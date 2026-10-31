const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');

test('native feature shards cover every declared group once and consume one platform build', () => {
  const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/native-product-audit.yml'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tests/native/audit/manifest.json'), 'utf8'));
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.deepEqual(workflow.on.push.branches, ['codex/native-v6-followup-20261031']);
  for (const platform of ['ios', 'android']) {
    const build = workflow.jobs[platform + '-build'], consume = workflow.jobs[platform + '-cases'];
    assert.equal(build.env.PLATINUM_NATIVE_AUDIT_BUILD_ONLY, '1');
    assert.equal(consume.needs, platform + '-build');
    assert.equal(consume.strategy['fail-fast'], false);
    const groups = consume.strategy.matrix.include.flatMap(item => item.groups.split(','));
    assert.equal(groups.length, new Set(groups).size, 'a group must not run twice and inflate coverage');
    assert.deepEqual([...groups].sort(), [...manifest.groups].sort());
    assert.equal(consume.steps.find(item => item.uses?.startsWith('actions/download-artifact@')).with.name, 'native-audit-' + platform + '-binary');
    assert.ok(consume.steps.some(item => item.run === 'bash scripts/quality/run-native-ui-audit-device.sh ' + platform + ' "$AUDIT_GROUPS"'));
    assert.equal(consume.steps.some(item => /test-(ios|android)-app-ui|expo prebuild|xcodebuild|gradlew/.test(item.run || '')), false, 'consumers cannot rebuild');
    assert.ok(consume.steps.some(item => item.if === 'always()' && item.uses?.startsWith('actions/upload-artifact@')));
  }
});

test('actual coverage collector rejects absent, failed, duplicate and wrong-source results', () => {
  const script = `import importlib.util,json,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('summary', ${JSON.stringify(path.join(root, 'scripts/quality/native-ui-audit-summary.py'))})
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
manifest={'cases':[{'id':'a'},{'id':'b'}]};source='a'*40
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp)
 def report(platform,shard,rows,commit=source):
  folder=root/('native-audit-'+platform+'-'+shard+'-results')/'native-audit-results';folder.mkdir(parents=True,exist_ok=True)
  (folder/'summary.json').write_text(json.dumps({'applicationSourceCommit':commit,'platform':platform}))
  (folder/'results.json').write_text(json.dumps(rows))
 missing=module.summarize(root,manifest,source)
 assert missing['platforms']['ios']['notExecuted']==2 and not missing['allDeclaredCasesPassed']
 for platform in ['ios','android']:report(platform,'one',[{'id':'a','status':'passed'},{'id':'b','status':'passed'}])
 complete=module.summarize(root,manifest,source);assert complete['allDeclaredCasesPassed'] and not complete['allControlsAccepted']
 report('ios','one',[{'id':'a','status':'passed'},{'id':'b','status':'failed'}])
 failed=module.summarize(root,manifest,source);assert failed['platforms']['ios']['failed']==1 and not failed['allDeclaredCasesPassed']
 report('ios','two',[{'id':'a','status':'passed'}]);assert module.summarize(root,manifest,source)['issues']
 report('ios','one',[{'id':'a','status':'passed'}], 'b'*40);assert not module.summarize(root,manifest,source)['allDeclaredCasesPassed']
print('missing,complete,failed,duplicate,wrong-source checked')
`;
  const output = execFileSync('python3', ['-c', script], { cwd: root, encoding: 'utf8' });
  assert.match(output, /wrong-source checked/);
});

test('all native audit shell paths parse and keep the original independent full UI gates', () => {
  for (const file of ['test-ios-app-ui.sh', 'test-android-app-ui.sh', 'run-native-ui-audit-device.sh']) {
    execFileSync('bash', ['-n', path.join(root, 'scripts/quality', file)]);
  }
  for (const platform of ['ios', 'android']) {
    const script = fs.readFileSync(path.join(root, 'scripts/quality', 'test-' + platform + '-app-ui.sh'), 'utf8');
    assert.match(script, /PLATINUM_NATIVE_AUDIT_BUILD_ONLY:-0/);
    assert.match(script, /run-native-ui-flows\.sh/);
    assert.match(script, /verify-native-ui-memory\.py/);
    assert.match(script, /verify-native-ui\.cjs/);
    assert.match(script, /native-ui-audit-binary\.py/);
  }
});

test('actual Android SDK setup finds its own adb even when platform-tools is absent from PATH', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/quality/run-native-ui-audit-device.sh'), 'utf8');
  const start = source.indexOf('  android_sdk='), end = source.indexOf('  export ANDROID_AVD_HOME=', start);
  assert(start > 0 && end > start, 'the executed setup must be extracted from the real consumer');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native audit sdk-'));
  try {
    const sdk = path.join(directory, 'sdk with spaces');
    for (const file of ['cmdline-tools/latest/bin/sdkmanager', 'cmdline-tools/latest/bin/avdmanager', 'platform-tools/adb']) {
      const target = path.join(sdk, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.endsWith('/adb') ? '#!/bin/sh\n[ "$1" = version ] || exit 42\nprintf "Android Debug Bridge fixture\\n"\n' : '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    fs.mkdirSync(path.join(directory, 'native-ui-logs'));
    const block = source.slice(start, end);
    execFileSync('bash', ['-euc', block], { cwd: directory, env: { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: '' } });
    assert.match(fs.readFileSync(path.join(directory, 'native-ui-logs/android-platform-tools.log'), 'utf8'), /Android Debug Bridge fixture/);
    assert.throws(() => execFileSync('bash', ['-euc', block], { cwd: directory, env: { ...process.env, ANDROID_HOME: '', ANDROID_SDK_ROOT: '' }, stdio: 'pipe' }), error => error.status === 2 && /requires an installed Android SDK/.test(String(error.stderr)));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
