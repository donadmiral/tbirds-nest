#!/usr/bin/env python3
"""Verify and consume one unchanged signed Simulator app with external gestures."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import tarfile

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / 'scripts/quality/retained-ios-full-ui.json'
PACKAGE = 'app.platinumcircles.mobile.qa'
EXTERNAL_FILES = {'tests/native/flows/feed-video.yaml', 'tests/native/flows/memory-capture.yaml'}


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


common = load_module('retained_common', ROOT / 'scripts/quality/retained-android-full-ui.py')
digest, relative, checked, command = common.digest, common.relative, common.checked, common.command


def verify_source(application, retained, config):
    if config.get('schemaVersion') != 1 or config.get('kind') != 'retained-ios-full-ui':
        raise ValueError('Wrong retained iOS consumer configuration')
    if any(config.get(key) is not False for key in ['rebuild', 'rebundle', 'resign']):
        raise ValueError('The retained app cannot be rebuilt, rebundled or signed')
    folder = retained / 'test-only-binary'
    for file, key in [('qa.app.tar.gz', 'appArchiveSha256'), ('binary-manifest.json', 'binaryManifestSha256'),
                      ('source.json', 'sourceReceiptSha256')]:
        checked(folder / file, config[key])
    checked(retained / 'source.json', config['sourceReceiptSha256'])
    if (folder / 'qa.app.tar.gz').stat().st_size != config['appArchiveBytes']:
        raise ValueError('Wrong app archive size')
    manifest = json.loads((folder / 'binary-manifest.json').read_text())
    source = json.loads((folder / 'source.json').read_text())
    expected = {'schemaVersion': 1, 'kind': 'disposable-native-full-app', 'configuration': 'Release',
                'applicationSourceCommit': config['applicationSourceCommit'],
                'applicationSourceTree': config['applicationSourceTree'], 'platform': 'ios',
                'packageId': PACKAGE, 'binaryName': 'PlatinumQA.app', 'binarySha256': config['binarySha256'],
                'sourceReceiptSha256': config['sourceReceiptSha256'], 'testOnly': True,
                'userDistributionPermitted': False, 'rebuildPerCase': False, 'resignOrRebundlePermitted': False}
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise ValueError('Wrong retained iOS binary provenance')
    native = manifest.get('nativeCompatibility', {})
    target = {'targetId': 'arm64-ios26.2', 'abi': 'arm64', 'runtimeIdentifier': 'com.apple.CoreSimulator.SimRuntime.iOS-26-2',
              'deviceTypeIdentifier': 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', 'platform': 'iphonesimulator'}
    if any(native.get(key) != value for key, value in target.items()):
        raise ValueError('Wrong retained Simulator target')
    if source.get('commit') != config['applicationSourceCommit'] or str(source.get('workflowRun')) != str(config['producerRunId']):
        raise ValueError('Wrong binary producer identity')
    if source.get('audit') is not None or source.get('mode') != manifest.get('fixtureMode'):
        raise ValueError('Wrong retained fixture mode')
    hashes = source.get('hashes', {})
    if not hashes or manifest.get('fixtureHashes') != {name: value for name, value in hashes.items() if name.startswith('tests/native/')}:
        raise ValueError('Incomplete source fixture hashes')
    for name, expected_hash in {**hashes, **config['sourceTools']}.items():
        checked(relative(application, name), expected_hash)
    if not source.get('overlays'):
        raise ValueError('Missing build overlays')
    for overlay in source['overlays']:
        if not overlay['retained'].startswith('overlays/'):
            raise ValueError('Wrong overlay directory')
        checked(relative(retained, overlay['retained']), overlay['after'])
        if overlay['before'] is not None:
            checked(relative(application, overlay['file']), overlay['before'])
    return manifest, source


def extract_app(archive, destination):
    destination.mkdir(exist_ok=False)
    with tarfile.open(archive, 'r:gz') as bundle:
        members = bundle.getmembers()
        if len(members) > 5000 or sum(row.size for row in members) > 1024 * 1024 * 1024:
            raise ValueError('Retained app exceeds extraction budget')
        for row in members:
            path = Path(row.name)
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != 'PlatinumQA.app':
                raise ValueError('Unsafe retained app archive path')
            if not (row.isfile() or row.isdir() or row.issym()):
                raise ValueError('Unsupported retained app archive entry')
        bundle.extractall(destination, filter='data')
    return destination / 'PlatinumQA.app'


def helpers(application, config):
    for name, expected in config['sourceTools'].items():
        checked(relative(application, name), expected)
    return (load_module('retained_ios_digest', application / 'scripts/quality/native-ui-audit-runner.py'),
            load_module('retained_ios_compatibility', application / 'scripts/quality/native-ui-ios-compatibility.py'))


def prepare(application, retained, config):
    if command(['git', '-C', str(application), 'rev-parse', 'HEAD']) != config['applicationSourceCommit']:
        raise ValueError('Wrong application checkout')
    for ref in ['HEAD^{tree}', config['productSourceCommit'] + '^{tree}']:
        if command(['git', '-C', str(application), 'rev-parse', ref]) != config['applicationSourceTree']:
            raise ValueError('Producer and product trees must match')
    if command(['git', '-C', str(application), 'diff', '--name-only', 'HEAD']):
        raise ValueError('Application checkout is modified')
    manifest, source = verify_source(application, retained, config)
    external = config.get('externalFiles', {})
    if set(external) != EXTERNAL_FILES:
        raise ValueError('Only reviewed external gestures may differ')
    sources = config.get('externalSources', {})
    if sources != {'tests/native/flows/memory-capture.yaml': 'tests/native/flows/retained-ios-memory-capture.yaml'}:
        raise ValueError('Only the reviewed external memory handoff variant is permitted')
    for name, expected in external.items():
        checked(relative(ROOT, sources.get(name, name)), expected)
    checked(ROOT / 'scripts/quality/run-retained-ios-flows.sh', config['externalRunnerSha256'])
    checked(ROOT / 'scripts/quality/retained-ios-handoff.py', config['externalHandoffSha256'])
    app = extract_app(retained / 'test-only-binary/qa.app.tar.gz', application / 'retained-app')
    runner, _ = helpers(application, config)
    if runner.binary_digest(app) != config['binarySha256'] or (app / 'main.jsbundle').stat().st_size < 100000:
        raise ValueError('Extracted Simulator app differs from producer')
    output = application / 'native-ui-logs'
    output.mkdir(exist_ok=False)
    (output / 'screenshots').mkdir()
    shutil.copyfile(retained / 'source.json', output / 'source.json')
    shutil.copytree(retained / 'overlays', output / 'overlays')
    for name in external:
        shutil.copyfile(relative(ROOT, sources.get(name, name)), relative(application, name))
    proof = {**config, 'consumerCommit': os.environ.get('GITHUB_SHA'), 'consumerRunId': os.environ.get('GITHUB_RUN_ID'),
             'sourceFilesVerified': len(source['hashes']), 'binaryVerified': True,
             'sourceReceiptStillIdentifiesOriginalProducer': True, 'priorResultsReused': False}
    (output / 'retained-provenance.json').write_text(json.dumps(proof, indent=2) + '\n')


def verify_runtime(application, retained, config, device):
    runner, compatibility = helpers(application, config)
    manifest = json.loads((retained / 'test-only-binary/binary-manifest.json').read_text())
    app = application / 'retained-app/PlatinumQA.app'
    if runner.binary_digest(app) != config['binarySha256']:
        raise ValueError('Retained app changed before installation')
    proof = compatibility.verify_immutable_compatibility(app, manifest, command)
    if device:
        if not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device):
            raise ValueError('Explicit Simulator UUID required')
        proof.update(compatibility.verify_booted_runtime(manifest, device, command))
        installed = Path(command(['xcrun', 'simctl', 'get_app_container', device, PACKAGE, 'app']))
        if not installed.is_dir() or runner.binary_digest(installed) != config['binarySha256']:
            raise ValueError('Installed app differs from retained producer')
        proof['installedAppMatchesProducer'] = True
    name = 'installed-identity.json' if device else 'immutable-compatibility.json'
    (application / 'native-ui-logs' / name).write_text(json.dumps(proof, indent=2) + '\n')


def finish(application, retained, config):
    output = application / 'native-ui-logs'
    runner, _ = helpers(application, config)
    if runner.binary_digest(application / 'retained-app/PlatinumQA.app') != config['binarySha256']:
        raise ValueError('Retained app changed during test')
    installed = json.loads((output / 'installed-identity.json').read_text())
    if installed.get('installedAppMatchesProducer') is not True:
        raise ValueError('Installed app identity was not confirmed')
    phases = json.loads((output / 'phase-results.json').read_text())
    if set(phases) != {'flows', 'evidence', 'memoryDecoder', 'fullAppVerifier'} or any(value != 0 for value in phases.values()):
        raise ValueError('Required full application phases did not pass')
    receipt = json.loads((output / 'receipt.json').read_text())
    if receipt.get('passed') is not True or receipt.get('commit') != config['applicationSourceCommit'] or str(receipt.get('workflowRun')) != str(config['producerRunId']):
        raise ValueError('Original full verifier did not confirm the retained source')
    handoff = json.loads((output / 'ios-memory-handoff.json').read_text())
    if handoff.get('exitCode') != 0 or handoff.get('attempts') != 1 or handoff.get('routeReceiptVerified') is not True:
        raise ValueError('The single external Simulator handoff did not succeed')
    checked(ROOT / 'scripts/quality/run-retained-ios-flows.sh', config['externalRunnerSha256'])
    checked(ROOT / 'scripts/quality/retained-ios-handoff.py', config['externalHandoffSha256'])
    source = json.loads((output / 'source.json').read_text())
    for name, expected in {**source['hashes'], **config['sourceTools'], **config['externalFiles']}.items():
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
    parser.add_argument('phase', choices=['prepare', 'immutable', 'installed', 'finish'])
    parser.add_argument('--device')
    args = parser.parse_args()
    if os.environ.get('CI') != 'true' or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa' or os.environ.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') != 'native-ui-synthetic-no-provider-key':
        parser.error('Only the isolated synthetic QA runner is permitted')
    application = Path.cwd()
    retained = application / 'retained-native-ui'
    config = json.loads(CONFIG.read_text())
    if args.phase == 'prepare':
        prepare(application, retained, config)
    elif args.phase in ['immutable', 'installed']:
        if args.phase == 'installed' and not args.device:
            parser.error('Installed validation requires the exact Simulator UUID')
        verify_runtime(application, retained, config, args.device)
    else:
        finish(application, retained, config)


if __name__ == '__main__':
    main()
