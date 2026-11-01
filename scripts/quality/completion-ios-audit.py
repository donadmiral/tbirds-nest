#!/usr/bin/env python3
"""Replay all original iOS audit cases against the verified f5 app, without rebuilding."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


JOURNEY = load('completion_journey_contract', Path(__file__).with_name('completion-ios-journey.py'))
SHARDS = {
    'settings': {'settings', 'stories', 'directories'},
    'account': {'support', 'auth', 'profile', 'business', 'memory'},
    'social': {'navigation', 'feed', 'market', 'jobs', 'messages'},
}


def selected_cases(manifest, shard):
    if (shard not in SHARDS or len(manifest['cases']) != 85
            or len({case['id'] for case in manifest['cases']}) != 85
            or set(manifest['groups']) != set().union(*SHARDS.values())):
        raise ValueError('The complete original 85-case partition is required')
    cases = [case for case in manifest['cases'] if case['group'] in SHARDS[shard]]
    if not cases:
        raise ValueError('No declared cases in the selected feature group')
    return cases


def collect_with_bounded_commands(runner, helper, device, target):
    """Preserve the original collector; bound every CoreSimulator metadata read."""
    original_command = runner.command
    records = []
    def command(args, **kwargs):
        if (args != ['xcrun', 'simctl', 'get_app_container', device, runner.PACKAGE, 'data']
                or kwargs != {'stdout': subprocess.PIPE, 'stderr': subprocess.DEVNULL, 'text': True, 'timeout': 30}):
            raise ValueError('Unexpected original iOS collection command')
        value = helper.setup_read(args, 'case-container', 30, records, target / 'collection-commands.json')
        return subprocess.CompletedProcess(args, 0, value, '')
    runner.command = command
    try:
        return runner.collect('ios', device, target)
    finally:
        runner.command = original_command


def summarize(folder, manifest):
    expected = {case['id'] for case in manifest['cases']}
    observed = {}
    issues = []
    for shard in SHARDS:
        required = {case['id'] for case in selected_cases(manifest, shard)}
        report = folder / ('fresh-ios-audit-' + shard + '-results')
        try:
            proof = json.loads((report / 'consumer-proof.json').read_text())
            summary = json.loads((report / 'summary.json').read_text())
            rows = json.loads((report / 'results.json').read_text())
            if (proof.get('applicationSourceCommit') != JOURNEY.SOURCE
                    or proof.get('applicationSourceTree') != JOURNEY.TREE
                    or proof.get('unchangedSourceAndBinaryAfterRun') is not True
                    or summary.get('applicationSourceCommit') != JOURNEY.SOURCE
                    or summary.get('platform') != 'ios'
                    or set(summary.get('selectedGroups', [])) != SHARDS[shard]
                    or len(rows) != len(required) or {row.get('id') for row in rows} != required):
                raise ValueError('Incomplete or unbound original shard results')
            for row in rows:
                identity = row['id']
                if identity in observed or row.get('attempts') != 1 or row.get('status') not in ['passed', 'failed']:
                    raise ValueError('Duplicate, retried or malformed original case result')
                observed[identity] = row['status']
        except (OSError, ValueError, TypeError, KeyError) as error:
            issues.append({'shard': shard, 'issue': str(error)})
    passed = sorted(key for key, status in observed.items() if status == 'passed')
    failed = sorted(key for key, status in observed.items() if status != 'passed')
    missing = sorted(expected - observed.keys())
    return {'applicationSourceCommit': JOURNEY.SOURCE, 'applicationSourceTree': JOURNEY.TREE,
            'platform': 'ios', 'expected': 85, 'passed': len(passed), 'failed': len(failed),
            'notExecuted': len(missing), 'passedCases': passed, 'failedCases': failed,
            'unexecutedCases': missing, 'issues': issues,
            'allDeclaredCasesPassed': not issues and len(passed) == 85 and not failed and not missing,
            'allControlsAccepted': False, 'hostedBackendAcceptance': False, 'physicalDeviceAcceptance': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--consumer-source')
    parser.add_argument('--shard', choices=SHARDS)
    parser.add_argument('--summarize', type=Path)
    args = parser.parse_args()
    tools_root = Path(__file__).resolve().parents[2]
    if args.summarize:
        manifest = json.loads((tools_root / 'tests/native/audit/manifest.json').read_text())
        result = summarize(args.summarize, manifest)
        Path('fresh-ios-audit-coverage.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2))
        return int(not result['allDeclaredCasesPassed'])
    if (os.environ.get('CI') != 'true' or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa'
            or os.environ.get('EXPO_PUBLIC_SUPABASE_URL') != 'https://uaulhuelcfkjwojtymmw.supabase.co'
            or os.environ.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') != 'native-ui-synthetic-no-provider-key'):
        raise ValueError('Only the disposable synthetic QA Simulator is permitted')
    if args.baseline is None or args.shard is None or not re.fullmatch('[0-9a-f]{40}', args.consumer_source or ''):
        parser.error('Exact producer checkout, consumer commit and original feature shard required')
    baseline = args.baseline.resolve(strict=True)
    def git(folder, revision):
        return subprocess.check_output(['git', '-C', str(folder), 'rev-parse', revision], text=True, timeout=30).strip()
    if (git(baseline, 'HEAD') != JOURNEY.SOURCE or git(baseline, 'HEAD^{tree}') != JOURNEY.TREE
            or git(tools_root, 'HEAD') != args.consumer_source):
        raise ValueError('Source or consumer checkout identity differs')
    binding = JOURNEY.validate_binding(json.loads(Path(__file__).with_name('completion-ios-journey.json').read_text()))
    scripts = baseline / 'scripts/quality'
    if JOURNEY.digest(scripts / 'native-ui-audit-runner.py') != JOURNEY.RUNNER_SHA:
        raise ValueError('The exact original audit runner changed')
    runner = load('completion_85_original_runner', scripts / 'native-ui-audit-runner.py')
    diagnostic = load('completion_85_reviewed_helpers', tools_root / 'scripts/quality/native-ui-ios-d46-recovery.py')
    helper = diagnostic.load_helpers(tools_root / 'scripts/quality')
    starter = load('completion_85_device_starter', scripts / 'native-ui-start-ios-device.py')
    created = load('completion_85_created_device', scripts / 'native-ui-ios-created-device.py')
    binary_dir = baseline / 'native-audit-binary'
    scenario_file = baseline / 'tests/native/audit/manifest.json'
    manifest = JOURNEY.verify_download(binary_dir, binding, scenario_file)
    scenarios = json.loads(scenario_file.read_text())
    cases = selected_cases(scenarios, args.shard)
    app = helper.extract_app(binary_dir / 'qa.app.tar.gz', binary_dir)
    runner.validate_binary(manifest, app, 'ios', JOURNEY.SOURCE, JOURNEY.TREE)
    output = baseline / 'native-audit-results'
    output.mkdir(exist_ok=False)
    shutil.copyfile(binary_dir / 'binary-manifest.json', output / 'binary-manifest.json')
    shutil.copyfile(scenario_file, output / 'audit-manifest.json')
    records = []
    setup = output / 'setup-commands.json'
    proof = {'kind': 'source-bound-original-85-ios-setup-recovery', 'applicationSourceCommit': JOURNEY.SOURCE,
             'applicationSourceTree': JOURNEY.TREE, 'producerRunId': JOURNEY.PRODUCER_RUN,
             'producerBinding': binding, 'consumerSourceCommit': args.consumer_source,
             'consumerRunId': os.environ.get('GITHUB_RUN_ID'), 'shard': args.shard,
             'originalCaseCount': 85, 'selectedCaseIds': [case['id'] for case in cases],
             'originalRunnerSha256': JOURNEY.RUNNER_SHA, 'originalCasesAndDeadlinesUnchanged': True,
             'rebuild': False, 'rebundle': False, 'resign': False, 'passed': False}
    device = None
    logger = None
    result = 1
    try:
        proof['immutableCompatibility'] = helper.verify_setup_immutable(app, manifest, records, setup)
        prepared = JOURNEY.prepare_simulator(manifest, starter, created, helper, records, setup)
        device = prepared['device']
        helper.atomic_json(output / 'device-setup.json', prepared)
        proof['bootedRuntime'] = JOURNEY.verify_selected_booted_runtime(manifest, prepared, created, helper, records, setup)
        helper.setup_read(['xcrun', 'simctl', 'install', device, str(app)], 'install', 120, records, setup)
        with (output / 'app.log').open('wb') as log:
            logger = subprocess.Popen(['xcrun', 'simctl', 'spawn', device, 'log', 'stream', '--style', 'compact',
                '--level', 'info', '--predicate', 'process == "PlatinumQA"'], stdout=log,
                stderr=subprocess.STDOUT, start_new_session=True)
            os.chdir(baseline)
            rows = runner.run_cases(cases, 'ios', device, output,
                collect_case=lambda platform, selected, target: collect_with_bounded_commands(runner, helper, selected, target))
        summary = {'applicationSourceCommit': JOURNEY.SOURCE, 'applicationSourceTree': JOURNEY.TREE,
                   'platform': 'ios', 'selectedGroups': sorted(SHARDS[args.shard]),
                   'unselectedGroups': sorted(set(scenarios['groups']) - SHARDS[args.shard]),
                   'attempted': len(rows), 'passed': sum(row['status'] == 'passed' for row in rows),
                   'failed': sum(row['status'] != 'passed' for row in rows), 'allControlsAccepted': False}
        helper.atomic_json(output / 'summary.json', summary)
        runner.validate_binary(manifest, app, 'ios', JOURNEY.SOURCE, JOURNEY.TREE)
        JOURNEY.verify_download(binary_dir, binding, scenario_file)
        subprocess.run(['git', '-C', str(baseline), 'diff', '--exit-code', 'HEAD', '--'], check=True,
                       stdout=subprocess.DEVNULL, timeout=30)
        proof['unchangedSourceAndBinaryAfterRun'] = True
        proof['passed'] = summary['failed'] == 0
        result = int(not proof['passed'])
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        proof['executionIssue'] = type(error).__name__
        proof['executionDetail'] = str(error)[:1000]
        raise
    finally:
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
