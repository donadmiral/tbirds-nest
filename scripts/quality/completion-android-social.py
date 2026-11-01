#!/usr/bin/env python3
"""Replay the unchanged social shard against the verified APK, without rebuilding."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import time

SOURCE = 'f5be97445ef7223baeb60dd10e8cded05630b6c1'
TREE = 'f54e192c3ef721d0207d840382f176185c8c4f5a'
PRODUCER_RUN = 41259529351
ARTIFACT_ID = 13065102124
ARTIFACT_BYTES = 63632600
ARTIFACT_SHA = 'a62e96df796ba3469018e137269fd7cb784e7d55a3628bf0a6247db509a538ea'
BINARY_SHA = 'a2a7cc10b33619d96ecdd461c8401fc360c47a592e94eded2e7c183863cdbd85'
BINARY_MANIFEST_SHA = '092cfe98f2cd88c05319267c7b8d947882734d478edfd3f792ea10d676ad0a3b'
SOURCE_RECEIPT_SHA = 'cb4762c4caaa3aebff83cf6071cd9b18db3e5377fbcb1903c4017f5c2e1df302'
AUDIT_MANIFEST_SHA = '0a5b4f2af0ea3e5ac5befce43ac3a4af46c347c83653467ba9ddfd3901c26a3d'
GROUPS = ('navigation', 'feed', 'market', 'jobs', 'messages')
ORIGINAL_FAILED_CASES = {
    'navigation-conversations', 'messages-calllog', 'messages-chat', 'navigation-warm-tabs',
    'feed-search-controls', 'notifications-empty-controls', 'market-offer-cancel',
    'jobs-application-entry', 'messages-recipient-search', 'feed-article-draft',
}
SOURCE_HASHES = {
    'scripts/quality/native-ui-audit-runner.py': '2eebacb4baca5b5231367c749fba465e13235c85a1d8dee4b5503eb72dbde3b4',
    'scripts/quality/run-native-ui-audit-device.sh': '4b76121375d76d71da18576ab817bada009b950c8c74f00728235ebc5471d52f',
    'scripts/quality/install-native-ui-tools.sh': '30ed0ef0d19fa409b18177d850009b0094cb7d20c86cf3e7f9809ea4192587f5',
    'scripts/quality/native-ui-emulator-graphics.py': '7768c98ec1eb3f3afc770dda6f6ece99fe4467bf65ce7e714be9b8b8a7f8ca78',
    'tests/native/audit/manifest.json': AUDIT_MANIFEST_SHA,
}
RECEIPTS = ('native-ui-receipt.json', 'native-ui-auth-diagnostics.json', 'native-ui-navigation-timing.json')


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def load_runner(baseline):
    path = baseline / 'scripts/quality/native-ui-audit-runner.py'
    if digest(path) != SOURCE_HASHES['scripts/quality/native-ui-audit-runner.py']:
        raise ValueError('The original audit runner differs from the producer')
    spec = importlib.util.spec_from_file_location('original_android_social_runner', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def selected_cases(manifest):
    cases = manifest['cases']
    if len(cases) != 85 or len({case['id'] for case in cases}) != 85:
        raise ValueError('The complete original 85-case manifest is required')
    selected = [case for case in cases if case['group'] in GROUPS]
    if len(selected) != 31 or not ORIGINAL_FAILED_CASES <= {case['id'] for case in selected}:
        raise ValueError('All 31 original social cases must be selected')
    return selected


def verify_independent_binding(tools_root):
    folder = tools_root / 'docs/quality/completion-20261101/android-audit-build'
    proof = json.loads((folder / 'verification.json').read_text())
    expected = {'id': ARTIFACT_ID, 'bytes': ARTIFACT_BYTES, 'sha256': ARTIFACT_SHA}
    if (proof.get('sourceCommit') != SOURCE or proof.get('workflowRun') != PRODUCER_RUN
            or proof.get('binaryArtifact') != expected or proof.get('apkSha256') != BINARY_SHA
            or proof.get('retainedSourceHashesVerified') != 607
            or proof.get('retainedFinalOverlayFilesVerified') != 9
            or proof.get('fullReleaseApkAndBundlePresent') is not True
            or proof.get('media3PackagedAbiPassed') is not True
            or digest(folder / 'binary-manifest.json') != BINARY_MANIFEST_SHA
            or digest(folder / 'source.json') != SOURCE_RECEIPT_SHA
            or digest(tools_root / 'tests/native/audit/manifest.json') != AUDIT_MANIFEST_SHA):
        raise ValueError('The independently verified producer binding is missing or changed')
    return expected


def verify_source(baseline):
    def git(revision):
        return subprocess.check_output(['git', '-C', str(baseline), 'rev-parse', revision], text=True, timeout=30).strip()
    if git('HEAD') != SOURCE or git('HEAD^{tree}') != TREE:
        raise ValueError('The application and tests must be the exact producer checkout')
    subprocess.run(['git', '-C', str(baseline), 'diff', '--exit-code', 'HEAD', '--'],
                   check=True, stdout=subprocess.DEVNULL, timeout=30)
    for name, expected in SOURCE_HASHES.items():
        if digest(baseline / name) != expected:
            raise ValueError('A source-bound helper or scenario changed: ' + name)
    return selected_cases(json.loads((baseline / 'tests/native/audit/manifest.json').read_text()))


def verify_download(binary_dir, runner):
    for name, expected in [('app-release.apk', BINARY_SHA), ('binary-manifest.json', BINARY_MANIFEST_SHA),
                           ('source.json', SOURCE_RECEIPT_SHA)]:
        if digest(binary_dir / name) != expected:
            raise ValueError('Downloaded producer bytes differ: ' + name)
    manifest = json.loads((binary_dir / 'binary-manifest.json').read_text())
    if (manifest.get('auditManifestSha256') != AUDIT_MANIFEST_SHA
            or manifest.get('sourceReceiptSha256') != SOURCE_RECEIPT_SHA
            or manifest.get('rebuildPerCase') is not False
            or manifest.get('resignOrRebundlePermitted') is not False):
        raise ValueError('Downloaded provenance or binary immutability differs')
    runner.validate_binary(manifest, binary_dir / 'app-release.apk', 'android', SOURCE, TREE)
    return manifest


def account_results(output, cases, runner):
    """Count every expected case and recheck its retained original evidence."""
    expected = {case['id']: case for case in cases}
    observed = {}
    issues = []
    try:
        rows = json.loads((output / 'results.json').read_text())
        if not isinstance(rows, list):
            raise ValueError('Case results must be a list')
    except (OSError, ValueError) as error:
        rows = []
        issues.append('Missing or malformed original results: ' + str(error))
    for row in rows:
        if not isinstance(row, dict) or row.get('id') not in expected:
            issues.append('Unexpected or malformed case result')
            continue
        identity = row['id']
        if identity in observed:
            issues.append('Duplicate original case: ' + identity)
            continue
        case = expected[identity]
        target = output / identity
        valid = (row.get('attempts') == 1 and row.get('group') == case['group']
                 and row.get('kind') == case['kind'] and row.get('timeoutSeconds') == 180
                 and row.get('driverStartupBudgetSeconds') == 0
                 and type(row.get('startedAtEpochMs')) is int
                 and type(row.get('finishedAtEpochMs')) is int
                 and row['finishedAtEpochMs'] >= row['startedAtEpochMs'] > 0)
        if not valid:
            issues.append('Altered case identity, deadline, attempt or timing: ' + identity)
        accepted = valid and row.get('status') == 'passed' and row.get('exitCode') == 0
        junit = runner.validate_junit(target / 'junit.xml', case)
        fixture = runner.validate_receipt(target / 'native-ui-receipt.json', case)
        accepted = accepted and junit.get('passed') is True and fixture.get('passed') is True
        if row.get('junit') != junit or row.get('fixture') != fixture:
            issues.append('Retained evidence differs from the original case result: ' + identity)
            accepted = False
        if accepted:
            for name in RECEIPTS:
                file = target / name
                collected = [item for item in row.get('collection', []) if item.get('file') == name]
                if (not file.is_file() or not file.stat().st_size or len(collected) != 1
                        or collected[0].get('collected') is not True
                        or collected[0].get('bytes') != file.stat().st_size):
                    accepted = False
                    issues.append('Missing or incomplete original receipt: ' + identity + '/' + name)
            if not any((target / 'maestro').rglob('*.png')):
                accepted = False
                issues.append('Missing original UI capture: ' + identity)
        observed[identity] = 'passed' if accepted else 'failed'
    try:
        summary = json.loads((output / 'summary.json').read_text())
        if (summary.get('applicationSourceCommit') != SOURCE or summary.get('applicationSourceTree') != TREE
                or summary.get('platform') != 'android' or set(summary.get('selectedGroups', [])) != set(GROUPS)
                or summary.get('attempted') != len(rows)
                or summary.get('passed') != sum(row.get('status') == 'passed' for row in rows if isinstance(row, dict))
                or summary.get('failed') != sum(row.get('status') != 'passed' for row in rows if isinstance(row, dict))
                or summary.get('allControlsAccepted') is not False):
            raise ValueError('Original source, group or count summary differs')
    except (OSError, ValueError, TypeError) as error:
        issues.append('Missing or inconsistent original summary: ' + str(error))
    return coverage_for_cases(cases, observed, issues)


def coverage_for_cases(cases, observed, issues):
    expected = {case['id'] for case in cases}
    passed = sorted(identity for identity, status in observed.items() if status == 'passed')
    failed = sorted(identity for identity, status in observed.items() if status == 'failed')
    missing = sorted(expected - set(observed))
    return {'applicationSourceCommit': SOURCE, 'applicationSourceTree': TREE, 'platform': 'android',
            'expected': len(expected), 'passed': len(passed), 'failed': len(failed), 'notExecuted': len(missing),
            'passedCases': passed, 'failedCases': failed, 'unexecutedCases': missing, 'issues': issues,
            'originalFailedCasesRecovered': sorted(ORIGINAL_FAILED_CASES & set(passed)),
            'originalFailedCasesRemaining': sorted(ORIGINAL_FAILED_CASES - set(passed)),
            'allOriginalSocialCasesPassed': len(passed) == 31 and not failed and not missing and not issues,
            'allControlsAccepted': False, 'hostedBackendAcceptance': False, 'physicalDeviceAcceptance': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifact-id', action='store_true')
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--consumer-source')
    args = parser.parse_args()
    tools_root = Path(__file__).resolve().parents[2]
    binding = verify_independent_binding(tools_root)
    if args.artifact_id:
        print(ARTIFACT_ID)
        return 0
    if args.baseline is None or not re.fullmatch('[0-9a-f]{40}', args.consumer_source or ''):
        parser.error('The exact producer checkout and consumer commit are required')
    if (os.environ.get('CI') != 'true' or os.environ.get('EXPO_PUBLIC_APP_ENV') != 'qa'
            or os.environ.get('EXPO_PUBLIC_SUPABASE_URL') != 'https://uaulhuelcfkjwojtymmw.supabase.co'
            or os.environ.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') != 'native-ui-synthetic-no-provider-key'):
        raise ValueError('Only the disposable synthetic QA emulator is permitted')
    consumer = subprocess.check_output(['git', '-C', str(tools_root), 'rev-parse', 'HEAD'], text=True, timeout=30).strip()
    if consumer != args.consumer_source:
        raise ValueError('Consumer workflow and checkout differ')
    baseline = args.baseline.resolve(strict=True)
    # Its exact digest was checked with the independent binding above. This
    # known case list lets a setup failure account for every unexecuted case.
    cases = selected_cases(json.loads((tools_root / 'tests/native/audit/manifest.json').read_text()))
    logs = baseline / 'native-ui-logs'
    logs.mkdir(exist_ok=True)
    proof = {'kind': 'source-bound-original-31-android-social-recovery',
             'applicationSourceCommit': SOURCE, 'applicationSourceTree': TREE,
             'producerRunId': PRODUCER_RUN, 'producerBinding': binding,
             'binarySha256': BINARY_SHA, 'binaryManifestSha256': BINARY_MANIFEST_SHA,
             'sourceReceiptSha256': SOURCE_RECEIPT_SHA, 'auditManifestSha256': AUDIT_MANIFEST_SHA,
             'consumerSourceCommit': consumer, 'consumerRunId': os.environ.get('GITHUB_RUN_ID'),
             'consumerRunAttempt': os.environ.get('GITHUB_RUN_ATTEMPT'),
             'selectedCaseIds': [case['id'] for case in cases],
             'originalHelperHashes': SOURCE_HASHES, 'originalCasesAndDeadlinesUnchanged': True,
             'rebuild': False, 'rebundle': False, 'resign': False, 'passed': False,
             'startedAtEpochMs': round(time.time() * 1000)}
    write_json(logs / 'consumer-proof.json', proof)
    runner = None
    write_json(logs / 'social-coverage.json', coverage_for_cases(cases, {}, ['Device setup has not completed']))
    try:
        if verify_source(baseline) != cases:
            raise ValueError('Producer and reviewed consumer scenario lists differ')
        runner = load_runner(baseline)
        binary_dir = baseline / 'native-audit-binary'
        verify_download(binary_dir, runner)
        if (baseline / 'native-audit-results').exists():
            raise ValueError('A fresh consumer cannot reuse earlier case results')
        # Only this child receives the source of its actual checkout. The separate
        # workflow commit above remains the consumer identity throughout.
        environment = dict(os.environ, GITHUB_SHA=SOURCE)
        command = ['bash', 'scripts/quality/run-native-ui-audit-device.sh', 'android', ','.join(GROUPS)]
        execution = subprocess.run(command, cwd=baseline, env=environment, check=False)
        proof['originalCommandExitCode'] = execution.returncode
        verify_source(baseline)
        verify_download(binary_dir, runner)
        proof['unchangedSourceAndBinaryAfterRun'] = True
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        proof['executionIssue'] = type(error).__name__
        proof['executionDetail'] = str(error)[:1000]
        raise
    finally:
        try:
            coverage = (account_results(baseline / 'native-audit-results', cases, runner) if runner is not None
                        else coverage_for_cases(cases, {}, ['Producer preflight did not permit execution']))
        except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
            coverage = coverage_for_cases(cases, {}, ['Case evidence could not be verified: ' + type(error).__name__])
        if proof.get('executionIssue'):
            coverage['issues'].append('Consumer execution failed: ' + proof['executionIssue'])
            coverage['allOriginalSocialCasesPassed'] = False
        proof['passed'] = (proof.get('originalCommandExitCode') == 0
                           and proof.get('unchangedSourceAndBinaryAfterRun') is True
                           and coverage['allOriginalSocialCasesPassed'])
        write_json(logs / 'social-coverage.json', coverage)
        proof['finishedAtEpochMs'] = round(time.time() * 1000)
        write_json(logs / 'consumer-proof.json', proof)
    return int(not proof['passed'])


if __name__ == '__main__':
    raise SystemExit(main())
