#!/usr/bin/env bash
set -euo pipefail

# This installs only a local synthetic fixture in a disposable CI simulator.
# It has no accounts, network requests, Photos writes, or signed app release.
if [[ "$(uname -s)" != Darwin || "${CI:-}" != true ]]; then
  printf '%s\n' 'Run this fixture only in a disposable macOS CI checkout.' >&2
  exit 2
fi
mkdir -p native-memory-logs
memory_fixture_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/memory-movie-fixture.XXXXXX")"
memory_simulator=""
cleanup_memory_fixture() {
  if [[ -n "$memory_simulator" ]]; then
    xcrun simctl shutdown "$memory_simulator" >/dev/null 2>&1 || true
    xcrun simctl delete "$memory_simulator" >/dev/null 2>&1 || true
  fi
  rm -rf "$memory_fixture_dir"
}
trap cleanup_memory_fixture EXIT
memory_arch="$(uname -m)"
memory_sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
memory_runtime="$(xcrun simctl list runtimes --json | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x.get("isAvailable") and x["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")]; r.sort(key=lambda x:tuple(int(n) for n in x["version"].split(".")),reverse=True); print(r[0]["identifier"] if r else "")')"
if [[ -z "$memory_runtime" ]]; then
  printf '%s\n' 'No available iOS simulator runtime. The memory movie gate cannot pass.' >&2
  exit 2
fi
memory_device="$(xcrun simctl list devicetypes --json | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["devicetypes"] if x.get("productFamily")=="iPhone" or x["name"].startswith("iPhone")]; preferred=next((x for x in r if x["name"]=="iPhone 16"),r[-1] if r else None); print(preferred["identifier"] if preferred else "")')"
memory_app="$memory_fixture_dir/MemoryMovieExportHarness.app"
mkdir -p "$memory_app"
for memory_extension in gif png webp; do
  cp "scripts/quality/android-story-export/src/androidTest/assets/memory-animated.$memory_extension" "$memory_app/memory-animated.$memory_extension"
done
cat > "$memory_app/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.platinum.qa.memorymovieharness</string>
<key>CFBundleName</key><string>Memory Movie Export QA</string>
<key>CFBundleExecutable</key><string>MemoryMovieExportHarness</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>MinimumOSVersion</key><string>15.1</string>
<key>LSRequiresIPhoneOS</key><true/>
<key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
</dict></plist>
PLIST
xcrun --sdk iphonesimulator swiftc -sdk "$memory_sdk" -target "$memory_arch-apple-ios15.1-simulator" -parse-as-library \
  modules/boomerang/ios/StoryVideoComposition.swift modules/boomerang/ios/MemoryMovieComposition.swift scripts/quality/MemoryMovieExportHarness.swift \
  -framework UIKit -framework AVFoundation -framework CoreImage -framework CoreMedia -framework CoreVideo -framework ImageIO -framework UniformTypeIdentifiers \
  -o "$memory_app/MemoryMovieExportHarness" 2>&1 | tee native-memory-logs/swift-build.log
codesign --force --sign - "$memory_app" 2>&1 | tee native-memory-logs/fixture-signing.log
memory_simulator="$(xcrun simctl create "Platinum Memory Movie QA ${GITHUB_RUN_ID:-local}" "$memory_device" "$memory_runtime")"
xcrun simctl boot "$memory_simulator"
xcrun simctl bootstatus "$memory_simulator" -b
xcrun simctl install "$memory_simulator" "$memory_app"
set +e
xcrun simctl launch --console --terminate-running-process "$memory_simulator" com.platinum.qa.memorymovieharness 2>&1 | tee native-memory-logs/simulator.log
set -e
memory_container="$(xcrun simctl get_app_container "$memory_simulator" com.platinum.qa.memorymovieharness data)"
cp "$memory_container/Documents/memory-movie-receipt.json" native-memory-logs/receipt.json
if [[ -d "$memory_container/Documents/media" ]]; then
  cp -R "$memory_container/Documents/media/." native-memory-logs/
fi
python3 - "$memory_arch" "$memory_runtime" <<'PY'
import hashlib,json,os,sys
from pathlib import Path
p=Path('native-memory-logs/receipt.json')
receipt=json.loads(p.read_text())
receipt.update(commit=os.environ.get('GITHUB_SHA'), workflow_run=os.environ.get('GITHUB_RUN_ID'), architecture=sys.argv[1], runtime=sys.argv[2])
receipt['sources']={str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in [Path('modules/boomerang/ios/StoryVideoComposition.swift'),Path('modules/boomerang/ios/MemoryMovieComposition.swift'),Path('scripts/quality/MemoryMovieExportHarness.swift'),Path('scripts/quality/test-ios-memory-movie.sh')]}
receipt['fixtures']={str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(Path('scripts/quality/android-story-export/src/androidTest/assets').glob('memory-animated.*'))}
receipt['movies']={f.name:{'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size} for f in Path('native-memory-logs').glob('*.mp4')}
receipt['images']={f.name:{'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size} for f in Path('native-memory-logs').glob('*.png')}
p.write_text(json.dumps(receipt,indent=2)+'\n')
expected_cases={
 'ordered scenes keep independent page audio and continuous ducked book music',
 'slow scenes preserve original pitch and fractional continuous loops',
 'changing music preserves excerpt position across a page and duck boundary',
 'one-pass page voiceover leaves later scenes silent',
 'muted original and zero-gain book music remain silent',
 'full scene fade and motion preserve timed artwork',
 'private photo normalization applies EXIF and preserves bounded transparent PNG',
 'animated photo bytes are rejected without a partial normalized file',
 'invalid bounds and foreign output paths fail without partial movies',
 'cancellation excludes concurrent story work cleans files and permits same-ID retry',
 'an unreadable source cannot produce a partial book movie',
}
cases=receipt.get('cases',[])
names=[case.get('name') for case in cases if isinstance(case,dict)] if isinstance(cases,list) else []
if receipt.get('passed') is not True or not isinstance(cases,list) or len(cases) != len(expected_cases) or len(names) != len(expected_cases) or not all(isinstance(name,str) for name in names) or set(names) != expected_cases:
 raise SystemExit('Native memory movie export failed: '+str(receipt.get('error')))
expected_movies={'pc-memory-export-'+name+'.mp4' for name in ['ordered','slow-fractional','continuous-phase','voice-once','muted','motion','retry']}
if set(receipt['movies']) != expected_movies or any(movie['bytes'] <= 1024 for movie in receipt['movies'].values()):
 raise SystemExit('Native memory export did not retain all seven expected encoded movies.')
if set(receipt['images']) != {'pc-memory-image-normalized.png','pc-memory-image-transparent.png'} or any(image['bytes'] <= 0 for image in receipt['images'].values()):
 raise SystemExit('Native memory export did not retain both verified normalized images.')
if len(receipt['fixtures']) != 3:
 raise SystemExit('Native memory export did not bind all three actual animation fixtures.')
print('Native whole-book movies: all eleven named simulator cases passed; seven movies and both normalized PNGs retained and hashed.')
PY
