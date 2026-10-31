const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const { createFixture, OWNER, PEER } = require('../native/backend-fixture.cjs');
const trace = require('../native/capture-boundary-trace.cjs');
const root = path.resolve(__dirname, '../..');
const env = { EXPO_PUBLIC_APP_ENV: 'qa', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'native-ui-synthetic-no-provider-key' };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('the real fixture recorder retains only known phases, booleans, sequence and a numeric timestamp', () => {
  const fixture = createFixture();
  const secret = 'private-url-token-account-error-sentinel';
  const details = { matched: true, reset: true, fulfilled: true, passed: true, url: secret, token: secret,
    get session() { throw Error('Unknown fields must not be read'); } };
  fixture.recordCaptureBoundary('unknown-' + secret, details);
  for (const phase of ['received', 'parsed', 'action-produced', 'mounted', 'readback-start', 'readback-complete']) {
    assert.equal(fixture.recordCaptureBoundary(phase, details), true);
  }
  assert.equal(fixture.receipt.captureBoundaries.length, 6);
  assert.equal(JSON.stringify(fixture.receipt.captureBoundaries).includes(secret), false);
  const allowed = new Set(['sequence', 'phase', 'atUnixMs', 'matched', 'expectedPath', 'reset', 'fulfilled', 'passed']);
  for (const [index, row] of fixture.receipt.captureBoundaries.entries()) {
    assert.equal(row.sequence, index + 1);
    assert.ok(Number.isSafeInteger(row.atUnixMs));
    assert.ok(Object.keys(row).every(key => allowed.has(key)));
  }
});

test('retention stays bounded and reports dropped markers without growing the event list', () => {
  const receipt = {}, snapshots = [];
  const record = trace.createCaptureBoundaryRecorder(receipt, value => snapshots.push(value.captureBoundaries.length), () => 17);
  for (let i = 0; i < 100; i += 1) record('received');
  assert.equal(receipt.captureBoundaries.length, 32);
  assert.equal(receipt.captureBoundaryDropped, 68);
  assert.equal(receipt.captureBoundaries.at(-1).sequence, 32);
  assert.ok(snapshots.every(size => size <= 32));
});

test('clock, synchronous sink and rejecting sink failures remain isolated observations', async () => {
  const receipt = {};
  const record = trace.createCaptureBoundaryRecorder(receipt, () => { throw Error('sink failed'); }, () => { throw Error('clock failed'); });
  assert.equal(record('mounted'), true);
  assert.deepEqual(receipt.captureBoundaries, [{ sequence: 1, phase: 'mounted' }]);
  const asyncReceipt = {};
  const asyncRecord = trace.createCaptureBoundaryRecorder(asyncReceipt, () => Promise.reject(Error('async sink failed')));
  assert.equal(asyncRecord('readback-start'), true);
  await flush();
  assert.equal(asyncReceipt.captureBoundaries.length, 1);
});

test('broken recorder accessors, detail producers and immutable receipt arrays cannot escape observation', () => {
  assert.doesNotThrow(() => trace.observeCaptureBoundary(() => { throw Error('missing runtime'); }, 'received'));
  assert.doesNotThrow(() => trace.observeCaptureBoundary({ get recordCaptureBoundary() { throw Error('recorder getter'); } }, 'received'));
  assert.doesNotThrow(() => trace.observeCaptureBoundary({ recordCaptureBoundary() { throw Error('recorder'); } }, 'parsed'));
  const fixture = createFixture();
  assert.doesNotThrow(() => trace.observeCaptureBoundary(fixture, 'parsed', () => { throw Error('detail producer'); }));
  assert.deepEqual(fixture.receipt.captureBoundaries, []);
  assert.equal(fixture.recordCaptureBoundary('parsed', { get matched() { throw Error('detail getter'); } }), false);
  Object.freeze(fixture.receipt.captureBoundaries);
  assert.equal(fixture.recordCaptureBoundary('received'), false);
});

test('the installed native WHATWG Response is observed without extra reads, clones or promise replacement', async () => {
  const context = vm.createContext({ URL, URLSearchParams, console });
  vm.runInContext(fs.readFileSync(require.resolve('whatwg-fetch'), 'utf8'), context);
  const response = new context.Response('private synthetic response body');
  const originalText = response.text;
  let reads = 0, originalPromise;
  response.text = function (...args) { reads++; originalPromise = originalText.apply(this, args); return originalPromise; };
  response.clone = () => { throw Error('Observation must never clone'); };
  const receipt = {};
  const observe = trace.createReaderResponseObserver(receipt, () => {}, () => 23);
  assert.equal(observe(response, 'book'), response);
  assert.equal(reads, 0); assert.equal(response.bodyUsed, false);
  const pending = response.text();
  assert.equal(pending, originalPromise); assert.equal(reads, 1);
  assert.equal(await pending, 'private synthetic response body');
  await flush();
  assert.equal(response.bodyUsed, true);
  assert.deepEqual(receipt.readerResponseBoundaries.map(row => row.phase), ['response-ready', 'body-start', 'body-complete']);
  assert.equal(receipt.readerResponseBoundaries.at(-1).fulfilled, true);
  assert.equal(JSON.stringify(receipt).includes('private synthetic response body'), false);
  const rejected = response.text();
  assert.equal(rejected, originalPromise);
  const originalError = await originalPromise.catch(error => error);
  await assert.rejects(rejected, error => error === originalError);
  assert.equal(reads, 2, 'the second read was explicitly requested by this test, never by observation');
  assert.equal(receipt.readerResponseBoundaries.at(-1).fulfilled, false);
});

test('reader response tracing preserves receiver, arguments, result reference and synchronous error identity', async () => {
  const receipt = {}, receiver = {}, argument = {}, result = { privateValue: 'never recorded' };
  const promised = Promise.resolve(result);
  const response = { status: 200, text(...args) { assert.equal(this, receiver); assert.deepEqual(args, [argument]); return promised; } };
  const observe = trace.createReaderResponseObserver(receipt, () => { throw Error('sink failure'); });
  observe(response, 'reactions');
  const pending = response.text.call(receiver, argument);
  assert.equal(pending, promised); assert.equal(await pending, result);
  const failure = new Error('private synchronous body error');
  const broken = { status: 500, text() { throw failure; } };
  observe(broken, 'book');
  assert.throws(() => broken.text(), error => error === failure);
  assert.equal(receipt.readerResponseBoundaries.at(-1).fulfilled, false);
  assert.equal(JSON.stringify(receipt).includes('private'), false);
});

test('reader retention stays bounded independently of capture markers and never consumes unrequested bodies', () => {
  const fixture = createFixture();
  const receipt = fixture.receipt;
  const observe = trace.createReaderResponseObserver(receipt, () => {});
  let reads = 0;
  for (let i = 0; i < 100; i += 1) observe({ status: 200, text() { reads++; return Promise.resolve('unused'); } }, 'book');
  assert.equal(reads, 0);
  assert.equal(receipt.readerResponseBoundaries.length, 64);
  assert.equal(receipt.readerResponseDropped, 36);
  assert.equal(receipt.readerResponseBoundaries[0].id, 1);
  assert.equal(receipt.readerResponseBoundaries.at(-1).id, 100);
  fixture.recordCaptureBoundary('mounted');
  assert.equal(receipt.captureBoundaries.length, 1);
});

test('nonselected and nonextensible responses keep their original behavior without false body completion', async () => {
  const receipt = {}, observe = trace.createReaderResponseObserver(receipt, () => Promise.reject(Error('sink')));
  const ignored = { get text() { throw Error('unselected response must not be inspected'); } };
  assert.equal(observe(ignored, 'unrelated'), ignored);
  assert.deepEqual(receipt.readerResponseBoundaries, []);
  const response = Object.freeze({ status: 200, text: () => Promise.resolve('original') });
  assert.equal(observe(response, 'reactions'), response);
  assert.equal(await response.text(), 'original');
  await flush();
  assert.equal(receipt.readerResponseBoundaries[0].bodyObserved, false);
  assert.equal(receipt.readerResponseBoundaries.length, 1);
});

function load(file, imports) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const code = file.endsWith('.tsx') ? ts.transpileModule(source, {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText : source;
  vm.runInNewContext(code, { module, exports: module.exports, process: { env }, require: name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    throw Error('Unexpected capture dependency: ' + name);
  } }, { filename: file });
  return module.exports;
}

function runtime({ initialization, recorder } = {}) {
  const fixture = createFixture(), effects = [], states = [];
  if (recorder) fixture.recordCaptureBoundary = recorder;
  const session = { user: { id: OWNER }, refresh_token: 'private-synthetic-token' };
  const authStore = selector => selector({ session });
  authStore.getState = () => ({ session });
  let initializations = 0;
  const accountsStore = { getState: () => ({
    accounts: [{ id: OWNER, refresh_token: session.refresh_token }], currentId: OWNER,
    init() { initializations++; return initialization ? initialization() : Promise.resolve(); },
  }) };
  const readSavedAccount = load('tests/native/account-readback.cjs', {
    './backend-fixture.cjs': { OWNER }, './fixture-runtime.cjs': { fixtureRuntime: () => fixture },
    './capture-boundary-trace.cjs': trace,
  }).readSavedAccount;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, value => states.push(value)],
    useEffect: effect => effects.push(effect),
  };
  const Screen = load('tests/native/MemoryCaptureFixtureScreen.tsx', {
    react: React, 'react-native': { StyleSheet: { create: value => value }, View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity' },
    '../../src/components/memory/MemoryMovieExport': () => null,
    '../../src/stores/authStore': { useAuthStore: authStore }, '../../src/stores/accountsStore': { useAccountsStore: accountsStore },
    './memory-fixture.cjs': require('../native/memory-fixture.cjs'), './fixture-runtime.cjs': { fixtureRuntime: () => fixture },
    './memory-capture-observer.cjs': { getStatus: () => 'ready', subscribe: () => () => {} },
    './account-readback.cjs': { readSavedAccount }, './capture-boundary-trace.cjs': trace,
  }).default;
  return { fixture, session, authStore, accountsStore, readSavedAccount, effects, states,
    mount() { const rendered = Screen(); const cleanup = effects.map(effect => effect()); return { rendered, cleanup }; },
    get initializations() { return initializations; } };
}

test('actual capture component and readback helper record mount and one pending init before completion', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const r = runtime({ initialization: () => held });
  r.mount();
  assert.equal(r.initializations, 1);
  assert.deepEqual(r.fixture.receipt.captureBoundaries.map(row => row.phase), ['mounted', 'readback-start']);
  assert.deepEqual(r.fixture.receipt.accountReadbacks, []);
  release(); await flush();
  assert.equal(r.initializations, 1);
  const completed = r.fixture.receipt.captureBoundaries.at(-1);
  assert.equal(completed.phase, 'readback-complete');
  assert.equal(completed.fulfilled, true); assert.equal(completed.passed, true);
  assert.deepEqual(r.fixture.receipt.accountReadbacks, [{ passed: true, reloaded: true, accountCount: 1 }]);
  assert.equal(r.states.at(-1), true);
  assert.equal(JSON.stringify(r.fixture.receipt.captureBoundaries).includes(r.session.refresh_token), false);
});

test('an unfinished read may complete after component cleanup without creating another init or UI update', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const r = runtime({ initialization: () => held });
  const mounted = r.mount();
  mounted.cleanup.forEach(cleanup => cleanup?.());
  release(); await flush();
  assert.equal(r.initializations, 1);
  assert.equal(r.fixture.receipt.captureBoundaries.at(-1).phase, 'readback-complete');
  assert.equal(r.fixture.receipt.accountReadbacks.length, 1);
  assert.deepEqual(r.states, []);
});

test('actual readback retains the original rejection and emits no error contents', async () => {
  const failure = new Error('private keychain error detail');
  const r = runtime({ initialization: () => Promise.reject(failure) });
  await assert.rejects(r.readSavedAccount(r), error => error === failure);
  assert.equal(r.initializations, 1);
  assert.deepEqual(r.fixture.receipt.captureBoundaries.map(row => row.phase), ['readback-start', 'readback-complete']);
  assert.equal(r.fixture.receipt.captureBoundaries.at(-1).fulfilled, false);
  assert.equal(JSON.stringify(r.fixture.receipt.captureBoundaries).includes(failure.message), false);
});

test('failed diagnostics preserve successful actual readback and wrong-owner guards still precede init', async () => {
  const r = runtime({ recorder() { throw Error('diagnostics failed'); } });
  const result = await r.readSavedAccount(r);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { passed: true, reloaded: true, accountCount: 1 });
  assert.equal(r.initializations, 1);
  r.authStore.getState = () => ({ session: { ...r.session, user: { id: PEER } } });
  await assert.rejects(r.readSavedAccount(r), /synthetic owner/);
  assert.equal(r.initializations, 1);
});
