#!/usr/bin/env python3
"""Do not equate missing, skipped, or failed feature groups with acceptance."""
import json
import os
from pathlib import Path
import sys


def summarize(folder, manifest, source):
    expected = {case['id'] for case in manifest['cases']}
    result = {'source': source, 'expectedPerPlatform': len(expected), 'platforms': {},
              'allControlsAccepted': False, 'issues': []}
    for platform in ['android', 'ios']:
        observed = {}
        for report in sorted(folder.glob('native-audit-' + platform + '-*-results/native-audit-results/summary.json')):
            try:
                summary = json.loads(report.read_text())
                if summary['applicationSourceCommit'] != source or summary['platform'] != platform:
                    raise ValueError('wrong-source-or-platform')
                rows = json.loads(report.with_name('results.json').read_text())
                for row in rows:
                    identity = row.get('id')
                    if identity not in expected or identity in observed:
                        raise ValueError('unknown-or-duplicate-case:' + str(identity))
                    observed[identity] = row.get('status')
            except (OSError, ValueError, KeyError, TypeError) as error:
                result['issues'].append({'report': str(report), 'failure': str(error)})
        passed = sorted(key for key, status in observed.items() if status == 'passed')
        failed = sorted(key for key, status in observed.items() if status != 'passed')
        missing = sorted(expected - observed.keys())
        result['platforms'][platform] = {'passed': len(passed), 'failed': len(failed), 'notExecuted': len(missing),
                                        'passedCases': passed, 'failedCases': failed, 'unexecutedCases': missing}
    result['allDeclaredCasesPassed'] = not result['issues'] and all(
        value['passed'] == len(expected) and value['failed'] == 0 and value['notExecuted'] == 0
        for value in result['platforms'].values())
    return result


def main():
    folder = Path(sys.argv[1])
    manifest = json.loads(Path('tests/native/audit/manifest.json').read_text())
    result = summarize(folder, manifest, os.environ['GITHUB_SHA'])
    Path('native-audit-coverage.json').write_text(json.dumps(result, indent=2) + '\n')
    lines = ['## Independent native audit', '', '| Platform | Passed | Failed | Not executed | Declared cases |',
             '|---|---:|---:|---:|---:|']
    for platform, values in result['platforms'].items():
        lines.append(f"| {platform} | {values['passed']} | {values['failed']} | {values['notExecuted']} | {result['expectedPerPlatform']} |")
    lines += ['', 'These are the explicitly declared case postconditions. They do not establish every-control, hosted-provider, or physical-device acceptance.', '']
    summary = '\n'.join(lines)
    print(summary)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
            output.write(summary)
    return int(not result['allDeclaredCasesPassed'])


if __name__ == '__main__':
    sys.exit(main())
