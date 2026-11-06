#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin || "${CI:-}" != true ]]; then
  printf '%s\n' 'Run the actual native player fixture on a disposable macOS CI runner.' >&2
  exit 2
fi
evidence="${STORY_HLS_GRADE_LOG_DIR:-native-story-hls-grade-logs}"
if [[ -e "$evidence/driver-result.json" ]]; then
  printf '%s\n' 'Refusing to replace an existing native playback result.' >&2
  exit 2
fi
mkdir -p "$evidence/sources"
evidence="$(cd "$evidence" && pwd)"
fixture_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/story-hls-grade-runtime.XXXXXX")"
simulator=''
server_pid=''
native_log_pid=''
cleanup() {
  status=$?
  trap - EXIT
  if [[ -n "$native_log_pid" ]]; then kill "$native_log_pid" >/dev/null 2>&1 || true; fi
  if [[ -n "$simulator" ]]; then
    xcrun simctl shutdown "$simulator" >/dev/null 2>&1 || true
    xcrun simctl delete "$simulator" >/dev/null 2>&1 || true
  fi
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$fixture_dir"
  exit "$status"
}
trap cleanup EXIT

source_ref="${STORY_HLS_GRADE_SOURCE_REF:-HEAD}"
source_commit="$(git rev-parse --verify --end-of-options "${source_ref}^{commit}")"
for name in StoryHLSGradeSurface.swift StoryVideoComposition.swift StoryVideoView.swift; do
  git show "$source_commit:modules/boomerang/ios/$name" > "$evidence/sources/$name"
done
python3 - "$source_commit" "$evidence" <<'PY'
import hashlib,json,os,subprocess,sys
from pathlib import Path
root=Path(sys.argv[2])
files=[*sorted((root/'sources').glob('*.swift')),Path('scripts/quality/StoryPlaybackExpoAdapter.swift'),
 Path('scripts/quality/StoryHLSGradeHarness.swift'),Path('scripts/quality/story-hls-grade-runtime.py'),
 Path('scripts/quality/test-ios-story-hls-grade.sh')]
receipt={'playerSourceCommit':sys.argv[1],'harnessSourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
 'workflowRun':os.environ.get('GITHUB_RUN_ID'),'adaptedBoundary':'Standalone UIKit host drives production HLS Metal surface with real AVPlayer; no React Native bridge',
 'sources':{str(p.relative_to(root)) if p.is_relative_to(root) else str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}
(root/'source.json').write_text(json.dumps(receipt,indent=2)+'\n')
PY

arch="$(uname -m)"
sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
runtime="$(xcrun simctl list runtimes --json | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x.get("isAvailable") and x["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")]; r.sort(key=lambda x:tuple(int(n) for n in x["version"].split(".")),reverse=True); print(r[0]["identifier"] if r else "")')"
test -n "$runtime"
device_type="$(xcrun simctl list devicetypes --json | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["devicetypes"] if x.get("productFamily")=="iPhone" or x["name"].startswith("iPhone")]; p=next((x for x in r if x["name"]=="iPhone 16"),r[-1] if r else None); print(p["identifier"] if p else "")')"
xcodebuild -version > "$evidence/toolchain.log"
xcrun swiftc --version >> "$evidence/toolchain.log"
python3 - "$arch" "$runtime" "$evidence" <<'PY'
from pathlib import Path
import json,sys
(Path(sys.argv[3])/'runtime.json').write_text(json.dumps({'architecture':sys.argv[1],
 'simulatorRuntime':sys.argv[2],'swiftLanguageMode':'5','optimization':'-O'},indent=2)+'\n')
PY

# The only media origin is an isolated loopback TLS server. Trust its short-lived
# certificate in this newly created Simulator, never in the host or a real phone.
cat > "$fixture_dir/openssl.cnf" <<'CONF'
[req]
distinguished_name=dn
x509_extensions=v3
prompt=no
[dn]
CN=localhost
[v3]
basicConstraints=critical,CA:TRUE
keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1
CONF
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 1 \
  -config "$fixture_dir/openssl.cnf" -keyout "$fixture_dir/tls.key" -out "$fixture_dir/tls.crt" \
  > "$evidence/tls-setup.log" 2>&1
# Deterministic source: red before the trim boundary, blue afterwards. A
# channel-swap grade must produce green, allowing compositor evidence to prove
# both real HLS decode and the requested trimmed frame. The single top-left
# black marker verifies orientation, including any CIImage-to-Metal flip.
if ! command -v ffmpeg >/dev/null; then brew install ffmpeg > "$evidence/ffmpeg-install.log" 2>&1; fi
mkdir -p "$evidence/media"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'color=c=red:s=320x240:r=30:d=1' \
  -f lavfi -i 'color=c=blue:s=320x240:r=30:d=7' \
  -filter_complex '[0:v][1:v]concat=n=2:v=1:a=0,drawbox=x=0:y=0:w=40:h=40:color=black:t=fill[v]' -map '[v]' \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 30 -keyint_min 30 -sc_threshold 0 \
  -hls_time 1 -hls_list_size 0 -hls_playlist_type vod \
  -hls_segment_filename "$evidence/media/segment-%03d.ts" "$evidence/media/fixture.m3u8" \
  > "$evidence/media-encode.log" 2>&1
ffprobe -v error -show_streams -show_format -of json "$evidence/media/fixture.m3u8" > "$evidence/media-probe.json"
python3 scripts/quality/story-hls-grade-runtime.py serve --media "$evidence/media" \
  --certificate "$fixture_dir/tls.crt" --key "$fixture_dir/tls.key" \
  --ready "$fixture_dir/server.json" --requests "$evidence/https-requests.jsonl" > "$evidence/https-server.log" 2>&1 &
server_pid=$!
for ((attempt=0; attempt<100; attempt++)); do
  if [[ -s "$fixture_dir/server.json" ]]; then break; fi
  kill -0 "$server_pid"
  sleep 0.1
done
origin="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["origin"])' "$fixture_dir/server.json")"
app="$fixture_dir/StoryHLSGradeHarness.app"
mkdir -p "$app"
python3 - "$app" "$origin" <<'PY'
from pathlib import Path
import plistlib,sys
info={'CFBundleIdentifier':'com.platinum.qa.storyhlsgrade','CFBundleName':'Story HLS Grade Runtime',
 'CFBundleExecutable':'StoryHLSGradeHarness','CFBundlePackageType':'APPL','CFBundleVersion':'1',
 'CFBundleShortVersionString':'1.0','MinimumOSVersion':'15.1','LSRequiresIPhoneOS':True,'UIDeviceFamily':[1,2],
 'StoryFixtureOrigin':sys.argv[2],'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True}}
(Path(sys.argv[1])/'Info.plist').write_bytes(plistlib.dumps(info))
PY

xcrun --sdk iphonesimulator swiftc -O -swift-version 5 -sdk "$sdk" -target "$arch-apple-ios15.1-simulator" \
  -parse-as-library -emit-module -emit-object -module-name ExpoModulesCore \
  -emit-module-path "$fixture_dir/ExpoModulesCore.swiftmodule" scripts/quality/StoryPlaybackExpoAdapter.swift \
  -o "$fixture_dir/ExpoModulesCore.o" 2>&1 | tee "$evidence/host-adapter-build.log"
xcrun --sdk iphonesimulator swiftc -O -swift-version 5 -sdk "$sdk" -target "$arch-apple-ios15.1-simulator" \
  -parse-as-library -I "$fixture_dir" "$fixture_dir/ExpoModulesCore.o" "$evidence/sources/StoryVideoView.swift" \
  "$evidence/sources/StoryVideoComposition.swift" "$evidence/sources/StoryHLSGradeSurface.swift" \
  scripts/quality/StoryHLSGradeHarness.swift \
  -framework UIKit -framework AVFoundation -framework CoreImage -framework CoreMedia -framework CoreVideo -framework Metal -framework QuartzCore \
  -o "$app/StoryHLSGradeHarness" 2>&1 | tee "$evidence/swift-build.log"
codesign --force --sign - "$app" 2>&1 | tee "$evidence/fixture-signing.log"
simulator="$(xcrun simctl create "Story HLS grade ${GITHUB_RUN_ID:-local} ${source_commit:0:8}" "$device_type" "$runtime")"
xcrun simctl boot "$simulator"
xcrun simctl bootstatus "$simulator" -b
xcrun simctl keychain "$simulator" add-root-cert "$fixture_dir/tls.crt"
xcrun simctl install "$simulator" "$app"
xcrun simctl spawn "$simulator" log stream --style compact --level info \
  --predicate 'process == "StoryHLSGradeHarness"' > "$evidence/native-system.log" 2>&1 &
native_log_pid=$!
python3 scripts/quality/story-hls-grade-runtime.py run --device "$simulator" --bundle com.platinum.qa.storyhlsgrade \
  --output "$evidence" --requests "$evidence/https-requests.jsonl"
