#!/usr/bin/env bash
set -euo pipefail
if [[ "$(uname -s)" != Linux || "${CI:-}" != true || ! -r /dev/kvm || ! -w /dev/kvm ]]; then
  printf '%s\n' 'Use a disposable Linux CI runner with KVM for full Android UI acceptance.' >&2
  exit 2
fi
node scripts/quality/prepare-native-ui.cjs
android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
sdk_manager="$android_sdk/cmdline-tools/latest/bin/sdkmanager"
avd_manager="$android_sdk/cmdline-tools/latest/bin/avdmanager"
adb_bin="$android_sdk/platform-tools/adb"
test -x "$sdk_manager"
work_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/platinum-app-ui.XXXXXX")"
export ANDROID_AVD_HOME="$work_dir/avd"
export ANDROID_SERIAL=emulator-5556
mkdir -p "$ANDROID_AVD_HOME"
emulator_pid=''
emulator_started_ns=''
log_pid=''
video_pid=''
xvfb_pid=''
cleanup() {
  status=$?
  trap - EXIT
  if [[ -n "$emulator_pid" ]]; then
    if [[ -n "$video_pid" ]]; then
      "$adb_bin" shell pkill -2 screenrecord >/dev/null 2>&1 || true
      wait "$video_pid" >/dev/null 2>&1 || true
      "$adb_bin" pull /sdcard/platinum-navigation.mp4 native-ui-logs/navigation.mp4 >/dev/null 2>&1 || true
    fi
    "$adb_bin" exec-out cat /data/user/0/app.platinumcircles.mobile.qa/files/native-ui-receipt.json > native-ui-logs/native-ui-receipt-final.json 2>/dev/null || true
    "$adb_bin" exec-out cat /data/user/0/app.platinumcircles.mobile.qa/files/native-ui-auth-diagnostics.json > native-ui-logs/native-ui-auth-diagnostics-final.json 2>/dev/null || true
    mkdir -p native-ui-logs/memory-capture
    "$adb_bin" pull /data/user/0/app.platinumcircles.mobile.qa/files/native-memory-capture/. native-ui-logs/memory-capture/ >/dev/null 2>&1 || true
    timeout 10 "$adb_bin" emu kill >/dev/null 2>&1 || true
    kill "$emulator_pid" >/dev/null 2>&1 || true
    wait "$emulator_pid" >/dev/null 2>&1 || true
    # Diagnostics cannot replace the original flow/decoder/verification result.
    timeout 3 python3 scripts/quality/native-ui-emulator-host-diagnostics.py collect \
      --pid "$emulator_pid" --started-ns "$emulator_started_ns" --gate-exit "$status" \
      > native-ui-logs/emulator-host-collector.log 2>&1 || true
    timeout 10 python3 scripts/quality/native-ui-emulator-diagnostics.py \
      --pid "$emulator_pid" --started-ns "$emulator_started_ns" --gate-exit "$status" \
      > native-ui-logs/emulator-crashpad-collector.log 2>&1 || true
  fi
  if [[ -n "$log_pid" ]]; then kill "$log_pid" >/dev/null 2>&1 || true; fi
  if [[ -n "${xvfb_pid:-}" ]]; then
    kill "$xvfb_pid" >/dev/null 2>&1 || true
    timeout 2 tail --pid="$xvfb_pid" -f /dev/null >/dev/null 2>&1 || kill -9 "$xvfb_pid" >/dev/null 2>&1 || true
    wait "$xvfb_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir"
  exit "$status"
}
trap cleanup EXIT
{
  java -version
  node --version
  maestro --version
} > native-ui-logs/toolchain.log 2>&1
# Both prior software modes ultimately exposed packaged SwiftShader GLES. Use
# a disposable host display with Mesa's CPU renderer and verify the actual
# driver, rather than accepting an automatic fallback to that same library.
command -v Xvfb >/dev/null
command -v glxinfo >/dev/null
dpkg-query -W xvfb mesa-utils libgl1-mesa-dri libglx-mesa0 libegl-mesa0 > native-ui-logs/host-graphics-packages.txt
Xvfb -displayfd 3 -screen 0 1024x768x24 -nolisten tcp \
  3> "$work_dir/xvfb-display" > native-ui-logs/xvfb.log 2>&1 &
xvfb_pid=$!
for ((attempt=0; attempt<50; attempt++)); do
  if [[ -s "$work_dir/xvfb-display" ]]; then break; fi
  kill -0 "$xvfb_pid"
  sleep 0.1
done
read -r native_ui_display_number < "$work_dir/xvfb-display"
[[ "$native_ui_display_number" =~ ^[0-9]+$ ]]
native_ui_display=":$native_ui_display_number"
DISPLAY="$native_ui_display" LIBGL_ALWAYS_SOFTWARE=true GALLIUM_DRIVER=llvmpipe LC_ALL=C \
  timeout 10 glxinfo -B > native-ui-logs/host-graphics.log 2>&1
python3 scripts/quality/native-ui-emulator-graphics.py host
python3 - <<'PY' > native-ui-logs/sdk-packages.txt
from pathlib import Path
import tomllib
v=tomllib.loads(Path('node_modules/react-native/gradle/libs.versions.toml').read_text())['versions']
for p in [f"platforms;android-{v['compileSdk']}",f"build-tools;{v['buildTools']}",f"ndk;{v['ndkVersion']}",'cmake;3.22.1','platform-tools','emulator','system-images;android-35;default;x86_64']: print(p)
PY
mapfile -t packages < native-ui-logs/sdk-packages.txt
"$sdk_manager" --install "${packages[@]}" 2>&1 | tee native-ui-logs/sdk-install.log
npx --no-install expo prebuild --platform android --no-install \
  --skip-dependency-update react,react-native 2>&1 | tee native-ui-logs/prebuild.log
python3 - <<'PY'
from pathlib import Path
import re
build=Path('android/app/build.gradle')
if 'app.platinumcircles.mobile.qa' not in build.read_text(): raise SystemExit('Incorrect native application identity.')
with build.open('a') as out:
    out.write('\n// Disposable Emulator-only fixture. The release variant bundles the actual JS.\n')
    out.write('android.buildTypes.release.signingConfig = android.signingConfigs.debug\n')
manifest=Path('android/app/src/main/AndroidManifest.xml')
text,count=re.subn(r'(<meta-data android:name="expo.modules.updates.ENABLED" android:value=")[^"]+("[^>]*>)',r'\g<1>false\2',manifest.read_text())
if count!=1: raise SystemExit('Expected the generated Expo updates switch.')
manifest.write_text(text)
PY
bash android/gradlew -p android --no-daemon --console=plain --stacktrace --max-workers=2 \
  '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g' -PreactNativeArchitectures=x86_64 \
  :app:assembleRelease 2>&1 | tee native-ui-logs/build.log
apk="$PWD/android/app/build/outputs/apk/release/app-release.apk"
test -s "$apk"
python3 - "$apk" <<'PY'
import sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    if len(z.read('assets/index.android.bundle'))<100000: raise SystemExit('Full JavaScript app bundle is missing.')
    if not any(p.startswith('lib/x86_64/') for p in z.namelist()): raise SystemExit('Emulator ABI is missing.')
PY
printf 'no\n' | "$avd_manager" create avd --force --name platinum_app_ui --package 'system-images;android-35;default;x86_64' --path "$ANDROID_AVD_HOME/platinum_app_ui.avd"
# Isolate the common packaged SwiftShader GLES path observed in both crashes.
# This QA app compiles Skia Ganesh/OpenGL and its movie effects use GLES.
# Guest Vulkan is intentionally outside this GLES-only acceptance run.
# https://developer.android.com/studio/run/emulator-acceleration
# https://developer.android.com/studio/run/emulator-troubleshooting
# https://docs.mesa3d.org/envvars.html
emulator_version_status=0
timeout 10 "$android_sdk/emulator/emulator" -version > native-ui-logs/emulator-version.log 2>&1 || emulator_version_status=$?
emulator_help_status=0
timeout 10 "$android_sdk/emulator/emulator" -help-gpu > native-ui-logs/emulator-gpu-help.log 2>&1 || emulator_help_status=$?
printf '{"versionExitCode":%s,"gpuHelpExitCode":%s}\n' "$emulator_version_status" "$emulator_help_status" > native-ui-logs/emulator-cli-metadata.json || true
emulator_started_ns="$(date +%s%N)"
kill -0 "$xvfb_pid"
DISPLAY="$native_ui_display" LIBGL_ALWAYS_SOFTWARE=true GALLIUM_DRIVER=llvmpipe LC_ALL=C \
  "$android_sdk/emulator/emulator" -avd platinum_app_ui -port 5556 -no-window -no-audio -no-boot-anim -no-snapshot -gpu host -feature -Vulkan -memory 3072 > native-ui-logs/emulator.log 2>&1 &
emulator_pid=$!
timeout 180 "$adb_bin" wait-for-device
for ((attempt=0; attempt<120; attempt++)); do
  if [[ "$("$adb_bin" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; then break; fi
  sleep 2
done
test "$("$adb_bin" shell getprop sys.boot_completed | tr -d '\r')" = 1
kill -0 "$xvfb_pid"
python3 scripts/quality/native-ui-emulator-graphics.py emulator
# The disposable AOSP image permits diagnostic root access. Keep the actual
# release app non-debuggable and read only its synthetic acceptance receipt.
"$adb_bin" root
timeout 30 "$adb_bin" wait-for-device
test "$("$adb_bin" shell id -u | tr -d '\r')" = 0
"$adb_bin" install -r "$apk"
"$adb_bin" logcat -c
"$adb_bin" logcat > native-ui-logs/app.log 2>&1 &
log_pid=$!
"$adb_bin" shell screenrecord --time-limit 180 /sdcard/platinum-navigation.mp4 > native-ui-logs/recording.log 2>&1 &
video_pid=$!
timeout 3 python3 scripts/quality/native-ui-emulator-host-diagnostics.py snapshot \
  --pid "$emulator_pid" --started-ns "$emulator_started_ns" --sdk-root "$android_sdk" \
  > native-ui-logs/emulator-host-snapshot.log 2>&1 || true
flow_status=0
bash scripts/quality/run-native-ui-flows.sh "$ANDROID_SERIAL" || flow_status=$?
evidence_status=0
"$adb_bin" exec-out cat /data/user/0/app.platinumcircles.mobile.qa/files/native-ui-receipt.json > native-ui-logs/native-ui-receipt.json || evidence_status=1
"$adb_bin" exec-out cat /data/user/0/app.platinumcircles.mobile.qa/files/native-ui-auth-diagnostics.json > native-ui-logs/native-ui-auth-diagnostics.json || evidence_status=1
mkdir -p native-ui-logs/memory-capture
"$adb_bin" pull /data/user/0/app.platinumcircles.mobile.qa/files/native-memory-capture/. native-ui-logs/memory-capture/ || evidence_status=1
memory_status=0
python3 scripts/quality/verify-native-ui-memory.py || memory_status=$?
verification_status=0
node scripts/quality/verify-native-ui.cjs android || verification_status=$?
cat > native-ui-logs/phase-results.json <<EOF
{"flows":$flow_status,"evidence":$evidence_status,"memoryDecoder":$memory_status,"fullAppVerifier":$verification_status}
EOF
if (( flow_status != 0 || evidence_status != 0 || memory_status != 0 || verification_status != 0 )); then exit 1; fi
