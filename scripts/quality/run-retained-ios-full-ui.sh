#!/usr/bin/env bash
set -euo pipefail
ios_target="${PLATINUM_NATIVE_IOS_TARGET:-intel-ios18.5}"
case "$ios_target" in
  intel-ios18.5) ios_arch=x86_64; ios_version=18.5; ios_device_type=com.apple.CoreSimulator.SimDeviceType.iPhone-16 ;;
  arm64-ios26.2) ios_arch=arm64; ios_version=26.2; ios_device_type=com.apple.CoreSimulator.SimDeviceType.iPhone-17 ;;
  *) printf '%s\n' 'Unsupported native iOS audit target.' >&2; exit 2 ;;
esac
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != "$ios_arch" || "${CI:-}" != true ]]; then
  printf '%s\n' 'Use the disposable macOS CI runner matching the explicit native Simulator target.' >&2
  exit 2
fi
consumer_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app="$PWD/retained-app/PlatinumQA.app"
python3 "$consumer_dir/retained-ios-full-ui.py" immutable
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
    if [[ -f "$container/Documents/native-ui-input-diagnostics.json" ]]; then cp "$container/Documents/native-ui-input-diagnostics.json" native-ui-logs/native-ui-input-diagnostics.json; fi
    if [[ -f "$container/Documents/native-ui-ios-input-diagnostics.jsonl" ]]; then cp "$container/Documents/native-ui-ios-input-diagnostics.jsonl" native-ui-logs/native-ui-ios-input-diagnostics.jsonl; fi
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
runtime="$(xcrun simctl list runtimes --json | python3 -c 'import json,sys; items=[x for x in json.load(sys.stdin)["runtimes"] if x.get("isAvailable") and x["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")]; preferred=next((x for x in items if x["version"]==sys.argv[1]),None); print(preferred["identifier"] if preferred else "")' "$ios_version")"
test -n "$runtime"
ui_simulator="$(xcrun simctl create "Platinum full app UI ${GITHUB_RUN_ID}" "$ios_device_type" "$runtime")"
python3 "$consumer_dir/retained-ios-autofill.py" verify-created "$ui_simulator" --runtime "$runtime"
xcrun simctl boot "$ui_simulator"
xcrun simctl bootstatus "$ui_simulator" -b
python3 "$consumer_dir/retained-ios-autofill.py" configure "$ui_simulator"
xcrun simctl install "$ui_simulator" "$app"
python3 "$consumer_dir/retained-ios-full-ui.py" installed --device "$ui_simulator"
xcrun simctl spawn "$ui_simulator" log stream --style compact --level info --predicate 'process == "PlatinumQA"' > native-ui-logs/app.log 2>&1 &
ui_log_pid=$!
xcrun simctl io "$ui_simulator" recordVideo --codec=h264 native-ui-logs/navigation.mp4 > native-ui-logs/recording.log 2>&1 &
ui_video_pid=$!
flow_status=0
bash "$consumer_dir/run-retained-ios-flows.sh" "$ui_simulator" || flow_status=$?
evidence_status=0
container="$(xcrun simctl get_app_container "$ui_simulator" app.platinumcircles.mobile.qa data)" || evidence_status=1
mkdir -p native-ui-logs/memory-capture
if [[ -n "$container" ]]; then
  cp "$container/Documents/native-ui-receipt.json" native-ui-logs/native-ui-receipt.json || evidence_status=1
  cp "$container/Documents/native-ui-auth-diagnostics.json" native-ui-logs/native-ui-auth-diagnostics.json || evidence_status=1
  cp "$container/Documents/native-ui-input-diagnostics.json" native-ui-logs/native-ui-input-diagnostics.json || evidence_status=1
  cp "$container/Documents/native-ui-ios-input-diagnostics.jsonl" native-ui-logs/native-ui-ios-input-diagnostics.jsonl || evidence_status=1
  cp -R "$container/Documents/native-memory-capture/." native-ui-logs/memory-capture/ || evidence_status=1
else
  evidence_status=1
fi
memory_status=0
python3 scripts/quality/verify-native-ui-memory.py native-ui-logs/memory-capture ios || memory_status=$?
verification_status=0
node scripts/quality/verify-native-ui.cjs ios || verification_status=$?
cat > native-ui-logs/phase-results.json <<EOF
{"flows":$flow_status,"evidence":$evidence_status,"memoryDecoder":$memory_status,"fullAppVerifier":$verification_status}
EOF
if (( flow_status != 0 || evidence_status != 0 || memory_status != 0 || verification_status != 0 )); then exit 1; fi
python3 "$consumer_dir/retained-ios-full-ui.py" finish
