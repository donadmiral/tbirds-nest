import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('retained_ios', ROOT / 'scripts/quality/native-ui-ios-full-app-recovery.py')
RECOVERY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RECOVERY)


class RetainedIosTests(unittest.TestCase):
    def runner(self):
        return RECOVERY.generate_runner(
            (ROOT / 'scripts/quality/test-ios-app-ui.sh').read_text(),
            Path('/tmp/retained app/PlatinumQA.app'),
            ROOT / 'scripts/quality/native-ui-ios-full-app-recovery.py')

    def test_full_original_acceptance_tail_is_identical(self):
        original = (ROOT / 'scripts/quality/test-ios-app-ui.sh').read_text()
        generated = self.runner()
        self.assertEqual(generated[generated.index('flow_status=0\n'):],
                         original[original.index('flow_status=0\n'):])
        for required in ['run-native-ui-flows.sh', 'verify-native-ui-memory.py',
                         'verify-native-ui.cjs', 'native-ui-ios-input-diagnostics.jsonl']:
            self.assertIn(required, generated)

    def test_original_runner_change_fails_closed(self):
        original = (ROOT / 'scripts/quality/test-ios-app-ui.sh').read_text()
        with self.assertRaisesRegex(ValueError, 'Original runner changed'):
            RECOVERY.generate_runner(original + '\n', Path('/app'), Path('/helper'))

    def test_no_rebuild_rebundle_or_resign(self):
        generated = self.runner()
        for forbidden in ['expo prebuild', 'pod _', 'xcodebuild -workspace',
                          'codesign --force', 'prepare-native-ui.cjs', 'prepare-native-ui-audit.cjs']:
            self.assertNotIn(forbidden, generated)
        self.assertIn(' immutable --app "$app"', generated)
        self.assertIn(' install --app "$app" --device "$ui_simulator"', generated)
        self.assertIn('--immutable-preflight native-ui-logs/immutable-preflight.json', generated)
        self.assertIn('--cleanup-device "$ui_simulator"', generated)

    def test_generated_shell_parses_with_quoted_paths(self):
        subprocess.run(['bash', '-n'], input=self.runner(), text=True, check=True)

    def test_retained_paths_reject_traversal_and_symlinks(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'original').write_text('original')
            (root / 'linked').symlink_to(root / 'original')
            for path in ['../outside', '/absolute', 'linked', 'missing']:
                with self.assertRaises(ValueError):
                    RECOVERY.safe(root, path)
            self.assertEqual(RECOVERY.safe(root, 'original'), root / 'original')

    def test_changed_bytes_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'bytes'
            path.write_text('original')
            original = RECOVERY.digest(path)
            RECOVERY.checked(path, original)
            path.write_text('changed')
            with self.assertRaisesRegex(ValueError, 'Pinned identity mismatch'):
                RECOVERY.checked(path, original)

    def test_changed_app_bytes_fail_before_setup(self):
        with tempfile.TemporaryDirectory() as folder:
            app = Path(folder) / 'PlatinumQA.app'
            app.mkdir()
            (app / 'main.jsbundle').write_text('compiled original')
            original = RECOVERY.module(ROOT, 'native-ui-audit-runner.py').binary_digest(app)
            with mock.patch.object(RECOVERY, 'BINARY_SHA', original):
                RECOVERY.verify_app(ROOT, app)
                (app / 'main.jsbundle').write_text('changed app')
                with self.assertRaisesRegex(ValueError, 'Signed bundle bytes differ'):
                    RECOVERY.verify_app(ROOT, app)

    def test_changed_flow_fails_before_extract_or_install(self):
        with tempfile.TemporaryDirectory() as folder:
            consumer = Path(folder)
            flow = consumer / RECOVERY.FLOW
            flow.parent.mkdir(parents=True)
            flow.write_text('unreviewed flow')
            output = consumer / 'no-output'
            with mock.patch.object(RECOVERY, 'validate', return_value=(None, {}, {})):
                with self.assertRaisesRegex(ValueError, 'Pinned identity mismatch'):
                    RECOVERY.prepare(ROOT, consumer, consumer, output)
            self.assertFalse(output.exists())

    def test_only_owned_push_branch_and_no_compile_job(self):
        workflow = (ROOT / '.github/workflows/native-ios-prompt-recovery.yml').read_text()
        self.assertIn("branches: ['codex/live-ios-prompt-recovery-20261104']", workflow)
        self.assertNotIn('pull_request:', workflow)
        self.assertIn('runs-on: macos-26', workflow)
        self.assertIn('timeout-minutes: 30', workflow)
        self.assertIn("artifact-ids: '13359603305'", workflow)
        self.assertIn('ref: ' + RECOVERY.SOURCE, workflow)
        self.assertIn('fetch-depth: 2', workflow)
        self.assertNotIn('test-ios-app-ui.sh', workflow)
        self.assertNotIn('build-live-qa', workflow)


if __name__ == '__main__':
    unittest.main()
