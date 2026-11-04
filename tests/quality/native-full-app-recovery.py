import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('recovery', ROOT / 'scripts/quality/native-ui-full-app-recovery.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Recovery(unittest.TestCase):
    def test_derivation_preserves_every_flow_and_verifier_byte(self):
        original = (ROOT / 'scripts/quality/test-android-app-ui.sh').read_text()
        result = m.generate_runner(original, Path('/retained/app-release.apk'), Path('/consumer/helper.py'))
        self.assertEqual(original[original.index('flow_status=0\n'):], result[result.index('flow_status=0\n'):])
        for command in ['expo prebuild', 'gradlew', 'prepare-native-ui', 'prepare-native-ui-audit']:
            self.assertNotIn(command, result)
        for command in ['native-ui-xvfb-readiness.py', 'native-ui-emulator-graphics.py host',
                        'native-ui-emulator-graphics.py emulator', 'run-native-ui-flows.sh',
                        'verify-native-ui-memory.py', 'verify-native-ui.cjs android']:
            self.assertIn(command, result)
        subprocess.run(['bash', '-n'], input=result, text=True, check=True)
        navigation = (ROOT / 'tests/native/flows/navigation.yaml').read_text()
        self.assertIn('feed-video.yaml', navigation)
        self.assertIn('live-immersive.yaml', navigation)

    def test_changed_original_runner_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Original runner changed'):
            m.generate_runner('different', Path('/a'), Path('/b'))

    def simulate(self, root_results, clock=None):
        calls = []
        def execute(args, **kwargs):
            self.assertGreater(kwargs['timeout'], 0)
            self.assertLessEqual(kwargs['timeout'], 20)
            self.assertEqual(args[:3], ['/sdk/adb', '-s', 'emulator-5556'])
            cmd = args[3:]
            calls.append(cmd)
            if cmd == ['root']:
                code, out = root_results.pop(0)
            elif cmd[-1] == 'ro.kernel.qemu': code, out = 0, '1'
            elif cmd[-1] == 'ro.product.cpu.abi': code, out = 0, 'x86_64'
            elif cmd[-1] == 'ro.build.version.sdk': code, out = 0, '35'
            elif cmd == ['shell', 'id', '-u']: code, out = 0, '0'
            else: code, out = 0, ''
            return subprocess.CompletedProcess(args, code, out, '')
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'CI':'true','EXPO_PUBLIC_APP_ENV':'qa'}):
            output = Path(directory) / 'root.json'
            try:
                m.root_device('/sdk/adb', output, execute=execute, **({'clock':clock} if clock else {}))
            finally:
                self.last_receipt = __import__('json').loads(output.read_text())
                self.last_calls = calls
        return calls

    def test_root_success_never_reconnects(self):
        calls = self.simulate([(0, 'restarting adbd as root')])
        self.assertNotIn(['reconnect'], calls)
        self.assertTrue(self.last_receipt['success'])

    def test_closed_transport_gets_one_targeted_reconnect(self):
        calls = self.simulate([(1, 'unable to connect for root: closed'), (0, '')])
        self.assertEqual(calls.count(['root']), 2)
        self.assertEqual(calls.count(['reconnect']), 1)
        self.assertTrue(self.last_receipt['success'])

    def test_non_transient_failure_does_not_retry(self):
        with self.assertRaisesRegex(ValueError, 'Non-transient'):
            self.simulate([(1, 'adbd cannot run as root in production builds')])
        self.assertEqual(self.last_calls.count(['root']), 1)
        self.assertNotIn(['reconnect'], self.last_calls)
        self.assertFalse(self.last_receipt['success'])

    def test_second_transport_failure_is_terminal(self):
        with self.assertRaisesRegex(ValueError, 'Root recovery failed'):
            self.simulate([(1, 'closed'), (1, 'offline')])
        self.assertEqual(self.last_calls.count(['root']), 2)
        self.assertEqual(self.last_calls.count(['reconnect']), 1)

    def test_shared_deadline_is_terminal(self):
        ticks = iter([0, 61])
        with self.assertRaisesRegex(ValueError, 'deadline exhausted'):
            self.simulate([], clock=lambda: next(ticks))
        self.assertFalse(self.last_receipt['success'])

    def test_checked_file_rejects_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'x'
            path.write_text('valid')
            expected = hashlib.sha256(b'valid').hexdigest()
            m.checked(path, expected)
            path.write_text('changed')
            with self.assertRaisesRegex(ValueError, 'identity mismatch'):
                m.checked(path, expected)
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                m.safe(Path(directory), '../outside')

if __name__ == '__main__':
    unittest.main()
