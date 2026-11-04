const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('retained full-app binaries require exact fixture and overlay provenance', () => {
  const result = spawnSync('python3', ['-B', '-c', String.raw`
import copy, hashlib, importlib.util, os, pathlib, tempfile, unittest
module_path = pathlib.Path('scripts/quality/native-ui-audit-binary.py').resolve()
spec = importlib.util.spec_from_file_location('binary_manifest', module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Provenance(unittest.TestCase):
    def setUp(self):
        self.previous = pathlib.Path.cwd()
        self.directory = tempfile.TemporaryDirectory()
        os.chdir(self.directory.name)
        self.receipt = pathlib.Path('native-ui-logs/source.json')
        self.receipt.parent.mkdir()
        names = ['App.tsx', 'package.json', 'package-lock.json', 'app.config.js',
                 'tests/native/entry.js', 'tests/native/backend-fixture.cjs',
                 'tests/native/flows/navigation.yaml', 'tests/native/flows/feed-video.yaml']
        hashes = {}
        for name in names:
            path = pathlib.Path(name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('reviewed fixture: ' + name)
            hashes[name] = module.runner.sha256_file(path)
        pathlib.Path('index.js').write_text('synthetic entry overlay')
        retained = self.receipt.parent / 'overlays/index.js'
        retained.parent.mkdir()
        retained.write_bytes(pathlib.Path('index.js').read_bytes())
        self.source = {'commit': 'a' * 40,
            'mode': 'Complete production App and screens with isolated synthetic transports and a CI-only capture route',
            'hashes': hashes, 'overlays': [{'file': 'index.js', 'retained': 'overlays/index.js',
                'after': module.runner.sha256_file(retained)}]}
    def tearDown(self):
        os.chdir(self.previous)
        self.directory.cleanup()
    def validate(self, source=None, commit='a' * 40):
        return module.source_provenance(source or self.source, commit,
            'disposable-native-full-app', self.receipt)
    def test_valid_provenance_is_explicitly_test_only(self):
        value = self.validate()
        self.assertTrue(value['testOnly'])
        self.assertFalse(value['userDistributionPermitted'])
        self.assertEqual(len(value['fixtureHashes']), 4)
        self.assertEqual(value['producerScriptSha256'], module.runner.sha256_file(module_path))
    def test_changed_fixture_is_rejected(self):
        pathlib.Path('tests/native/backend-fixture.cjs').write_text('different transport')
        with self.assertRaisesRegex(ValueError, 'fixture changed'):
            self.validate()
    def test_changed_overlay_or_retained_copy_is_rejected(self):
        for path in [pathlib.Path('index.js'), self.receipt.parent / 'overlays/index.js']:
            original = path.read_bytes()
            path.write_text('changed overlay')
            with self.assertRaisesRegex(ValueError, 'overlay changed'):
                self.validate()
            path.write_bytes(original)
    def test_wrong_source_or_fixture_mode_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'declared source'):
            self.validate(commit='b' * 40)
        for changed in [dict(self.source, audit={}), dict(self.source, mode='production')]:
            with self.assertRaisesRegex(ValueError, 'synthetic full-app'):
                self.validate(changed)
    def test_missing_hash_or_overlay_is_rejected(self):
        changed = copy.deepcopy(self.source)
        del changed['hashes']['App.tsx']
        with self.assertRaisesRegex(ValueError, 'source hashes'):
            self.validate(changed)
        with self.assertRaisesRegex(ValueError, 'explicit full-app overlays'):
            self.validate(dict(self.source, overlays=[]))

unittest.main()
`], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const platform of ['android', 'ios']) {
  for (const failure of ['none', 'manifest', 'binary']) {
    test(`${platform} retention ${failure} preserves device execution and the final acceptance result`, () => {
      const script = fs.readFileSync(`scripts/quality/test-${platform}-app-ui.sh`, 'utf8');
      const start = script.indexOf('binary_retention_status=0');
      const end = script.indexOf(platform === 'android' ? "printf 'no\\n'" : 'runtime=', start);
      assert.ok(start > 0 && end > start);
      const retention = script.slice(start, end);
      const finalGate = script.slice(script.indexOf('cat > native-ui-logs/phase-results.json'));
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-retention-'));
      const binaryFailure = failure !== 'binary' ? '' : platform === 'ios'
        ? 'tar() { return 45; }'
        : 'cp() { if [[ "$1" == "$apk" ]]; then return 46; fi; command cp "$@"; }';
      try {
        const result = spawnSync('bash', ['-c', `set -euo pipefail
mkdir -p native-ui-logs Fixture.app
printf '{}' > native-ui-logs/source.json
printf 'synthetic APK' > app.apk
printf 'synthetic Simulator executable' > Fixture.app/binary
apk="$PWD/app.apk"
app="$PWD/Fixture.app"
ios_target=intel-ios18.5
GITHUB_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
git() { printf 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\n'; }
python3() {
  printf '{}' > native-ui-logs/test-only-binary/binary-manifest.pending.json
  return ${failure === 'manifest' ? 44 : 0}
}
${binaryFailure}
${retention}
printf 'device execution reached' > device-flow-reached
flow_status=0
evidence_status=0
memory_status=0
verification_status=0
${finalGate}`], { cwd: directory, encoding: 'utf8' });
        assert.equal(result.status, failure === 'none' ? 0 : 1, result.stdout + result.stderr);
        assert.ok(fs.existsSync(path.join(directory, 'device-flow-reached')));
        const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'native-ui-logs/phase-results.json')));
        assert.equal(receipt.binaryRetention === 0, failure === 'none');
        assert.equal(fs.existsSync(path.join(directory, 'native-ui-logs/test-only-binary/binary-manifest.json')), failure === 'none');
        if (failure === 'manifest') {
          assert.ok(fs.statSync(path.join(directory, 'native-ui-logs/test-only-binary',
            platform === 'android' ? 'app-release.apk' : 'qa.app.tar.gz')).size > 0);
        }
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  }
}
