#!/usr/bin/env python3
"""Recover only the ecf social/settings shards that stopped before installation."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


COMMON = load('ecf_remaining_verified_common', Path(__file__).with_name('completion-ios-ecf-account.py'))
FLOWS = load('ecf_remaining_reviewed_flow_copy', Path(__file__).with_name('completion-ios-social-flow-corrections.py'))
SHARDS = {'social': {'count': 31, 'failedJob': 124734744440, 'failedArtifact': 13067678598},
          'settings': {'count': 27, 'failedJob': 124734744493, 'failedArtifact': 13067808885}}


def selected_cases(manifest, shard):
    if shard not in SHARDS:
        raise ValueError('Only the terminal pre-install social/settings failures may be recovered')
    cases = COMMON.AUDIT.selected_cases(manifest, shard)
    if len(cases) != SHARDS[shard]['count'] or any(case['kind'] == 'same-session-memory-capture' for case in cases):
        raise ValueError('The complete original declared social/settings partition is required')
    return cases


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--consumer-source', required=True)
    parser.add_argument('--shard', choices=SHARDS, required=True)
    args = parser.parse_args()
    if (os.environ.get('CI') != 'true' or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa'
            or os.environ.get('EXPO_PUBLIC_SUPABASE_URL') != 'https://uaulhuelcfkjwojtymmw.supabase.co'
            or os.environ.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') != 'native-ui-synthetic-no-provider-key'):
        raise ValueError('Only the isolated synthetic QA Simulator is permitted')
    if not re.fullmatch('[0-9a-f]{40}', args.consumer_source):
        parser.error('An exact reviewed consumer commit is required')
    baseline = args.baseline.resolve(strict=True)
    tools_root = Path(__file__).resolve().parents[2]
    def git(folder, revision):
        return subprocess.check_output(['git', '-C', str(folder), 'rev-parse', revision], text=True, timeout=30).strip()
    if (git(baseline, 'HEAD') != COMMON.SOURCE or git(baseline, 'HEAD^{tree}') != COMMON.TREE
            or git(tools_root, 'HEAD') != args.consumer_source):
        raise ValueError('The original ecf producer or reviewed consumer checkout differs')
    binding = COMMON.validate_binding(json.loads(Path(__file__).with_name('completion-ios-ecf-account.json').read_text()))
    binary_dir = baseline / 'native-audit-binary'
    manifest, source = COMMON.verify_download(binary_dir, binding, baseline)
    scripts = baseline / 'scripts/quality'
    if COMMON.JOURNEY.digest(scripts / 'native-ui-audit-runner.py') != COMMON.RUNNER_SHA:
        raise ValueError('The exact original current-source runner changed')
    runner = load('ecf_remaining_original_runner', scripts / 'native-ui-audit-runner.py')
    helper = load('ecf_remaining_original_helpers', scripts / 'native-ui-ios-audit-recovery.py')
    starter = load('ecf_remaining_original_starter', scripts / 'native-ui-start-ios-device.py')
    created = load('ecf_remaining_original_created_device', scripts / 'native-ui-ios-created-device.py')
    scenario_file = baseline / 'tests/native/audit/manifest.json'
    scenarios = json.loads(scenario_file.read_text())
    cases = selected_cases(scenarios, args.shard)
    app = helper.extract_app(binary_dir / 'qa.app.tar.gz', binary_dir)
    runner.validate_binary(manifest, app, 'ios', COMMON.SOURCE, COMMON.TREE)
    output = baseline / 'native-audit-results'
    output.mkdir(exist_ok=False)
    shutil.copyfile(binary_dir / 'binary-manifest.json', output / 'binary-manifest.json')
    shutil.copyfile(scenario_file, output / 'audit-manifest.json')
    records = []
    setup = output / 'setup-commands.json'
    proof = {'kind': 'current-source-ios-remaining-preboot-order-recovery',
             'applicationSourceCommit': COMMON.SOURCE, 'applicationSourceTree': COMMON.TREE,
             'producerRunId': COMMON.PRODUCER_RUN, 'producerBinding': binding,
             'consumerSourceCommit': args.consumer_source, 'consumerRunId': os.environ.get('GITHUB_RUN_ID'),
             'shard': args.shard, 'selectedGroups': sorted(COMMON.AUDIT.SHARDS[args.shard]),
             'selectedCaseIds': [case['id'] for case in cases], 'selectedCaseCount': len(cases),
             'originalRunnerSha256': COMMON.RUNNER_SHA,
             'originalCaseIdentitiesResetsAndDeadlinesUnchanged': True,
             'precedingFailedRun': COMMON.PRODUCER_RUN,
             'precedingFailedJob': SHARDS[args.shard]['failedJob'],
             'precedingFailedArtifact': SHARDS[args.shard]['failedArtifact'],
             'sourceInputVerification': COMMON.verify_source_inputs(baseline, source),
             'accountShardOrOriginalReaderJourneyIncluded': False,
             'rebuild': False, 'rebundle': False, 'resign': False,
             'passed': False, 'installed': False, 'attempted': 0}
    device = None
    logger = None
    execution_temp = None
    execution = baseline
    execution_proof = None
    result = 1
    try:
        if args.shard == 'social':
            execution_temp = tempfile.TemporaryDirectory(prefix='ecf-social-flows-', dir=baseline.parent)
            execution = Path(execution_temp.name) / 'execution'
            execution_proof = FLOWS.materialize(baseline, execution, source)
            helper.atomic_json(output / 'executed-flow-proof.json', execution_proof)
            proof['flowInteractionCorrections'] = execution_proof['corrections']
            for change in execution_proof['corrections']:
                name = Path(change['path']).name
                target = output / 'executed-flows' / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(execution / change['path'], target)
        else:
            proof['flowInteractionCorrections'] = []
        prepared, compatibility = COMMON.prepare_bound_device(app, manifest, starter, created, helper, records, setup)
        device = prepared['device']
        proof.update(compatibility)
        helper.atomic_json(output / 'device-setup.json', prepared)
        helper.setup_read(['xcrun', 'simctl', 'install', device, str(app)], 'install', 120, records, setup)
        proof['installed'] = True
        with (output / 'app.log').open('wb') as log:
            logger = subprocess.Popen(['xcrun', 'simctl', 'spawn', device, 'log', 'stream', '--style', 'compact',
                '--level', 'info', '--predicate', 'process == "PlatinumQA"'], stdout=log,
                stderr=subprocess.STDOUT, start_new_session=True)
            os.chdir(execution)
            rows = runner.run_cases(cases, 'ios', device, output,
                collect_case=lambda platform, selected, target: COMMON.AUDIT.collect_with_bounded_commands(runner, helper, selected, target))
        if len(rows) != len(cases) or [row['id'] for row in rows] != [case['id'] for case in cases]:
            raise ValueError('Every original selected case must execute once in the original order')
        summary = {'applicationSourceCommit': COMMON.SOURCE, 'applicationSourceTree': COMMON.TREE,
                   'platform': 'ios', 'selectedGroups': sorted(COMMON.AUDIT.SHARDS[args.shard]),
                   'unselectedGroups': sorted(set(scenarios['groups']) - COMMON.AUDIT.SHARDS[args.shard]),
                   'attempted': len(rows), 'passed': sum(row['status'] == 'passed' for row in rows),
                   'failed': sum(row['status'] != 'passed' for row in rows), 'allControlsAccepted': False}
        helper.atomic_json(output / 'summary.json', summary)
        runner.validate_binary(manifest, app, 'ios', COMMON.SOURCE, COMMON.TREE)
        COMMON.verify_download(binary_dir, binding, baseline)
        subprocess.run(['git', '-C', str(baseline), 'diff', '--exit-code', 'HEAD', '--'], check=True,
                       stdout=subprocess.DEVNULL, timeout=30)
        if execution_proof is not None:
            FLOWS.verify_execution(execution, execution_proof)
            proof['executedFlowsReverifiedAfterRun'] = True
        proof['unchangedCanonicalSourceAndBinaryAfterRun'] = True
        proof['passed'] = summary['failed'] == 0
        result = int(not proof['passed'])
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        proof['executionIssue'] = type(error).__name__
        proof['executionDetail'] = str(error)[:1000]
        raise
    finally:
        try:
            proof['caseAccounting'] = COMMON.case_accounting(output / 'results.json', cases)
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
        if execution_temp is not None:
            os.chdir(baseline)
            execution_temp.cleanup()
        helper.atomic_json(output / 'consumer-proof.json', proof)
    return result


if __name__ == '__main__':
    raise SystemExit(main())
