import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('retained_save', ROOT / 'scripts/quality/native-ui-android-save-recovery.py')
RECOVERY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RECOVERY)
CONFIG = json.loads(RECOVERY.CONFIG.read_text())
MANIFEST = json.loads((ROOT / 'tests/native/audit/manifest.json').read_text())


class RetainedSaveChecks(unittest.TestCase):
    def test_pinned_producer_and_selected_case_are_exact(self):
        self.assertEqual(CONFIG['applicationSourceCommit'], 'd46c50f09164c75c7fe8cdba0c3470c272b1ab4e')
        self.assertEqual(CONFIG['artifactId'], 13055287858)
        self.assertEqual(CONFIG['producerRunId'], 41235679679)
        self.assertEqual(CONFIG['binarySha256'], '9897c6328030bde3bf2bdbf4553012f5431362d4f7a0e53960821301daa14298')
        case = RECOVERY.select_case(MANIFEST, CONFIG)
        self.assertEqual(case['id'], 'memory-cover-settings')
        self.assertEqual(case['flow'], 'flows/retained-memory-cover-settings.yaml')
        self.assertEqual(case['name'], 'Retained Android book save and readback')
        self.assertEqual(sum(item['id'] == case['id'] for item in MANIFEST['cases']), 1)

    def test_case_scope_drift_is_rejected(self):
        for field, value in [('kind', 'entry-smoke'), ('group', 'profile'), ('fixtureScenario', 'other')]:
            changed = copy.deepcopy(MANIFEST)
            next(item for item in changed['cases'] if item['id'] == CONFIG['caseId'])[field] = value
            with self.assertRaisesRegex(ValueError, 'scope changed'):
                RECOVERY.select_case(changed, CONFIG)
        changed = copy.deepcopy(MANIFEST)
        next(item for item in changed['cases'] if item['id'] == CONFIG['caseId'])['state']['routes'][0]['params']['ownerId'] = 'other'
        with self.assertRaises(ValueError):
            RECOVERY.select_case(changed, CONFIG)

    def test_consumer_flow_and_gate_are_hash_bound(self):
        RECOVERY.checked(RECOVERY.GATE, CONFIG['receiptGateSha256'])
        RECOVERY.checked(ROOT / CONFIG['diagnosticFlow'], CONFIG['diagnosticFlowSha256'])
        with tempfile.TemporaryDirectory() as directory:
            value = Path(directory) / 'value'
            value.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'identity mismatch'):
                RECOVERY.checked(value, CONFIG['binarySha256'])
            link = Path(directory) / 'link'
            link.symlink_to(value)
            with self.assertRaises(ValueError):
                RECOVERY.checked(link, RECOVERY.digest(value))

    def test_installed_identity_reads_only_one_exact_base_apk(self):
        with patch.object(RECOVERY, 'read_command', return_value='package:/data/app/~~ABC=/app.platinumcircles.mobile.qa-123=/base.apk'), \
                patch.object(RECOVERY.subprocess, 'check_output', return_value=b'retained') as read:
            self.assertEqual(RECOVERY.installed_digest('emulator-5556', CONFIG['packageId']), hashlib.sha256(b'retained').hexdigest())
            self.assertEqual(read.call_args.args[0][-1], '/data/app/~~ABC=/app.platinumcircles.mobile.qa-123=/base.apk')
        for bad in ['package:/data/app/one/base.apk\npackage:/data/app/two/base.apk', '/data/app/one/base.apk', 'package:/elsewhere/private']:
            with patch.object(RECOVERY, 'read_command', return_value=bad), self.assertRaises(ValueError):
                RECOVERY.installed_digest('emulator-5556', CONFIG['packageId'])

    def exercise_run(self, status='passed', changed=False, wrong_installed=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'results'
            output.mkdir()
            binary = root / 'app-release.apk'
            binary.write_bytes(b'exact retained apk')
            config = {**CONFIG, 'binarySha256': RECOVERY.digest(binary)}
            case = RECOVERY.select_case(MANIFEST, CONFIG)
            calls = []
            def execute(cases, platform, device, target):
                calls.append((cases, platform, device))
                if changed:
                    binary.write_bytes(b'replaced after install')
                return [{'id': cases[0]['id'], 'status': status}]
            gate = types.SimpleNamespace(validate_device=lambda *args: None, run_cases=execute)
            metadata = {'nativeCompatibility': {'abi': 'x86_64', 'api': '35'}, 'toolchain': {'java': '17'}}
            with patch.object(RECOVERY, 'preflight', return_value=(config, binary, metadata, case, gate)), \
                    patch.object(RECOVERY, 'installed_digest', return_value='wrong' if wrong_installed else config['binarySha256']), \
                    patch.object(RECOVERY.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0)):
                if wrong_installed:
                    with self.assertRaisesRegex(ValueError, 'Installed APK bytes differ'):
                        RECOVERY.run(root, output, 'emulator-5556')
                    self.assertEqual(calls, [])
                    return
                result = RECOVERY.run(root, output, 'emulator-5556')
            summary = json.loads((output / 'summary.json').read_text())
            self.assertEqual(len(calls), 1)
            self.assertEqual(len(calls[0][0]), 1)
            self.assertEqual(calls[0][0][0]['id'], 'memory-cover-settings')
            self.assertFalse(summary['currentApplicationRepairsIncluded'])
            self.assertFalse(summary['otherRepairsDeviceVerified'])
            self.assertFalse(summary['allControlsAccepted'])
            expected = status == 'passed' and not changed
            self.assertEqual(result, 0 if expected else 1)
            self.assertEqual(summary['passed'], int(expected))

    def test_success_executes_exactly_one_case_and_preserves_scope(self):
        self.exercise_run()

    def test_case_failure_or_binary_change_cannot_pass(self):
        self.exercise_run(status='failed')
        self.exercise_run(changed=True)

    def test_wrong_installed_binary_stops_before_any_case(self):
        self.exercise_run(wrong_installed=True)


if __name__ == '__main__':
    unittest.main()
