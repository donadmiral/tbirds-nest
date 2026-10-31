const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');

const file = '.github/workflows/native-audit-android-recovery.yml';
const workflow = YAML.parse(fs.readFileSync(file, 'utf8'));
const job = workflow.jobs['android-cases'];
const source = 'b568bd7b75bd25ad919afd8eac8d52300a5c3fcc';
const tree = '24c1a151d852ced19f2198980412922ec4c7a4ed';
const recovery = 'c'.repeat(40);
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const executeStep = job.steps.find(step => step.name === 'Run the unchanged baseline cases against the retained APK');
const provenance = job.steps.find(step => step.name === 'Record distinct recovery and application provenance').run;
const setup = job.steps.find(step => step.name === 'Prepare device tools and expose the installed SDK executables').run;

function temporary(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-native-audit-recovery-'));
  try { return callback(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('recovery consumes only the fixed prior binary and fixed test checkout across all three independent shards', () => {
  assert.deepEqual(workflow.on, { push: { branches: ['codex/native-audit-recovery-20261031'], paths: [file] } });
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.deepEqual(Object.keys(workflow.jobs), ['android-cases']);
  assert.equal(job['runs-on'], 'ubuntu-24.04'); assert.equal(job['timeout-minutes'], 100);
  assert.equal(job.strategy['fail-fast'], false);
  assert.deepEqual(job.strategy.matrix.include.map(value => value.groups), [
    'settings,stories,directories', 'support,auth,profile,business,memory', 'navigation,feed,market,jobs,messages',
  ]);
  const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, source); assert.equal(checkout.with['persist-credentials'], false);
  const download = job.steps.find(step => step.uses?.startsWith('actions/download-artifact@'));
  assert.deepEqual(download.with, { name: 'native-audit-android-binary', path: 'native-audit-binary', 'run-id': 41229206389, 'github-token': '${{ github.token }}' });
  assert.equal(executeStep.run, `GITHUB_SHA=${source} bash scripts/quality/run-native-ui-audit-device.sh android "$AUDIT_GROUPS"`);
  assert.equal(job.steps.some(step => /npm ci|expo prebuild|xcodebuild|gradlew|test-android-app-ui|codesign/.test(step.run || '')), false);
  assert.ok(job.steps.some(step => step.if === 'always()' && step.uses?.startsWith('actions/upload-artifact@') && step.with.path.includes('native-ui-logs/')));
});

test('all actual workflow shell steps parse and the baseline source override remains process scoped with failures preserved', () => {
  for (const step of job.steps.filter(step => step.run)) {
    const parsed = spawnSync('bash', ['-n', '-c', step.run], { encoding: 'utf8' });
    assert.equal(parsed.status, 0, parsed.stderr);
  }
  temporary(directory => {
    const helper = path.join(directory, 'scripts/quality/run-native-ui-audit-device.sh');
    fs.mkdirSync(path.dirname(helper), { recursive: true });
    fs.writeFileSync(helper, 'printf "%s\\n" "$GITHUB_SHA" "$1" "$2" > observed\nexit "${HELPER_EXIT:-0}"\n');
    const env = { ...process.env, GITHUB_SHA: recovery, AUDIT_GROUPS: 'support,auth', HELPER_EXIT: '0' };
    const result = spawnSync('bash', ['-eu', '-c', executeStep.run + '\nprintf "%s" "$GITHUB_SHA"'], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, recovery);
    assert.equal(fs.readFileSync(path.join(directory, 'observed'), 'utf8'), source + '\nandroid\nsupport,auth\n');
    const failed = spawnSync('bash', ['-eu', '-c', executeStep.run], { cwd: directory, env: { ...env, HELPER_EXIT: '17' }, encoding: 'utf8' });
    assert.equal(failed.status, 17, 'a failed baseline helper must fail the recovery shard');
  });
});

test('the actual setup prefix exposes the installed SDK adb to subsequent steps without relying on the initial PATH', () => {
  temporary(directory => {
    const sdk = path.join(directory, 'sdk'); fs.mkdirSync(path.join(sdk, 'platform-tools'), { recursive: true });
    fs.mkdirSync(path.join(sdk, 'emulator'));
    fs.writeFileSync(path.join(sdk, 'platform-tools/adb'), '#!/bin/sh\nprintf "baseline-sdk-adb\\n"\n', { mode: 0o755 });
    const env = { ...process.env, ANDROID_HOME: sdk, JAVA_HOME_17_X64: path.join(directory, 'java'), GITHUB_ENV: path.join(directory, 'env'), GITHUB_PATH: path.join(directory, 'path') };
    const prefix = setup.slice(0, setup.indexOf('sudo apt-get update'));
    const configured = spawnSync('bash', ['-eu', '-c', prefix], { env, encoding: 'utf8' }); assert.equal(configured.status, 0, configured.stderr);
    const paths = fs.readFileSync(env.GITHUB_PATH, 'utf8').trim().split('\n');
    assert.ok(paths.includes(path.join(sdk, 'platform-tools'))); assert.ok(paths.includes(path.join(sdk, 'emulator')));
    const observed = spawnSync('timeout', ['1', 'adb', 'version'], { env: { ...env, PATH: paths.join(':') + ':' + process.env.PATH }, encoding: 'utf8' });
    assert.equal(observed.status, 0, observed.stderr); assert.equal(observed.stdout.trim(), 'baseline-sdk-adb');
    const missing = spawnSync('bash', ['-eu', '-c', prefix], { env: { ...env, ANDROID_HOME: '' }, encoding: 'utf8' }); assert.notEqual(missing.status, 0);
  });
});

function provenanceFixture(directory, overrides = {}) {
  const bin = path.join(directory, 'bin'); fs.mkdirSync(bin);
  const actualSource = overrides.source || source, actualTree = overrides.tree || tree;
  fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\ncase "$2" in HEAD) printf "%s" "' + actualSource + '";; *) printf "%s" "' + actualTree + '";; esac\n', { mode: 0o755 });
  const binary = Buffer.from('exact retained test APK bytes');
  fs.mkdirSync(path.join(directory, 'native-audit-binary'));
  fs.writeFileSync(path.join(directory, 'native-audit-binary/app-release.apk'), overrides.changedBinary ? Buffer.from('different bytes') : binary);
  fs.writeFileSync(path.join(directory, 'native-audit-binary/binary-manifest.json'), JSON.stringify({
    applicationSourceCommit: source, applicationSourceTree: tree, platform: 'android', binarySha256: digest(binary), ...overrides.manifest,
  }));
  return { ...process.env, PATH: bin + ':' + process.env.PATH, GITHUB_SHA: overrides.recovery || recovery,
    GITHUB_REF: 'refs/heads/codex/native-audit-recovery-20261031', GITHUB_RUN_ID: '900', GITHUB_RUN_ATTEMPT: '1', AUDIT_GROUPS: 'support,auth' };
}

test('the actual provenance step distinguishes recovery workflow, original application/tests and producer run while verifying binary bytes', () => {
  temporary(directory => {
    const result = spawnSync('bash', ['-eu', '-c', provenance], { cwd: directory, env: provenanceFixture(directory), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(fs.readFileSync(path.join(directory, 'native-ui-logs/recovery-provenance.json'), 'utf8'));
    assert.equal(value.recoveryWorkflowCommit, recovery); assert.equal(value.applicationAndTestCommit, source);
    assert.equal(value.applicationAndTestTree, tree); assert.equal(value.binaryProducerRunId, 41229206389);
    assert.equal(value.recoveryRunId, 900); assert.equal(value.caseHelperExpectedSourceCommit, source);
    assert.equal(value.rebuild, false); assert.equal(value.rebundle, false); assert.equal(value.resign, false);
    assert.deepEqual(value.featureGroups, ['support', 'auth']);
  });
});

test('the actual provenance step fails closed for wrong checkouts, changed binaries and incorrect manifests before device execution', () => {
  for (const overrides of [{ source: 'a'.repeat(40) }, { tree: 'a'.repeat(40) }, { changedBinary: true },
    { manifest: { applicationSourceCommit: 'a'.repeat(40) } }, { manifest: { applicationSourceTree: 'a'.repeat(40) } },
    { manifest: { platform: 'ios' } }, { recovery: 'invalid' }]) {
    temporary(directory => {
      const result = spawnSync('bash', ['-eu', '-c', provenance], { cwd: directory, env: provenanceFixture(directory, overrides), encoding: 'utf8' });
      assert.notEqual(result.status, 0, JSON.stringify(overrides));
      assert.equal(fs.existsSync(path.join(directory, 'native-ui-logs/recovery-provenance.json')), false);
    });
  }
});
