#!/usr/bin/env python3
"""Reuse the pinned AutoFill checks with distinct source and Simulator owners."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CONSUMER = Path(__file__).resolve().parents[2]
retained = load_module('retained_ios_identity', Path(__file__).with_name('retained-ios-full-ui.py'))


def retained_context(root, env, config, original, system=None, machine=None):
    consumer, run, attempt = (env.get(key, '') for key in ('GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'))
    original.require(re.fullmatch(r'[a-f0-9]{40}', consumer) is not None
                     and re.fullmatch(r'[1-9][0-9]*', run) is not None
                     and re.fullmatch(r'[1-9][0-9]*', attempt) is not None, 'missing_consumer_identity')
    retained.checked(root / 'native-ui-logs/source.json', config['sourceReceiptSha256'])
    proof = original.bounded_json(root / 'native-ui-logs/retained-provenance.json')
    original.require(proof.get('consumerCommit') == consumer and proof.get('consumerRunId') == run
                     and proof.get('applicationSourceCommit') == config['applicationSourceCommit']
                     and proof.get('producerRunId') == config['producerRunId'], 'consumer_identity_mismatch')
    # Only source validation receives the producer identity. Commands retain
    # the actual consumer environment and the fresh consumer-owned Simulator.
    producer_env = {**env, 'GITHUB_SHA': config['applicationSourceCommit'],
                    'GITHUB_RUN_ID': str(config['producerRunId'])}
    context = original.context(root, producer_env, system, machine)
    return {**context, 'workflowRun': run, 'workflowAttempt': attempt,
            'name': 'Platinum full app UI ' + run, 'consumerCommit': consumer,
            'producerCommit': config['applicationSourceCommit'],
            'producerRun': str(config['producerRunId']),
            'identityScope': 'Producer source hashes with fresh consumer Simulator ownership'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('verify-created', 'configure'))
    parser.add_argument('device')
    parser.add_argument('--runtime')
    args = parser.parse_args()
    root = Path.cwd()
    config = json.loads((CONSUMER / 'scripts/quality/retained-ios-full-ui.json').read_text())
    retained.checked(Path(__file__), config['externalAutofillSha256'])
    retained.checked(root / 'native-ui-logs/source.json', config['sourceReceiptSha256'])
    source = json.loads((root / 'native-ui-logs/source.json').read_text())
    original_path = root / 'scripts/quality/native-ui-ios-autofill.py'
    retained.checked(original_path, source['hashes']['scripts/quality/native-ui-ios-autofill.py'])
    original = load_module('original_ios_autofill', original_path)
    directory = root / 'native-ui-logs/ios-autofill-preflight'
    directory.mkdir(parents=True, exist_ok=True)
    result = {'schemaVersion': 1, 'passed': False, 'phase': args.phase,
              'budgetSeconds': original.BUDGET_SECONDS,
              'settingsBundleIdentifier': original.SETTINGS_APP, 'setting': original.SETTING,
              'scope': 'Pinned producer AutoFill checks on the fresh consumer-owned Simulator. No app-flow acceptance.'}
    started = None
    try:
        original.require(retained.command(['git', '-C', str(CONSUMER), 'rev-parse', 'HEAD']) == os.environ.get('GITHUB_SHA'),
                         'consumer_checkout_mismatch')
        ctx = retained_context(root, os.environ, config, original)
        result['context'] = ctx
        original.require(re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', args.device)
                         is not None, 'invalid_device_uuid')
        result['device'] = args.device
        if args.phase == 'verify-created':
            original.require(args.runtime == ctx['runtimeIdentifier'], 'runtime_argument_mismatch')
            original.require(not (directory / 'ownership.json').exists(), 'ownership_already_recorded')
            started = time.monotonic()
            run = original.Commands(root, dict(os.environ), directory, original.Deadline(started))
            verification = original.inventory(ctx, args.device, 'Shutdown', run, 'created')
            original.write_json(directory / 'ownership.json', {
                'context': ctx, 'device': args.device, 'verification': verification,
                'startedMonotonic': started, 'budgetSeconds': original.BUDGET_SECONDS}, exclusive=True)
            return 0
        original.require(args.runtime is None, 'unexpected_runtime_argument')
        owner = original.bounded_json(directory / 'ownership.json')
        deadline = original.validate_ownership(ctx, args.device, owner)
        started = owner['startedMonotonic']
        original.write_json(directory / 'configure-attempt.json', {
            'device': args.device, 'sourceCommit': ctx['sourceCommit'],
            'consumerCommit': ctx['consumerCommit'], 'workflowRun': ctx['workflowRun'], 'attempts': 1}, exclusive=True)
        run = original.Commands(root, dict(os.environ), directory, deadline)
        result.update(original.configure(ctx, args.device, owner, directory, run))
        result['evidence'] = {path.name: original.digest(path.read_bytes()) for path in
            (directory / name for name in ('ownership.json', 'before-hierarchy.json', 'before.png',
                                           'after-hierarchy.json', 'after.png'))}
        result['elapsedMs'] = round((time.monotonic() - started) * 1000)
        original.write_json(directory / 'result.json', result, exclusive=True)
        return 0
    except Exception as error:
        result['errorCode'] = str(error) if isinstance(error, original.PreflightError) else 'preflight_evidence_or_execution_failed'
        if started is not None:
            result['elapsedMs'] = round((time.monotonic() - started) * 1000)
        output = directory / ('result.json' if not (directory / 'result.json').exists() else 'rejected-repeat.json')
        if not output.exists():
            original.write_json(output, result, exclusive=True)
        print('Retained Simulator AutoFill preflight failed: ' + result['errorCode'], file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
