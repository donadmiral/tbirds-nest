#!/usr/bin/env bash
set -euo pipefail
# Current full application on physical ARM64 hardware, isolated synthetic users.
# No EAS account, provider credentials, production backend or user data.
[[ "$(uname -s)" == Linux && "${CI:-}" == true ]]
node scripts/quality/prepare-native-ui.cjs
android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
sdk_manager="$android_sdk/cmdline-tools/latest/bin/sdkmanager"
test -x "$sdk_manager"
mkdir -p physical-android-build
python3 - <<'PY' > physical-android-build/sdk-packages.txt
from pathlib import Path
import tomllib
v=tomllib.loads(Path('node_modules/react-native/gradle/libs.versions.toml').read_text())['versions']
for p in [f"platforms;android-{v['compileSdk']}",f"build-tools;{v['buildTools']}",f"ndk;{v['ndkVersion']}",'cmake;3.22.1','platform-tools']: print(p)
PY
mapfile -t packages < physical-android-build/sdk-packages.txt
"$sdk_manager" --install "${packages[@]}" 2>&1 | tee physical-android-build/sdk-install.log
npx --no-install expo prebuild --platform android --no-install --skip-dependency-update react,react-native 2>&1 | tee physical-android-build/prebuild.log
python3 - <<'PY'
from pathlib import Path
import re
build=Path('android/app/build.gradle')
assert 'app.platinumcircles.mobile.qa' in build.read_text(), 'QA application identity required'
with build.open('a') as out:
 out.write('\n// Disposable physical-device fixture, never a distribution build.\nandroid.buildTypes.release.signingConfig = android.signingConfigs.debug\n')
manifest=Path('android/app/src/main/AndroidManifest.xml')
s,n=re.subn(r'(<meta-data android:name="expo.modules.updates.ENABLED" android:value=")[^"]+("[^>]*>)',r'\g<1>false\2',manifest.read_text())
assert n==1, 'Expo update switch required'
manifest.write_text(s)
PY
timeout 2400 bash android/gradlew -p android --no-daemon --console=plain --stacktrace --max-workers=2 \
  '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g' -PreactNativeArchitectures=arm64-v8a \
  -I "$PWD/scripts/quality/android-media-dependencies.init.gradle" \
  "-PplatinumStoryMediaReceipt=$PWD/physical-android-build/media3-runtime.json" \
  -PplatinumStoryMediaConfiguration=releaseRuntimeClasspath -PplatinumRequireExpoVideoSource=true \
  :app:verifyStoryMediaDependencies :app:assembleRelease 2>&1 | tee physical-android-build/build.log
cp android/app/build/outputs/apk/release/app-release.apk physical-android-build/app-release.apk
cp native-ui-logs/source.json physical-android-build/source.json
# Build a self-contained discoverable Appium Python package before upload.
python3 -m venv "${RUNNER_TEMP:-/tmp}/platinum-physical-python"
physical_python="${RUNNER_TEMP:-/tmp}/platinum-physical-python/bin/python"
"$physical_python" -m pip download --only-binary=:all: --dest tests/native/physical/wheelhouse -r tests/native/physical/requirements.txt
"$physical_python" -m pip install --no-index --find-links=tests/native/physical/wheelhouse -r tests/native/physical/requirements.txt
"$physical_python" -m pytest --collect-only tests/native/physical/tests | tee physical-android-build/test-collection.log
python3 - <<'PY'
from pathlib import Path
import hashlib,json,os,zipfile
p=Path('physical-android-build/app-release.apk')
with zipfile.ZipFile(p) as z:
 assert len(z.read('assets/index.android.bundle'))>100000, 'Full bundled JS required'
 assert any(n.startswith('lib/arm64-v8a/') for n in z.namelist()), 'Physical ARM64 ABI required'
 assert not any(n.startswith('lib/x86') for n in z.namelist()), 'Only physical ARM64 ABI intended'
classes=list(Path('modules/secure-media/android/build').rglob('SecureMediaModule.class'))
assert classes, 'Actual SecureMedia Expo bridge must compile'
receipt={'commit':os.environ['GITHUB_SHA'],'workflowRun':os.environ['GITHUB_RUN_ID'],'apkSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'abi':'arm64-v8a','javascriptBundled':True,'syntheticBackend':True,'physicalDeviceAcceptance':False,'secureMediaCompiled':True}
Path('physical-android-build/receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
with zipfile.ZipFile('physical-android-build/appium-python-tests.zip','w',zipfile.ZIP_DEFLATED) as z:
 for f in Path('tests/native/physical').rglob('*'):
  if f.is_file() and '__pycache__' not in f.parts: z.write(f,f.relative_to('tests/native/physical'))
PY
