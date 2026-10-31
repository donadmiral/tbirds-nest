const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const helper = 'scripts/quality/native-ui-ios-url-trace.py';
const delegate = 'ios/PlatinumQA/AppDelegate.swift';
const evidence = 'native-ui-logs/ios-url-trace';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const helperBytes = fs.readFileSync(path.join(root, helper));
const extraction = spawnSync('python3', ['-c',
  'import sys,tarfile; t=tarfile.open(sys.argv[1]); sys.stdout.buffer.write(t.extractfile("package/ios/HelloWorld/AppDelegate.swift").read())',
  path.join(root, 'node_modules/expo/template.tgz')], { encoding: 'utf8', timeout: 5000 });
assert.equal(extraction.status, 0, extraction.stderr);
const template = extraction.stdout;
const forward = '    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)\n';

// Execute the repository's actual config-plugin transformation. The dangerous
// filesystem mod is not run; only its AppDelegate callback receives a fixture.
function withVoip(source) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'plugins/withVoipPushKit.js'), 'utf8'), {
    module, exports: module.exports,
    require(name) {
      if (name === '@expo/config-plugins') return {
        withAppDelegate: (config, apply) => apply({ ...config, modResults: { language: 'swift', contents: source } }),
        withDangerousMod: config => config,
      };
      if (name === 'fs') return fs;
      if (name === 'path') return path;
      throw Error('Unexpected config-plugin dependency: ' + name);
    },
  }, { filename: 'plugins/withVoipPushKit.js' });
  return module.exports({}).modResults.contents;
}

function fixture(source = withVoip(template)) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-ios-url-trace-'));
  const write = (file, value) => {
    const target = path.join(directory, file);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); return target;
  };
  write(helper, helperBytes); write(delegate, source);
  const manifest = { commit: 'fixture-head', workflowRun: 'fixture-run', hashes: { [helper]: sha(helperBytes) } };
  const saveManifest = () => write('native-ui-logs/source.json', JSON.stringify(manifest) + '\n');
  saveManifest();
  const env = { ...process.env, CI: 'true', EXPO_PUBLIC_APP_ENV: 'qa', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'native-ui-synthetic-no-provider-key',
    GITHUB_SHA: manifest.commit, GITHUB_RUN_ID: manifest.workflowRun };
  return {
    directory, source, write, manifest, saveManifest, env,
    read: file => fs.readFileSync(path.join(directory, file), 'utf8'),
    run: (extra = {}, args = []) => spawnSync('python3', [helper, ...args], { cwd: directory, env: { ...env, ...extra }, encoding: 'utf8', timeout: 5000 }),
    close: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

function removeObservation(source, addedFoundation) {
  let result = source.replace(/ {2}\/\/ BEGIN NATIVE_UI_URL_TRACE_COUNTER[^\n]*\n[\s\S]*? {2}\/\/ END NATIVE_UI_URL_TRACE_COUNTER\n/, '')
    .replace(/ {4}\/\/ BEGIN NATIVE_UI_URL_TRACE[^\n]*\n[\s\S]*? {4}\/\/ END NATIVE_UI_URL_TRACE\n/, '');
  if (addedFoundation) result = result.replace('import Expo\nimport Foundation\n', 'import Expo\n');
  return result;
}

for (const [name, source] of [
  ['installed Expo template', template],
  ['installed template with actual VoIP plugin', withVoip(template)],
  ['existing Foundation import', withVoip(template).replace('import Expo\n', 'import Expo\nimport Foundation\n')],
]) {
  test('actual URL patcher preserves complete original Swift: ' + name, () => {
    const f = fixture(source);
    try {
      const result = f.run(); assert.equal(result.status, 0, result.stderr);
      const proof = JSON.parse(f.read(evidence + '/source-proof.json'));
      const generated = f.read(delegate), before = f.read(evidence + '/' + proof.before.file), after = f.read(evidence + '/' + proof.after.file);
      assert.equal(before, source); assert.equal(after, generated);
      assert.equal(proof.before.sha256, sha(Buffer.from(before))); assert.equal(proof.after.sha256, sha(Buffer.from(after)));
      assert.equal(proof.helperSHA256, sha(helperBytes));
      assert.equal(proof.sourceManifestSHA256, sha(Buffer.from(f.read('native-ui-logs/source.json'))));
      assert.equal(proof.commit, f.manifest.commit); assert.equal(proof.workflowRun, f.manifest.workflowRun);
      assert.equal(removeObservation(generated, proof.addedFoundationImport), source,
        'deleting only the observer restores all original imports, methods, forwarding and plugin bytes');
      assert.equal(generated.split(forward).length - 1, 1);
      assert.equal(proof.originalForwardingExpressionSHA256, sha(Buffer.from(forward)));
      assert.equal(proof.exactReversalMatchesBefore, true); assert.equal(proof.runtimeAcceptance, false);
      assert.equal(proof.maximumTracedURLs, 16); assert.equal(proof.maximumLogRecords, 32);
      assert.deepEqual(proof.recordFields, ['phase', 'sequence', 'atUnixMs', 'matched']);
    } finally { f.close(); }
  });
}

test('generated observer has bounded QA-only numeric log arguments and a defer without route side effects', () => {
  const f = fixture();
  try {
    assert.equal(f.run().status, 0);
    const generated = f.read(delegate), block = generated.match(/ {4}\/\/ BEGIN NATIVE_UI_URL_TRACE[^\n]*\n([\s\S]*?) {4}\/\/ END NATIVE_UI_URL_TRACE\n/)[1];
    assert.match(block, /Bundle\.main\.bundleIdentifier == "app\.platinumcircles\.mobile\.qa"/);
    assert.match(block, /url\.scheme\?\.lowercased\(\) == "platinum-circles-qa"/);
    assert.match(block, /nativeUIURLTraceSequence < 16/);
    assert.equal((block.match(/nativeUIURLTraceSequence \+= 1/g) || []).length, 1);
    assert.match(block, /url\.absoluteString == "platinum-circles-qa:\/\/ui-fixture\/memory"/);
    assert.match(block, /else \{\s*nativeUIURLTraceToken = nil\s*\}/);
    const logs = [...block.matchAll(/NSLog\("([^"\n]+)",\s*([^\n]+)\)/g)];
    assert.deepEqual(logs.map(match => match[1]), [
      '[native-ui-url] entry sequence=%ld atUnixMs=%.0f matched=%ld',
      '[native-ui-url] exit sequence=%ld atUnixMs=%.0f matched=%ld',
    ]);
    assert.deepEqual(logs.map(match => match[2].trim()), [
      'nativeUIURLTraceSequence, Date().timeIntervalSince1970 * 1000, matched ? 1 : 0',
      'sequence, Date().timeIntervalSince1970 * 1000, matched ? 1 : 0',
    ]);
    assert.match(block, /defer \{\s*if let \(sequence, matched\) = nativeUIURLTraceToken/);
    assert.doesNotMatch(block, /\b(?:return|throw|try|await|Task|DispatchQueue|sleep|openURL|RCTLinkingManager|super\.application)\b/);
    assert.doesNotMatch(logs.map(match => match[2]).join('\n'), /\b(?:url|options|environment|query|token|payload|absoluteString)\b/i);
  } finally { f.close(); }
});

for (const [name, change, expected] of [
  ['CI disabled', () => ({ CI: 'false' }), /disposable synthetic QA/],
  ['production environment', () => ({ EXPO_PUBLIC_APP_ENV: 'production' }), /disposable synthetic QA/],
  ['provider key', () => ({ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'not-the-synthetic-sentinel' }), /disposable synthetic QA/],
  ['missing commit', () => ({ GITHUB_SHA: '' }), /current-run original-source provenance/],
  ['wrong commit', () => ({ GITHUB_SHA: 'different-head' }), /current-run original-source provenance/],
  ['wrong run', () => ({ GITHUB_RUN_ID: 'different-run' }), /current-run original-source provenance/],
  ['wrong helper hash', f => { f.manifest.hashes[helper] = '0'.repeat(64); f.saveManifest(); }, /current-run original-source provenance/],
  ['malformed source manifest', f => { f.write('native-ui-logs/source.json', '[]'); }, /manifest shape/],
  ['changed forwarding', f => { f.write(delegate, f.source.replace(' || RCTLinkingManager.', ' && RCTLinkingManager.')); }, /reviewed generated Swift/],
  ['changed method signature', f => { f.write(delegate, f.source.replace('open url: URL,', 'open changed: URL,')); }, /reviewed generated Swift/],
  ['duplicate forwarding', f => { f.write(delegate, f.source + '\n' + forward); }, /reviewed generated Swift/],
  ['duplicate class', f => { f.write(delegate, f.source + '\npublic class AppDelegate: ExpoAppDelegate {\n}\n'); }, /reviewed generated Swift/],
  ['existing observer', f => { f.write(delegate, f.source + '\n// NATIVE_UI_URL_TRACE\n'); }, /already contains/],
  ['unexpected imports', f => { f.write(delegate, f.source.replace('import Expo\n', 'import DifferentExpo\n')); }, /reviewed generated Swift imports/],
  ['oversized source', f => { f.write(delegate, f.source + ' '.repeat(128 * 1024)); }, /bounded regular/],
]) {
  test('actual URL patcher fails closed before source mutation: ' + name, () => {
    const f = fixture();
    try {
      const env = change(f) || {}, before = fs.readFileSync(path.join(f.directory, delegate));
      const result = f.run(env); assert.equal(result.status, 2, result.stderr); assert.match(result.stderr, expected);
      assert.deepEqual(fs.readFileSync(path.join(f.directory, delegate)), before);
      assert.equal(fs.existsSync(path.join(f.directory, evidence)), false);
    } finally { f.close(); }
  });
}

test('actual URL patcher rejects path overrides, symlinks and duplicate application', () => {
  const f = fixture();
  try {
    assert.equal(f.run({}, ['other.swift']).status, 2);
    const file = path.join(f.directory, delegate), target = f.write('original.swift', f.source);
    fs.unlinkSync(file); fs.symlinkSync(target, file);
    let result = f.run(); assert.equal(result.status, 2); assert.match(result.stderr, /symbolic link/); assert.equal(f.read('original.swift'), f.source);
    fs.unlinkSync(file); f.write(delegate, f.source);
    result = f.run(); assert.equal(result.status, 0, result.stderr);
    const after = f.read(delegate), proof = f.read(evidence + '/source-proof.json');
    result = f.run(); assert.equal(result.status, 2); assert.match(result.stderr, /already contains/);
    assert.equal(f.read(delegate), after); assert.equal(f.read(evidence + '/source-proof.json'), proof);
  } finally { f.close(); }
});

test('actual URL patcher refuses preexisting evidence without replacing generated source', () => {
  const f = fixture();
  try {
    f.write(evidence + '/kept.txt', 'previous evidence');
    const result = f.run(); assert.equal(result.status, 2); assert.match(result.stderr, /reuse URL trace evidence/);
    assert.equal(f.read(delegate), f.source); assert.equal(f.read(evidence + '/kept.txt'), 'previous evidence');
  } finally { f.close(); }
});

for (const changedMethod of [false, true]) {
  test('actual iOS shell runs generated-source check before CocoaPods: ' + (changedMethod ? 'mismatch stops build' : 'valid source proceeds'), () => {
    const f = fixture();
    try {
      f.write('scripts/quality/test-ios-app-ui.sh', fs.readFileSync(path.join(root, 'scripts/quality/test-ios-app-ui.sh')));
      f.write('ios/PlatinumQA/Supporting/Expo.plist', '<?xml version="1.0"?><plist version="1.0"><dict><key>EXUpdatesEnabled</key><true/></dict></plist>');
      if (changedMethod) f.write(delegate, f.source.replace('open url: URL,', 'open changed: URL,'));
      const stubs = {
        uname: 'if [[ "$1" == -s ]]; then echo Darwin; else echo x86_64; fi',
        node: 'if [[ "$1" == --version ]]; then echo v22; else echo prepare >> native-ui-logs/order.log; fi',
        npx: 'echo prebuild >> native-ui-logs/order.log',
        xcodebuild: 'echo fixture-xcode-version',
        xcrun: 'echo fixture-sdk-version',
        maestro: 'echo fixture-maestro-version',
        pod: 'echo pods >> native-ui-logs/order.log; exit 31',
      };
      for (const [name, body] of Object.entries(stubs)) fs.chmodSync(f.write('bin/' + name, '#!/usr/bin/env bash\nset -eu\n' + body + '\n'), 0o755);
      const run = spawnSync('bash', ['scripts/quality/test-ios-app-ui.sh'], { cwd: f.directory,
        env: { ...f.env, PATH: path.join(f.directory, 'bin') + path.delimiter + process.env.PATH }, encoding: 'utf8', timeout: 5000 });
      assert.equal(run.status, changedMethod ? 2 : 31, run.stderr);
      assert.equal(f.read('native-ui-logs/order.log'), changedMethod ? 'prepare\nprebuild\n' : 'prepare\nprebuild\npods\n');
      assert.equal(fs.existsSync(path.join(f.directory, evidence + '/source-proof.json')), !changedMethod);
      if (!changedMethod) assert.equal((f.read(delegate).match(/\[native-ui-url\] entry/g) || []).length, 1);
    } finally { f.close(); }
  });
}
