#!/usr/bin/env python3
"""Focused consumer-boundary tests. Generated receipts are unit fixtures only."""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('social_consumer', Path(__file__).with_name('completion-android-social.py'))
CONSUMER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONSUMER)
RUNNER = CONSUMER.load_runner(ROOT)
MANIFEST = json.loads((ROOT / 'tests/native/audit/manifest.json').read_text())
CASES = CONSUMER.selected_cases(MANIFEST)


def populate(output):
    rows = []
    for case in CASES:
        target = output / case['id']
        (target / 'maestro').mkdir(parents=True)
        (target / 'maestro/unit-fixture.png').write_bytes(b'unit-test-capture-placeholder')
        suite = ET.Element('testsuite', tests='1', failures='0', errors='0', skipped='0')
        ET.SubElement(suite, 'testcase', name=case['name'], status='SUCCESS', file='tests/native/audit/' + case['flow'])
        ET.ElementTree(suite).write(target / 'junit.xml')
        receipt = {'mode': 'synthetic-native-ui', 'networkForwarded': False, 'unhandled': [],
                   'audit': {'caseId': case['id'], 'scenario': case['fixtureScenario'], 'rejected': []},
                   'requests': [{'path': '/auth/v1/token'}]}
        (target / 'native-ui-receipt.json').write_text(json.dumps(receipt))
        for name in CONSUMER.RECEIPTS[1:]:
            (target / name).write_text('{"unitFixture":true}')
        rows.append({'id': case['id'], 'group': case['group'], 'kind': case['kind'], 'attempts': 1,
                     'status': 'passed', 'exitCode': 0, 'timeoutSeconds': 180, 'driverStartupBudgetSeconds': 0,
                     'startedAtEpochMs': 1000, 'finishedAtEpochMs': 2000,
                     'junit': RUNNER.validate_junit(target / 'junit.xml', case),
                     'fixture': RUNNER.validate_receipt(target / 'native-ui-receipt.json', case),
                     'collection': [{'file': name, 'collected': True, 'bytes': (target / name).stat().st_size}
                                    for name in CONSUMER.RECEIPTS]})
    summary = {'applicationSourceCommit': CONSUMER.SOURCE, 'applicationSourceTree': CONSUMER.TREE,
               'platform': 'android', 'selectedGroups': sorted(CONSUMER.GROUPS),
               'attempted': 31, 'passed': 31, 'failed': 0, 'allControlsAccepted': False}
    CONSUMER.write_json(output / 'results.json', rows)
    CONSUMER.write_json(output / 'summary.json', summary)
    return rows, summary


class ConsumerBoundaries(unittest.TestCase):
    def test_exact_producer_and_full_social_partition(self):
        self.assertEqual(CONSUMER.verify_independent_binding(ROOT)['id'], 13065102124)
        self.assertEqual(CONSUMER.digest(ROOT / 'tests/native/audit/manifest.json'), CONSUMER.AUDIT_MANIFEST_SHA)
        self.assertEqual(len(CASES), 31)
        self.assertEqual(len(CONSUMER.ORIGINAL_FAILED_CASES), 10)
        altered = copy.deepcopy(MANIFEST)
        altered['cases'].pop()
        with self.assertRaises(ValueError):
            CONSUMER.selected_cases(altered)

    def test_absent_execution_accounts_for_all_31_cases(self):
        with tempfile.TemporaryDirectory() as directory:
            result = CONSUMER.account_results(Path(directory), CASES, RUNNER)
        self.assertEqual((result['passed'], result['failed'], result['notExecuted']), (0, 0, 31))
        self.assertEqual(len(result['originalFailedCasesRemaining']), 10)
        self.assertFalse(result['allOriginalSocialCasesPassed'])

    def test_complete_unit_evidence_and_failure_boundaries(self):
        defects = [None, 'missing-case', 'duplicate-case', 'wrong-source', 'wrong-tree', 'retry',
                   'deadline', 'failed-case', 'missing-junit', 'missing-fixture', 'wrong-fixture',
                   'client-error', 'missing-timing', 'receipt-size', 'missing-capture']
        for defect in defects:
            with self.subTest(defect=defect), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                rows, summary = populate(output)
                target = output / rows[0]['id']
                if defect == 'missing-case':
                    rows.pop()
                elif defect == 'duplicate-case':
                    rows[1] = copy.deepcopy(rows[0])
                elif defect == 'wrong-source':
                    summary['applicationSourceCommit'] = '0' * 40
                elif defect == 'wrong-tree':
                    summary['applicationSourceTree'] = '0' * 40
                elif defect == 'retry':
                    rows[0]['attempts'] = 2
                elif defect == 'deadline':
                    rows[0]['timeoutSeconds'] = 360
                elif defect == 'failed-case':
                    rows[0]['status'] = 'failed'
                    rows[0]['exitCode'] = 1
                elif defect == 'missing-junit':
                    (target / 'junit.xml').unlink()
                elif defect == 'missing-fixture':
                    (target / 'native-ui-receipt.json').unlink()
                elif defect in ['wrong-fixture', 'client-error']:
                    path = target / 'native-ui-receipt.json'
                    receipt = json.loads(path.read_text())
                    if defect == 'wrong-fixture':
                        receipt['audit']['caseId'] = 'not-this-case'
                    else:
                        receipt['audit']['diagnostics'] = [{'unitFixture': True}]
                    path.write_text(json.dumps(receipt))
                elif defect == 'missing-timing':
                    (target / 'native-ui-navigation-timing.json').unlink()
                elif defect == 'receipt-size':
                    rows[0]['collection'][0]['bytes'] += 1
                elif defect == 'missing-capture':
                    shutil.rmtree(target / 'maestro')
                CONSUMER.write_json(output / 'results.json', rows)
                CONSUMER.write_json(output / 'summary.json', summary)
                result = CONSUMER.account_results(output, CASES, RUNNER)
                self.assertEqual(result['allOriginalSocialCasesPassed'], defect is None)
                self.assertFalse(result['allControlsAccepted'])
                self.assertFalse(result['hostedBackendAcceptance'])
                self.assertFalse(result['physicalDeviceAcceptance'])
                if defect is None:
                    self.assertEqual((result['passed'], result['failed'], result['notExecuted']), (31, 0, 0))
                    self.assertEqual(len(result['originalFailedCasesRecovered']), 10)


if __name__ == '__main__':
    unittest.main(verbosity=2)
