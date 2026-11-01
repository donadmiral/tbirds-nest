#!/usr/bin/env python3
"""Revalidate retained ecf5 Android artifacts with that exact commit's validators."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
SOURCE = 'ecf5e5a960106d7cb04c211ee99e9e89c09642cc'
TREE = '38a64a6d47eafe0f976708edcc338b34204811f4'
GROUPS = {
    'social': {'feed', 'market', 'jobs', 'messages', 'navigation'},
    'account': {'auth', 'business', 'memory', 'profile', 'support'},
    'settings': {'directories', 'settings', 'stories'},
}
SHA = lambda data: hashlib.sha256(data).hexdigest()


def source_file(name):
    return subprocess.check_output(['git', 'show', SOURCE + ':' + name], cwd=ROOT)


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Usage: revalidate.py EXTRACTED_ARTIFACTS_PARENT')
    parent = Path(sys.argv[1])
    runner_data = source_file('scripts/quality/native-ui-audit-runner.py')
    producer = json.loads((OUT.parent / 'android-audit-build-ecf5/source.json').read_text())
    assert SHA(runner_data) == producer['audit']['inputs']['scripts/quality/native-ui-audit-runner.py']
    manifest_data = source_file('tests/native/audit/manifest.json')
    manifest = json.loads(manifest_data)
    expected = {c['id']: c for c in manifest['cases']}
    assert len(expected) == len(manifest['cases']) == 85
    binary = (OUT.parent / 'android-audit-build-ecf5/binary-manifest.json').read_bytes()
    observed = {}; issues = []; groups = []; timing_unavailable = []
    with tempfile.TemporaryDirectory(prefix='platinum-ecf-validator-') as temporary:
        path = Path(temporary) / 'runner.py'; path.write_bytes(runner_data)
        spec = importlib.util.spec_from_file_location('ecf_audit_runner', path)
        runner = importlib.util.module_from_spec(spec); spec.loader.exec_module(runner)
        for name, selected in GROUPS.items():
            folder = parent / name / 'native-audit-results'
            if not folder.is_dir():
                continue
            summary = json.loads((folder / 'summary.json').read_text())
            rows = json.loads((folder / 'results.json').read_text())
            assert (folder / 'binary-manifest.json').read_bytes() == binary, name
            assert (folder / 'audit-manifest.json').read_bytes() == manifest_data, name
            assert summary['applicationSourceCommit'] == SOURCE and summary['applicationSourceTree'] == TREE
            assert summary['platform'] == 'android' and set(summary['selectedGroups']) == selected
            assert summary['allControlsAccepted'] is False
            wanted = {k for k, c in expected.items() if c['group'] in selected}
            assert len(rows) == len(wanted) == summary['attempted']
            assert {r['id'] for r in rows} == wanted
            assert summary['passed'] == sum(r['status'] == 'passed' for r in rows)
            assert summary['failed'] == len(rows) - summary['passed']
            checks = []
            for row in rows:
                identity = row['id']; case = expected[identity]; target = folder / identity
                assert identity not in observed
                valid = (row['group'] == case['group'] and row['kind'] == case['kind']
                         and row['attempts'] == 1
                         and row['timeoutSeconds'] == (300 if case['kind'] == 'same-session-memory-capture' else 180)
                         and row['driverStartupBudgetSeconds'] == 0
                         and type(row['startedAtEpochMs']) is int and type(row['finishedAtEpochMs']) is int
                         and row['finishedAtEpochMs'] >= row['startedAtEpochMs'] > 0)
                junit = runner.validate_junit(target / 'junit.xml', case)
                fixture = runner.validate_receipt(target / 'native-ui-receipt.json', case)
                accepted = (valid and row['status'] == 'passed' and row['exitCode'] == 0
                            and junit.get('passed') is True and fixture.get('passed') is True
                            and row['junit'] == junit and row['fixture'] == fixture)
                for receipt in ['native-ui-receipt.json', 'native-ui-auth-diagnostics.json', 'native-ui-navigation-timing.json']:
                    file = target / receipt
                    collected = [x for x in row['collection'] if x.get('file') == receipt]
                    retained = (file.is_file() and file.stat().st_size > 0 and len(collected) == 1
                                and collected[0].get('collected') is True
                                and collected[0].get('bytes') == file.stat().st_size)
                    accepted = accepted and retained
                    if retained:
                        try:
                            json.loads(file.read_text())
                        except ValueError:
                            if receipt == 'native-ui-navigation-timing.json':
                                timing_unavailable.append(identity)
                            else:
                                accepted = False
                captures = list((target / 'maestro').rglob('*.png'))
                accepted = accepted and bool(captures) and all(p.read_bytes().startswith(b'\x89PNG\r\n\x1a\n') for p in captures)
                if identity == 'memory-capture-session':
                    accepted = accepted and row['mediaVerifierExitCode'] == 0
                observed[identity] = 'passed' if accepted else 'failed'
                if not accepted:
                    issues.append('Case failed independent evidence checks: ' + identity)
                checks.append({'id': identity, 'accepted': accepted, 'junit': junit, 'fixture': fixture,
                               'uiCaptures': len(captures), 'attempts': row['attempts']})
            groups.append({'name': name, 'reported': len(rows), 'verifiedPassed': sum(x['accepted'] for x in checks), 'cases': checks})
            shutil.copyfile(folder / 'summary.json', OUT / (name + '-summary.json'))
            shutil.copyfile(folder / 'results.json', OUT / (name + '-results.json'))
    missing = sorted(set(expected) - set(observed)); passed = sorted(k for k, v in observed.items() if v == 'passed')
    failed = sorted(k for k, v in observed.items() if v == 'failed')
    report = {'formatVersion': 1, 'sourceCommit': SOURCE, 'sourceTree': TREE, 'workflowRun': 41266020074,
              'validatorSha256': SHA(runner_data), 'expected': 85, 'reported': len(observed),
              'verifiedPassed': len(passed), 'verifiedFailed': len(failed), 'artifactNotYetRetained': len(missing),
              'passedCases': passed, 'failedCases': failed, 'casesWithoutRetainedArtifact': missing,
              'all85Passed': len(passed) == 85 and not issues, 'issues': issues, 'groups': groups,
              'optionalTimingNotAvailable': sorted(timing_unavailable),
              'timingBoundary': 'An adb missing-file diagnostic is retained evidence of unavailable optional timing, never a latency sample. Warm-tabs performance has its own actual JSON analysis.',
              'allControlsAccepted': False, 'hostedBackendAcceptance': False, 'physicalDeviceAcceptance': False}
    (OUT / 'independent-coverage.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ['expected', 'reported', 'verifiedPassed', 'verifiedFailed', 'artifactNotYetRetained', 'all85Passed', 'issues']}))
    if issues:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
