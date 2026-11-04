#!/usr/bin/env python3
"""One iOS full-app recovery with original signed bytes and an explicit flow delta."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess

SOURCE = '54cc04abb953a4580f817741fa81d7d54759aecf'
RELEASE = 'bb6797cfae67eb1142236615dee3daaac3e1b771'
TREE = '75c7587093bb8c4d37ae45811e60b9d8e73af873'
RUN = '41901710700'
ARTIFACT = '13359603305'
ARCHIVE_SHA = '04443f424aa8c23b3d1de9288a330e2caa732e272f74871458e713eb716a7296'
BINARY_SHA = 'cd25ed212a5a8460ef760fde49471ad2df024037431b84ac12d95e1f26de2fea'
MANIFEST_SHA = 'f8793f0ff98b043104f1ecc0446c50696fff85ae9fc0b479d501f5dc49870ab7'
RECEIPT_SHA = 'c6e3329cb06356cec7f88148190ecf1927645e626645896ac98216c3160136a1'
RUNNER_SHA = '4f52d8cd572d2c38362348902a418d4802f6347bc85905e138e297979bb2613a'
FLOW_SHA = 'cf4e4ad6c845769d435174bfec2451d33577d9decd95e8c81d99e120f1daa095'
PACKAGE = 'app.platinumcircles.mobile.qa'
FLOW = 'tests/native/flows/navigation.yaml'


def module(root, name):
    path = root / 'scripts/quality' / name
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


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


def verify_app(root, app):
    if module(root, 'native-ui-audit-runner.py').binary_digest(app) != BINARY_SHA:
        raise ValueError('Signed bundle bytes differ from the original producer')


def validate(root, retained):
    for expression, expected in [('HEAD', SOURCE), ('HEAD^{tree}', TREE), (RELEASE + '^{tree}', TREE)]:
        if command(['git', '-C', str(root), 'rev-parse', expression]) != expected:
            raise ValueError('Wrong original application identity: ' + expression)
    if command(['git', '-C', str(root), 'diff', '--name-only', 'HEAD']):
        raise ValueError('Application checkout has tracked changes')
    archive = safe(retained, 'test-only-binary/qa.app.tar.gz')
    manifest_path = safe(retained, 'test-only-binary/binary-manifest.json')
    source_path = safe(retained, 'source.json')
    for path, expected in [(archive, ARCHIVE_SHA), (manifest_path, MANIFEST_SHA),
                           (source_path, RECEIPT_SHA),
                           (safe(retained, 'test-only-binary/source.json'), RECEIPT_SHA)]:
        checked(path, expected)
    manifest = json.loads(manifest_path.read_text())
    source = json.loads(source_path.read_text())
    expected = {'schemaVersion': 1, 'kind': 'disposable-native-full-app',
                'configuration': 'Release', 'applicationSourceCommit': SOURCE,
                'applicationSourceTree': TREE, 'platform': 'ios',
                'packageId': PACKAGE, 'binaryName': 'PlatinumQA.app',
                'binarySha256': BINARY_SHA, 'sourceReceiptSha256': RECEIPT_SHA,
                'testOnly': True, 'userDistributionPermitted': False,
                'rebuildPerCase': False, 'resignOrRebundlePermitted': False}
    if any(type(manifest.get(k)) is not type(v) or manifest.get(k) != v for k, v in expected.items()):
        raise ValueError('Retained full-app contract mismatch')
    target = module(root, 'native-ui-ios-compatibility.py').expected_target(manifest)
    if target['targetId'] != 'arm64-ios26.2':
        raise ValueError('Expected original ARM iOS26.2 target')
    if source['commit'] != SOURCE or str(source['workflowRun']) != RUN:
        raise ValueError('Producer receipt identity mismatch')
    if len(source['hashes']) != 698 or len(source['overlays']) != 16:
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
    fixture_files = {name: value for name, value in source['hashes'].items()
                     if name.startswith('tests/native/')}
    if fixture_files != manifest['fixtureHashes'] or len(fixture_files) != 123:
        raise ValueError('Incomplete fixture manifest')
    for name, expected_hash in manifest['nativeCompatibility']['configurationInputs'].items():
        checked(safe(root, name), expected_hash)
    checked(safe(root, 'scripts/quality/test-ios-app-ui.sh'), RUNNER_SHA)
    return archive, source, manifest


def generate_runner(original, app, helper):
    if hashlib.sha256(original.encode()).hexdigest() != RUNNER_SHA:
        raise ValueError('Original runner changed')
    start = original.index('node scripts/quality/prepare-native-ui.cjs\n')
    end = original.index("ui_simulator=''\n", start)
    result = original[:start] + original[end:]
    start = result.index('npx --no-install expo prebuild')
    end = result.index('xcrun simctl spawn "$ui_simulator" log stream', start)
    replacement = ('app=' + shlex.quote(str(app)) + '\n'
        'binary_retention_status=0\n'
        "printf '{\"exitCode\":0,\"mode\":\"validated-existing-signed-bundle\"}\\n' > native-ui-logs/binary-retention.json\n"
        'python3 ' + shlex.quote(str(helper)) + ' immutable --app "$app"\n'
        'ui_simulator="$(python3 scripts/quality/native-ui-start-ios-device.py '
        '--manifest native-ui-logs/retained-binary-manifest.json '
        '--immutable-preflight native-ui-logs/immutable-preflight.json '
        '--output native-ui-logs/device-setup.json)"\n'
        'python3 ' + shlex.quote(str(helper)) + ' install --app "$app" --device "$ui_simulator"\n')
    result = result[:start] + replacement + result[end:]
    cleanup = ('    xcrun simctl shutdown "$ui_simulator" >/dev/null 2>&1 || true\n'
               '    xcrun simctl delete "$ui_simulator" >/dev/null 2>&1 || true\n')
    if result.count(cleanup) != 1:
        raise ValueError('Original owned-device cleanup changed')
    result = result.replace(cleanup,
        '    python3 scripts/quality/native-ui-start-ios-device.py '
        '--manifest native-ui-logs/retained-binary-manifest.json '
        '--output native-ui-logs/device-setup.json --cleanup-device "$ui_simulator" '
        '> native-ui-logs/cleanup.log 2>&1 || true\n')
    if result[result.index('flow_status=0\n'):] != original[original.index('flow_status=0\n'):]:
        raise ValueError('Original flow, receipt and decoder gate changed')
    return result


def prepare(root, retained, consumer, output):
    archive, source, manifest = validate(root, retained)
    checked(safe(consumer, FLOW), FLOW_SHA)
    if output.exists():
        raise ValueError('Fresh output required, no prior UI evidence may be reused')
    output.mkdir()
    (output / 'screenshots').mkdir()
    shutil.copyfile(retained / 'source.json', output / 'source.json')
    shutil.copyfile(retained / 'test-only-binary/binary-manifest.json', output / 'retained-binary-manifest.json')
    shutil.copytree(retained / 'overlays', output / 'overlays')
    app = module(root, 'native-ui-ios-audit-recovery.py').extract_app(archive, output / 'signed-bundle')
    verify_app(root, app)
    original = (root / 'scripts/quality/test-ios-app-ui.sh').read_text()
    runner = generate_runner(original, app.resolve(), Path(__file__).resolve())
    (output / 'run-retained-ios.sh').write_text(runner)
    # Only the external Maestro instruction changes. The already-compiled app,
    # original source receipt and every assertion/decoder remain unchanged.
    shutil.copyfile(root / FLOW, output / 'original-navigation.yaml')
    shutil.copyfile(consumer / FLOW, root / FLOW)
    receipt = {'schemaVersion': 1, 'kind': 'retained-full-app-ios-recovery',
        'releaseSource': RELEASE, 'applicationSourceCommit': SOURCE, 'applicationSourceTree': TREE,
        'releaseTreeEqualsApplicationTree': True, 'producerRunId': RUN, 'producerArtifactId': ARTIFACT,
        'consumerCommit': os.environ.get('GITHUB_SHA'), 'consumerRunId': os.environ.get('GITHUB_RUN_ID'),
        'binarySha256': BINARY_SHA, 'archiveSha256': ARCHIVE_SHA,
        'sourceReceiptSha256': RECEIPT_SHA, 'binaryManifestSha256': MANIFEST_SHA,
        'validatedSourceFiles': len(source['hashes']), 'validatedOverlays': len(source['overlays']),
        'originalSourceReceiptUnchanged': True, 'originalApplicationRuntimeUnchanged': True,
        'flowOverride': {'file': FLOW, 'before': source['hashes'][FLOW], 'after': FLOW_SHA,
                         'scope': 'Bounded iOS system password prompt dismissal only'},
        'fullOriginalFlowAndVerifierTailUnchanged': True,
        'sourceReceiptWorkflowRunMeaning': 'Original compiled bundle producer. This recovery run is consumerRunId.',
        'rebuild': False, 'rebundle': False, 'resign': False, 'testOnly': True,
        'userDistributionPermitted': False, 'runnerSha256': hashlib.sha256(runner.encode()).hexdigest()}
    (output / 'recovery-provenance.json').write_text(json.dumps(receipt, indent=2) + '\n')


def immutable(root, app):
    output = root / 'native-ui-logs'
    manifest_path = output / 'retained-binary-manifest.json'
    checked(manifest_path, MANIFEST_SHA)
    manifest = json.loads(manifest_path.read_text())
    verify_app(root, app)
    records = []
    bounded = module(root, 'native-ui-ios-audit-recovery.py')
    actual = bounded.verify_setup_immutable(app, manifest, records, output / 'immutable-commands.json')
    proof = {'schemaVersion': 1, 'kind': 'native-ios-immutable-preflight',
        'applicationSourceCommit': SOURCE, 'applicationSourceTree': TREE,
        'binaryManifestSha256': MANIFEST_SHA, 'binarySha256': BINARY_SHA,
        'binaryPath': str(app.resolve()), 'developerDirectory': os.environ.get('DEVELOPER_DIR'),
        'immutableCompatibility': actual, 'commands': records}
    module(root, 'native-ui-ios-immutable-preflight.py').verify_record(manifest, MANIFEST_SHA, proof, app)
    bounded.atomic_json(output / 'immutable-preflight.json', proof)


def install(root, app, device):
    output = root / 'native-ui-logs'
    manifest = json.loads((output / 'retained-binary-manifest.json').read_text())
    prepared = json.loads((output / 'device-setup.json').read_text())
    module(root, 'native-ui-ios-compatibility.py').verify_prepared_booted_runtime(manifest, device, prepared)
    verify_app(root, app)
    bounded = module(root, 'native-ui-ios-audit-recovery.py')
    bounded.setup_read(['xcrun', 'simctl', 'install', device, str(app)], 'install', 120, [], output / 'install.json')
    installed = Path(bounded.setup_read(['xcrun', 'simctl', 'get_app_container', device, PACKAGE, 'app'],
                                      'installed-app', 30, [], output / 'installed-app.json'))
    verify_app(root, installed)
    bounded.atomic_json(output / 'installed-binary.json', {'binarySha256': BINARY_SHA, 'matchesProducer': True})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['prepare', 'immutable', 'install'])
    parser.add_argument('--retained', type=Path)
    parser.add_argument('--consumer', type=Path)
    parser.add_argument('--app', type=Path)
    parser.add_argument('--device')
    args = parser.parse_args()
    if os.environ.get('CI') != 'true' or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa':
        raise ValueError('Only disposable QA CI may consume this synthetic app')
    root = Path.cwd().resolve()
    if args.mode == 'prepare':
        prepare(root, args.retained.resolve(), args.consumer.resolve(), root / 'native-ui-logs')
    elif args.mode == 'immutable':
        immutable(root, args.app.resolve())
    else:
        install(root, args.app.resolve(), args.device)


if __name__ == '__main__':
    main()
