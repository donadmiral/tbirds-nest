const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const overlay = require('../../scripts/quality/native-ui-input-overlay.cjs');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));
function trace(options = {}) {
  const module = { exports: {} };
  vm.runInNewContext(read('tests/native/input-diagnostics.cjs'), { module, exports: module.exports });
  const api = module.exports, recorder = api.installInputDiagnostics(options);
  return { ...api, recorder };
}
function compile(source, globals = {}, fileName = 'observer.tsx') {
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, { fileName, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React, esModuleInterop: true } });
  assert.deepEqual(compiled.diagnostics?.filter(row => row.category === ts.DiagnosticCategory.Error), []);
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports, ...globals }, { filename: fileName });
  return module.exports;
}
function find(source, predicate) {
  const ast = ts.createSourceFile('actual.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits = [];
  function visit(node) { if (predicate(node, ast)) hits.push(node.getText(ast)); ts.forEachChild(node, visit); }
  visit(ast); assert.equal(hits.length, 1); return hits[0];
}
const initializer = (source, name) => find(source, node => ts.isVariableDeclaration(node) && node.name.getText() === name)
  .replace(new RegExp('^' + name + '\\s*=\\s*'), '');
function callbackContaining(source, needle) {
  return find(source, (node, ast) => ts.isArrowFunction(node) && node.body.getText(ast).includes(needle)
    && !node.body.getText(ast).includes('return <'));
}

test('input observations retain only bounded allowlisted metadata and preserve first plus recent events', async () => {
  const writes = [], t = trace({ write: value => { writes.push(JSON.parse(value)); }, now: () => 17 });
  const secret = 'private-account-route-input-error-token';
  const details = { opened: true, scopeRevision: 2, request: 3, rootRoute: 'NewLive', activeRoute: secret,
    params: secret, text: secret, error: secret, get payload() { throw Error('Must not inspect payload'); } };
  t.record('unknown-' + secret, details);
  for (let i = 0; i < 800; i++) t.record('open-book-state-commit', details);
  await t.recorder.flush();
  const value = plain(t.recorder.snapshot());
  assert.equal(value.events.length, t.MAX_EVENTS); assert.equal(value.dropped, 801 - t.MAX_EVENTS);
  assert.equal(value.events[0].phase, 'installed'); assert.equal(value.events.at(-1).sequence, 801);
  assert.equal(value.events.at(-1).opened, true); assert.equal(value.events.at(-1).scopeRevision, 2);
  assert.equal(value.events.at(-1).activeRoute, undefined);
  assert.ok(writes.length <= 2, 'same-turn observations coalesce instead of queueing unbounded writes');
  assert.doesNotMatch(JSON.stringify(value), /private-account/);
  const copy = t.recorder.snapshot(); copy.events[0].phase = 'changed';
  assert.equal(t.recorder.snapshot().events[0].phase, 'installed');
});

test('observer clock, sink and metadata getter failures never change callback work', async () => {
  const t = trace({ now() { throw Error('clock'); }, write() { return Promise.reject(Error('sink')); } });
  assert.equal(t.record('open-book-state-commit', { get opened() { throw Error('getter'); } }), false);
  const receiver = {}, argument = {}, result = {}, failure = new Error('private original failure');
  let calls = 0;
  const original = function (...args) { calls++; assert.equal(this, receiver); assert.deepEqual(args, [argument]); return result; };
  const wrapped = t.wrapCallback('start-live', original);
  assert.equal(t.wrapCallback('start-live', original), wrapped, 'callback identity stays stable');
  assert.equal(wrapped.call(receiver, argument), result); assert.equal(calls, 1);
  const strictCallback = function () { 'use strict'; return this; };
  const strictWrapped = t.wrapCallback('start-live', strictCallback);
  assert.equal(strictWrapped(), undefined); assert.equal(strictWrapped.call(null), null);
  const rejected = Promise.reject(failure); rejected.catch(() => {});
  assert.equal(t.wrapCallback('open-book', () => rejected)(), rejected, 'no extra promise chain replaces the result');
  assert.throws(() => t.wrapCallback('open-book', () => { throw failure; })(), error => error === failure);
  assert.equal(t.wrapCallback('unknown', original), original);
  await t.recorder.flush();
  assert.doesNotMatch(JSON.stringify(t.recorder.snapshot()), /private original|clock|sink/);
});

test('navigation dispatch preserves receiver, arguments, result and error while recording only route names', () => {
  const t = trace(), args = ['NewLive', { private: 'not recorded' }], result = {};
  let calls = 0, current = 'LiveStreams';
  const navigation = { getState: () => ({ index: 0, routes: [{ name: current, key: 'private-id', params: args[1] }] }),
    navigate(...received) { calls++; assert.equal(this, navigation); assert.equal(received[1], args[1]); current = 'NewLive'; return result; } };
  assert.equal(t.observeNavigation(navigation.navigate, navigation, args), result); assert.equal(calls, 1);
  const rows = t.recorder.snapshot().events.filter(row => row.phase.startsWith('live-navigation'));
  assert.equal(rows[0].activeRoute, 'LiveStreams'); assert.equal(rows[1].activeRoute, 'NewLive');
  const failure = new Error('private failure');
  assert.throws(() => t.observeNavigation(() => { throw failure; }, { getState() { throw Error('observation'); } }, []), error => error === failure);
  assert.equal(t.recorder.snapshot().events.at(-2).activeRoute, 'unavailable');
  const observers = t.navigationObservers({ current: { getRootState: navigation.getState } });
  observers.onReady(); observers.onStateChange({ index: 0, routes: [{ name: 'Main', state: { index: 0,
    routes: [{ name: 'private-route-name', params: args[1] }] } }] });
  assert.equal(t.recorder.snapshot().events.at(-1).activeRoute, 'other');
  assert.doesNotMatch(JSON.stringify(t.recorder.snapshot()), /private/);
});

test('passive installed Pressability emitter retains original listener and transition behavior', () => {
  const babel = require('@babel/core');
  const source = read('node_modules/react-native/Libraries/Pressability/PressabilityPerformanceEventEmitter.js');
  const code = babel.transformSync(source, { babelrc: false, configFile: false,
    presets: [require.resolve('@react-native/babel-preset')] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require });
  const emitter = module.exports.default, originalCalls = [];
  const original = event => originalCalls.push(event);
  emitter.addListener(original);
  const before = emitter.emitEvent, t = trace();
  const remove = t.attachPressabilityEmitter(emitter);
  const event = { signal: 'RESPONDER_TERMINATED', nativeTimestamp: 456, private: 'never retained' };
  emitter.emitEvent(() => event);
  assert.equal(emitter.emitEvent, before); assert.equal(originalCalls[0], event);
  assert.equal(t.recorder.snapshot().events.at(-1).signal, 'RESPONDER_TERMINATED');
  assert.equal(t.recorder.snapshot().events.at(-1).nativeTimestamp, 456);
  const count = t.recorder.snapshot().events.length; remove(); emitter.emitEvent(() => event);
  assert.equal(originalCalls.length, 2); assert.equal(t.recorder.snapshot().events.length, count);
  assert.doesNotMatch(JSON.stringify(t.recorder.snapshot()), /never retained/);
  t.attachPressabilityEmitter({ addListener() { throw Error('unavailable'); }, removeListener() {} });
  assert.equal(t.recorder.snapshot().events.at(-1).phase, 'pressability-unavailable');
});

const sourceFiles = [
  ['src/components/LiveUi.tsx', overlay.liveUiInputOverlay],
  ['src/screens/feed/LiveStreamsScreen.tsx', overlay.liveDirectoryInputOverlay],
  ['src/navigation/AppNavigator.tsx', overlay.navigationInputOverlay],
  ['src/screens/feed/NewLiveScreen.tsx', overlay.newLiveInputOverlay],
  ['src/screens/profile/MemoryAlbumScreen.tsx', overlay.memoryInputOverlay],
];
test('all exact production source overlays parse, reject repeated application and add no responder decision handlers', () => {
  for (const [file, transform] of sourceFiles) {
    const actual = read(file), result = transform(actual);
    const parsed = ts.createSourceFile(file, result, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(parsed.parseDiagnostics.length, 0, file);
    assert.throws(() => transform(result), /already installed/);
    assert.equal(read(file), actual, 'overlay transformation never mutates source');
    for (const decision of ['onStartShouldSetResponder', 'onMoveShouldSetResponder', 'onResponderTerminationRequest']) {
      assert.equal(result.split(decision).length, actual.split(decision).length);
    }
  }
  const transformed = overlay.navigationInputOverlay(read('src/navigation/AppNavigator.tsx'));
  assert.equal((transformed.match(/onStateChange=\{nativeInputNavigation.onStateChange\}/g) || []).length, 2);
  assert.equal((transformed.match(/onUnhandledAction=\{handleUnhandledNavigationAction\}/g) || []).length, 2);
});

test('actual overlaid Start live control preserves callback invocation and adds passive touch boundaries only', () => {
  const t = trace(), receiver = {}, event = new Proxy({}, { get() { throw Error('Never inspect the event'); } }), result = {};
  let calls = 0;
  const onCreate = function (...args) { calls++; assert.equal(this, receiver); assert.equal(args[0], event); return result; };
  const React = { createElement: (type, props, ...children) => ({ type, props, children }), useState: initial => [initial, () => {}] };
  const component = compile(overlay.liveUiInputOverlay(read('src/components/LiveUi.tsx')), { require: name => {
    if (name.endsWith('/input-diagnostics.cjs')) return t;
    if (name === 'react') return React;
    if (name === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: value => value, absoluteFill: {} } };
    if (name === '@expo/vector-icons') return { Feather: 'Icon' };
    if (name === '../../shared/liveDirectory') return { LIVE_TOPICS: [['irl', 'IRL']] };
    if (name === '../theme/useTheme') return { useTheme: () => ({ t: { ink: { primary: '#123', secondary: '#456' }, surface: { raised: '#fff', sunken: '#eee' } } }) };
    return {};
  } }).LiveDirectoryHeader;
  const tree = component({ filter: 'for_you', view: 'live', topic: 'all', query: '', onCreate });
  function walk(node) { return node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : []; }
  const button = walk(tree).find(node => node.props?.accessibilityLabel === 'Start live');
  assert.ok(button); assert.equal(button.props.onPress.call(receiver, event), result); assert.equal(calls, 1);
  for (const name of ['onTouchStart', 'onTouchEnd', 'onTouchCancel', 'onPressIn', 'onPressOut']) assert.equal(button.props[name](event), undefined);
  assert.ok(t.recorder.snapshot().events.some(row => row.phase === 'start-live-touch-cancel'));
});

function capability(source, t, scenario) {
  const effect = callbackContaining(source, 'const version = ++generation.current;');
  const mutations = [], requests = [], generation = { current: 0 }, owner = 'private-owner';
  let resolve, reject;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const globals = { nativeInputTrace: t, generation, owner, visibleOwner: { current: owner },
    liveRpc(...args) { requests.push(args); if (scenario === 'throw') throw pending; return pending; },
    liveObject: value => value && typeof value === 'object',
    ...Object.fromEntries(['Available', 'Broadcastable', 'Recordable', 'Loading', 'Error'].map(name => ['set' + name, value => mutations.push([name, value])])) };
  const fn = compile('module.exports = ' + effect, globals);
  return { fn, mutations, requests, generation, resolve, reject, pending };
}
test('actual capability effect retains original request, cleanup and state results on fulfillment, rejection and stale completion', async () => {
  const file = 'src/screens/feed/NewLiveScreen.tsx', source = read(file), t = trace(), changed = overlay.newLiveInputOverlay(source);
  for (const scenario of ['fulfilled', 'rejected', 'stale', 'throw']) {
    const before = capability(source, t, scenario), after = capability(changed, t, scenario);
    if (scenario === 'throw') {
      assert.throws(before.fn, value => value === before.pending); assert.throws(after.fn, value => value === after.pending); continue;
    }
    const cleanBefore = before.fn(), cleanAfter = after.fn();
    assert.deepEqual(plain(after.requests), plain(before.requests)); assert.equal(after.requests.length, 1);
    if (scenario === 'stale') { cleanBefore(); cleanAfter(); }
    if (scenario === 'rejected') { before.reject(Error('private failure')); after.reject(Error('private failure')); }
    else { const data = { capabilities: { create: true, broadcast: true, recording: false } }; before.resolve(data); after.resolve(data); }
    await turn();
    assert.deepEqual(after.mutations, before.mutations); assert.equal(after.generation.current, before.generation.current);
    if (scenario !== 'stale') { cleanBefore(); cleanAfter(); }
    assert.equal(after.generation.current, before.generation.current);
  }
  assert.doesNotMatch(JSON.stringify(t.recorder.snapshot()), /private-owner|private failure/);
});

test('actual Open book callback preserves updates and errors while opened/auth-scope commits stay observational', () => {
  const source = read('src/screens/profile/MemoryAlbumScreen.tsx'), changed = overlay.memoryInputOverlay(source), t = trace();
  function make(text, failure) {
    const values = [], completeIntent = { current: 4 };
    const fn = compile('module.exports = ' + initializer(text, 'openBook'), { nativeInputTrace: t, useCallback: fn => fn, completeIntent,
      setPreparingBook: value => values.push(['preparing', value]), setOpened: value => { values.push(['opened', value]); if (failure) throw failure; } });
    return { fn, values, completeIntent };
  }
  const before = make(source), after = make(changed);
  assert.equal(after.fn(), before.fn()); assert.deepEqual(after.values, before.values);
  assert.equal(after.completeIntent.current, before.completeIntent.current);
  const failure = new Error('private failure');
  assert.throws(make(changed, failure).fn, value => value === failure);
  const commit = callbackContaining(changed, "nativeInputTrace.record('open-book-state-commit'");
  compile('module.exports = ' + commit, { nativeInputTrace: t, opened: true, authScopeRevision: 2 })();
  const row = t.recorder.snapshot().events.at(-1);
  assert.equal(row.opened, true); assert.equal(row.scopeRevision, 2);
  assert.doesNotMatch(JSON.stringify(t.recorder.snapshot()), /private failure/);
});

test('diagnostic entry and collection preserve existing flows and retain exact overlay/workflow provenance', () => {
  const prepare = read('scripts/quality/prepare-native-ui.cjs');
  for (const file of ['scripts/quality/native-ui-input-overlay.cjs', 'scripts/quality/native-ui-ios-input-trace.py', '.github/workflows/live-native-input-diagnostics.yml']) assert.ok(prepare.includes(file));
  assert.ok(prepare.includes("...files('tests/native')"));
  assert.ok(prepare.includes('overlays.push({ file, before, after, reason, retained })'));
  for (const platform of ['ios', 'android']) {
    const runner = read('scripts/quality/test-' + platform + '-app-ui.sh');
    assert.ok(runner.includes('native-ui-input-diagnostics.json'));
    assert.ok(runner.includes('scripts/quality/run-native-ui-flows.sh'));
  }
  const entry = read('tests/native/entry.js');
  assert.ok(entry.indexOf('installFixtureTransport(fixture, FixtureWebSocket)') < entry.indexOf('installInputDiagnostics({'));
  assert.ok(entry.indexOf('installInputDiagnostics({') < entry.indexOf("const App = require('../../App').default"));
  const ios = read('scripts/quality/test-ios-app-ui.sh');
  assert.ok(ios.indexOf('python3 scripts/quality/native-ui-ios-url-trace.py') < ios.indexOf('python3 scripts/quality/native-ui-ios-input-trace.py'));
  assert.ok(ios.indexOf('python3 scripts/quality/native-ui-ios-input-trace.py') < ios.indexOf('pod _1.16.2_ install'));
  assert.ok(ios.includes('native-ui-ios-input-diagnostics.jsonl'));
});
