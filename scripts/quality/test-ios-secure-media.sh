#!/usr/bin/env bash
set -euo pipefail

# Executes the production CryptoKit core with local synthetic bytes in a disposable simulator.
# It has no accounts, network requests, Photos writes, or signed app release.
if [[ "$(uname -s)" != Darwin || "${CI:-}" != true ]]; then
  printf '%s\n' 'Run this fixture only in a disposable macOS CI checkout.' >&2
  exit 2
fi
run_bounded() {
  python3 -c 'import subprocess,sys; raise SystemExit(subprocess.run(sys.argv[2:], timeout=int(sys.argv[1])).returncode)' "$@"
}
mkdir -p secure-media-ios-logs
story_fixture_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/secure-media-fixture.XXXXXX")"
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
story_app="$story_fixture_dir/SecureMediaCryptoHarness.app"
mkdir -p "$story_app"
cat > "$story_app/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.platinum.qa.securemediaharness</string>
<key>CFBundleName</key><string>Secure Media Crypto QA</string>
<key>CFBundleExecutable</key><string>SecureMediaCryptoHarness</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>MinimumOSVersion</key><string>15.1</string>
<key>LSRequiresIPhoneOS</key><true/>
<key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
</dict></plist>
PLIST
xcrun --sdk iphonesimulator swiftc -sdk "$story_sdk" -target "$story_arch-apple-ios15.1-simulator" -parse-as-library \
  modules/secure-media/ios/SecureMediaCrypto.swift scripts/quality/SecureMediaCryptoHarness.swift \
  -framework UIKit -framework CryptoKit \
  -o "$story_app/SecureMediaCryptoHarness" 2>&1 | tee secure-media-ios-logs/swift-build.log
codesign --force --sign - "$story_app" 2>&1 | tee secure-media-ios-logs/fixture-signing.log
story_simulator="$(xcrun simctl create "Platinum Story Audio QA ${GITHUB_RUN_ID:-local}" "$story_device" "$story_runtime")"
xcrun simctl boot "$story_simulator"
run_bounded 180 xcrun simctl bootstatus "$story_simulator" -b
xcrun simctl install "$story_simulator" "$story_app"
set +e
run_bounded 120 xcrun simctl launch --console --terminate-running-process "$story_simulator" com.platinum.qa.securemediaharness 2>&1 | tee secure-media-ios-logs/simulator.log
set -e
story_container="$(xcrun simctl get_app_container "$story_simulator" com.platinum.qa.securemediaharness data)"
cp "$story_container/Documents/secure-media-receipt.json" secure-media-ios-logs/receipt.json
python3 - "$story_arch" "$story_runtime" <<'PYTEST'
import hashlib,json,os,sys
from pathlib import Path
p=Path('secure-media-ios-logs/receipt.json'); r=json.loads(p.read_text())
r.update(commit=os.environ.get('GITHUB_SHA'), workflow_run=os.environ.get('GITHUB_RUN_ID'), architecture=sys.argv[1], runtime=sys.argv[2])
r['sources']={str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in [Path('modules/secure-media/ios/SecureMediaCrypto.swift'),Path('scripts/quality/SecureMediaCryptoHarness.swift')]}
p.write_text(json.dumps(r,indent=2)+'\n')
expected={'full-resolution roundtrip','fresh nonce per write','tampered tag rejected without plaintext','rotated account key cannot decrypt','traversal and symlink escape rejected','invalid key and oversize input rejected','cache excluded from backup'}
assert r.get('passed') is True and len(r.get('cases',[]))==len(expected) and set(r['cases'])==expected, r
print('Actual CryptoKit runtime acceptance passed: seven cases. This is a simulator, not physical-phone acceptance.')
PYTEST
