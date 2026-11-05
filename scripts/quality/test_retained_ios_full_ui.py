import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('ios_retained', Path(__file__).with_name('retained-ios-full-ui.py'))
ios = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ios)
handoff = ios.load_module('handoff', Path(__file__).with_name('retained-ios-handoff.py'))


class HandoffReceiptChecks(unittest.TestCase):
    def receipt(self):
        rows = [{'phase': 'received', 'matched': True}, {'phase': 'parsed', 'matched': True, 'expectedPath': True},
                {'phase': 'action-produced', 'matched': True}, {'phase': 'mounted'}, {'phase': 'readback-start'},
                {'phase': 'readback-complete', 'fulfilled': True, 'passed': True}]
        return {'mode': 'synthetic-native-ui', 'networkForwarded': False, 'captureBoundaryDropped': 0,
                'captureBoundaries': [dict(row, sequence=index + 1) for index, row in enumerate(rows)]}

    def test_new_completed_entry_is_ready(self):
        self.assertTrue(handoff.ready(self.receipt(), 0))

    def test_prior_entry_is_not_a_new_handoff(self):
        self.assertFalse(handoff.ready(self.receipt(), 6))

    def test_failed_readback_is_not_ready(self):
        value = self.receipt(); value['captureBoundaries'][-1]['passed'] = False
        self.assertFalse(handoff.ready(value, 0))

    def test_unmatched_url_is_not_ready(self):
        value = self.receipt(); value['captureBoundaries'][0]['matched'] = False
        self.assertFalse(handoff.ready(value, 0))

    def test_dropped_or_corrupt_events_are_rejected(self):
        value = self.receipt(); value['captureBoundaryDropped'] = 1
        with self.assertRaises(ValueError): handoff.ready(value, 0)
        value = self.receipt(); value['captureBoundaries'][2]['sequence'] = 99
        with self.assertRaises(ValueError): handoff.ready(value, 0)


class RetainedIOSChecks(unittest.TestCase):
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
        self.tar = self.folder / 'qa.app.tar.gz'
        with tarfile.open(self.tar, 'w:gz') as bundle:
            info = tarfile.TarInfo('PlatinumQA.app/main.jsbundle')
            info.size = 3
            bundle.addfile(info, io.BytesIO(b'app'))
        self.config = {'schemaVersion': 1, 'kind': 'retained-ios-full-ui',
                       'applicationSourceCommit': 'a' * 40, 'applicationSourceTree': 'b' * 40,
                       'producerRunId': 123, 'sourceTools': {}, 'rebuild': False, 'rebundle': False, 'resign': False,
                       'appArchiveSha256': ios.digest(self.tar), 'appArchiveBytes': self.tar.stat().st_size,
                       'binarySha256': 'c' * 64}
        self.source = {'commit': 'a' * 40, 'workflowRun': '123', 'mode': 'normal full app',
                       'hashes': {'App.tsx': ios.digest(self.app / 'App.tsx')},
                       'overlays': [{'file': 'App.tsx', 'before': ios.digest(self.app / 'App.tsx'),
                                     'retained': 'overlays/App.tsx', 'after': ios.digest(self.archive / 'overlays/App.tsx')}]}
        self.manifest = {'schemaVersion': 1, 'kind': 'disposable-native-full-app', 'configuration': 'Release',
                         'applicationSourceCommit': 'a' * 40, 'applicationSourceTree': 'b' * 40,
                         'platform': 'ios', 'packageId': ios.PACKAGE, 'binaryName': 'PlatinumQA.app',
                         'binarySha256': 'c' * 64, 'testOnly': True, 'userDistributionPermitted': False,
                         'rebuildPerCase': False, 'resignOrRebundlePermitted': False,
                         'fixtureMode': 'normal full app', 'fixtureHashes': {},
                         'nativeCompatibility': {'targetId': 'arm64-ios26.2', 'abi': 'arm64',
                             'runtimeIdentifier': 'com.apple.CoreSimulator.SimRuntime.iOS-26-2',
                             'deviceTypeIdentifier': 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', 'platform': 'iphonesimulator'}}
        self.write_metadata()

    def write_metadata(self):
        for path in [self.folder / 'source.json', self.archive / 'source.json']:
            path.write_text(json.dumps(self.source))
        self.config['sourceReceiptSha256'] = ios.digest(self.folder / 'source.json')
        self.manifest['sourceReceiptSha256'] = self.config['sourceReceiptSha256']
        (self.folder / 'binary-manifest.json').write_text(json.dumps(self.manifest))
        self.config['binaryManifestSha256'] = ios.digest(self.folder / 'binary-manifest.json')

    def verify(self):
        return ios.verify_source(self.app, self.archive, self.config)

    def test_exact_source_and_archive_pass(self):
        self.assertEqual(self.verify()[0]['platform'], 'ios')

    def test_changed_source_is_rejected(self):
        (self.app / 'App.tsx').write_text('changed')
        with self.assertRaises(ValueError): self.verify()

    def test_changed_archive_is_rejected(self):
        with self.tar.open('ab') as stream: stream.write(b'changed')
        with self.assertRaises(ValueError): self.verify()

    def test_other_binary_platform_is_rejected(self):
        self.manifest['platform'] = 'android'; self.write_metadata()
        with self.assertRaises(ValueError): self.verify()

    def test_other_native_target_is_rejected(self):
        self.manifest['nativeCompatibility']['abi'] = 'x86_64'; self.write_metadata()
        with self.assertRaises(ValueError): self.verify()

    def test_other_producer_is_rejected(self):
        self.source['workflowRun'] = '456'; self.write_metadata()
        with self.assertRaises(ValueError): self.verify()

    def test_resigning_permission_is_rejected(self):
        self.config['resign'] = True
        with self.assertRaises(ValueError): self.verify()

    def test_valid_app_extracts_without_rewriting_files(self):
        app = ios.extract_app(self.tar, self.app / 'extracted')
        self.assertEqual((app / 'main.jsbundle').read_bytes(), b'app')

    def test_archive_cannot_escape_app_directory(self):
        for index, name in enumerate(['../outside', '/absolute', 'Another.app/binary']):
            with tarfile.open(self.tar, 'w:gz') as bundle:
                info = tarfile.TarInfo(name); info.size = 3
                bundle.addfile(info, io.BytesIO(b'bad'))
            with self.assertRaises(ValueError): ios.extract_app(self.tar, self.app / str(index))

    def test_archive_symlink_cannot_escape_extraction_directory(self):
        with tarfile.open(self.tar, 'w:gz') as bundle:
            info = tarfile.TarInfo('PlatinumQA.app/link'); info.type = tarfile.SYMTYPE; info.linkname = '../../outside'
            bundle.addfile(info)
        with self.assertRaises(tarfile.FilterError): ios.extract_app(self.tar, self.app / 'escaped')


if __name__ == '__main__':
    unittest.main()
