#!/usr/bin/env bash
set -euo pipefail

# A disposable simulator encodes synthetic source/camera fixtures with the exact
# production renderer. It never signs in, uploads, or writes to the photo library.
if [[ "$(uname -s)" != Darwin || "${CI:-}" != true ]]; then
  printf '%s\n' 'Run this fixture only in a disposable macOS CI checkout.' >&2
  exit 2
fi
mkdir -p native-react-logs
react_fixture_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/react-video-fixture.XXXXXX")"
react_simulator=""
cleanup_react_fixture() {
  if [[ -n "$react_simulator" ]]; then
    xcrun simctl shutdown "$react_simulator" >/dev/null 2>&1 || true
    xcrun simctl delete "$react_simulator" >/dev/null 2>&1 || true
  fi
  rm -rf "$react_fixture_dir"
}
trap cleanup_react_fixture EXIT
react_arch="$(uname -m)"
react_sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
react_runtime="$(xcrun simctl list runtimes --json | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x.get("isAvailable") and x["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")]; r.sort(key=lambda x:tuple(int(n) for n in x["version"].split(".")),reverse=True); print(r[0]["identifier"] if r else "")')"
if [[ -z "$react_runtime" ]]; then
  printf '%s\n' 'No iOS simulator runtime. React encoding cannot be verified.' >&2
  exit 2
fi
react_device="$(xcrun simctl list devicetypes --json | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["devicetypes"] if x.get("productFamily")=="iPhone" or x["name"].startswith("iPhone")]; p=next((x for x in r if x["name"]=="iPhone 16"),r[-1] if r else None); print(p["identifier"] if p else "")')"
react_app="$react_fixture_dir/ReactVideoExportHarness.app"
mkdir -p "$react_app"
cat > "$react_app/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.platinum.qa.reactvideoharness</string>
<key>CFBundleName</key><string>React Video Export QA</string>
<key>CFBundleExecutable</key><string>ReactVideoExportHarness</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>MinimumOSVersion</key><string>15.1</string>
<key>LSRequiresIPhoneOS</key><true/>
<key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
</dict></plist>
PLIST
xcrun --sdk iphonesimulator swiftc -O -sdk "$react_sdk" -target "$react_arch-apple-ios15.1-simulator" -parse-as-library \
  modules/boomerang/ios/StoryVideoComposition.swift modules/boomerang/ios/ReactVideoComposition.swift scripts/quality/ReactVideoExportHarness.swift \
  -framework UIKit -framework AVFoundation -framework CoreImage -framework CoreMedia -framework CoreVideo -framework Vision \
  -o "$react_app/ReactVideoExportHarness" 2>&1 | tee native-react-logs/swift-build.log
codesign --force --sign - "$react_app" 2>&1 | tee native-react-logs/fixture-signing.log
react_simulator="$(xcrun simctl create "Platinum React QA ${GITHUB_RUN_ID:-local}" "$react_device" "$react_runtime")"
xcrun simctl boot "$react_simulator"
xcrun simctl bootstatus "$react_simulator" -b
xcrun simctl install "$react_simulator" "$react_app"
set +e
xcrun simctl launch --console --terminate-running-process "$react_simulator" com.platinum.qa.reactvideoharness 2>&1 | tee native-react-logs/simulator.log
set -e
react_container="$(xcrun simctl get_app_container "$react_simulator" com.platinum.qa.reactvideoharness data)"
cp "$react_container/Documents/react-video-receipt.json" native-react-logs/receipt.json
if [[ -d "$react_container/Documents/media" ]]; then
  cp -R "$react_container/Documents/media/." native-react-logs/
fi
python3 - "$react_arch" "$react_runtime" <<'PY'
import hashlib,json,os,sys
from pathlib import Path
path=Path('native-react-logs/receipt.json')
receipt=json.loads(path.read_text())
receipt.update(commit=os.environ.get('GITHUB_SHA'),workflow_run=os.environ.get('GITHUB_RUN_ID'),architecture=sys.argv[1],runtime=sys.argv[2])
receipt['sources']={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in map(Path,[
 'modules/boomerang/ios/StoryVideoComposition.swift','modules/boomerang/ios/ReactVideoComposition.swift',
 'scripts/quality/ReactVideoExportHarness.swift','scripts/quality/test-ios-react-video.sh'])}
receipt['movies']={p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in Path('native-react-logs').glob('*.mp4')}
path.write_text(json.dumps(receipt,indent=2)+'\n')
expected={
 'source pauses and replays preserve moving face and continuous microphone',
 'photo source keeps movable PiP voice and burned artwork in one video',
 'trimming inside a freeze keeps face source and voice aligned',
 'invalid timelines missing microphone and foreign paths leave no files',
 'cancellation removes partial exports and allows same identifier retry',
}
cases=receipt.get('cases',[])
if receipt.get('passed') is not True or len(cases)!=len(expected) or {case.get('name') for case in cases}!=expected:
 raise SystemExit('Native React export failed: '+str(receipt.get('error')))
movies={'pc-react-export-'+name+'.mp4' for name in ['pause-replay','photo-pip','trim-hold','retry']}
if set(receipt['movies'])!=movies or any(value['bytes']<=1024 for value in receipt['movies'].values()):
 raise SystemExit('React did not retain all four verified native MP4 files.')
print('Native React: five named runtime cases passed; four decoded and inspected MP4s retained and hashed.')
PY
