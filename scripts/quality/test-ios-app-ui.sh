#!/usr/bin/env bash
set -euo pipefail
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != x86_64 || "${CI:-}" != true ]]; then
  printf '%s\n' 'Use the disposable Intel macOS CI runner for the locked MLKit Simulator pods.' >&2
  exit 2
fi
node scripts/quality/prepare-native-ui.cjs
ui_simulator=''
ui_log_pid=''
ui_video_pid=''
cleanup() {
  status=$?
  trap - EXIT
  if [[ -n "$ui_video_pid" ]]; then
    kill -INT "$ui_video_pid" >/dev/null 2>&1 || true
    wait "$ui_video_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$ui_log_pid" ]]; then kill "$ui_log_pid" >/dev/null 2>&1 || true; fi
  if [[ -n "$ui_simulator" ]]; then
    container="$(xcrun simctl get_app_container "$ui_simulator" app.platinumcircles.mobile.qa data 2>/dev/null || true)"
    if [[ -f "$container/Documents/native-ui-receipt.json" ]]; then cp "$container/Documents/native-ui-receipt.json" native-ui-logs/native-ui-receipt.json; fi
    if [[ -f "$container/Documents/native-ui-auth-diagnostics.json" ]]; then cp "$container/Documents/native-ui-auth-diagnostics.json" native-ui-logs/native-ui-auth-diagnostics.json; fi
    if [[ -d "$container/Documents/native-memory-capture" ]]; then
      mkdir -p native-ui-logs/memory-capture
      cp -R "$container/Documents/native-memory-capture/." native-ui-logs/memory-capture/
    fi
    xcrun simctl shutdown "$ui_simulator" >/dev/null 2>&1 || true
    xcrun simctl delete "$ui_simulator" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT
{
  xcodebuild -version
  xcrun --sdk iphonesimulator --show-sdk-version
  node --version
  maestro --version
} > native-ui-logs/toolchain.log 2>&1
npx --no-install expo prebuild --platform ios --no-install \
  --skip-dependency-update react,react-native 2>&1 | tee native-ui-logs/prebuild.log
python3 scripts/quality/native-ui-ios-url-trace.py
python3 - <<'PY'
from pathlib import Path
import plistlib
configs=list(Path('ios').glob('*/Supporting/Expo.plist'))
if len(configs)!=1: raise SystemExit('Expected exactly one generated Expo updates configuration.')
data=plistlib.loads(configs[0].read_bytes()); data['EXUpdatesEnabled']=False
configs[0].write_bytes(plistlib.dumps(data))
PY
pod _1.16.2_ install --project-directory=ios 2>&1 | tee native-ui-logs/pods.log
xcodebuild -workspace ios/PlatinumQA.xcworkspace -scheme PlatinumQA \
  -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath native-ui-derived CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=- \
  ONLY_ACTIVE_ARCH=YES ARCHS=x86_64 FORCE_BUNDLING=1 build 2>&1 | tee native-ui-logs/build.log
app="$PWD/native-ui-derived/Build/Products/Release-iphonesimulator/PlatinumQA.app"
test -s "$app/main.jsbundle"
xcrun lipo "$app/PlatinumQA" -verify_arch x86_64
# Xcode creates simulated entitlements in the executable. The host macOS code
# signature is separate; adding iOS app entitlements to that signature is wrong.
python3 scripts/quality/native-ui-ios-entitlements.py "$app" native-ui-logs/simulator-entitlements-before-resign.json
codesign --display --verbose=4 "$app" > native-ui-logs/simulator-signature-before-resign.log 2>&1
codesign --display --entitlements - --xml "$app" > native-ui-logs/simulator-host-entitlements-before-resign.plist 2> native-ui-logs/simulator-host-entitlements-before-resign.log
codesign --force --deep --sign - "$app" 2>&1 | tee native-ui-logs/simulator-signing.log
codesign --verify --deep --strict --verbose=2 "$app" 2>&1 | tee native-ui-logs/simulator-signature-verification.log
codesign --display --verbose=4 "$app" > native-ui-logs/simulator-signature.log 2>&1
codesign --display --entitlements - --xml "$app" > native-ui-logs/simulator-host-entitlements.plist 2> native-ui-logs/simulator-host-entitlements.log
python3 scripts/quality/native-ui-ios-entitlements.py "$app" native-ui-logs/simulator-entitlements.json
python3 - <<'PY'
from pathlib import Path
import json
import plistlib
logs = Path('native-ui-logs')
before = json.loads((logs / 'simulator-entitlements-before-resign.json').read_text())
after = json.loads((logs / 'simulator-entitlements.json').read_text())
if before['embeddedSections'] != after['embeddedSections'] or before['simulatedEntitlements'] != after['simulatedEntitlements']:
    raise SystemExit('Ad-hoc signing changed the simulated app entitlements.')
for suffix in ('-before-resign', ''):
    metadata = (logs / ('simulator-signature' + suffix + '.log')).read_text()
    if 'Signature=adhoc' not in metadata:
        raise SystemExit('Expected only local ad-hoc Simulator signing.')
    data = (logs / ('simulator-host-entitlements' + suffix + '.plist')).read_bytes().strip()
    host = plistlib.loads(data) if data else {}
    if set(host) - {'get-task-allow', 'com.apple.security.get-task-allow'}:
        raise SystemExit('Unexpected application entitlements in the host Simulator signature.')
PY
runtime="$(xcrun simctl list runtimes --json | python3 -c 'import json,sys; items=[x for x in json.load(sys.stdin)["runtimes"] if x.get("isAvailable") and x["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")]; preferred=next((x for x in items if x["version"]=="18.5"),None); print(preferred["identifier"] if preferred else "")')"
test -n "$runtime"
ui_simulator="$(xcrun simctl create "Platinum full app UI ${GITHUB_RUN_ID}" com.apple.CoreSimulator.SimDeviceType.iPhone-16 "$runtime")"
xcrun simctl boot "$ui_simulator"
xcrun simctl bootstatus "$ui_simulator" -b
xcrun simctl install "$ui_simulator" "$app"
xcrun simctl spawn "$ui_simulator" log stream --style compact --level info --predicate 'process == "PlatinumQA"' > native-ui-logs/app.log 2>&1 &
ui_log_pid=$!
xcrun simctl io "$ui_simulator" recordVideo --codec=h264 native-ui-logs/navigation.mp4 > native-ui-logs/recording.log 2>&1 &
ui_video_pid=$!
flow_status=0
bash scripts/quality/run-native-ui-flows.sh "$ui_simulator" || flow_status=$?
evidence_status=0
container="$(xcrun simctl get_app_container "$ui_simulator" app.platinumcircles.mobile.qa data)" || evidence_status=1
mkdir -p native-ui-logs/memory-capture
if [[ -n "$container" ]]; then
  cp "$container/Documents/native-ui-receipt.json" native-ui-logs/native-ui-receipt.json || evidence_status=1
  cp "$container/Documents/native-ui-auth-diagnostics.json" native-ui-logs/native-ui-auth-diagnostics.json || evidence_status=1
  cp -R "$container/Documents/native-memory-capture/." native-ui-logs/memory-capture/ || evidence_status=1
else
  evidence_status=1
fi
memory_status=0
python3 scripts/quality/verify-native-ui-memory.py || memory_status=$?
verification_status=0
node scripts/quality/verify-native-ui.cjs ios || verification_status=$?
cat > native-ui-logs/phase-results.json <<EOF
{"flows":$flow_status,"evidence":$evidence_status,"memoryDecoder":$memory_status,"fullAppVerifier":$verification_status}
EOF
if (( flow_status != 0 || evidence_status != 0 || memory_status != 0 || verification_status != 0 )); then exit 1; fi
