#!/usr/bin/env python3
"""Consume the exact d46 iOS audit binary without rebuilding or changing cases."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import signal
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

SOURCE = 'd46c50f09164c75c7fe8cdba0c3470c272b1ab4e'
TREE = 'b9816fb408382a5e4ae4277111128e458b1d524f'
PRODUCER_RUN = 41235679679
RUNNER_SHA = 'fd855d4daebddd0a23cc9d1cc261b2a883d3ac15f1f08b64b6718321775e3352'
MANIFEST_SHA = '0a5b4f2af0ea3e5ac5befce43ac3a4af46c347c83653467ba9ddfd3901c26a3d'
DIAGNOSTIC_FLOW = 'tests/native/diagnostics/ios-warm-tabs-reader.yaml'
DIAGNOSTIC_SHA = '11ddee124546458271269419f66f997f452634a884e3fb2444a3eedbf438bc82'
DIRECT_FLOW = 'tests/native/diagnostics/ios-direct-reader-controls.yaml'
DIRECT_NAME = 'Diagnostic direct saved memory reader controls'
DIRECT_SHA = '008099f1ee207ab6c91022d410b04873b67a3ee3ea2f5b3ad586180b0a5c67af'
SIGNIN_FLOW = 'tests/native/audit/flows/_signin.yaml'
SIGNIN_SHA = '847857016d5651ef0cfe7d57747c5ef3a08ad3e837492aa4b2f7fa250125993a'
DIRECT_SIGNIN_REFERENCE = '../../../../baseline/' + SIGNIN_FLOW
WARM_CONTROLS_FLOW = 'tests/native/diagnostics/ios-warm-reader-controls.yaml'
WARM_CONTROLS_NAME = 'Diagnostic original tabs to saved memory reader controls'
WARM_CONTROLS_SHA = '044a6809310e7e2344331491f8308b0a83ef3cb2e0127dd0c4c4792d9673c22f'
HELPERS = {
    'native-ui-ios-audit-recovery.py': '428cdb8734e41c6a3a25ec1f6088a627ce6e26f911fe5496e1082e7c742592a2',
    'native-ui-ios-compatibility.py': '0a6e65d5dbfbf883cc0d4b765011d1941dcd64c0972140e28d9d3d6564159ce9',
    'native-ui-ios-created-device.py': 'd2ffc477184b8a55f3e557facf1928ac5e11976caf84f78f8050c356e172d3b7',
}
BINDING_FIELDS = {
    'schemaVersion', 'ready', 'applicationSourceCommit', 'applicationSourceTree',
    'producerRunId', 'producerArtifactName', 'producerArtifactId',
    'producerArtifactZipSha256', 'producerArtifactZipBytes', 'appArchiveSha256',
    'binaryManifestSha256', 'binarySha256', 'sourceReceiptSha256',
}


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(part)
    return value.hexdigest()


def validate_binding(value):
    if not isinstance(value, dict) or set(value) != BINDING_FIELDS:
        raise ValueError('An exact d46 producer binding is required')
    expected = {'schemaVersion': 1, 'ready': True, 'applicationSourceCommit': SOURCE,
                'applicationSourceTree': TREE, 'producerRunId': PRODUCER_RUN,
                'producerArtifactName': 'native-audit-ios-binary'}
    if any(type(value.get(key)) is not type(item) or value.get(key) != item for key, item in expected.items()):
        raise ValueError('The verified d46 producer artifact is not ready or does not match')
    for key in ['producerArtifactId', 'producerArtifactZipBytes']:
        if type(value[key]) is not int or value[key] <= 0:
            raise ValueError('A verified positive artifact identity and byte size are required')
    for key in ['producerArtifactZipSha256', 'appArchiveSha256', 'binaryManifestSha256',
                'binarySha256', 'sourceReceiptSha256']:
        if not isinstance(value[key], str) or len(value[key]) != 64 or any(c not in '0123456789abcdef' for c in value[key]):
            raise ValueError('Every producer digest must come from verified artifact bytes')
    return value


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_helpers(folder):
    for name, expected in HELPERS.items():
        if digest(folder / name) != expected:
            raise ValueError('Reviewed recovery dependency changed: ' + name)
    return load_module('d46_reviewed_recovery_helpers', folder / 'native-ui-ios-audit-recovery.py')


def verify_download(binary_dir, binding):
    for name, key in [('source.json', 'sourceReceiptSha256'),
                      ('binary-manifest.json', 'binaryManifestSha256'),
                      ('qa.app.tar.gz', 'appArchiveSha256')]:
        if digest(binary_dir / name) != binding[key]:
            raise ValueError('The downloaded producer file differs: ' + name)
    manifest = json.loads((binary_dir / 'binary-manifest.json').read_text())
    expected = {'applicationSourceCommit': SOURCE, 'applicationSourceTree': TREE,
                'platform': 'ios', 'binarySha256': binding['binarySha256'],
                'sourceReceiptSha256': binding['sourceReceiptSha256'],
                'auditManifestSha256': MANIFEST_SHA}
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise ValueError('The producer manifest does not match the verified d46 binding')
    return manifest


def select_cases(scenarios, groups, requested_ids=None):
    if not groups or not groups <= set(scenarios['groups']):
        raise ValueError('Unknown or empty feature group selection')
    eligible = [case for case in scenarios['cases'] if case['group'] in groups]
    if requested_ids is None:
        return eligible
    if not isinstance(requested_ids, str):
        raise ValueError('Case selection must be comma-separated exact case IDs')
    identifiers = requested_ids.split(',')
    if (any(not value or value != value.strip() for value in identifiers)
            or len(identifiers) != len(set(identifiers))):
        raise ValueError('Case selection must contain unique nonempty exact IDs')
    if not set(identifiers) <= {case['id'] for case in eligible}:
        raise ValueError('Every selected case must exist in the selected feature groups')
    # Preserve the original manifest order, regardless of the caller's order.
    return [case for case in eligible if case['id'] in set(identifiers)]


def select_existing_device(inventory_text, manifest, verifier):
    expected = manifest.get('nativeCompatibility', {})
    if expected.get('abi') != 'x86_64' or expected.get('runtimeIdentifier') != verifier.RUNTIME:
        raise ValueError('Only the pinned x86_64 iOS18.5 profile may select a device')
    inventory = json.loads(inventory_text)
    if not isinstance(inventory, dict) or not isinstance(inventory.get('devices'), dict):
        raise ValueError('Missing Simulator device inventory')
    eligible = []
    seen = set()
    for runtime, rows in inventory['devices'].items():
        if not isinstance(runtime, str) or not isinstance(rows, list):
            raise ValueError('Malformed Simulator device inventory')
        for row in rows:
            if (not isinstance(row, dict) or type(row.get('isAvailable')) is not bool
                    or not isinstance(row.get('state'), str)
                    or not isinstance(row.get('deviceTypeIdentifier'), str)):
                raise ValueError('Malformed Simulator device row')
            device = verifier.validate_device_identifier(row.get('udid'))
            if device.lower() in seen:
                raise ValueError('Ambiguous duplicate Simulator device UUID')
            seen.add(device.lower())
            if (runtime == verifier.RUNTIME and row['deviceTypeIdentifier'] == verifier.DEVICE_TYPE
                    and row['isAvailable'] is True and row['state'] == 'Shutdown'):
                eligible.append(device)
    eligible.sort(key=str.lower)
    return {'mode': 'existing-shutdown' if eligible else 'fresh-creation',
            'selectedDevice': eligible[0] if eligible else None, 'eligibleCount': len(eligible),
            'runtimeIdentifier': verifier.RUNTIME, 'deviceTypeIdentifier': verifier.DEVICE_TYPE,
            'expectedAbi': 'x86_64', 'selectionOrder': 'lexicographic UUID among exact eligible devices',
            'enumeration': 'bounded preboot simctl list devices --json'}


def select_execution_cases(scenarios, groups, requested_ids=None, warm=False, direct=False, warm_controls=False):
    if direct or warm_controls:
        if groups != {'memory'} or requested_ids is not None or warm or (direct and warm_controls):
            raise ValueError('Reader diagnostic-only mode requires memory alone and no other case or diagnostic mode')
        select_cases(scenarios, groups, 'memory-reader-controls')
        if warm_controls:
            select_cases(scenarios, {'navigation'}, 'navigation-warm-tabs')
        return []
    return select_cases(scenarios, groups, requested_ids)


def direct_diagnostic_junit(path, name=DIRECT_NAME, flow=DIRECT_FLOW):
    try:
        root = ET.parse(path).getroot()
        cases, suites = list(root.iter('testcase')), list(root.iter('testsuite'))
        if len(cases) != 1 or len(suites) != 1 or suites[0].get('tests') != '1':
            raise ValueError('Expected one executed direct diagnostic')
        case = cases[0]
        if case.get('name') != name or case.get('file') != flow or case.get('status') != 'SUCCESS':
            raise ValueError('Direct diagnostic identity/status mismatch')
        if any(list(root.iter(tag)) for tag in ['failure', 'error', 'skipped']):
            raise ValueError('Direct diagnostic failure/error/skip')
        if any(node.get(field, '0') != '0' for node in [root] + suites for field in ['failures', 'errors', 'skipped', 'disabled']):
            raise ValueError('Nonzero direct diagnostic suite failures')
        return {'passed': True, 'executedDiagnostics': 1}
    except (OSError, ValueError, ET.ParseError) as error:
        return {'passed': False, 'issue': type(error).__name__}


def verify_direct_reader_flow(tools_root, baseline, relative=DIRECT_FLOW, expected_sha=DIRECT_SHA):
    flow = tools_root / relative
    if digest(flow) != expected_sha:
        raise ValueError('Reviewed direct reader diagnostic bytes changed')
    # Maestro resolves runFlow file paths while parsing, before environment
    # substitution. Keep a literal path to the separate immutable checkout.
    if flow.read_text().splitlines()[3] != '- runFlow: ' + DIRECT_SIGNIN_REFERENCE:
        raise ValueError('The direct diagnostic must include the literal baseline sign-in path')
    try:
        included = (flow.parent / DIRECT_SIGNIN_REFERENCE).resolve(strict=True)
        expected = (baseline / SIGNIN_FLOW).resolve(strict=True)
    except OSError as error:
        raise ValueError('The direct diagnostic baseline sign-in file is unavailable') from error
    if included != expected or not included.is_file() or digest(included) != SIGNIN_SHA:
        raise ValueError('The direct diagnostic must use the exact original d46 sign-in file')
    return {'reference': DIRECT_SIGNIN_REFERENCE, 'baselinePath': SIGNIN_FLOW,
            'sha256': SIGNIN_SHA, 'resolvedBeforeMaestro': True}


def run_direct_reader_diagnostic(helper, runner, execute, baseline, tools_root, output, device, scenarios):
    sign_in = verify_direct_reader_flow(tools_root, baseline)
    target = output / 'diagnostic-direct-reader-controls'
    target.mkdir()
    diagnostic = {'id': 'diagnostic-direct-reader-controls', 'kind': 'direct-reader-diagnostic-only',
        'name': DIRECT_NAME, 'countedInBaseline85': False, 'fixtureCaseId': 'memory-reader-controls',
        'flow': DIRECT_FLOW, 'flowSha256': DIRECT_SHA, 'signIn': sign_in, 'timeoutSeconds': 600,
        'watchdogScope': 'Entire Maestro CLI including driver startup, original sign-in and controls',
        'readerRequirementMs': 15000, 'pageAssertionsUnchanged': True, 'centerElement': False,
        'attempts': 1, 'startedAtEpochMs': round(time.time() * 1000)}
    helper.atomic_json(target / 'result.json', diagnostic)
    with (target / 'maestro.log').open('wb') as stream:
        try:
            diagnostic['exitCode'] = execute(['maestro', '--device', device, 'test', '--format', 'junit',
                '--output', str(target / 'junit.xml'), '--debug-output', str(target / 'maestro'),
                '--test-output-dir', str(target / 'maestro'),
                DIRECT_FLOW], timeout=600, cwd=tools_root, stdout=stream, stderr=subprocess.STDOUT).returncode
        except subprocess.TimeoutExpired:
            diagnostic.update({'exitCode': None, 'timedOut': True})
        except OSError as error:
            diagnostic.update({'exitCode': None, 'executionIssue': type(error).__name__})
    try:
        diagnostic['collection'] = runner.collect('ios', device, target)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        diagnostic['collectionIssue'] = type(error).__name__
    fixture_case = next(case for case in scenarios['cases'] if case['id'] == 'memory-reader-controls')
    diagnostic['fixture'] = runner.validate_receipt(target / 'native-ui-receipt.json', fixture_case)
    diagnostic['junit'] = direct_diagnostic_junit(target / 'junit.xml')
    diagnostic['passed'] = diagnostic.get('exitCode') == 0 and diagnostic['fixture']['passed'] and diagnostic['junit']['passed']
    diagnostic['finishedAtEpochMs'] = round(time.time() * 1000)
    helper.atomic_json(target / 'result.json', diagnostic)
    return diagnostic


def capture_failed_reader_threads(helper, device, target, budget):
    record = {'trigger': 'reader-diagnostic-failed', 'changesVerdict': False,
              'samples': [], 'attempted': False, 'startedAtEpochMs': round(time.time() * 1000)}
    if budget['used']:
        record['issue'] = 'sample-pair-budget-already-used'
        return record
    budget['used'] = True
    record['attempted'] = True
    target.mkdir(exist_ok=False)
    helper.atomic_json(target / 'sampling.json', record)
    for role, package in [('app', helper.PACKAGE), ('driver', helper.DRIVER_PACKAGE)]:
        try:
            bundle = helper.scoped_container(device, package, 'app')
            info = plistlib.loads((bundle / 'Info.plist').read_bytes())
            name = info.get('CFBundleExecutable', '')
            if info.get('CFBundleIdentifier') != package or not name or Path(name).name != name:
                raise ValueError('Unexpected selected process bundle')
            executable = (bundle / name).resolve(strict=True)
            if not executable.is_relative_to(bundle):
                raise ValueError('Executable escaped its selected bundle')
            sample = helper.sample_process(helper.find_process(executable), target / (role + '.sample.txt'))
            sample['role'] = role
            record['samples'].append(sample)
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            record['samples'].append({'role': role, 'complete': False, 'issue': type(error).__name__})
        record['updatedAtEpochMs'] = round(time.time() * 1000)
        helper.atomic_json(target / 'sampling.json', record)
    return record


def run_warm_reader_controls_diagnostic(helper, runner, execute, baseline, tools_root, output, device, scenarios, budget):
    sign_in = verify_direct_reader_flow(tools_root, baseline, WARM_CONTROLS_FLOW, WARM_CONTROLS_SHA)
    target = output / 'diagnostic-warm-reader-controls'
    target.mkdir()
    diagnostic = {'id': 'diagnostic-warm-reader-controls', 'kind': 'original-navigation-reader-diagnostic-only',
        'name': WARM_CONTROLS_NAME, 'countedInBaseline85': False, 'fixtureCaseId': 'navigation-warm-tabs',
        'flow': WARM_CONTROLS_FLOW, 'flowSha256': WARM_CONTROLS_SHA, 'signIn': sign_in, 'timeoutSeconds': 600,
        'watchdogScope': 'Entire Maestro CLI including driver startup, original sign-in and controls',
        'readerRequirementMs': 15000, 'navigationCycles': 1, 'pageAssertionsUnchanged': True,
        'attempts': 1, 'startedAtEpochMs': round(time.time() * 1000)}
    helper.atomic_json(target / 'result.json', diagnostic)
    with (target / 'maestro.log').open('wb') as stream:
        try:
            diagnostic['exitCode'] = execute(['maestro', '--device', device, 'test', '--format', 'junit',
                '--output', str(target / 'junit.xml'), '--debug-output', str(target / 'maestro'),
                '--test-output-dir', str(target / 'maestro'), WARM_CONTROLS_FLOW],
                timeout=600, cwd=tools_root, stdout=stream, stderr=subprocess.STDOUT).returncode
        except subprocess.TimeoutExpired:
            diagnostic.update({'exitCode': None, 'timedOut': True})
        except OSError as error:
            diagnostic.update({'exitCode': None, 'executionIssue': type(error).__name__})
    # Capture native evidence before slower receipt collection can delay it.
    if diagnostic.get('exitCode') != 0:
        try:
            diagnostic['failureCapture'] = capture_failed_reader_threads(helper, device, target / 'failure-threads', budget)
        except Exception as error:
            diagnostic['failureCapture'] = {'attempted': False, 'issue': type(error).__name__, 'changesVerdict': False}
    try:
        diagnostic['collection'] = runner.collect('ios', device, target)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        diagnostic['collectionIssue'] = type(error).__name__
    fixture_case = next(case for case in scenarios['cases'] if case['id'] == 'navigation-warm-tabs')
    diagnostic['fixture'] = runner.validate_receipt(target / 'native-ui-receipt.json', fixture_case)
    diagnostic['junit'] = direct_diagnostic_junit(target / 'junit.xml', WARM_CONTROLS_NAME, WARM_CONTROLS_FLOW)
    diagnostic['passed'] = diagnostic.get('exitCode') == 0 and diagnostic['fixture']['passed'] and diagnostic['junit']['passed']
    if not diagnostic['passed'] and 'failureCapture' not in diagnostic:
        try:
            diagnostic['failureCapture'] = capture_failed_reader_threads(helper, device, target / 'failure-threads', budget)
        except Exception as error:
            diagnostic['failureCapture'] = {'attempted': False, 'issue': type(error).__name__, 'changesVerdict': False}
    diagnostic['finishedAtEpochMs'] = round(time.time() * 1000)
    helper.atomic_json(target / 'result.json', diagnostic)
    return diagnostic


def run_warm_reader_diagnostic(helper, runner, execute, baseline, output, device, scenarios):
    # Reuse the reviewed recovery diagnostic contract, but d46 already contains
    # this exact flow. Never copy over or modify that original source file.
    if digest(baseline / DIAGNOSTIC_FLOW) != DIAGNOSTIC_SHA:
        raise ValueError('The original warm reader diagnostic bytes changed')
    target = output / 'diagnostic-warm-tabs-reader'
    target.mkdir()
    diagnostic = {'kind': 'additional-related-path-diagnostic', 'countedInBaseline85': False,
        'flow': DIAGNOSTIC_FLOW, 'flowSha256': DIAGNOSTIC_SHA, 'timeoutSeconds': 600,
        'readerRequirementMs': 15000, 'attempts': 1, 'startedAtEpochMs': round(time.time() * 1000)}
    helper.atomic_json(target / 'result.json', diagnostic)
    with (target / 'maestro.log').open('wb') as stream:
        try:
            diagnostic['exitCode'] = execute(['maestro', '--device', device, 'test', '--format', 'junit',
                '--output', str(target / 'junit.xml'), '--debug-output', str(target / 'maestro'),
                '--test-output-dir', str(target / 'maestro'), DIAGNOSTIC_FLOW], timeout=600,
                stdout=stream, stderr=subprocess.STDOUT).returncode
        except subprocess.TimeoutExpired:
            diagnostic.update({'exitCode': None, 'timedOut': True})
        except OSError as error:
            diagnostic.update({'exitCode': None, 'executionIssue': type(error).__name__})
    try:
        diagnostic['collection'] = runner.collect('ios', device, target)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        diagnostic['collectionIssue'] = type(error).__name__
    fixture_case = next(case for case in scenarios['cases'] if case['id'] == 'navigation-warm-tabs')
    diagnostic['fixture'] = runner.validate_receipt(target / 'native-ui-receipt.json', fixture_case)
    diagnostic['junit'] = helper.diagnostic_junit(target / 'junit.xml')
    diagnostic['passed'] = diagnostic.get('exitCode') == 0 and diagnostic['fixture']['passed'] and diagnostic['junit']['passed']
    diagnostic['finishedAtEpochMs'] = round(time.time() * 1000)
    helper.atomic_json(target / 'result.json', diagnostic)
    return diagnostic


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--recovery-source')
    parser.add_argument('--groups')
    parser.add_argument('--cases')
    parser.add_argument('--warm-reader-diagnostic', action='store_true')
    parser.add_argument('--direct-reader-diagnostic-only', action='store_true')
    parser.add_argument('--warm-reader-controls-diagnostic-only', action='store_true')
    parser.add_argument('--artifact-id', action='store_true')
    args = parser.parse_args()
    binding_path = Path(__file__).with_suffix('.json')
    binding = validate_binding(json.loads(binding_path.read_text()))
    if args.artifact_id:
        print(binding['producerArtifactId'])
        return 0
    if not args.baseline or not args.recovery_source or not args.groups:
        parser.error('--baseline, --recovery-source and --groups are required')
    if os.environ.get('CI') != 'true' or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa' or os.environ.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') != 'native-ui-synthetic-no-provider-key':
        raise ValueError('Only the existing isolated synthetic QA environment is supported')
    if platform.system() != 'Darwin' or len(args.recovery_source) != 40 or any(c not in '0123456789abcdef' for c in args.recovery_source):
        raise ValueError('An exact recovery commit on macOS is required')
    tools_root = Path(__file__).resolve().parents[2]
    helper = load_helpers(Path(__file__).parent)
    created_verifier = load_module('d46_created_device', Path(__file__).with_name('native-ui-ios-created-device.py'))
    if helper.read_command(['git', '-C', str(tools_root), 'rev-parse', 'HEAD']) != args.recovery_source:
        raise ValueError('Recovery checkout differs from its recorded source')
    baseline = args.baseline.resolve(strict=True)
    os.chdir(baseline)
    if helper.read_command(['git', 'rev-parse', 'HEAD']) != SOURCE or helper.read_command(['git', 'rev-parse', 'HEAD^{tree}']) != TREE:
        raise ValueError('Baseline checkout differs from the d46 binary source')
    helper.read_command(['git', 'diff', '--exit-code', 'HEAD'])
    runner_path = baseline / 'scripts/quality/native-ui-audit-runner.py'
    manifest_path = baseline / 'tests/native/audit/manifest.json'
    if digest(runner_path) != RUNNER_SHA or digest(manifest_path) != MANIFEST_SHA:
        raise ValueError('The original d46 runner and all85 scenarios must remain unchanged')
    runner = load_module('original_d46_audit_runner', runner_path)
    binary_dir = baseline / 'native-audit-binary'
    manifest = verify_download(binary_dir, binding)
    app = helper.extract_app(binary_dir / 'qa.app.tar.gz', binary_dir)
    runner.validate_binary(manifest, app, 'ios', SOURCE, TREE)
    scenarios = json.loads(manifest_path.read_text())
    groups = set(args.groups.split(','))
    cases = select_execution_cases(scenarios, groups, args.cases, args.warm_reader_diagnostic,
                                   args.direct_reader_diagnostic_only, args.warm_reader_controls_diagnostic_only)
    selected_case_ids = [case['id'] for case in cases]
    unselected_case_ids = [case['id'] for case in scenarios['cases'] if case['id'] not in selected_case_ids]
    if args.warm_reader_diagnostic:
        if 'memory' not in groups or digest(baseline / DIAGNOSTIC_FLOW) != DIAGNOSTIC_SHA:
            raise ValueError('The warm reader diagnostic requires memory and its unchanged original flow')
    direct_sign_in = verify_direct_reader_flow(tools_root, baseline) if args.direct_reader_diagnostic_only else None
    warm_sign_in = (verify_direct_reader_flow(tools_root, baseline, WARM_CONTROLS_FLOW, WARM_CONTROLS_SHA)
                    if args.warm_reader_controls_diagnostic_only else None)
    output = baseline / 'native-audit-results'
    output.mkdir(exist_ok=False)
    logs = baseline / 'native-ui-logs'
    logs.mkdir(exist_ok=True)
    for original, name in [(binary_dir / 'binary-manifest.json', 'binary-manifest.json'),
                           (binary_dir / 'source.json', 'source.json'), (manifest_path, 'audit-manifest.json'),
                           (binding_path, 'verified-producer-binding.json')]:
        shutil.copyfile(original, output / name)
    if args.direct_reader_diagnostic_only:
        shutil.copyfile(tools_root / DIRECT_FLOW, output / 'direct-reader-diagnostic.yaml')
    if args.warm_reader_controls_diagnostic_only:
        shutil.copyfile(tools_root / WARM_CONTROLS_FLOW, output / 'warm-reader-controls-diagnostic.yaml')
    provenance = {'schemaVersion': 1, 'kind': 'exact-d46-binary-ios-audit-recovery',
        **binding, 'auditManifestSha256': MANIFEST_SHA, 'originalRunnerSha256': RUNNER_SHA,
        'recoverySourceCommit': args.recovery_source, 'recoveryRunId': os.environ.get('GITHUB_RUN_ID'),
        'recoveryRunAttempt': os.environ.get('GITHUB_RUN_ATTEMPT'), 'consumerSha256': digest(Path(__file__)),
        'bindingSha256': digest(binding_path), 'reviewedHelperHashes': HELPERS,
        'workflowSha256': digest(tools_root / '.github/workflows/native-audit-ios-d46-recovery.yml'),
        'selectedGroups': sorted(groups), 'unselectedGroups': sorted(set(scenarios['groups']) - groups),
        'selectedCaseIds': selected_case_ids, 'unselectedCaseIds': unselected_case_ids,
        'caseSelection': 'diagnostic-only' if args.direct_reader_diagnostic_only or args.warm_reader_controls_diagnostic_only else ('explicit-subset' if args.cases is not None else 'all-selected-groups'),
        'diagnosticOnly': args.direct_reader_diagnostic_only or args.warm_reader_controls_diagnostic_only, 'warmDiagnosticRequested': args.warm_reader_diagnostic,
        'directSignIn': direct_sign_in,
        'warmControlsSignIn': warm_sign_in,
        'selectedCaseCount': len(cases), 'declaredCaseCount': len(scenarios['cases']),
        'separateDiagnostics': ([{'id': 'diagnostic-warm-tabs-reader', 'flow': DIAGNOSTIC_FLOW,
            'flowSha256': DIAGNOSTIC_SHA, 'countedInBaseline85': False, 'readerRequirementMs': 15000}]
            if args.warm_reader_diagnostic else ([{'id': 'diagnostic-direct-reader-controls', 'name': DIRECT_NAME,
                'flow': DIRECT_FLOW, 'flowSha256': DIRECT_SHA, 'countedInBaseline85': False,
                'fixtureCaseId': 'memory-reader-controls', 'readerRequirementMs': 15000, 'timeoutSeconds': 600}]
                if args.direct_reader_diagnostic_only else [])),
        'rebuild': False, 'rebundle': False, 'resign': False, 'originalCasesUnchanged': True,
        'extraCasesAdded': False, 'allControlsAccepted': False,
        'diagnosticLimits': {'snapshotIntervalSeconds': 5, 'maxTraceBytesPerFile': helper.MAX_TRACE_BYTES,
            'samplePairsPerShard': 1, 'sampleSecondsPerProcess': 3, 'sampleIntervalMilliseconds': 10,
            'sampleWallBudgetSeconds': 8, 'sampleBytesPerProcess': helper.MAX_SAMPLE_BYTES},
        'observationOverhead': 'Bounded snapshots and samples add diagnostic work. Original case deadlines and gate outcomes are unchanged.'}
    if args.warm_reader_controls_diagnostic_only:
        provenance['separateDiagnostics'] = [{'id': 'diagnostic-warm-reader-controls', 'name': WARM_CONTROLS_NAME,
            'flow': WARM_CONTROLS_FLOW, 'flowSha256': WARM_CONTROLS_SHA, 'countedInBaseline85': False,
            'fixtureCaseId': 'navigation-warm-tabs', 'readerRequirementMs': 15000, 'timeoutSeconds': 600,
            'navigationCycles': 1, 'failureSampling': 'bounded selected app and driver, independent of busy log marker'}]
    helper.atomic_json(output / 'recovery-provenance.json', provenance)
    device = None
    device_created = False
    log_process = None
    active_observer = None
    budget = {'used': False}
    old_handlers = {}
    def cancel(signum, _frame):
        raise SystemExit(128 + signum)
    for sig in [signal.SIGINT, signal.SIGTERM]:
        old_handlers[sig] = signal.signal(sig, cancel)
    setup_records = []
    try:
        provenance['immutableCompatibilityVerification'] = helper.verify_setup_immutable(
            app, manifest, setup_records, output / 'setup-commands.json')
        helper.atomic_json(output / 'recovery-provenance.json', provenance)
        runtime = manifest['nativeCompatibility']['runtimeIdentifier']
        inventory_text = helper.setup_read(['xcrun', 'simctl', 'list', 'devices', '--json'],
            'select-existing-device', 30, setup_records, output / 'setup-commands.json')
        selection = select_existing_device(inventory_text, manifest, created_verifier)
        provenance['deviceSelection'] = selection
        helper.atomic_json(output / 'recovery-provenance.json', provenance)
        device = selection['selectedDevice']
        if device is None:
            created = helper.setup_read(['xcrun', 'simctl', 'create', 'Platinum d46 audit ' + os.environ.get('GITHUB_RUN_ID', ''),
                                         'com.apple.CoreSimulator.SimDeviceType.iPhone-16', runtime],
                                        'create', 120, setup_records, output / 'setup-commands.json')
            device = created_verifier.validate_device_identifier(created)
            device_created = True
            selection['selectedDevice'] = device
        selection['createdByThisInvocation'] = device_created
        provenance['prebootDeviceVerification'] = created_verifier.verify_created_device(
            manifest, device, helper.setup_compatibility_reader(app, setup_records, output / 'setup-commands.json'))
        provenance['prebootDeviceVerification']['scope'] = (
            'Exact selected Shutdown device and runtime identity verified before boot; '
            'selection provenance distinguishes reused and newly created devices. Exact-UUID boot readiness remains required.')
        provenance['device'] = device
        helper.atomic_json(output / 'recovery-provenance.json', provenance)
        helper.setup_read(['xcrun', 'simctl', 'boot', device], 'boot', 120, setup_records, output / 'setup-commands.json')
        helper.setup_read(['xcrun', 'simctl', 'bootstatus', device, '-b'], 'bootstatus', 300, setup_records, output / 'setup-commands.json')
        provenance['bootedRuntimeVerification'] = {
            'runtimeIdentifier': runtime, 'runtimeVersion': provenance['prebootDeviceVerification']['runtimeVersion'],
            'selectedDevice': device, 'deviceTypeIdentifier': provenance['prebootDeviceVerification']['deviceTypeIdentifier'],
            'bootstatusCompleted': True,
            'scope': 'Selected runtime/device identity checked before boot; boot and bootstatus -b succeeded for that exact UUID. App launch remains required.'}
        helper.atomic_json(output / 'recovery-provenance.json', provenance)
        if runner.binary_digest(app) != binding['binarySha256']:
            raise ValueError('Verified app bytes changed before installation')
        helper.read_command(['xcrun', 'simctl', 'install', device, str(app)], timeout=120)
        with (logs / 'app.log').open('wb') as log_file:
            log_process = subprocess.Popen(['xcrun', 'simctl', 'spawn', device, 'log', 'stream', '--style', 'compact', '--level', 'info',
                '--predicate', 'process == "PlatinumQA"'], stdout=log_file, stderr=subprocess.STDOUT, start_new_session=True)
        case_paths = {'tests/native/audit/' + case['flow']: case for case in cases}
        if args.warm_reader_diagnostic:
            case_paths[DIAGNOSTIC_FLOW] = {'id': 'diagnostic-warm-tabs-reader', 'fixtureCaseId': 'navigation-warm-tabs'}
        if args.direct_reader_diagnostic_only:
            case_paths[DIRECT_FLOW] = {'id': 'diagnostic-direct-reader-controls', 'fixtureCaseId': 'memory-reader-controls'}
        if args.warm_reader_controls_diagnostic_only:
            case_paths[WARM_CONTROLS_FLOW] = {'id': 'diagnostic-warm-reader-controls', 'fixtureCaseId': 'navigation-warm-tabs'}
        def execute(command, timeout, **kwargs):
            nonlocal active_observer
            if command[0] != 'maestro':
                return runner.run_owned(command, timeout, **kwargs)
            case = case_paths[command[-1]]
            def make_observer():
                nonlocal active_observer
                active_observer = helper.Observer(device, output / case['id'] / 'diagnostics', logs / 'app.log', budget,
                                                   expected_case=case.get('fixtureCaseId', case['id']))
                return active_observer
            try:
                return helper.observed_call(runner.run_owned, make_observer, command, timeout, **kwargs)
            finally:
                active_observer = None
        diagnostic = (run_warm_reader_diagnostic(helper, runner, execute, baseline, output, device, scenarios)
                      if args.warm_reader_diagnostic else None)
        if args.direct_reader_diagnostic_only:
            diagnostic = run_direct_reader_diagnostic(helper, runner, execute, baseline, tools_root, output, device, scenarios)
        if args.warm_reader_controls_diagnostic_only:
            diagnostic = run_warm_reader_controls_diagnostic(helper, runner, execute, baseline, tools_root, output, device, scenarios, budget)
        results = runner.run_cases(cases, 'ios', device, output, execute=execute) if cases else []
        helper.atomic_json(output / 'results.json', results)
        summary = {'applicationSourceCommit': SOURCE, 'applicationSourceTree': TREE, 'platform': 'ios',
            'selectedGroups': sorted(groups), 'unselectedGroups': sorted(set(scenarios['groups']) - groups),
            'selectedCaseIds': selected_case_ids, 'unselectedCaseIds': unselected_case_ids,
            'attempted': len(results), 'passed': sum(row['status'] == 'passed' for row in results),
            'failed': sum(row['status'] != 'passed' for row in results), 'allControlsAccepted': False,
            'separateDiagnostic': diagnostic, 'diagnosticOnly': args.direct_reader_diagnostic_only or args.warm_reader_controls_diagnostic_only,
            'warmDiagnosticAttempted': args.warm_reader_diagnostic,
            'diagnosticAttempted': int(diagnostic is not None),
            'diagnosticPassed': int(diagnostic is not None and diagnostic['passed']),
            'diagnosticFailed': int(diagnostic is not None and not diagnostic['passed'])}
        helper.atomic_json(output / 'summary.json', summary)
        helper.read_command(['git', 'diff', '--exit-code', 'HEAD'])
        if digest(runner_path) != RUNNER_SHA or digest(manifest_path) != MANIFEST_SHA or runner.binary_digest(app) != binding['binarySha256']:
            raise ValueError('Original d46 case/source/binary bytes changed during recovery')
        if args.warm_reader_diagnostic and digest(baseline / DIAGNOSTIC_FLOW) != DIAGNOSTIC_SHA:
            raise ValueError('Original warm reader diagnostic bytes changed during recovery')
        if args.direct_reader_diagnostic_only:
            verify_direct_reader_flow(tools_root, baseline)
        if args.warm_reader_controls_diagnostic_only:
            verify_direct_reader_flow(tools_root, baseline, WARM_CONTROLS_FLOW, WARM_CONTROLS_SHA)
        return int(summary['failed'] != 0 or (diagnostic is not None and not diagnostic['passed']))
    finally:
        try:
            if active_observer:
                active_observer.finish()
            if device:
                helper.Observer(device, output / 'exit-diagnostics', logs / 'app.log', {'used': True}).snapshot('exit')
        except Exception:
            pass
        if log_process:
            helper.stop_group(log_process)
        if device:
            for action in (['shutdown', 'delete'] if device_created else ['shutdown']):
                try:
                    helper.bounded_command(['xcrun', 'simctl', action, device], timeout=10)
                except (OSError, ValueError, subprocess.TimeoutExpired):
                    pass
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)


if __name__ == '__main__':
    sys.exit(main())
