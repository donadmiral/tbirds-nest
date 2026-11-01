#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin || "${CI:-}" != true ]]; then
  printf '%s\n' 'Run the actual native player fixture on a disposable macOS CI runner.' >&2
  exit 2
fi
evidence="${STORY_PLAYBACK_LOG_DIR:-native-story-playback-logs}"
if [[ -e "$evidence/driver-result.json" ]]; then
  printf '%s\n' 'Refusing to replace an existing native playback result.' >&2
  exit 2
fi
mkdir -p "$evidence/sources"
evidence="$(cd "$evidence" && pwd)"
fixture_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/story-playback-runtime.XXXXXX")"
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

source_ref="${STORY_PLAYBACK_SOURCE_REF:-HEAD}"
source_commit="$(git rev-parse --verify --end-of-options "${source_ref}^{commit}")"
for name in StoryVideoView.swift StoryVideoComposition.swift; do
  git show "$source_commit:modules/boomerang/ios/$name" > "$evidence/sources/$name"
done
python3 - "$source_commit" "$evidence" <<'PY'
import hashlib,json,os,subprocess,sys
from pathlib import Path
root=Path(sys.argv[2])
files=[*sorted((root/'sources').glob('*.swift')),Path('scripts/quality/StoryPlaybackExpoAdapter.swift'),
 Path('scripts/quality/StoryVideoPlaybackHarness.swift'),Path('scripts/quality/story-playback-runtime.py'),
 Path('scripts/quality/test-ios-story-playback.sh'),Path('tests/native/assets/memory-capture-video.mp4')]
receipt={'playerSourceCommit':sys.argv[1],'harnessSourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
 'workflowRun':os.environ.get('GITHUB_RUN_ID'),'adaptedBoundary':'Expo UIView hosting and event delivery only; AVFoundation and player source are unchanged',
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
python3 scripts/quality/story-playback-runtime.py serve --video tests/native/assets/memory-capture-video.mp4 \
  --certificate "$fixture_dir/tls.crt" --key "$fixture_dir/tls.key" \
  --ready "$fixture_dir/server.json" --requests "$evidence/https-requests.jsonl" > "$evidence/https-server.log" 2>&1 &
server_pid=$!
for ((attempt=0; attempt<100; attempt++)); do
  if [[ -s "$fixture_dir/server.json" ]]; then break; fi
  kill -0 "$server_pid"
  sleep 0.1
done
origin="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["origin"])' "$fixture_dir/server.json")"
app="$fixture_dir/StoryVideoPlaybackHarness.app"
mkdir -p "$app"
cp tests/native/assets/memory-capture-video.mp4 "$app/fixture.mp4"
python3 - "$app" "$origin" <<'PY'
from pathlib import Path
import plistlib,sys
info={'CFBundleIdentifier':'com.platinum.qa.storyplayback','CFBundleName':'Story Playback Runtime',
 'CFBundleExecutable':'StoryVideoPlaybackHarness','CFBundlePackageType':'APPL','CFBundleVersion':'1',
 'CFBundleShortVersionString':'1.0','MinimumOSVersion':'15.1','LSRequiresIPhoneOS':True,'UIDeviceFamily':[1,2],
 'StoryFixtureOrigin':sys.argv[2],'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True}}
(Path(sys.argv[1])/'Info.plist').write_bytes(plistlib.dumps(info))
PY

xcrun --sdk iphonesimulator swiftc -O -swift-version 5 -sdk "$sdk" -target "$arch-apple-ios15.1-simulator" \
  -parse-as-library -emit-module -emit-object -module-name ExpoModulesCore \
  -emit-module-path "$fixture_dir/ExpoModulesCore.swiftmodule" scripts/quality/StoryPlaybackExpoAdapter.swift \
  -o "$fixture_dir/ExpoModulesCore.o" 2>&1 | tee "$evidence/host-adapter-build.log"
xcrun --sdk iphonesimulator swiftc -O -swift-version 5 -sdk "$sdk" -target "$arch-apple-ios15.1-simulator" \
  -parse-as-library -I "$fixture_dir" "$fixture_dir/ExpoModulesCore.o" \
  "$evidence/sources/StoryVideoComposition.swift" "$evidence/sources/StoryVideoView.swift" \
  scripts/quality/StoryVideoPlaybackHarness.swift \
  -framework UIKit -framework AVFoundation -framework CoreImage -framework CoreMedia -framework CoreVideo \
  -o "$app/StoryVideoPlaybackHarness" 2>&1 | tee "$evidence/swift-build.log"
codesign --force --sign - "$app" 2>&1 | tee "$evidence/fixture-signing.log"
simulator="$(xcrun simctl create "Story playback ${GITHUB_RUN_ID:-local} ${source_commit:0:8}" "$device_type" "$runtime")"
xcrun simctl boot "$simulator"
xcrun simctl bootstatus "$simulator" -b
xcrun simctl keychain "$simulator" add-root-cert "$fixture_dir/tls.crt"
xcrun simctl install "$simulator" "$app"
xcrun simctl spawn "$simulator" log stream --style compact --level info \
  --predicate 'process == "StoryVideoPlaybackHarness"' > "$evidence/native-system.log" 2>&1 &
native_log_pid=$!
python3 scripts/quality/story-playback-runtime.py run --device "$simulator" --bundle com.platinum.qa.storyplayback \
  --output "$evidence" --requests "$evidence/https-requests.jsonl"
