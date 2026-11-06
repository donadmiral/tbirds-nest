#!/usr/bin/env bash
set -euo pipefail

# Execute the production Android AES-GCM core in isolated instrumentation
# app. Everything installed here is synthetic and local to this disposable AVD.
# This is neither a signed product release nor physical-device acceptance.
if [[ "$(uname -s)" != Linux || "${CI:-}" != true ]]; then
  printf '%s\n' 'Run this emulator gate only in a disposable Linux CI checkout.' >&2
  exit 2
fi
repo_root="$(pwd)"
android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
sdk_manager="$android_sdk/cmdline-tools/latest/bin/sdkmanager"
avd_manager="$android_sdk/cmdline-tools/latest/bin/avdmanager"
adb_bin="$android_sdk/platform-tools/adb"
harness="$repo_root/scripts/quality/android-secure-media"
evidence="$repo_root/android-secure-media-logs"
if [[ -z "$android_sdk" || ! -x "$sdk_manager" || ! -x "$avd_manager" ]]; then
  printf '%s\n' 'The Android SDK command-line tools are required.' >&2
  exit 2
fi
if [[ ! -f "$harness/build.gradle" || ! -f node_modules/expo/template.tgz ]]; then
  printf '%s\n' 'The checked-in instrumentation harness and locked Expo dependencies are required.' >&2
  exit 2
fi
if [[ ! -r /dev/kvm || ! -w /dev/kvm ]]; then
  printf '%s\n' 'This bounded emulator gate requires usable KVM acceleration.' >&2
  exit 2
fi
mkdir -p "$evidence"
work_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/platinum-android-crypto.XXXXXX")"
export ANDROID_AVD_HOME="$work_dir/avd"
export ANDROID_SERIAL=emulator-5556
mkdir -p "$ANDROID_AVD_HOME"
emulator_pid=''
cleanup() {
  status=$?
  trap - EXIT
  if [[ -n "$emulator_pid" ]]; then
    timeout 15 "$adb_bin" -s "$ANDROID_SERIAL" logcat -d > "$evidence/logcat.log" 2>&1 || true
    timeout 10 "$adb_bin" -s "$ANDROID_SERIAL" emu kill >/dev/null 2>&1 || true
    kill "$emulator_pid" >/dev/null 2>&1 || true
    for ((stop_attempt=0; stop_attempt<10; stop_attempt++)); do
      if ! kill -0 "$emulator_pid" 2>/dev/null; then break; fi
      sleep 1
    done
    kill -KILL "$emulator_pid" >/dev/null 2>&1 || true
    wait "$emulator_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir"
  exit "$status"
}
trap cleanup EXIT

python3 - "$work_dir" <<'PY' > "$evidence/preflight.json"
from pathlib import Path
import hashlib, json, sys, tarfile, tomllib
root = Path.cwd()
expo = json.loads((root / 'node_modules/expo/package.json').read_text())['version']
versions = tomllib.loads((root / 'node_modules/react-native/gradle/libs.versions.toml').read_text())['versions']
if not expo.startswith('54.'):
    raise SystemExit('Review this harness before upgrading the Expo major version.')
if versions['agp'] != '8.11.0' or versions['kotlin'] != '2.1.20' or versions['compileSdk'] != '36':
    raise SystemExit('Align and review the standalone harness after a native toolchain update.')
wrapper = Path(sys.argv[1]) / 'wrapper'
with tarfile.open(root / 'node_modules/expo/template.tgz') as archive:
    for name in ('gradlew', 'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties'):
        member = archive.getmember('package/android/' + name)
        if not member.isfile():
            raise SystemExit('Unexpected Expo Gradle wrapper member type.')
        target = wrapper / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.extractfile(member).read())
sources = [root / 'modules/secure-media/android/src/main/java/expo/modules/securemedia/SecureMediaCrypto.kt']
fixtures = [p for p in (root / 'scripts/quality/android-secure-media/src/androidTest').rglob('*') if p.is_file()]
print(json.dumps({
    'expo': expo, 'nativeToolchain': {k: versions[k] for k in ('agp', 'kotlin', 'compileSdk', 'minSdk')},
    'productionSources': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
    'acceptanceSources': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in fixtures},
    'gradleWrapperSha256': hashlib.sha256((wrapper / 'gradle/wrapper/gradle-wrapper.jar').read_bytes()).hexdigest(),
    'scope': 'Actual production AES-GCM source in an isolated Android instrumentation application, not a physical device.'
}, indent=2))
PY

{
  java -version
  node --version
  "$sdk_manager" --version
} > "$evidence/toolchain.log" 2>&1
# The hosted runner already has the standard SDK licence acceptances. This gate
# does not auto-accept an agreement or provision a Google/Play/provider account.
"$sdk_manager" --install 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' \
  'emulator' 'system-images;android-35;default;x86_64' \
  2>&1 | tee "$evidence/sdk-install.log"
"$android_sdk/emulator/emulator" -version >> "$evidence/toolchain.log" 2>&1
"$android_sdk/emulator/emulator" -accel-check >> "$evidence/toolchain.log" 2>&1
printf 'no\n' | "$avd_manager" create avd --force --name platinum_secure_media \
  --package 'system-images;android-35;default;x86_64' \
  --path "$ANDROID_AVD_HOME/platinum_secure_media.avd" \
  2>&1 | tee "$evidence/avd-create.log"

# No snapshots or user accounts are reused. Software GLES keeps the rendering
# path available on a headless hosted runner; CPU virtualisation still uses KVM.
"$android_sdk/emulator/emulator" -avd platinum_secure_media -port 5556 \
  -no-window -no-snapshot -no-audio -no-boot-anim -gpu swiftshader \
  -accel on -memory 2048 -cores 2 -camera-back none -camera-front none \
  > "$evidence/emulator.log" 2>&1 &
emulator_pid=$!
timeout 180 "$adb_bin" -s "$ANDROID_SERIAL" wait-for-device
booted=false
boot_deadline=$((SECONDS + 180))
while ((SECONDS < boot_deadline)); do
  if [[ "$(timeout 5 "$adb_bin" -s "$ANDROID_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; then
    booted=true
    break
  fi
  if ! kill -0 "$emulator_pid" 2>/dev/null; then
    printf '%s\n' 'The isolated emulator exited before boot.' >&2
    exit 1
  fi
  sleep 2
done
if [[ "$booted" != true ]]; then
  printf '%s\n' 'The isolated emulator did not finish booting within the deadline.' >&2
  exit 1
fi
"$adb_bin" -s "$ANDROID_SERIAL" shell input keyevent 82
"$adb_bin" -s "$ANDROID_SERIAL" shell getprop ro.build.fingerprint > "$evidence/emulator-build.log"

# The harness Sync task copies the production Kotlin engine byte-for-byte.
# Gradle installs only the ephemeral debug-signed harness and instrumentation
# APKs; it does not install the Platinum Circles application or access QA data.
set +e
timeout 900 bash "$work_dir/wrapper/gradlew" -p "$harness" --no-daemon --console=plain --stacktrace \
  --max-workers=2 '-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=1g' \
  -Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true \
  connectedDebugAndroidTest 2>&1 | tee "$evidence/gradle.log"
test_status=${PIPESTATUS[0]}
set -e

python3 - "$harness" "$evidence" "$test_status" <<'PYTEST'
from pathlib import Path
import hashlib,json,os,re,shutil,sys,xml.etree.ElementTree as ET
harness,evidence=map(Path,sys.argv[1:3]); source=harness/'build/outputs/androidTest-results'
if source.exists(): shutil.copytree(source,evidence/'instrumentation-results',dirs_exist_ok=True)
assert int(sys.argv[3]) == 0, 'Gradle instrumentation failed: ' + sys.argv[3]
reports=list((evidence/'instrumentation-results').rglob('TEST-*.xml'))
assert reports, 'No instrumentation XML returned'
tests=[]
for report in reports:
 for case in ET.parse(report).getroot().iter('testcase'):
  assert not any(case.find(t) is not None for t in ('failure','error','skipped')), ET.tostring(case).decode()
  tests.append(case.get('name'))
expected={'fullResolutionRoundtrip','freshNoncePerWrite','tamperedTagRejectedWithoutPlaintext','rotatedAccountKeyCannotDecrypt','traversalAndSymlinkEscapeRejected','invalidKeyAndOversizeInputRejected'}
assert len(tests)==len(expected) and set(tests)==expected, tests
crypto=Path('modules/secure-media/android/src/main/java/expo/modules/securemedia/SecureMediaCrypto.kt')
r={'passed':True,'cases':tests,'physicalDevice':False,'platform':'Android Emulator','commit':os.environ.get('GITHUB_SHA'),'sourceSha256':hashlib.sha256(crypto.read_bytes()).hexdigest()}
(evidence/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
print('Actual Android Cipher runtime acceptance passed: six cases. This is an emulator, not physical-phone acceptance.')
PYTEST
exit "$test_status"
