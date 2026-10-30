#!/usr/bin/env bash
set -euo pipefail

# This is a disposable native compilation gate, not a release or device test.
# It builds one ARM64 QA APK with signing disabled, never installs or uploads it,
# and retains only diagnostics. The current Android module has no story encoder.
if [[ "$(uname -s)" != Linux || "${CI:-}" != true ]]; then
  printf '%s\n' 'Run this compile gate only in a disposable Linux CI checkout.' >&2
  exit 2
fi
if [[ -d android ]]; then
  printf '%s\n' 'Refusing to overwrite an existing native Android directory. Use a fresh checkout.' >&2
  exit 2
fi
if [[ "${EXPO_PUBLIC_APP_ENV:-}" != qa ]]; then
  printf '%s\n' 'This compile gate requires the isolated QA app configuration.' >&2
  exit 2
fi
android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
sdk_manager="$android_sdk/cmdline-tools/latest/bin/sdkmanager"
if [[ -z "$android_sdk" || ! -x "$sdk_manager" ]]; then
  printf '%s\n' 'The Android command-line tools must be installed before this gate runs.' >&2
  exit 2
fi
mkdir -p android-native-compile-logs
{
  java -version
  javac -version
  node --version
  npm --version
  "$sdk_manager" --version
} 2>&1 | tee android-native-compile-logs/toolchain.log

# Use the SDK and NDK required by the actual locked React Native dependency.
# The hosted Ubuntu runner already accepts the standard Android SDK licenses.
python3 - <<'PY' > android-native-compile-logs/sdk-packages.log
from pathlib import Path
import json, tomllib
expo = json.loads(Path('node_modules/expo/package.json').read_text())['version']
if not expo.startswith('54.'):
    raise SystemExit('Review this native gate before upgrading the Expo major version.')
versions = tomllib.loads(Path('node_modules/react-native/gradle/libs.versions.toml').read_text())['versions']
for package in (f"platforms;android-{versions['compileSdk']}",
                f"build-tools;{versions['buildTools']}", f"ndk;{versions['ndkVersion']}", 'cmake;3.22.1'):
    print(package)
PY
mapfile -t android_packages < android-native-compile-logs/sdk-packages.log
"$sdk_manager" --install "${android_packages[@]}" 2>&1 | tee android-native-compile-logs/sdk-install.log

# Expo 54 includes its native template. No EAS or Google Play account is used.
npx --no-install expo prebuild --platform android --no-install \
  --skip-dependency-update react,react-native 2>&1 | tee android-native-compile-logs/prebuild.log

node node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js \
  resolve --platform android --json > android-native-compile-logs/autolinking.log
python3 - <<'PY' 2>&1 | tee android-native-compile-logs/preflight.log
from pathlib import Path
import json
root = Path.cwd()
modules = json.loads(Path('android-native-compile-logs/autolinking.log').read_text())['modules']
matches = [p for m in modules if m['packageName'] == 'boomerang' for p in m['projects']
           if 'expo.modules.boomerang.BoomerangModule' in p.get('modules', [])]
if len(matches) != 1 or Path(matches[0]['sourceDir']).resolve() != root / 'modules/boomerang/android':
    raise SystemExit('The actual local Boomerang Android module was not autolinked.')
build = Path('android/app/build.gradle')
if 'app.platinumcircles.mobile.qa' not in build.read_text():
    raise SystemExit('The generated Android application does not use the isolated QA identity.')
if Path('android/app/google-services.json').exists():
    raise SystemExit('This compile-only QA target must not contain Firebase credentials.')
# Expo's debug variant is normally signed automatically. Disable only signing
# in this disposable generated project; all actual native sources still build.
with build.open('a') as target:
    target.write('\n// Disposable compile gate: no app signing or installation.\n')
    target.write('android.buildTypes.debug.signingConfig = null\n')
print('QA identity and local Boomerang autolinking verified; generated debug signing disabled.')
PY

# A single physical-device ABI bounds CI cost while compiling the actual New
# Architecture, Java/Kotlin sources, manifests, resources, and native C++ links.
# Debug skips the JS bundle; the separate quality gate verifies JS and types.
bash android/gradlew -p android --no-daemon --console=plain --stacktrace \
  --max-workers=2 '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g' \
  -PreactNativeArchitectures=arm64-v8a :app:assembleDebug \
  2>&1 | tee android-native-compile-logs/gradle.log

python3 - "$android_sdk" <<'PY' 2>&1 | tee android-native-compile-logs/postflight.log
from pathlib import Path
import hashlib, json, os, subprocess, sys, tomllib, zipfile
source = Path('modules/boomerang/android/src/main/java/expo/modules/boomerang/BoomerangModule.kt')
objects = list(Path('modules/boomerang/android/build').rglob('BoomerangModule.class'))
if not objects or any(p.read_bytes()[:4] != bytes.fromhex('cafebabe') for p in objects):
    raise SystemExit('Required Boomerang Kotlin bytecode was not compiled.')
packages = list(Path('node_modules/expo/android/build').rglob('ExpoModulesPackageList.java'))
if not any('expo.modules.boomerang.BoomerangModule' in p.read_text() for p in packages):
    raise SystemExit('The generated Expo package list does not register Boomerang.')
apks = list(Path('android/app/build/outputs/apk/debug').glob('*-unsigned.apk'))
if len(apks) != 1:
    raise SystemExit('Exactly one unsigned Android QA APK is required.')
apk = apks[0]
with zipfile.ZipFile(apk) as archive:
    if archive.testzip() is not None:
        raise SystemExit('The Android QA APK failed ZIP integrity verification.')
    entries = archive.namelist()
    required = {'classes.dex', 'AndroidManifest.xml', 'lib/arm64-v8a/libreactnative.so', 'lib/arm64-v8a/libappmodules.so'}
    if not required.issubset(entries):
        raise SystemExit(f'The Android QA APK lacks required native outputs: {sorted(required - set(entries))}')
    if any(n.upper().startswith('META-INF/') and n.upper().endswith(('.SF', '.RSA', '.DSA', '.EC')) for n in entries):
        raise SystemExit('The compile-only APK unexpectedly contains a JAR signature.')
versions = tomllib.loads(Path('node_modules/react-native/gradle/libs.versions.toml').read_text())['versions']
build_tools = Path(sys.argv[1]) / 'build-tools' / versions['buildTools']
badging = subprocess.run([str(build_tools / 'aapt2'), 'dump', 'badging', str(apk)], capture_output=True, text=True, check=True).stdout
if "name='app.platinumcircles.mobile.qa'" not in badging:
    raise SystemExit('The compiled APK has the wrong application ID.')
signature = subprocess.run([str(build_tools / 'apksigner'), 'verify', '--verbose', str(apk)], capture_output=True, text=True)
signature_report = signature.stdout + signature.stderr
Path('android-native-compile-logs/signature.log').write_text(signature_report)
if signature.returncode == 0 or 'Missing META-INF/MANIFEST.MF' not in signature_report:
    raise SystemExit('The APK did not report the expected absence of a signing certificate.')
receipt = {
    'commit': os.environ.get('GITHUB_SHA'),
    'workflow_run': os.environ.get('GITHUB_RUN_ID'),
    'result': 'unsigned Android QA native compile passed',
    'native_source': {'path': str(source), 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                      'compiled_classes': [str(p) for p in objects]},
    'expo_module_registration_verified': True,
    'android_abi': 'arm64-v8a',
    'apk': {'path': str(apk), 'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(), 'bytes': apk.stat().st_size},
    'application_id': 'app.platinumcircles.mobile.qa',
    'apk_signed': False,
    'javascript_bundle_included': False,
    'android_story_composition_implemented': False,
    'device_or_provider_acceptance': False,
    'app_installed_uploaded_or_submitted': False,
}
Path('android-native-compile-logs/receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
PY
