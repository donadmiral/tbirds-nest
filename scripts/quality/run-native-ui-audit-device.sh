#!/usr/bin/env bash
set -euo pipefail
# Consume one source-bound binary on a disposable device. This script never builds.
platform="${1:?Expected ios or android}"
groups="${2:?Expected feature groups}"
if [[ "${CI:-}" != true || "${EXPO_PUBLIC_APP_ENV:-}" != qa || "${EXPO_PUBLIC_SUPABASE_ANON_KEY:-}" != native-ui-synthetic-no-provider-key ]]; then
  printf '%s\n' 'Independent native audits require the isolated synthetic QA environment.' >&2
  exit 2
fi
mkdir -p native-ui-logs
binary_manifest="$PWD/native-audit-binary/binary-manifest.json"
test -s "$binary_manifest"
source_tree="$(git rev-parse 'HEAD^{tree}')"
work_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/platinum-native-audit.XXXXXX")"
device=''
emulator_pid=''
xvfb_pid=''
log_pid=''
cleanup() {
  status=$?
  trap - EXIT
  if [[ -n "$log_pid" ]]; then kill "$log_pid" >/dev/null 2>&1 || true; fi
  if [[ "$platform" == ios && -n "$device" ]]; then
    xcrun simctl shutdown "$device" >/dev/null 2>&1 || true
    xcrun simctl delete "$device" >/dev/null 2>&1 || true
  fi
  if [[ -n "$emulator_pid" ]]; then
    timeout 10 adb -s "$device" emu kill >/dev/null 2>&1 || true
    kill "$emulator_pid" >/dev/null 2>&1 || true
    wait "$emulator_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$xvfb_pid" ]]; then
    kill "$xvfb_pid" >/dev/null 2>&1 || true
    timeout 2 tail --pid="$xvfb_pid" -f /dev/null >/dev/null 2>&1 || kill -9 "$xvfb_pid" >/dev/null 2>&1 || true
    wait "$xvfb_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir"
  exit "$status"
}
trap cleanup EXIT
if [[ "$platform" == ios ]]; then
  [[ "$(uname -s)" == Darwin && "$(uname -m)" == x86_64 ]]
  tar -xzf native-audit-binary/qa.app.tar.gz -C native-audit-binary
  binary="$PWD/native-audit-binary/PlatinumQA.app"
  test -s "$binary/main.jsbundle"
  codesign --verify --deep --strict "$binary"
  runtime=com.apple.CoreSimulator.SimRuntime.iOS-18-5
  device="$(xcrun simctl create "Platinum audit ${GITHUB_RUN_ID}-${GITHUB_JOB}" com.apple.CoreSimulator.SimDeviceType.iPhone-16 "$runtime")"
  xcrun simctl boot "$device"
  xcrun simctl bootstatus "$device" -b
  xcrun simctl spawn "$device" log stream --style compact --level info --predicate 'process == "PlatinumQA"' > native-ui-logs/app.log 2>&1 &
  log_pid=$!
elif [[ "$platform" == android ]]; then
  [[ "$(uname -s)" == Linux && -r /dev/kvm && -w /dev/kvm ]]
  binary="$PWD/native-audit-binary/app-release.apk"
  test -s "$binary"
  android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  sdk_manager="$android_sdk/cmdline-tools/latest/bin/sdkmanager"
  avd_manager="$android_sdk/cmdline-tools/latest/bin/avdmanager"
  "$sdk_manager" --install platform-tools emulator 'system-images;android-35;default;x86_64' > native-ui-logs/sdk-install.log 2>&1
  export ANDROID_AVD_HOME="$work_dir/avd"
  export ANDROID_SERIAL=emulator-5556
  device="$ANDROID_SERIAL"
  mkdir -p "$ANDROID_AVD_HOME"
  Xvfb -displayfd 3 -screen 0 1024x768x24 -nolisten tcp 3> "$work_dir/display" > native-ui-logs/xvfb.log 2>&1 &
  xvfb_pid=$!
  for ((attempt=0; attempt<50; attempt++)); do
    if [[ -s "$work_dir/display" ]]; then break; fi
    kill -0 "$xvfb_pid"
    sleep 0.1
  done
  read -r display_number < "$work_dir/display"
  [[ "$display_number" =~ ^[0-9]+$ ]]
  export DISPLAY=":$display_number" LIBGL_ALWAYS_SOFTWARE=true GALLIUM_DRIVER=llvmpipe LC_ALL=C
  timeout 10 glxinfo -B > native-ui-logs/host-graphics.log 2>&1
  python3 scripts/quality/native-ui-emulator-graphics.py host
  printf 'no\n' | "$avd_manager" create avd --force --name platinum_audit --package 'system-images;android-35;default;x86_64' --path "$ANDROID_AVD_HOME/platinum_audit.avd"
  "$android_sdk/emulator/emulator" -avd platinum_audit -port 5556 -no-window -no-audio -no-boot-anim -no-snapshot -gpu host -feature -Vulkan -memory 3072 > native-ui-logs/emulator.log 2>&1 &
  emulator_pid=$!
  timeout 180 adb -s "$device" wait-for-device
  for ((attempt=0; attempt<120; attempt++)); do
    if [[ "$(adb -s "$device" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; then break; fi
    kill -0 "$emulator_pid"
    sleep 2
  done
  test "$(adb -s "$device" shell getprop sys.boot_completed | tr -d '\r')" = 1
  python3 scripts/quality/native-ui-emulator-graphics.py emulator
  adb -s "$device" root
  timeout 30 adb -s "$device" wait-for-device
  test "$(adb -s "$device" shell id -u | tr -d '\r')" = 0
  adb -s "$device" logcat -c
  adb -s "$device" logcat > native-ui-logs/app.log 2>&1 &
  log_pid=$!
else
  printf '%s\n' 'Unknown native audit platform.' >&2
  exit 2
fi
python3 scripts/quality/native-ui-audit-runner.py --platform "$platform" --device "$device" \
  --binary "$binary" --binary-manifest "$binary_manifest" \
  --expected-source "$GITHUB_SHA" --expected-tree "$source_tree" \
  --groups "$groups" --output native-audit-results
