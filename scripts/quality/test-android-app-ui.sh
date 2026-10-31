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
log_pid=''
video_pid=''
cleanup() {
  status=$?
  trap - EXIT
  if [[ -n "$emulator_pid" ]]; then
    if [[ -n "$video_pid" ]]; then
      "$adb_bin" shell pkill -2 screenrecord >/dev/null 2>&1 || true
      wait "$video_pid" >/dev/null 2>&1 || true
      "$adb_bin" pull /sdcard/platinum-navigation.mp4 native-ui-logs/navigation.mp4 >/dev/null 2>&1 || true
    fi
    "$adb_bin" exec-out run-as app.platinumcircles.mobile.qa cat files/native-ui-receipt.json > native-ui-logs/native-ui-receipt-final.json 2>/dev/null || true
    timeout 10 "$adb_bin" emu kill >/dev/null 2>&1 || true
    kill "$emulator_pid" >/dev/null 2>&1 || true
    wait "$emulator_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$log_pid" ]]; then kill "$log_pid" >/dev/null 2>&1 || true; fi
  rm -rf "$work_dir"
  exit "$status"
}
trap cleanup EXIT
{
  java -version
  node --version
  maestro --version
} > native-ui-logs/toolchain.log 2>&1
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
    out.write('android.buildTypes.release.debuggable = true\n')
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
"$android_sdk/emulator/emulator" -avd platinum_app_ui -port 5556 -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect -memory 3072 > native-ui-logs/emulator.log 2>&1 &
emulator_pid=$!
timeout 180 "$adb_bin" wait-for-device
for ((attempt=0; attempt<120; attempt++)); do
  if [[ "$("$adb_bin" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; then break; fi
  sleep 2
done
test "$("$adb_bin" shell getprop sys.boot_completed | tr -d '\r')" = 1
"$adb_bin" install -r "$apk"
"$adb_bin" logcat -c
"$adb_bin" logcat > native-ui-logs/app.log 2>&1 &
log_pid=$!
"$adb_bin" shell screenrecord --time-limit 180 /sdcard/platinum-navigation.mp4 > native-ui-logs/recording.log 2>&1 &
video_pid=$!
maestro --device "$ANDROID_SERIAL" test --format junit --output native-ui-logs/maestro.xml \
  --debug-output native-ui-logs/maestro tests/native/flows/navigation.yaml 2>&1 | tee native-ui-logs/maestro.log
"$adb_bin" exec-out run-as app.platinumcircles.mobile.qa cat files/native-ui-receipt.json > native-ui-logs/native-ui-receipt.json
node scripts/quality/verify-native-ui.cjs android
