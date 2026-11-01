#!/usr/bin/env python3
"""Run the 27 unchanged account cases in the verified ecf iOS app, without rebuilding."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

import importlib.util


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


JOURNEY = load('ecf_account_shared_journey', Path(__file__).with_name('completion-ios-journey.py'))
AUDIT = load('ecf_account_shared_audit', Path(__file__).with_name('completion-ios-audit.py'))
SOURCE = 'ecf5e5a960106d7cb04c211ee99e9e89c09642cc'
TREE = '38a64a6d47eafe0f976708edcc338b34204811f4'
PRODUCER_RUN = 41266020074
RUNNER_SHA = '78f277998834d10dc93a2aaaa7d3e3df65fbd84b6997d3012d3018a8a6c0856a'
ACCOUNT_GROUPS = {'support', 'auth', 'profile', 'business', 'memory'}


def validate_binding(value):
    if not isinstance(value, dict) or set(value) != JOURNEY.BINDING_FIELDS:
        raise ValueError('The complete independently verified current-source producer binding is required')
    expected = {'schemaVersion': 1, 'ready': True, 'applicationSourceCommit': SOURCE,
                'applicationSourceTree': TREE, 'producerRunId': PRODUCER_RUN,
                'producerArtifactName': 'native-audit-ios-binary',
                'producerArtifactId': 13067374445, 'producerArtifactZipBytes': 49154766}
    if any(type(value.get(key)) is not type(item) or value.get(key) != item for key, item in expected.items()):
        raise ValueError('Only the separately verified ecf producer artifact is permitted')
    for key in ['producerArtifactZipSha256', 'appArchiveSha256', 'binaryManifestSha256',
                'binarySha256', 'sourceReceiptSha256']:
        if not isinstance(value[key], str) or not re.fullmatch('[0-9a-f]{64}', value[key]):
            raise ValueError('Every current producer digest must be complete')
    return value


def verify_source_inputs(baseline, source):
    """Bind all original source and runner inputs before and after execution."""
    inputs = dict(source['hashes'])
    for path, expected in source['audit']['inputs'].items():
        if path in inputs and inputs[path] != expected:
            raise ValueError('Contradictory source and audit input hashes')
        inputs[path] = expected
    for path, expected in inputs.items():
        relative = Path(path)
        if relative.is_absolute() or '..' in relative.parts or not relative.parts:
            raise ValueError('A producer input escapes its source checkout')
        file = baseline / relative
        if (any((baseline / Path(*relative.parts[:length])).is_symlink() for length in range(1, len(relative.parts) + 1))
                or not file.is_file() or JOURNEY.digest(file) != expected):
            raise ValueError('The exact producer source input changed: ' + path)
    return {'sourceInputs': len(source['hashes']), 'auditInputs': len(source['audit']['inputs'])}


def verify_download(binary_dir, binding, baseline):
    validate_binding(binding)
    for name, key in [('source.json', 'sourceReceiptSha256'),
                      ('binary-manifest.json', 'binaryManifestSha256'),
                      ('qa.app.tar.gz', 'appArchiveSha256')]:
        if JOURNEY.digest(binary_dir / name) != binding[key]:
            raise ValueError('The current producer file differs: ' + name)
    manifest = json.loads((binary_dir / 'binary-manifest.json').read_text())
    expected = {'applicationSourceCommit': SOURCE, 'applicationSourceTree': TREE,
                'platform': 'ios', 'binarySha256': binding['binarySha256'],
                'sourceReceiptSha256': binding['sourceReceiptSha256'],
                'auditManifestSha256': JOURNEY.digest(baseline / 'tests/native/audit/manifest.json')}
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise ValueError('The current binary manifest does not match the exact producer')
    source = json.loads((binary_dir / 'source.json').read_text())
    if (source.get('commit') != SOURCE or source.get('workflowRun') != str(PRODUCER_RUN)
            or source.get('audit', {}).get('applicationSourceCommit') != SOURCE
            or source['audit'].get('manifestSha256') != manifest['auditManifestSha256']):
        raise ValueError('The retained source receipt does not bind the current producer')
    verify_source_inputs(baseline, source)
    return manifest, source


def selected_cases(manifest):
    cases = AUDIT.selected_cases(manifest, 'account')
    if len(cases) != 27 or AUDIT.SHARDS['account'] != ACCOUNT_GROUPS:
        raise ValueError('All 27 original account cases are required')
    return cases


def prepare_bound_device(app, manifest, starter, created, helper, records, setup):
    """Verify immutable inputs before boot, then consume the actual owned boot proof."""
    if manifest.get('applicationSourceCommit') != SOURCE or manifest.get('applicationSourceTree') != TREE:
        raise ValueError('The exact current-source app is required before simulator setup')
    immutable = helper.verify_setup_immutable(app, manifest, records, setup)
    prepared = JOURNEY.prepare_simulator(manifest, starter, created, helper, records, setup)
    device = created.validate_device_identifier(prepared.get('device'))
    try:
        runtime = helper.compatibility_module.verify_prepared_booted_runtime(manifest, device, prepared)
    except BaseException:
        cleanup = []
        for operation in ['shutdown', 'delete']:
            try:
                helper.setup_read(['xcrun', 'simctl', operation, device], operation, 20, records, setup)
                cleanup.append({'operation': operation, 'completed': True})
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                cleanup.append({'operation': operation, 'completed': False, 'issue': type(error).__name__})
        helper.atomic_json(Path(setup).parent / 'prepared-proof-failure-cleanup.json', {'device': device, 'cleanup': cleanup})
        raise
    return prepared, {'immutableCompatibility': immutable, 'bootedRuntime': runtime,
                      'immutableCompatibilityVerifiedBeforeDeviceCreation': True}


def case_accounting(path, cases):
    rows = json.loads(path.read_text()) if path.exists() else []
    if (not isinstance(rows, list) or len(rows) > len(cases)
            or any(not isinstance(row, dict) for row in rows)
            or [row.get('id') for row in rows] != [case['id'] for case in cases[:len(rows)]]
            or any(type(row.get('attempts')) is not int or row['attempts'] != 1
                   or row.get('status') not in ['running', 'passed', 'failed'] for row in rows)):
        raise ValueError('Malformed original account case accounting')
    return {'expected': len(cases), 'attempted': len(rows),
            'passed': sum(row['status'] == 'passed' for row in rows),
            'failed': sum(row['status'] == 'failed' for row in rows),
            'unfinished': sum(row['status'] == 'running' for row in rows),
            'notAttempted': len(cases) - len(rows)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifact-id', action='store_true')
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--consumer-source')
    args = parser.parse_args()
    binding = validate_binding(json.loads(Path(__file__).with_suffix('.json').read_text()))
    if args.artifact_id:
        print(binding['producerArtifactId'])
        return 0
    if (os.environ.get('CI') != 'true' or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa'
            or os.environ.get('EXPO_PUBLIC_SUPABASE_URL') != 'https://uaulhuelcfkjwojtymmw.supabase.co'
            or os.environ.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') != 'native-ui-synthetic-no-provider-key'):
        raise ValueError('Only the disposable synthetic QA Simulator is permitted')
    if args.baseline is None or not re.fullmatch('[0-9a-f]{40}', args.consumer_source or ''):
        parser.error('Exact producer checkout and consumer commit are required')
    baseline = args.baseline.resolve(strict=True)
    tools_root = Path(__file__).resolve().parents[2]
    def git(folder, revision):
        return subprocess.check_output(['git', '-C', str(folder), 'rev-parse', revision], text=True, timeout=30).strip()
    if (git(baseline, 'HEAD') != SOURCE or git(baseline, 'HEAD^{tree}') != TREE
            or git(tools_root, 'HEAD') != args.consumer_source):
        raise ValueError('Producer or consumer checkout identity differs')
    scripts = baseline / 'scripts/quality'
    binary_dir = baseline / 'native-audit-binary'
    scenario_file = baseline / 'tests/native/audit/manifest.json'
    manifest, source = verify_download(binary_dir, binding, baseline)
    if JOURNEY.digest(scripts / 'native-ui-audit-runner.py') != RUNNER_SHA:
        raise ValueError('The original current-source audit runner changed')
    runner = load('ecf_account_original_runner', scripts / 'native-ui-audit-runner.py')
    helper = load('ecf_account_original_helpers', scripts / 'native-ui-ios-audit-recovery.py')
    starter = load('ecf_account_original_starter', scripts / 'native-ui-start-ios-device.py')
    created = load('ecf_account_original_created_device', scripts / 'native-ui-ios-created-device.py')
    scenarios = json.loads(scenario_file.read_text())
    cases = selected_cases(scenarios)
    app = helper.extract_app(binary_dir / 'qa.app.tar.gz', binary_dir)
    runner.validate_binary(manifest, app, 'ios', SOURCE, TREE)
    output = baseline / 'native-audit-results'
    output.mkdir(exist_ok=False)
    shutil.copyfile(binary_dir / 'binary-manifest.json', output / 'binary-manifest.json')
    shutil.copyfile(scenario_file, output / 'audit-manifest.json')
    records = []
    setup = output / 'setup-commands.json'
    proof = {'kind': 'current-source-ios-account-preboot-order-recovery',
             'applicationSourceCommit': SOURCE, 'applicationSourceTree': TREE,
             'producerRunId': PRODUCER_RUN, 'producerBinding': binding,
             'consumerSourceCommit': args.consumer_source, 'consumerRunId': os.environ.get('GITHUB_RUN_ID'),
             'selectedGroups': sorted(ACCOUNT_GROUPS), 'selectedCaseIds': [case['id'] for case in cases],
             'originalCaseCount': 85, 'selectedCaseCount': 27, 'originalRunnerSha256': RUNNER_SHA,
             'originalCasesAndDeadlinesUnchanged': True, 'sourceInputVerification': verify_source_inputs(baseline, source),
             'firstSignInResetUnchanged': True, 'caseAttempts': 1, 'rebuild': False, 'rebundle': False,
             'resign': False, 'passed': False, 'installed': False, 'attempted': 0,
             'precedingFailedRun': 41266020074, 'precedingFailedJob': 124734744421}
    device = None
    logger = None
    result = 1
    try:
        prepared, compatibility = prepare_bound_device(app, manifest, starter, created, helper, records, setup)
        device = prepared['device']
        proof.update(compatibility)
        helper.atomic_json(output / 'device-setup.json', prepared)
        helper.setup_read(['xcrun', 'simctl', 'install', device, str(app)], 'install', 120, records, setup)
        proof['installed'] = True
        with (output / 'app.log').open('wb') as log:
            logger = subprocess.Popen(['xcrun', 'simctl', 'spawn', device, 'log', 'stream', '--style', 'compact',
                '--level', 'info', '--predicate', 'process == "PlatinumQA"'], stdout=log,
                stderr=subprocess.STDOUT, start_new_session=True)
            os.chdir(baseline)
            rows = runner.run_cases(cases, 'ios', device, output,
                collect_case=lambda platform, selected, target: AUDIT.collect_with_bounded_commands(runner, helper, selected, target))
        summary = {'applicationSourceCommit': SOURCE, 'applicationSourceTree': TREE,
                   'platform': 'ios', 'selectedGroups': sorted(ACCOUNT_GROUPS),
                   'unselectedGroups': sorted(set(scenarios['groups']) - ACCOUNT_GROUPS),
                   'attempted': len(rows), 'passed': sum(row['status'] == 'passed' for row in rows),
                   'failed': sum(row['status'] != 'passed' for row in rows), 'allControlsAccepted': False}
        if len(rows) != 27 or [row['id'] for row in rows] != [case['id'] for case in cases]:
            raise ValueError('The complete unchanged account case order was not executed')
        helper.atomic_json(output / 'summary.json', summary)
        runner.validate_binary(manifest, app, 'ios', SOURCE, TREE)
        verify_download(binary_dir, binding, baseline)
        subprocess.run(['git', '-C', str(baseline), 'diff', '--exit-code', 'HEAD', '--'], check=True,
                       stdout=subprocess.DEVNULL, timeout=30)
        proof['attempted'] = len(rows)
        proof['unchangedSourceAndBinaryAfterRun'] = True
        proof['passed'] = summary['failed'] == 0
        result = int(not proof['passed'])
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        proof['executionIssue'] = type(error).__name__
        proof['executionDetail'] = str(error)[:1000]
        raise
    finally:
        try:
            proof['caseAccounting'] = case_accounting(output / 'results.json', cases)
            proof['attempted'] = proof['caseAccounting']['attempted']
        except (OSError, ValueError, TypeError) as error:
            proof['caseAccountingIssue'] = type(error).__name__
            proof['passed'] = False
            result = 1
        if logger is not None:
            helper.stop_group(logger)
        if device is not None:
            proof['cleanup'] = []
            for operation in ['shutdown', 'delete']:
                try:
                    helper.setup_read(['xcrun', 'simctl', operation, device], operation, 20, records, setup)
                    proof['cleanup'].append({'operation': operation, 'completed': True})
                except (OSError, ValueError, subprocess.SubprocessError) as error:
                    proof['cleanup'].append({'operation': operation, 'completed': False, 'issue': type(error).__name__})
        helper.atomic_json(output / 'consumer-proof.json', proof)
    return result


if __name__ == '__main__':
    raise SystemExit(main())
