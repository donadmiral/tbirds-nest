#!/usr/bin/env python3
"""One full-app Android retry using immutable CI-only bytes, never a rebuild."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import time

SOURCE = 'aa73cc92d9676c51ef757ef34ce91f17754dd4a1'
TREE = '12daa31beedd4fcd10e8b56eaf0fd88c0ab6c3b6'
RUN = '41886667189'
ARTIFACT = '13354845087'
APK_SHA = '62eb5d935f4b1a7f755a4f874418cca33595aa617d6ed3e37912edca740068cf'
MANIFEST_SHA = 'd99896686174a5a7080abebcad0464ab6ec3d20c66c47d652b0e164a8853d9d3'
RECEIPT_SHA = 'b6edcc6804cff091520a43ee183426e17eb37199826f04d28d5efb40cdbb74d7'
RUNNER_SHA = 'b29dce2a33c72fdf0cfa7db7237fec769d8ab183edcfed98435b0160f5d89f00'
PACKAGE = 'app.platinumcircles.mobile.qa'
SERIAL = 'emulator-5556'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def safe(root, name):
    relative = Path(name)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('Unsafe retained path')
    result = root / relative
    if result.resolve() != result.absolute() or not result.is_file():
        raise ValueError('Missing or linked retained path: ' + name)
    return result


def checked(path, expected):
    if path.is_symlink() or not path.is_file() or digest(path) != expected:
        raise ValueError('Pinned identity mismatch: ' + str(path))


def command(args):
    return subprocess.check_output(args, stderr=subprocess.PIPE, timeout=30).decode().strip()


def validate(root, retained):
    if command(['git', '-C', str(root), 'rev-parse', 'HEAD']) != SOURCE:
        raise ValueError('Wrong original application commit')
    if command(['git', '-C', str(root), 'rev-parse', 'HEAD^{tree}']) != TREE:
        raise ValueError('Wrong original application tree')
    if command(['git', '-C', str(root), 'diff', '--name-only', 'HEAD']):
        raise ValueError('Application checkout has tracked changes')
    binary = safe(retained, 'test-only-binary/app-release.apk')
    manifest_path = safe(retained, 'test-only-binary/binary-manifest.json')
    source_path = safe(retained, 'source.json')
    checked(binary, APK_SHA)
    checked(manifest_path, MANIFEST_SHA)
    checked(source_path, RECEIPT_SHA)
    checked(safe(retained, 'test-only-binary/source.json'), RECEIPT_SHA)
    manifest = json.loads(manifest_path.read_text())
    source = json.loads(source_path.read_text())
    expected = {'schemaVersion': 1, 'kind': 'disposable-native-full-app',
                'configuration': 'Release', 'applicationSourceCommit': SOURCE,
                'applicationSourceTree': TREE, 'platform': 'android',
                'packageId': PACKAGE, 'binaryName': 'app-release.apk',
                'binarySha256': APK_SHA, 'sourceReceiptSha256': RECEIPT_SHA,
                'testOnly': True, 'userDistributionPermitted': False,
                'rebuildPerCase': False, 'resignOrRebundlePermitted': False}
    if any(manifest.get(k) != v for k, v in expected.items()):
        raise ValueError('Retained full-app contract mismatch')
    compatibility = manifest['nativeCompatibility']
    if any(compatibility.get(k) != v for k, v in {
            'abi': 'x86_64', 'api': '35',
            'image': 'system-images;android-35;default;x86_64'}.items()):
        raise ValueError('Retained emulator compatibility mismatch')
    if source['commit'] != SOURCE or str(source['workflowRun']) != RUN:
        raise ValueError('Producer receipt identity mismatch')
    if len(source['hashes']) != 697 or len(source['overlays']) != 16:
        raise ValueError('Incomplete source and prepared-overlay manifest')
    for name, expected_hash in source['hashes'].items():
        checked(safe(root, name), expected_hash)
    for overlay in source['overlays']:
        if overlay['before'] is None:
            if (root / overlay['file']).exists():
                raise ValueError('Generated overlay already exists')
        else:
            checked(safe(root, overlay['file']), overlay['before'])
        if not overlay['retained'].startswith('overlays/'):
            raise ValueError('Unexpected retained overlay location')
        checked(safe(retained, overlay['retained']), overlay['after'])
    # The producer binds exactly the fixture files in its original source receipt.
    fixture_files = {name: value for name, value in source['hashes'].items()
                     if name.startswith('tests/native/')}
    if fixture_files != manifest['fixtureHashes'] or len(fixture_files) != 123:
        raise ValueError('Incomplete fixture manifest')
    for name, expected_hash in manifest['fixtureHashes'].items():
        checked(safe(root, name), expected_hash)
    for name, expected_hash in compatibility['configurationInputs'].items():
        checked(safe(root, name), expected_hash)
    runner = safe(root, 'scripts/quality/test-android-app-ui.sh')
    checked(runner, RUNNER_SHA)
    return binary, source, manifest


def generate_runner(original, binary, helper):
    if hashlib.sha256(original.encode()).hexdigest() != RUNNER_SHA:
        raise ValueError('Original runner changed')
    start = original.index('node scripts/quality/prepare-native-ui.cjs\n')
    end = original.index('android_sdk=', start)
    result = original[:start] + 'test "${PLATINUM_NATIVE_AUDIT_BUILD_ONLY:-0}" = 0\n' + original[end:]
    start = result.index("python3 - <<'PY' > native-ui-logs/sdk-packages.txt\n")
    end = result.index("printf 'no\\n' | ", start)
    replacement = ("printf '%s\\n' platform-tools emulator 'build-tools;36.0.0' 'system-images;android-35;default;x86_64' > native-ui-logs/sdk-packages.txt\n"
                   'mapfile -t packages < native-ui-logs/sdk-packages.txt\n'
                   '"$sdk_manager" --install "${packages[@]}" 2>&1 | tee native-ui-logs/sdk-install.log\n'
                   'apk=' + shlex.quote(str(binary)) + '\n'
                   'python3 ' + shlex.quote(str(helper)) + ' apk --aapt "$android_sdk/build-tools/36.0.0/aapt" --apk "$apk"\n'
                   '# Original retained bytes passed immutable full-app preflight.\n'
                   'binary_retention_status=0\n'
                   "printf '{\"exitCode\":0,\"mode\":\"validated-existing-retained-binary\"}\\n' > native-ui-logs/binary-retention.json\n")
    result = result[:start] + replacement + result[end:]
    root_block = ('"$adb_bin" root\n'
                  'timeout 30 "$adb_bin" wait-for-device\n'
                  'test "$("$adb_bin" shell id -u | tr -d \'\\r\')" = 0\n')
    if result.count(root_block) != 1:
        raise ValueError('Original root setup changed')
    result = result.replace(root_block, 'python3 ' + shlex.quote(str(helper)) + ' root --adb "$adb_bin"\n')
    install = '"$adb_bin" install -r "$apk"\n'
    if result.count(install) != 1:
        raise ValueError('Original installation changed')
    result = result.replace(install, install + 'python3 ' + shlex.quote(str(helper)) + ' installed --adb "$adb_bin"\n')
    if result[result.index('flow_status=0\n'):] != original[original.index('flow_status=0\n'):]:
        raise ValueError('Original full flow/receipt/decoder gate changed')
    return result


def prepare(root, retained, output):
    binary, source, manifest = validate(root, retained)
    if output.exists():
        raise ValueError('Fresh output required, no prior UI evidence may be reused')
    output.mkdir()
    (output / 'screenshots').mkdir()
    shutil.copyfile(retained / 'source.json', output / 'source.json')
    shutil.copyfile(retained / 'test-only-binary/binary-manifest.json', output / 'retained-binary-manifest.json')
    shutil.copytree(retained / 'overlays', output / 'overlays')
    helper = Path(__file__).resolve()
    original = (root / 'scripts/quality/test-android-app-ui.sh').read_text()
    runner = generate_runner(original, binary, helper)
    (output / 'run-retained-full-app.sh').write_text(runner)
    receipt = {'schemaVersion': 1, 'kind': 'retained-full-app-android-recovery',
               'applicationSourceCommit': SOURCE, 'applicationSourceTree': TREE,
               'producerRunId': RUN, 'producerArtifactId': ARTIFACT,
               'consumerCommit': os.environ.get('GITHUB_SHA'),
               'consumerRunId': os.environ.get('GITHUB_RUN_ID'),
               'binarySha256': APK_SHA, 'sourceReceiptSha256': RECEIPT_SHA,
               'binaryManifestSha256': MANIFEST_SHA,
               'validatedSourceFiles': len(source['hashes']), 'validatedOverlays': len(source['overlays']),
               'originalSourceReceiptUnchanged': True, 'originalApplicationCheckoutUnchanged': True,
               'fullOriginalFlowAndVerifierTailUnchanged': True,
               'sourceReceiptWorkflowRunMeaning': 'Original compiled APK producer. This recovery run is consumerRunId.',
               'rebuild': False, 'rebundle': False, 'resign': False,
               'testOnly': True, 'userDistributionPermitted': False,
               'runnerSha256': hashlib.sha256(runner.encode()).hexdigest()}
    (output / 'recovery-provenance.json').write_text(json.dumps(receipt, indent=2) + '\n')


def root_device(adb, output, execute=subprocess.run, clock=time.monotonic):
    if os.environ.get('CI') != 'true' or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa':
        raise ValueError('Root recovery requires disposable QA CI')
    if not Path(adb).is_absolute() or Path(adb).name != 'adb':
        raise ValueError('Use the explicit SDK adb')
    deadline = clock() + 60
    records = []
    receipt = {'device': SERIAL, 'deadlineSeconds': 60, 'maximumRootAttempts': 2,
               'maximumReconnects': 1, 'success': False, 'commands': records}

    def call(args):
        remaining = deadline - clock()
        if remaining <= 0:
            raise ValueError('Shared root recovery deadline exhausted')
        response = execute([adb, '-s', SERIAL, *args], capture_output=True, text=True,
                           timeout=min(20, remaining))
        text = (response.stdout + response.stderr).strip()
        records.append({'args': args, 'exitCode': response.returncode, 'output': text[:1200]})
        return response.returncode, text

    def require(args, expected):
        code, text = call(args)
        if code or text != expected:
            raise ValueError('Emulator identity or root verification failed: ' + ' '.join(args))

    def acquire():
        code, text = call(['root'])
        if code:
            return code, text
        code, text = call(['wait-for-device'])
        if code:
            return code, text
        code, text = call(['shell', 'id', '-u'])
        if not code and text == '0':
            return 0, '0'
        return code or 1, text

    try:
        require(['shell', 'getprop', 'ro.kernel.qemu'], '1')
        require(['shell', 'getprop', 'ro.product.cpu.abi'], 'x86_64')
        require(['shell', 'getprop', 'ro.build.version.sdk'], '35')
        code, text = acquire()
        if code:
            if not re.search(r'\b(closed|offline)\b|device .+ not found|no devices/emulators found', text, re.I):
                raise ValueError('Non-transient root failure: ' + text)
            # Only this already-verified disposable emulator transport is reset.
            call(['reconnect'])
            require(['wait-for-device'], '')
            require(['shell', 'getprop', 'ro.kernel.qemu'], '1')
            require(['shell', 'getprop', 'ro.product.cpu.abi'], 'x86_64')
            require(['shell', 'getprop', 'ro.build.version.sdk'], '35')
            code, text = acquire()
            if code:
                raise ValueError('Root recovery failed: ' + text)
        receipt['success'] = True
        receipt['verifiedUid'] = 0
    finally:
        output.write_text(json.dumps(receipt, indent=2) + '\n')


def inspect_apk(aapt, binary):
    checked(binary, APK_SHA)
    badging = command([aapt, 'dump', 'badging', str(binary)])
    if (f"package: name='{PACKAGE}' versionCode='1' versionName='1.1.0'" not in badging
            or "native-code: 'x86_64'" not in badging):
        raise ValueError('Actual retained APK identity or ABI mismatch')
    Path('native-ui-logs/retained-apk-badging.txt').write_text(badging + '\n')


def installed(adb):
    lines = command([adb, '-s', SERIAL, 'shell', 'pm', 'path', PACKAGE]).splitlines()
    if len(lines) != 1 or not re.fullmatch(r'package:/data/app/[A-Za-z0-9_./=+~\-]+/base\.apk', lines[0]):
        raise ValueError('Expected exactly one installed base APK')
    result = command([adb, '-s', SERIAL, 'exec-out', 'sha256sum', lines[0][8:]])
    if result.split()[0] != APK_SHA:
        raise ValueError('Installed APK bytes differ from retained producer bytes')
    Path('native-ui-logs/installed-binary.json').write_text(json.dumps({
        'packageId': PACKAGE, 'sha256': APK_SHA, 'matchesProducer': True}) + '\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['prepare', 'root', 'apk', 'installed'])
    parser.add_argument('--retained', type=Path)
    parser.add_argument('--adb')
    parser.add_argument('--aapt')
    parser.add_argument('--apk', type=Path)
    args = parser.parse_args()
    if args.mode == 'prepare':
        prepare(Path.cwd().resolve(), args.retained.resolve(), Path('native-ui-logs'))
    elif args.mode == 'root':
        root_device(args.adb, Path('native-ui-logs/adb-root-recovery.json'))
    elif args.mode == 'apk':
        inspect_apk(args.aapt, args.apk)
    else:
        installed(args.adb)


if __name__ == '__main__':
    main()
