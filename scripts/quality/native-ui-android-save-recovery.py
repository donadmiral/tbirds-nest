#!/usr/bin/env python3
"""Verify one corrected Save flow against the exact retained d46 QA APK."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / 'scripts/quality/native-ui-android-save-recovery.json'
GATE = ROOT / 'scripts/quality/native-ui-audit-runner.py'


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def checked(path, expected):
    if not path.is_file() or path.is_symlink() or digest(path) != expected:
        raise ValueError('Pinned file identity mismatch: ' + path.name)


def read_command(args):
    return subprocess.check_output(args, stderr=subprocess.PIPE, timeout=30).decode().strip()


def load_gate():
    spec = importlib.util.spec_from_file_location('retained_save_gate', GATE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def select_case(manifest, config):
    matches = [case for case in manifest['cases'] if case['id'] == config['caseId']]
    if len(matches) != 1:
        raise ValueError('Exactly one original Save case is required')
    case = matches[0]
    expected = {'ownerId': '10000000-0000-4000-8000-000000000001',
                'albumId': 'a0000000-0000-4000-8000-000000000002'}
    if (case['kind'] != 'control-journey' or case['group'] != 'memory'
            or case['fixtureScenario'] != 'baseline'
            or case['state']['routes'][0]['params'] != expected):
        raise ValueError('The original Save case scope changed')
    return {**case, 'name': config['caseName'], 'flow': 'flows/retained-memory-cover-settings.yaml'}


def preflight(source_root, output):
    config = json.loads(CONFIG.read_text())
    if (config['schemaVersion'] != 1 or config['kind'] != 'retained-android-memory-save'
            or any(config[key] is not False for key in ['rebuild', 'rebundle', 'resign', 'currentApplicationRepairsIncluded'])):
        raise ValueError('Retained-package-only contract changed')
    if read_command(['git', '-C', str(source_root), 'rev-parse', 'HEAD']) != config['applicationSourceCommit']:
        raise ValueError('Wrong application checkout')
    if read_command(['git', '-C', str(source_root), 'rev-parse', 'HEAD^{tree}']) != config['applicationSourceTree']:
        raise ValueError('Wrong application tree')
    if read_command(['git', '-C', str(source_root), 'diff', '--name-only', 'HEAD']):
        raise ValueError('The retained application checkout contains tracked edits')
    checked(GATE, config['receiptGateSha256'])
    for name, expected in config['originalFiles'].items():
        checked(source_root / name, expected)
    binary_dir = source_root / 'native-audit-binary'
    binary = binary_dir / 'app-release.apk'
    checked(binary, config['binarySha256'])
    checked(binary_dir / 'binary-manifest.json', config['binaryManifestSha256'])
    checked(binary_dir / 'source.json', config['sourceReceiptSha256'])
    manifest_path = source_root / 'tests/native/audit/manifest.json'
    checked(manifest_path, config['auditManifestSha256'])
    binary_manifest = json.loads((binary_dir / 'binary-manifest.json').read_text())
    gate = load_gate()
    gate.validate_binary(binary_manifest, binary, 'android', config['applicationSourceCommit'], config['applicationSourceTree'])
    if (binary_manifest['packageId'] != config['packageId']
            or binary_manifest['sourceReceiptSha256'] != config['sourceReceiptSha256']
            or binary_manifest['auditManifestSha256'] != config['auditManifestSha256']
            or binary_manifest['nativeCompatibility']['abi'] != 'x86_64'
            or binary_manifest['nativeCompatibility']['api'] != '35'):
        raise ValueError('Original APK metadata changed')
    source = json.loads((binary_dir / 'source.json').read_text())
    if source['commit'] != config['applicationSourceCommit'] or str(source['workflowRun']) != str(config['producerRunId']):
        raise ValueError('Original producer source receipt changed')
    manifest = json.loads(manifest_path.read_text())
    case = select_case(manifest, config)
    flow = ROOT / config['diagnosticFlow']
    checked(flow, config['diagnosticFlowSha256'])
    target = source_root / config['diagnosticFlow']
    if target.exists():
        checked(target, config['diagnosticFlowSha256'])
    else:
        shutil.copyfile(flow, target)
    output.mkdir(parents=True, exist_ok=True)
    provenance = {**config, 'kind': 'retained-android-save-verification',
                  'consumerCommit': os.environ.get('GITHUB_SHA'), 'consumerRunId': os.environ.get('GITHUB_RUN_ID'),
                  'selectedCases': [case['id']], 'unselectedOriginalCases': len(manifest['cases']) - 1,
                  'originalSigninUnchanged': True, 'originalApplicationSourceUnchanged': True,
                  'sourceScope': 'Retained d46 APK, corrected external Save flow and case-specific persistence verifier only.'}
    (output / 'recovery-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    shutil.copyfile(binary_dir / 'binary-manifest.json', output / 'binary-manifest.json')
    shutil.copyfile(manifest_path, output / 'original-audit-manifest.json')
    shutil.copyfile(flow, output / 'executed-save-flow.yaml')
    return config, binary, binary_manifest, case, gate


def installed_digest(device, package):
    lines = read_command(['adb', '-s', device, 'shell', 'pm', 'path', package]).splitlines()
    if len(lines) != 1 or not re.fullmatch(r'package:/data/app/[A-Za-z0-9_./=+~-]+/base\.apk', lines[0]):
        raise ValueError('Expected exactly one installed retained base APK')
    data = subprocess.check_output(['adb', '-s', device, 'exec-out', 'cat', lines[0][8:]], timeout=45)
    return hashlib.sha256(data).hexdigest()


def run(source_root, output, device):
    config, binary, binary_manifest, case, gate = preflight(source_root, output)
    gate.validate_device('android', device, binary_manifest['nativeCompatibility'], binary, binary_manifest['toolchain'])
    install = subprocess.run(['adb', '-s', device, 'install', '-r', str(binary)], check=False, timeout=90)
    if install.returncode:
        raise ValueError('Retained APK installation failed')
    installed = installed_digest(device, config['packageId'])
    if installed != config['binarySha256']:
        raise ValueError('Installed APK bytes differ from the retained producer APK')
    (output / 'installed-identity.json').write_text(json.dumps({'packageId': config['packageId'],
        'installedApkSha256': installed, 'matchesProducer': True}, indent=2) + '\n')
    target = output / 'cases'
    target.mkdir(exist_ok=False)
    results = gate.run_cases([case], 'android', device, target)
    unchanged = digest(binary) == config['binarySha256']
    accepted = len(results) == 1 and results[0]['status'] == 'passed' and unchanged
    summary = {'kind': 'retained-android-save-verification', 'applicationSourceCommit': config['applicationSourceCommit'],
               'consumerCommit': os.environ.get('GITHUB_SHA'), 'platform': 'android', 'attempted': len(results),
               'passed': int(accepted), 'failed': int(not accepted), 'selectedCases': [case['id']],
               'binaryUnchangedAfterTest': unchanged, 'rebuild': False, 'rebundle': False, 'resign': False,
               'currentApplicationRepairsIncluded': False, 'otherRepairsDeviceVerified': False,
               'allControlsAccepted': False}
    (output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    return 0 if accepted else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['prepare', 'run'])
    parser.add_argument('--device')
    args = parser.parse_args()
    if (os.environ.get('CI') != 'true' or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa'
            or os.environ.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') != 'native-ui-synthetic-no-provider-key'):
        parser.error('Use only the isolated synthetic QA runner')
    source_root = Path.cwd()
    output = source_root / 'native-save-results'
    try:
        if args.phase == 'prepare':
            preflight(source_root, output)
            return 0
        if not args.device or not re.fullmatch(r'emulator-[0-9]+', args.device):
            raise ValueError('An exact disposable emulator serial is required')
        return run(source_root, output, args.device)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        output.mkdir(parents=True, exist_ok=True)
        (output / 'setup-or-verification-failure.json').write_text(json.dumps({
            'phase': args.phase, 'errorType': type(error).__name__, 'message': str(error),
            'passed': False, 'noPassInferredFromSetup': True}, indent=2) + '\n')
        raise


if __name__ == '__main__':
    sys.exit(main())
