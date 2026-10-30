#!/usr/bin/env bash
set -euo pipefail

# This installs only a local synthetic fixture in a disposable CI simulator.
# It has no accounts, network requests, Photos writes, or signed app release.
if [[ "$(uname -s)" != Darwin || "${CI:-}" != true ]]; then
  printf '%s\n' 'Run this fixture only in a disposable macOS CI checkout.' >&2
  exit 2
fi
mkdir -p native-audio-logs
story_fixture_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/story-audio-fixture.XXXXXX")"
story_simulator=""
cleanup_story_fixture() {
  if [[ -n "$story_simulator" ]]; then
    xcrun simctl shutdown "$story_simulator" >/dev/null 2>&1 || true
    xcrun simctl delete "$story_simulator" >/dev/null 2>&1 || true
  fi
  rm -rf "$story_fixture_dir"
}
trap cleanup_story_fixture EXIT
story_arch="$(uname -m)"
story_sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
story_runtime="$(xcrun simctl list runtimes --json | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x.get("isAvailable") and x["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")]; r.sort(key=lambda x:tuple(int(n) for n in x["version"].split(".")),reverse=True); print(r[0]["identifier"] if r else "")')"
if [[ -z "$story_runtime" ]]; then
  printf '%s\n' 'No available iOS simulator runtime. The audio export gate cannot pass.' >&2
  exit 2
fi
story_device="$(xcrun simctl list devicetypes --json | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["devicetypes"] if x.get("productFamily")=="iPhone" or x["name"].startswith("iPhone")]; preferred=next((x for x in r if x["name"]=="iPhone 16"),r[-1] if r else None); print(preferred["identifier"] if preferred else "")')"
story_app="$story_fixture_dir/StoryAudioExportHarness.app"
mkdir -p "$story_app"
cat > "$story_app/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.platinum.qa.storyaudioharness</string>
<key>CFBundleName</key><string>Story Audio Export QA</string>
<key>CFBundleExecutable</key><string>StoryAudioExportHarness</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>MinimumOSVersion</key><string>15.1</string>
<key>LSRequiresIPhoneOS</key><true/>
<key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
</dict></plist>
PLIST
xcrun --sdk iphonesimulator swiftc -sdk "$story_sdk" -target "$story_arch-apple-ios15.1-simulator" -parse-as-library \
  modules/boomerang/ios/StoryVideoComposition.swift scripts/quality/StoryAudioExportHarness.swift \
  -framework UIKit -framework AVFoundation -framework CoreImage -framework CoreMedia -framework CoreVideo \
  -o "$story_app/StoryAudioExportHarness" 2>&1 | tee native-audio-logs/swift-build.log
codesign --force --sign - "$story_app" 2>&1 | tee native-audio-logs/fixture-signing.log
story_simulator="$(xcrun simctl create "Platinum Story Audio QA ${GITHUB_RUN_ID:-local}" "$story_device" "$story_runtime")"
xcrun simctl boot "$story_simulator"
xcrun simctl bootstatus "$story_simulator" -b
xcrun simctl install "$story_simulator" "$story_app"
set +e
xcrun simctl launch --console --terminate-running-process "$story_simulator" com.platinum.qa.storyaudioharness 2>&1 | tee native-audio-logs/simulator.log
set -e
story_container="$(xcrun simctl get_app_container "$story_simulator" com.platinum.qa.storyaudioharness data)"
cp "$story_container/Documents/story-audio-receipt.json" native-audio-logs/receipt.json
if [[ -d "$story_container/Documents/media" ]]; then
  cp "$story_container/Documents/media/"*.mp4 native-audio-logs/
fi
python3 - "$story_arch" "$story_runtime" <<'PY'
import hashlib,json,os,sys
from pathlib import Path
p=Path('native-audio-logs/receipt.json')
receipt=json.loads(p.read_text())
receipt.update(commit=os.environ.get('GITHUB_SHA'), workflow_run=os.environ.get('GITHUB_RUN_ID'), architecture=sys.argv[1], runtime=sys.argv[2])
receipt['sources']={str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in [Path('modules/boomerang/ios/StoryVideoComposition.swift'),Path('scripts/quality/StoryAudioExportHarness.swift'),Path('scripts/quality/test-ios-story-audio.sh')]}
receipt['movies']={f.name:{'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size} for f in Path('native-audio-logs').glob('*.mp4')}
p.write_text(json.dumps(receipt,indent=2)+'\n')
expected_cases={
 'video trim and speed keep looping excerpt and music pitch',
 'voiceover stops while the remaining video stays present',
 'original mix level and muted soundtrack are preserved',
 '2x original pitch and independent looping music stay in sync',
 '0.5x original pitch and independent looping music stay in sync',
 'photo or text artwork becomes a movie with actual audio',
 'invalid audio range is rejected and partial output removed',
 'cancellation stops the native writer and removes temporary movies',
}
cases=receipt.get('cases',[])
names=[case.get('name') for case in cases if isinstance(case,dict)] if isinstance(cases,list) else []
if receipt.get('passed') is not True or not isinstance(cases,list) or len(cases) != len(expected_cases) or len(names) != len(expected_cases) or not all(isinstance(name,str) for name in names) or set(names) != expected_cases:
 raise SystemExit('Native story audio export failed: '+str(receipt.get('error')))
expected_movies={'pc-story-export-'+name+'.mp4' for name in ['loop','voice','original','mixed-speed-2x','mixed-speed-0.5x','still']}
if set(receipt['movies']) != expected_movies or any(movie['bytes'] <= 1024 for movie in receipt['movies'].values()):
 raise SystemExit('Native story audio export did not retain all six expected encoded movies.')
print('Native encoded story audio: all eight named simulator cases passed; all six movies retained and hashed.')
PY
