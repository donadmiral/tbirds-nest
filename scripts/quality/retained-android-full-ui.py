#!/usr/bin/env python3
"""Run corrected external gestures against one exact retained synthetic APK."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / 'scripts/quality/retained-android-full-ui.json'
PACKAGE = 'app.platinumcircles.mobile.qa'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def relative(root, name):
    path = Path(name)
    if path.is_absolute() or '..' in path.parts or not path.parts:
        raise ValueError('Unsafe retained path')
    return root / path


def checked(path, expected):
    if path.is_symlink() or not path.is_file() or digest(path) != expected:
        raise ValueError('Pinned file mismatch: ' + str(path))


def command(args):
    return subprocess.check_output(args, stderr=subprocess.PIPE, timeout=30).decode().strip()


def verify_retained(application, retained, config):
    if config.get('schemaVersion') != 1 or config.get('kind') != 'retained-android-full-ui':
        raise ValueError('Wrong retained consumer configuration')
    if any(config.get(key) is not False for key in ['rebuild', 'rebundle', 'resign']):
        raise ValueError('Retained consumer cannot build or modify an APK')
    folder = retained / 'test-only-binary'
    checked(folder / 'app-release.apk', config['binarySha256'])
    checked(folder / 'binary-manifest.json', config['binaryManifestSha256'])
    checked(folder / 'source.json', config['sourceReceiptSha256'])
    checked(retained / 'source.json', config['sourceReceiptSha256'])
    manifest = json.loads((folder / 'binary-manifest.json').read_text())
    source = json.loads((folder / 'source.json').read_text())
    expected = {
        'schemaVersion': 1, 'kind': 'disposable-native-full-app', 'configuration': 'Release',
        'applicationSourceCommit': config['applicationSourceCommit'],
        'applicationSourceTree': config['applicationSourceTree'], 'platform': 'android',
        'packageId': PACKAGE, 'binaryName': 'app-release.apk', 'binarySha256': config['binarySha256'],
        'sourceReceiptSha256': config['sourceReceiptSha256'], 'testOnly': True,
        'userDistributionPermitted': False, 'rebuildPerCase': False, 'resignOrRebundlePermitted': False,
    }
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise ValueError('Wrong retained binary provenance')
    native = manifest.get('nativeCompatibility', {})
    if native.get('abi') != 'x86_64' or native.get('api') != '35' or native.get('image') != 'system-images;android-35;default;x86_64':
        raise ValueError('Wrong retained emulator target')
    if source.get('commit') != config['applicationSourceCommit'] or str(source.get('workflowRun')) != str(config['producerRunId']):
        raise ValueError('Wrong binary producer identity')
    if source.get('audit') is not None or source.get('mode') != manifest.get('fixtureMode'):
        raise ValueError('Wrong retained fixture mode')
    hashes = source.get('hashes', {})
    if not hashes or manifest.get('fixtureHashes') != {name: value for name, value in hashes.items() if name.startswith('tests/native/')}:
        raise ValueError('Incomplete retained source hashes')
    for name, expected_hash in hashes.items():
        checked(relative(application, name), expected_hash)
    overlays = source.get('overlays', [])
    if not overlays:
        raise ValueError('Missing build overlay provenance')
    for overlay in overlays:
        if not overlay['retained'].startswith('overlays/'):
            raise ValueError('Wrong retained overlay directory')
        checked(relative(retained, overlay['retained']), overlay['after'])
        if overlay['before'] is not None:
            checked(relative(application, overlay['file']), overlay['before'])
    with zipfile.ZipFile(folder / 'app-release.apk') as archive:
        if archive.getinfo('assets/index.android.bundle').file_size < 100000 or not any(name.startswith('lib/x86_64/') for name in archive.namelist()):
            raise ValueError('Missing bundled application or emulator ABI')
    return manifest, source


def prepare(application, retained, config):
    if command(['git', '-C', str(application), 'rev-parse', 'HEAD']) != config['applicationSourceCommit']:
        raise ValueError('Wrong application checkout')
    for ref in ['HEAD^{tree}', config['productSourceCommit'] + '^{tree}']:
        if command(['git', '-C', str(application), 'rev-parse', ref]) != config['applicationSourceTree']:
            raise ValueError('Producer and product trees must match')
    if command(['git', '-C', str(application), 'diff', '--name-only', 'HEAD']):
        raise ValueError('Application checkout is modified')
    manifest, source = verify_retained(application, retained, config)
    # Only the separately reviewed external Maestro acquisition gesture changes.
    flows = config.get('externalFlows', {})
    if set(flows) != {'tests/native/flows/feed-video.yaml'}:
        raise ValueError('Only the reviewed feed gesture override is permitted')
    for name, expected in flows.items():
        checked(relative(ROOT, name), expected)
    output = application / 'native-ui-logs'
    output.mkdir(exist_ok=False)
    (output / 'screenshots').mkdir()
    shutil.copyfile(retained / 'source.json', output / 'source.json')
    shutil.copytree(retained / 'overlays', output / 'overlays')
    for name in flows:
        shutil.copyfile(relative(ROOT, name), relative(application, name))
    proof = {**config, 'consumerCommit': os.environ.get('GITHUB_SHA'),
             'consumerRunId': os.environ.get('GITHUB_RUN_ID'), 'binaryVerified': True,
             'sourceFilesVerified': len(source['hashes']), 'applicationSourceUnchanged': True,
             'externalFlowOverrides': flows, 'priorResultsReused': False,
             'sourceReceiptStillIdentifiesOriginalProducer': True}
    (output / 'retained-provenance.json').write_text(json.dumps(proof, indent=2) + '\n')


def installed(application, config, device):
    if not re.fullmatch(r'emulator-[0-9]+', device or ''):
        raise ValueError('Explicit disposable emulator required')
    if command(['adb', '-s', device, 'shell', 'getprop', 'ro.build.version.sdk']) != '35':
        raise ValueError('Wrong emulator API')
    if command(['adb', '-s', device, 'shell', 'getprop', 'ro.product.cpu.abi']) != 'x86_64':
        raise ValueError('Wrong emulator ABI')
    paths = command(['adb', '-s', device, 'shell', 'pm', 'path', PACKAGE]).splitlines()
    if len(paths) != 1 or not re.fullmatch(r'package:/data/app/[A-Za-z0-9_./=+~-]+/base\.apk', paths[0]):
        raise ValueError('Expected exactly one installed base APK')
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / 'installed.apk'
        subprocess.run(['adb', '-s', device, 'pull', paths[0][8:], str(target)], check=True, timeout=90)
        checked(target, config['binarySha256'])
    (application / 'native-ui-logs/installed-identity.json').write_text(json.dumps({
        'packageId': PACKAGE, 'binarySha256': config['binarySha256'], 'matchesProducer': True,
        'api': 35, 'abi': 'x86_64'}, indent=2) + '\n')


def finish(application, retained, config):
    output = application / 'native-ui-logs'
    checked(retained / 'test-only-binary/app-release.apk', config['binarySha256'])
    installed_proof = json.loads((output / 'installed-identity.json').read_text())
    receipt = json.loads((output / 'receipt.json').read_text())
    phases = json.loads((output / 'phase-results.json').read_text())
    if installed_proof.get('matchesProducer') is not True or installed_proof.get('binarySha256') != config['binarySha256']:
        raise ValueError('Installed binary proof is missing')
    if set(phases) != {'flows', 'evidence', 'memoryDecoder', 'fullAppVerifier'} or any(value != 0 for value in phases.values()):
        raise ValueError('Full application phases did not pass')
    if receipt.get('passed') is not True or receipt.get('commit') != config['applicationSourceCommit'] or str(receipt.get('workflowRun')) != str(config['producerRunId']):
        raise ValueError('Full verifier receipt does not match retained source')
    for name, expected in config['externalFlows'].items():
        checked(relative(application, name), expected)
    source = json.loads((output / 'source.json').read_text())
    for name, expected in source['hashes'].items():
        if name not in config['externalFlows']:
            checked(relative(application, name), expected)
    (output / 'retained-result.json').write_text(json.dumps({
        'passed': True, 'applicationSourceCommit': config['applicationSourceCommit'],
        'productSourceCommit': config['productSourceCommit'], 'applicationSourceTree': config['applicationSourceTree'],
        'consumerCommit': os.environ.get('GITHUB_SHA'), 'consumerRunId': os.environ.get('GITHUB_RUN_ID'),
        'binarySha256': config['binarySha256'], 'fullVerifierReceiptSha256': digest(output / 'receipt.json'),
        'rebuild': False, 'rebundle': False, 'resign': False, 'priorResultsReused': False,
        'providerAcceptance': False, 'physicalDevice': False}, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['prepare', 'installed', 'finish'])
    parser.add_argument('--device')
    args = parser.parse_args()
    if os.environ.get('CI') != 'true' or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa' or os.environ.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') != 'native-ui-synthetic-no-provider-key':
        parser.error('Only the isolated synthetic QA runner is permitted')
    application = Path.cwd()
    retained = application / 'retained-native-ui'
    config = json.loads(CONFIG.read_text())
    if args.phase == 'prepare':
        prepare(application, retained, config)
    elif args.phase == 'installed':
        installed(application, config, args.device)
    else:
        finish(application, retained, config)


if __name__ == '__main__':
    main()
