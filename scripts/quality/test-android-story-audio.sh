#!/usr/bin/env bash
set -euo pipefail

# Execute the production Android story encoder in an isolated instrumentation
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
harness="$repo_root/scripts/quality/android-story-export"
evidence="$repo_root/android-story-export-logs"
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
work_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/platinum-android-audio.XXXXXX")"
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
sources = [root / 'modules/boomerang/android/src/main/java/expo/modules/boomerang' / name
           for name in ('StoryVideoComposition.kt', 'StoryVideoEffects.kt')]
if not all(path.is_file() for path in sources):
    raise SystemExit('The actual production encoder sources are required.')
print(json.dumps({
    'expo': expo, 'nativeToolchain': {k: versions[k] for k in ('agp', 'kotlin', 'compileSdk', 'minSdk')},
    'productionSources': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
    'gradleWrapperSha256': hashlib.sha256((wrapper / 'gradle/wrapper/gradle-wrapper.jar').read_bytes()).hexdigest(),
    'scope': 'Actual production engine sources in a standalone local-only Android instrumentation application.'
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
printf 'no\n' | "$avd_manager" create avd --force --name platinum_story_export \
  --package 'system-images;android-35;default;x86_64' \
  --path "$ANDROID_AVD_HOME/platinum_story_export.avd" \
  2>&1 | tee "$evidence/avd-create.log"

# No snapshots or user accounts are reused. Software GLES keeps the rendering
# path available on a headless hosted runner; CPU virtualisation still uses KVM.
"$android_sdk/emulator/emulator" -avd platinum_story_export -port 5556 \
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
timeout 1200 bash "$work_dir/wrapper/gradlew" -p "$harness" --no-daemon --console=plain --stacktrace \
  --max-workers=2 '-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=1g' \
  -I "$repo_root/scripts/quality/android-media-dependencies.init.gradle" \
  "-PplatinumStoryMediaReceipt=$evidence/media3-runtime.json" \
  -Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true \
  verifyStoryMediaDependencies connectedDebugAndroidTest 2>&1 | tee "$evidence/gradle.log"
test_status=${PIPESTATUS[0]}
set -e

# Collect partial diagnostic movies even when a test fails; a failure can never
# turn into a successful receipt merely because files exist.
if timeout 30 "$adb_bin" -s "$ANDROID_SERIAL" exec-out run-as app.platinumcircles.storyexporttest \
  tar -C files/evidence -cf - . > "$work_dir/device-evidence.tar" 2> "$evidence/evidence-pull.log"; then
  python3 - "$work_dir/device-evidence.tar" "$evidence" <<'PY'
from pathlib import Path, PurePosixPath
import sys, tarfile
out = Path(sys.argv[2]) / 'device'
out.mkdir(exist_ok=True)
with tarfile.open(sys.argv[1]) as archive:
    for member in archive.getmembers():
        name = PurePosixPath(member.name)
        if name.is_absolute() or '..' in name.parts or member.issym() or member.islnk():
            raise SystemExit('Unsafe instrumentation evidence path.')
        if member.isdir():
            continue
        if not member.isfile() or member.size > 100 * 1024 * 1024:
            raise SystemExit('Unexpected instrumentation evidence member.')
        target = out.joinpath(*name.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.extractfile(member).read())
PY
fi

python3 - "$harness" "$evidence" <<'PY'
from pathlib import Path
import shutil, sys
source = Path(sys.argv[1]) / 'build/outputs/androidTest-results'
if source.exists():
    shutil.copytree(source, Path(sys.argv[2]) / 'instrumentation-results', dirs_exist_ok=True)
PY
if [[ "$test_status" -ne 0 ]]; then
  exit "$test_status"
fi

python3 - "$evidence" <<'PY'
from pathlib import Path
import hashlib, json, os, re, sys, xml.etree.ElementTree as ET
evidence = Path(sys.argv[1])
reports = list((evidence / 'instrumentation-results').rglob('TEST-*.xml'))
if not reports:
    raise SystemExit('No Android instrumentation test result was retained.')
tests = []
for report in reports:
    suite = ET.parse(report).getroot()
    for case in suite.iter('testcase'):
        if any(case.find(tag) is not None for tag in ('failure', 'error', 'skipped')):
            raise SystemExit('An Android encoder instrumentation case did not pass.')
        tests.append({'class': case.get('classname'), 'name': case.get('name'), 'seconds': case.get('time')})
if not tests:
    raise SystemExit('The Android encoder gate executed no cases.')
harness_source = Path('scripts/quality/android-story-export/src/androidTest/java/expo/modules/boomerang/StoryAudioExportTest.kt')
expected_tests = set(re.findall(r'@Test\s+fun\s+(\w+)\s*\(', harness_source.read_text()))
observed_tests = {case['name'] for case in tests if case['class'] == 'expo.modules.boomerang.StoryAudioExportTest'}
if len(expected_tests) < 12 or not expected_tests.issubset(observed_tests):
    raise SystemExit('The complete declared encoder acceptance suite did not execute.')
device_receipt = evidence / 'device/receipt.json'
if not device_receipt.is_file():
    raise SystemExit('The emulator did not produce its measured encoder receipt.')
measured = json.loads(device_receipt.read_text())
if measured.get('media3Version') != '1.8.1' or len(measured.get('cases', [])) < len(expected_tests):
    raise SystemExit('The emulator did not retain measurements for every encoder case.')
preflight = json.loads((evidence / 'preflight.json').read_text())
for name, expected in preflight['productionSources'].items():
    if hashlib.sha256(Path(name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Production encoder source changed during instrumentation.')
    generated = Path('scripts/quality/android-story-export/build/generated/production-renderer/expo/modules/boomerang') / Path(name).name
    if not generated.is_file() or hashlib.sha256(generated.read_bytes()).hexdigest() != expected:
        raise SystemExit('The compiled renderer copy does not match the production encoder source.')
generated_root = Path('scripts/quality/android-story-export/build/generated/production-renderer')
if {p.name for p in generated_root.rglob('*.kt')} != {Path(name).name for name in preflight['productionSources']}:
    raise SystemExit('The generated renderer source set contains unexpected Kotlin files.')
movies = sorted((evidence / 'device').glob('*.mp4'))
if not movies or any(p.stat().st_size < 1024 for p in movies):
    raise SystemExit('The emulator did not retain valid-sized encoded movie evidence.')
receipt = {
    'commit': os.environ.get('GITHUB_SHA'), 'workflowRun': os.environ.get('GITHUB_RUN_ID'),
    'result': 'Android production story encoder instrumentation passed',
    'preflight': preflight,
    'compiledSourceCopiesVerified': True,
    'media3Runtime': json.loads((evidence / 'media3-runtime.json').read_text()),
    'emulatorBuild': (evidence / 'emulator-build.log').read_text().strip(),
    'instrumentationTests': tests, 'measuredReceipt': measured,
    'movies': [{'name': p.name, 'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in movies],
    'physicalDeviceAcceptance': False, 'installedProductAcceptance': False,
    'qaOrProductionDataAccessed': False, 'storeReleaseOrUpload': False,
}
(evidence / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
PY
