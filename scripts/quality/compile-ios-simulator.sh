#!/usr/bin/env bash
set -euo pipefail

# This gate is deliberately a disposable, unsigned simulator compile. It never
# archives, exports, signs, installs, starts a simulator, or submits an app.
if [[ "$(uname -s)" != Darwin || "${CI:-}" != true ]]; then
  printf '%s\n' 'Run this compile gate only in a disposable macOS CI checkout.' >&2
  exit 2
fi
if [[ -d ios ]]; then
  printf '%s\n' 'Refusing to overwrite an existing native iOS directory. Use a fresh checkout.' >&2
  exit 2
fi
if [[ "${EXPO_PUBLIC_APP_ENV:-}" != qa ]]; then
  printf '%s\n' 'This compile gate requires the isolated QA app configuration.' >&2
  exit 2
fi
native_arch="$(uname -m)"
case "$native_arch" in arm64|x86_64) ;; *) exit 2 ;; esac

mkdir -p native-compile-logs
{
  xcodebuild -version
  xcrun --sdk iphonesimulator --show-sdk-version
  node --version
  npm --version
  pod _1.16.2_ --version
} | tee native-compile-logs/toolchain.log

# Expo 54 includes its native template. No EAS command or Apple account is used.
npx --no-install expo prebuild --platform ios --no-install \
  --skip-dependency-update react,react-native 2>&1 | tee native-compile-logs/prebuild.log
pod _1.16.2_ install --project-directory=ios 2>&1 | tee native-compile-logs/pods.log
test -d ios/PlatinumQA.xcworkspace
test -f 'ios/Pods/Local Podspecs/Boomerang.podspec.json'

xcodebuild \
  -workspace ios/PlatinumQA.xcworkspace \
  -scheme PlatinumQA \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath native-compile-derived \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= \
  ONLY_ACTIVE_ARCH=YES "ARCHS=$native_arch" SKIP_BUNDLING=1 \
  build 2>&1 | tee native-compile-logs/xcodebuild.log

python3 - <<'PY'
from pathlib import Path
import hashlib, json, os
sources = [Path('modules/boomerang/ios') / name for name in (
    'BoomerangModule.swift', 'StoryVideoView.swift', 'StoryVideoComposition.swift')]
objects = {}
for source in sources:
    matches = list(Path('native-compile-derived/Build/Intermediates.noindex').rglob(source.stem + '.o'))
    if not matches:
        raise SystemExit(f'The app compiled, but required native source has no compiled object: {source}')
    objects[str(source)] = {
        'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'compiled_objects': [str(path) for path in matches],
    }
receipt = {
    'commit': os.environ.get('GITHUB_SHA'),
    'workflow_run': os.environ.get('GITHUB_RUN_ID'),
    'result': 'unsigned iOS Simulator compile passed',
    'native_sources': objects,
    'device_or_provider_acceptance': False,
    'archive_or_ipa_created': False,
    'app_uploaded_or_submitted': False,
}
Path('native-compile-logs/receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
PY
