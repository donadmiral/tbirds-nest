import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('retained', Path(__file__).with_name('retained-android-full-ui.py'))
retained = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retained)


class RetainedBinaryChecks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.app, self.archive = root / 'app', root / 'archive'
        self.app.mkdir()
        self.folder = self.archive / 'test-only-binary'
        self.folder.mkdir(parents=True)
        (self.archive / 'overlays').mkdir()
        (self.app / 'App.tsx').write_text('original app')
        (self.archive / 'overlays/App.tsx').write_text('observed app')
        self.config = {'schemaVersion': 1, 'kind': 'retained-android-full-ui',
                       'applicationSourceCommit': 'a' * 40, 'applicationSourceTree': 'b' * 40,
                       'producerRunId': 123, 'rebuild': False, 'rebundle': False, 'resign': False}
        with zipfile.ZipFile(self.folder / 'app-release.apk', 'w') as archive:
            archive.writestr('assets/index.android.bundle', 'app' * 40000)
            archive.writestr('lib/x86_64/test.so', 'native')
        self.config['binarySha256'] = retained.digest(self.folder / 'app-release.apk')
        self.source = {'commit': 'a' * 40, 'workflowRun': '123', 'mode': 'normal full app',
                       'hashes': {'App.tsx': retained.digest(self.app / 'App.tsx')},
                       'overlays': [{'file': 'App.tsx', 'before': retained.digest(self.app / 'App.tsx'),
                                     'retained': 'overlays/App.tsx',
                                     'after': retained.digest(self.archive / 'overlays/App.tsx')}]}
        self.manifest = {'schemaVersion': 1, 'kind': 'disposable-native-full-app', 'configuration': 'Release',
                         'applicationSourceCommit': 'a' * 40, 'applicationSourceTree': 'b' * 40,
                         'platform': 'android', 'packageId': retained.PACKAGE, 'binaryName': 'app-release.apk',
                         'binarySha256': self.config['binarySha256'], 'testOnly': True,
                         'userDistributionPermitted': False, 'rebuildPerCase': False,
                         'resignOrRebundlePermitted': False, 'fixtureMode': 'normal full app', 'fixtureHashes': {},
                         'nativeCompatibility': {'abi': 'x86_64', 'api': '35', 'image': 'system-images;android-35;default;x86_64'}}
        self.write_metadata()

    def write_metadata(self):
        for path in [self.folder / 'source.json', self.archive / 'source.json']:
            path.write_text(json.dumps(self.source))
        self.config['sourceReceiptSha256'] = retained.digest(self.folder / 'source.json')
        self.manifest['sourceReceiptSha256'] = self.config['sourceReceiptSha256']
        (self.folder / 'binary-manifest.json').write_text(json.dumps(self.manifest))
        self.config['binaryManifestSha256'] = retained.digest(self.folder / 'binary-manifest.json')

    def verify(self):
        return retained.verify_retained(self.app, self.archive, self.config)

    def test_exact_retained_binary_and_source_pass(self):
        self.assertEqual(self.verify()[0]['binarySha256'], self.config['binarySha256'])

    def test_changed_binary_is_rejected(self):
        with (self.folder / 'app-release.apk').open('ab') as stream:
            stream.write(b'changed')
        with self.assertRaisesRegex(ValueError, 'Pinned file mismatch'):
            self.verify()

    def test_changed_runtime_source_is_rejected(self):
        (self.app / 'App.tsx').write_text('new app')
        with self.assertRaisesRegex(ValueError, 'Pinned file mismatch'):
            self.verify()

    def test_changed_observation_overlay_is_rejected(self):
        (self.archive / 'overlays/App.tsx').write_text('changed observer')
        with self.assertRaisesRegex(ValueError, 'Pinned file mismatch'):
            self.verify()

    def test_audit_binary_cannot_replace_full_app_binary(self):
        self.manifest['kind'] = 'disposable-native-audit'
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, 'Wrong retained binary provenance'):
            self.verify()

    def test_other_producer_run_is_rejected(self):
        self.source['workflowRun'] = '456'
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, 'Wrong binary producer identity'):
            self.verify()

    def test_different_fixture_hashes_are_rejected(self):
        self.manifest['fixtureHashes'] = {'tests/native/entry.js': 'not the original'}
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, 'Incomplete retained source hashes'):
            self.verify()

    def test_unsafe_source_path_is_rejected(self):
        self.source['hashes'] = {'../outside': 'c' * 64}
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, 'Unsafe retained path'):
            self.verify()

    def test_rebuild_permission_is_rejected(self):
        self.config['rebuild'] = True
        with self.assertRaisesRegex(ValueError, 'cannot build or modify'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
