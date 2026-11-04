const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const helper = 'scripts/quality/native-ui-ios-input-trace.py';
const urlHelper = 'scripts/quality/native-ui-ios-url-trace.py';
const delegate = 'ios/PlatinumQA/AppDelegate.swift';
const evidence = 'native-ui-logs/ios-input-trace';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const helperBytes = fs.readFileSync(path.join(root, helper));
const urlHelperBytes = fs.readFileSync(path.join(root, urlHelper));
const extraction = spawnSync('python3', ['-c',
  'import sys,tarfile; t=tarfile.open(sys.argv[1]); sys.stdout.buffer.write(t.extractfile("package/ios/HelloWorld/AppDelegate.swift").read())',
  path.join(root, 'node_modules/expo/template.tgz')], { encoding: 'utf8', timeout: 5000 });
assert.equal(extraction.status, 0, extraction.stderr);
const template = extraction.stdout;
const launchForward = '    return super.application(application, didFinishLaunchingWithOptions: launchOptions)\n';
const urlForward = '    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)\n';
const eventDispatch = '    self.nativeUIInputTraceSendEvent(event)\n';

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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-ios-input-trace-'));
  const write = (file, value) => {
    const target = path.join(directory, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
    return target;
  };
  write(helper, helperBytes); write(urlHelper, urlHelperBytes); write(delegate, source);
  const manifest = { commit: 'fixture-head', workflowRun: 'fixture-run', hashes: { [helper]: sha(helperBytes), [urlHelper]: sha(urlHelperBytes) } };
  const saveManifest = () => write('native-ui-logs/source.json', JSON.stringify(manifest) + '\n');
  saveManifest();
  const env = { ...process.env, CI: 'true', EXPO_PUBLIC_APP_ENV: 'qa',
    EXPO_PUBLIC_SUPABASE_URL: 'https://uaulhuelcfkjwojtymmw.supabase.co',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'native-ui-synthetic-no-provider-key',
    GITHUB_SHA: manifest.commit, GITHUB_RUN_ID: manifest.workflowRun };
  return {
    directory, source, write, manifest, saveManifest, env,
    read: file => fs.readFileSync(path.join(directory, file), 'utf8'),
    run: (extra = {}, args = []) => spawnSync('python3', [helper, ...args], { cwd: directory, env: { ...env, ...extra }, encoding: 'utf8', timeout: 5000 }),
    runURL: () => spawnSync('python3', [urlHelper], { cwd: directory, env, encoding: 'utf8', timeout: 5000 }),
    close: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

function removeObserver(source, addedImports) {
  let restored = source.replace(/\n\/\/ BEGIN NATIVE_UI_INPUT_TRACE \(disposable synthetic QA only\)\n[\s\S]*\/\/ END NATIVE_UI_INPUT_TRACE\n$/, '')
    .replace(/ {4}\/\/ BEGIN NATIVE_UI_INPUT_TRACE_INSTALL[^\n]*\n[\s\S]*? {4}\/\/ END NATIVE_UI_INPUT_TRACE_INSTALL\n/, '');
  const block = addedImports.map(name => 'import ' + name + '\n').join('');
  return restored.replace('import Expo\n' + block, 'import Expo\n');
}

function observer(source) {
  return source.match(/\n\/\/ BEGIN NATIVE_UI_INPUT_TRACE \(disposable synthetic QA only\)\n([\s\S]*)\/\/ END NATIVE_UI_INPUT_TRACE\n$/)[1];
}

for (const [name, source, useURL] of [
  ['installed Expo template', template, false],
  ['actual VoIP plugin', withVoip(template), false],
  ['preexisting approved imports', withVoip(template).replace('import Expo\n', 'import Expo\nimport Foundation\nimport UIKit\nimport ObjectiveC\nimport Dispatch\n'), false],
  ['actual URL observer after the VoIP plugin', withVoip(template), true],
]) {
  test('input observer preserves all existing generated Swift: ' + name, () => {
    const f = fixture(source);
    try {
      if (useURL) {
        const url = f.runURL(); assert.equal(url.status, 0, url.stderr);
      }
      const before = f.read(delegate);
      const result = f.run(); assert.equal(result.status, 0, result.stderr);
      const proof = JSON.parse(f.read(evidence + '/source-proof.json'));
      const after = f.read(delegate);
      assert.equal(f.read(evidence + '/' + proof.before.file), before);
      assert.equal(f.read(evidence + '/' + proof.after.file), after);
      assert.equal(proof.before.sha256, sha(before)); assert.equal(proof.after.sha256, sha(after));
      assert.equal(proof.before.bytes, Buffer.byteLength(before)); assert.equal(proof.after.bytes, Buffer.byteLength(after));
      assert.equal(proof.helperSHA256, sha(helperBytes));
      assert.equal(proof.sourceManifestSHA256, sha(f.read('native-ui-logs/source.json')));
      assert.equal(proof.commit, f.manifest.commit); assert.equal(proof.workflowRun, f.manifest.workflowRun);
      assert.equal(removeObserver(after, proof.addedImports), before,
        'removing only the observer restores every original launch, linking, VoIP and URL-observer byte');
      assert.equal(after.split(launchForward).length - 1, 1);
      assert.equal(after.split(urlForward).length - 1, 1);
      assert.equal(after.split(eventDispatch).length - 1, 1);
      assert.equal(proof.originalLaunchForwardingExpressionSHA256, sha(launchForward));
      assert.equal(proof.originalEventDispatchCallSHA256, sha(eventDispatch));
      assert.equal(proof.exactReversalMatchesBefore, true);
      assert.equal(proof.runtimeAcceptance, false, 'source checks do not claim a native execution result');
      assert.equal(proof.runtimeArtifact, 'Documents/native-ui-ios-input-diagnostics.jsonl');
      if (useURL) {
        const urlProof = JSON.parse(f.read('native-ui-logs/ios-url-trace/source-proof.json'));
        assert.equal(proof.before.sha256, urlProof.after.sha256, 'the two generated-source receipts form an exact chain');
      }
    } finally { f.close(); }
  });
}

test('the exact observed dispatch body invokes the unchanged event once and never substitutes a responder decision', () => {
  const f = fixture();
  try {
    assert.equal(f.run().status, 0);
    const block = observer(f.read(delegate));
    const wrapper = block.slice(block.indexOf('extension UIApplication {'));
    assert.equal(wrapper, `extension UIApplication {
  @objc fileprivate dynamic func nativeUIInputTraceSendEvent(_ event: UIEvent) {
    let sequence = NativeUIInputTrace.begin(event)
    // After the one installation exchange, this selector is the original implementation.
    // Dispatch the original UIEvent once, unconditionally, without responder decisions.
    self.nativeUIInputTraceSendEvent(event)
    if let sequence = sequence {
      NativeUIInputTrace.capture(event, sequence: sequence, boundary: "after")
    }
  }
}
`);
    assert.equal((block.match(/method_exchangeImplementations\(original, observed\)/g) || []).length, 1);
    assert.match(block, /guard Thread\.isMainThread, !installed,\s*Bundle\.main\.bundleIdentifier == "app\.platinumcircles\.mobile\.qa"/);
    assert.match(block, /#selector\(UIApplication\.sendEvent\(_:\)\)/);
    assert.match(block, /#selector\(UIApplication\.nativeUIInputTraceSendEvent\(_:\)\)/);
    assert.match(block, /String\(cString: originalType\) == String\(cString: observedType\) else \{ return \}/);
    assert.match(block, /method_exchangeImplementations\(original, observed\)\s*installed = true/);
    const executable = block.replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(executable, /\b(?:hitTest|pointInside|sendAction|sendActions|becomeFirstResponder|resignFirstResponder|endEditing|cancelTouches|recognize|sleep|usleep|wait)\s*\(/);
    assert.doesNotMatch(executable, /\.point\(inside:|\.asyncAfter\(|DispatchQueue\.main|\.sync\s*\{/);
    assert.doesNotMatch(executable, /view\.(?:frame|bounds|isUserInteractionEnabled|isHidden|alpha)\s*=/);
    assert.doesNotMatch(executable, /\.gestureRecognizers|\.accessibilityIdentifier|\.accessibilityLabel|\.text\b|\.title\b|\.description\b|\.userInfo\b|\.allHTTPHeaderFields/);
  } finally { f.close(); }
});

test('native observation snapshots bounded actual geometry on main and only encodes immutable values off main', () => {
  const f = fixture();
  try {
    assert.equal(f.run().status, 0);
    const block = observer(f.read(delegate));
    const proof = JSON.parse(f.read(evidence + '/source-proof.json'));
    assert.match(block, /@MainActor\s*private enum NativeUIInputTrace/);
    assert.match(block, /static func capture[\s\S]*?guard Thread\.isMainThread else \{ return \}/);
    assert.match(block, /var current = touch\.view/);
    assert.match(block, /while let view = current, ancestors\.count < maximumAncestors/);
    assert.match(block, /let point = touch\.location\(in: view\)/);
    assert.match(block, /viewClass: String\(NSStringFromClass\(type\(of: view\)\)\.prefix\(120\)\)/);
    assert.match(block, /frame: NativeUIInputTraceRect\(view\.frame\)/);
    assert.match(block, /bounds: NativeUIInputTraceRect\(bounds\)/);
    assert.match(block, /containsPoint: bounds\.contains\(point\)/);
    assert.match(block, /current = view\.superview/);
    assert.match(block, /selected\.prefix\(maximumTouches\)/);
    assert.match(block, /sequence < maximumDispatches/);
    assert.match(block, /case \.began: return "began"\s*case \.ended: return "ended"\s*case \.cancelled: return "cancelled"\s*default: return nil/);
    const sink = block.slice(block.indexOf('private enum NativeUIInputTraceSink'), block.indexOf('@MainActor'));
    assert.match(sink, /DispatchQueue\(label: "native-ui\.input-geometry", qos: \.utility\)/);
    assert.match(sink, /queue\.async \{\s*do \{\s*let encoder = JSONEncoder\(\)/);
    assert.equal(block.split('JSONEncoder()').length - 1, 1);
    assert.equal(block.split('FileManager.default').length - 1, 1);
    assert.equal(block.split('FileHandle(forWritingTo: file)').length - 1, 1);
    assert.doesNotMatch(sink, /\b(?:UIEvent|UITouch|UIView|UIApplication)\b/);
    assert.match(sink, /guard line\.count <= 128 \* 1024/);
    assert.match(sink, /size <= maximumFileBytes,\s*UInt64\(line\.count\) <= maximumFileBytes - size/);
    assert.match(sink, /catch \{\s*\/\/ An observer write failure must never alter event delivery\.\s*\}/);
    assert.deepEqual(proof.phases, ['began', 'ended', 'cancelled']);
    assert.deepEqual(proof.boundaries, ['before', 'after']);
    assert.equal(proof.maximumDispatchesPerProcess, 512); assert.equal(proof.maximumRecordsPerProcess, 1024);
    assert.equal(proof.maximumTouchesPerRecord, 4); assert.equal(proof.maximumAncestorsPerTouch, 24);
    assert.equal(proof.maximumClassNameCharacters, 120); assert.equal(proof.maximumEncodedRecordBytes, 128 * 1024);
    assert.equal(proof.maximumArtifactBytes, 8 * 1024 * 1024);
    assert.deepEqual(proof.ancestorFields, ['viewClass', 'frame', 'bounds', 'point', 'containsPoint']);
    assert.equal(proof.snapshotThread, 'main'); assert.equal(proof.serializationAndFileWriteQueue, 'serial utility queue');
  } finally { f.close(); }
});

for (const [name, change, expected] of [
  ['CI disabled', () => ({ CI: 'false' }), /disposable synthetic QA/],
  ['production environment', () => ({ EXPO_PUBLIC_APP_ENV: 'production' }), /disposable synthetic QA/],
  ['production endpoint', () => ({ EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }), /disposable synthetic QA/],
  ['provider key', () => ({ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'actual-provider-key' }), /disposable synthetic QA/],
  ['missing commit', () => ({ GITHUB_SHA: '' }), /current-run original-source provenance/],
  ['wrong commit', () => ({ GITHUB_SHA: 'different-head' }), /current-run original-source provenance/],
  ['wrong run', () => ({ GITHUB_RUN_ID: 'different-run' }), /current-run original-source provenance/],
  ['wrong helper hash', f => { f.manifest.hashes[helper] = '0'.repeat(64); f.saveManifest(); }, /current-run original-source provenance/],
  ['malformed manifest', f => { f.write('native-ui-logs/source.json', '[]'); }, /manifest shape/],
  ['changed launch signature', f => { f.write(delegate, f.source.replace('didFinishLaunchingWithOptions launchOptions:', 'didFinishLaunchingWithOptions changed:')); }, /reviewed generated launch/],
  ['changed launch forwarding', f => { f.write(delegate, f.source.replace(launchForward, launchForward.replace('return super.', 'return other.'))); }, /reviewed generated launch/],
  ['duplicate launch class', f => { f.write(delegate, f.source + '\npublic class AppDelegate: ExpoAppDelegate {\n}\n'); }, /reviewed generated launch/],
  ['preexisting event customization', f => { f.write(delegate, f.source + '\n// previously changed sendEvent\n'); }, /reviewed generated launch/],
  ['duplicate observer', f => { f.write(delegate, f.source + '\n// NATIVE_UI_INPUT_TRACE\n'); }, /already contains/],
  ['unknown imports', f => { f.write(delegate, f.source.replace('import Expo\n', 'import OtherExpo\n')); }, /reviewed generated Swift imports/],
  ['oversized source', f => { f.write(delegate, f.source + ' '.repeat(128 * 1024)); }, /bounded regular/],
]) {
  test('input observer fails closed before mutation: ' + name, () => {
    const f = fixture();
    try {
      const env = change(f) || {}, before = fs.readFileSync(path.join(f.directory, delegate));
      const result = f.run(env); assert.equal(result.status, 2, result.stderr); assert.match(result.stderr, expected);
      assert.deepEqual(fs.readFileSync(path.join(f.directory, delegate)), before);
      assert.equal(fs.existsSync(path.join(f.directory, evidence)), false);
    } finally { f.close(); }
  });
}

test('input observer rejects path overrides, symlinks and repeated application without touching prior evidence', () => {
  const f = fixture();
  try {
    assert.equal(f.run({}, ['other.swift']).status, 2);
    const file = path.join(f.directory, delegate), target = f.write('original.swift', f.source);
    fs.unlinkSync(file); fs.symlinkSync(target, file);
    let result = f.run(); assert.equal(result.status, 2); assert.match(result.stderr, /symbolic link/);
    assert.equal(f.read('original.swift'), f.source);
    fs.unlinkSync(file); f.write(delegate, f.source);
    result = f.run(); assert.equal(result.status, 0, result.stderr);
    const after = f.read(delegate), proof = f.read(evidence + '/source-proof.json');
    result = f.run(); assert.equal(result.status, 2); assert.match(result.stderr, /already contains/);
    assert.equal(f.read(delegate), after); assert.equal(f.read(evidence + '/source-proof.json'), proof);
  } finally { f.close(); }
});

test('input observer refuses stale evidence without replacing generated source', () => {
  const f = fixture();
  try {
    f.write(evidence + '/kept.txt', 'previous evidence');
    const result = f.run(); assert.equal(result.status, 2); assert.match(result.stderr, /reuse input trace evidence/);
    assert.equal(f.read(delegate), f.source); assert.equal(f.read(evidence + '/kept.txt'), 'previous evidence');
  } finally { f.close(); }
});
