const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { processLock } = require('@supabase/supabase-js');
const { createAuthDiagnostics } = require('../native/auth-diagnostics.cjs');
const { nativeAuthOverlay } = require('../../scripts/quality/native-ui-auth-overlay.cjs');
const root = path.resolve(__dirname, '../..');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('actual SDK locking keeps mutual exclusion and identifies the holder, waiter and pending storage span', async () => {
  const timerDescriptors = ['setTimeout', 'clearTimeout'].map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  let now = 0;
  const d = createAuthDiagnostics({ now: () => now });
  const read = deferred(), result = { privateValue: 'must-never-be-recorded' };
  const adapter = { getItem(key) { assert.equal(key, 'private-session-key'); return read.promise; }, setItem() {}, removeItem() {} };
  const storage = d.wrapStorage(adapter), lock = d.wrapLock(processLock), calls = [];
  const first = lock('private-lock-name', 1000, () => { calls.push(1); return storage.getItem('private-session-key'); });
  await flush(); now = 5;
  const second = lock('private-lock-name', 1000, async () => { calls.push(2); return result; });
  await flush(); now = 13;
  const pending = d.snapshot();
  assert.deepEqual(calls, [1]);
  assert.equal(pending.activeLocks.length, 1); assert.equal(pending.waitingLocks.length, 1);
  assert.equal(pending.activeStorage.length, 1);
  assert.deepEqual(pending.activeStorage[0].activeLockOperationIds, [pending.activeLocks[0].operationId]);
  assert.equal(pending.activeLocks[0].holdMs, 13); assert.equal(pending.waitingLocks[0].waitMs, 8);
  read.resolve(result); assert.equal(await first, result); assert.equal(await second, result);
  assert.deepEqual(calls, [1, 2]);
  const final = d.snapshot();
  assert.deepEqual(final.activeLocks, []); assert.deepEqual(final.waitingLocks, []); assert.deepEqual(final.activeStorage, []);
  assert.equal(final.events.filter(row => row.kind === 'lock' && row.phase === 'released').length, 2);
  for (const name of ['setTimeout', 'clearTimeout']) {
    const observed = final.events.filter(row => row.kind === 'lock').map(row => row.timerApis[name]);
    assert.ok(observed.every(value => value.kind === 'function' && value.id > 0));
    assert.equal(new Set(observed.map(value => value.id)).size, 1);
  }
  assert.deepEqual(['setTimeout', 'clearTimeout'].map(name => Object.getOwnPropertyDescriptor(globalThis, name)), timerDescriptors);
  assert.doesNotMatch(JSON.stringify(final), /private-lock-name|private-session-key|must-never-be-recorded/);
});

test('lock wrapper preserves receiver, timeout arguments, callback arguments and result references', async () => {
  const d = createAuthDiagnostics(), receiver = {}, callbackReceiver = {}, callbackArgument = {}, result = {};
  const original = function (name, timeout, fn) {
    assert.equal(this, receiver); assert.equal(name, 'secret-key'); assert.equal(timeout, -1);
    return fn.call(callbackReceiver, callbackArgument);
  };
  assert.equal(d.wrapLock(original).call(receiver, 'secret-key', -1, function (value) {
    assert.equal(this, callbackReceiver); assert.equal(value, callbackArgument); return result;
  }), result);
  assert.equal(d.snapshot().events[0].acquireTimeoutMs, -1);
});

test('acquisition timeout retains the original error without invoking work or recording error content', async () => {
  const error = Object.assign(new Error('private error token'), { isAcquireTimeout: true, privateSession: 'private payload' });
  const d = createAuthDiagnostics(); let called = false;
  const lock = d.wrapLock((name, timeout) => { assert.equal(name, 'private lock'); assert.equal(timeout, 5000); return Promise.reject(error); });
  await assert.rejects(lock('private lock', 5000, () => { called = true; }), e => e === error);
  assert.equal(called, false); assert.deepEqual(d.snapshot().waitingLocks, []);
  assert.equal(d.snapshot().events.at(-1).outcome, 'acquire-timeout');
  assert.doesNotMatch(JSON.stringify(d.snapshot()), /private|Error|stack/);
});

test('callback and storage failures retain rejection identity and leave no false active operation', async () => {
  for (const asynchronous of [false, true]) {
    const error = new Error('never store this error');
    const d = createAuthDiagnostics(), fail = () => { if (asynchronous) return Promise.reject(error); throw error; };
    const lock = d.wrapLock((_name, _timeout, fn) => fn());
    if (asynchronous) await assert.rejects(lock('key', 5000, fail), e => e === error);
    else assert.throws(() => lock('key', 5000, fail), e => e === error);
    const storage = d.wrapStorage({ getItem: fail, setItem: fail, removeItem: fail });
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      if (asynchronous) await assert.rejects(storage[method]('key', 'secret'), e => e === error);
      else assert.throws(() => storage[method]('key', 'secret'), e => e === error);
    }
    assert.deepEqual(d.snapshot().activeLocks, []); assert.deepEqual(d.snapshot().activeStorage, []);
    assert.doesNotMatch(JSON.stringify(d.snapshot()), /secret|never store|stack/);
  }
});

test('storage arguments, optional callbacks, receiver and resolved values survive observation', async () => {
  const calls = [], value = { session: 'private value' }, callback = () => {}, d = createAuthDiagnostics();
  const adapter = Object.fromEntries(['getItem', 'setItem', 'removeItem'].map(method => [method, function (...args) {
    assert.equal(this, adapter); calls.push([method, ...args]); return Promise.resolve(value);
  }]));
  adapter.isServer = false;
  const wrapped = d.wrapStorage(adapter);
  assert.equal(wrapped.isServer, false);
  for (const method of ['getItem', 'setItem', 'removeItem']) assert.equal(await wrapped[method]('private key', value, callback), value);
  assert.deepEqual(calls.map(row => row.slice(1)), Array(3).fill(['private key', value, callback]));
  assert.equal(new Set(d.snapshot().events.map(row => row.storageId)).size, 1);
  assert.doesNotMatch(JSON.stringify(d.snapshot()), /private|session|callback/);
});

test('event retention is bounded while preserving startup and recent observations', () => {
  const d = createAuthDiagnostics({ maxEvents: 16 });
  const storage = d.wrapStorage({ getItem: () => null, setItem() {}, removeItem() {} });
  for (let i = 0; i < 100; i++) storage.getItem('unrecorded-' + i);
  const result = d.snapshot();
  assert.equal(result.events.length, 16); assert.equal(result.droppedEvents, 184);
  assert.equal(result.events[0].operationId, 1); assert.equal(result.events.at(-1).operationId, 100);
  assert.equal(result.events.at(-1).storageId, 0, 'resource IDs are bounded too');
  assert.doesNotMatch(JSON.stringify(result), /unrecorded/);
});

test('diagnostic clock and sink errors cannot change auth results', async () => {
  const d = createAuthDiagnostics({ now() { throw Error('clock failed'); }, onChange() { throw Error('sink failed'); } });
  const value = {};
  assert.equal(await d.wrapLock((_key, _timeout, fn) => fn())('key', 5000, () => Promise.resolve(value)), value);
  assert.equal(d.snapshot().atMs, 0); assert.deepEqual(d.snapshot().activeLocks, []);
});

test('timer descriptors identify lazy getters without invoking or changing them', async () => {
  const target = {}; let getters = 0;
  for (const name of ['setTimeout', 'clearTimeout']) Object.defineProperty(target, name, { configurable: true, get() { getters++; throw Error('A timer getter must not run during observation'); } });
  const before = Object.getOwnPropertyDescriptors(target), d = createAuthDiagnostics({ timerTarget: target });
  const result = {}; assert.equal(await d.wrapLock(processLock)('descriptor-observation', 1000, async () => result), result);
  assert.equal(getters, 0); assert.deepEqual(Object.getOwnPropertyDescriptors(target), before);
  const events = d.snapshot().events.filter(row => row.kind === 'lock');
  assert.deepEqual(events.map(row => row.phase), ['requested', 'acquired', 'released', 'settled']);
  assert.ok(events.every(row => row.timerApis.setTimeout.kind === 'getter' && row.timerApis.clearTimeout.kind === 'getter'));
  assert.equal(new Set(events.map(row => row.timerApis.setTimeout.id)).size, 1);
});

test('timer replacement is visible between lock phases and snapshot mutation cannot rewrite retained evidence', async () => {
  const target = { setTimeout() {}, clearTimeout() {} }, d = createAuthDiagnostics({ timerTarget: target });
  const gate = deferred(), lock = d.wrapLock((_name, _timeout, fn) => gate.promise.then(fn));
  const work = lock('key', 5000, async () => 'ok');
  target.clearTimeout = function replacement() {};
  gate.resolve(); assert.equal(await work, 'ok');
  const events = d.snapshot().events;
  assert.equal(events[0].timerApis.setTimeout.id, events[1].timerApis.setTimeout.id);
  assert.notEqual(events[0].timerApis.clearTimeout.id, events[1].timerApis.clearTimeout.id);
  events[0].timerApis.clearTimeout.id = 999;
  assert.notEqual(d.snapshot().events[0].timerApis.clearTimeout.id, 999);
});

test('timer descriptor failures and bounded identity overflow preserve auth behavior', () => {
  const inaccessible = new Proxy({}, { getOwnPropertyDescriptor() { throw Error('private inspection failure'); } });
  const failed = createAuthDiagnostics({ timerTarget: inaccessible });
  assert.equal(failed.wrapLock((_name, _timeout, fn) => fn())('private', 5000, () => 7), 7);
  assert.equal(failed.snapshot().events[0].timerApis.setTimeout.kind, 'unavailable');
  const target = {}, d = createAuthDiagnostics({ timerTarget: target, maxEvents: 16 });
  const lock = d.wrapLock((_name, _timeout, fn) => fn());
  for (let i = 0; i < 100; i++) { target.setTimeout = () => {}; target.clearTimeout = () => {}; assert.equal(lock('key', 5000, () => i), i); }
  const snapshot = d.snapshot(); assert.equal(snapshot.timerApiIdentityCount, 32); assert.equal(snapshot.timerApiIdentityLimitReached, true);
  assert.equal(snapshot.events.length, 16); assert.ok(snapshot.events.every(row => row.timerApis.setTimeout.id <= 32));
  assert.doesNotMatch(JSON.stringify(failed.snapshot()), /private|failure|stack/);
});

test('one finite wall-clock anchor pairs with the first monotonic observation without changing relative durations', () => {
  let now = 100, wall = 1700000000000, calls = 0;
  const d = createAuthDiagnostics({ now: () => now, wallNow: () => { calls++; return wall; } });
  const lock = d.wrapLock((_name, _timeout, fn) => fn());
  assert.equal(lock('key', 5000, () => { now += 25; wall += 900; return 8; }), 8);
  const snapshot = d.snapshot(); assert.equal(snapshot.wallClockOriginMs, 1700000000000); assert.equal(snapshot.atMs, 25); assert.equal(calls, 1);
  for (const wallNow of [() => NaN, () => { throw Error('clock failure'); }]) {
    const bad = createAuthDiagnostics({ now: () => 10, wallNow });
    assert.equal(bad.wrapLock((_name, _timeout, fn) => fn())('key', 5000, () => 9), 9); assert.equal(bad.snapshot().wallClockOriginMs, null);
  }
});

function nativeModule({ env = {}, wrongTransport = false, write } = {}) {
  const callbacks = [], writes = [], fetch = () => {}, fixture = { fetch }, module = { exports: {} };
  let requiredFilesystem = false;
  const context = {
    module, exports: module.exports,
    process: { env: { EXPO_PUBLIC_APP_ENV: 'qa', EXPO_PUBLIC_SUPABASE_URL: 'https://uaulhuelcfkjwojtymmw.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'native-ui-synthetic-no-provider-key', ...env } },
    fetch: wrongTransport ? () => {} : fetch, Date, performance: { now: () => 1 },
    setTimeout(fn, ms) { assert.equal(ms, 250); callbacks.push(fn); return callbacks.length; },
    require(name) {
      if (name === './fixture-runtime.cjs') return { fixtureRuntime: () => fixture };
      assert.equal(name, 'expo-file-system/legacy'); requiredFilesystem = true;
      return { documentDirectory: 'file:///synthetic/', writeAsStringAsync(file, text) {
        assert.equal(file, 'file:///synthetic/native-ui-auth-diagnostics.json');
        const value = JSON.parse(text); writes.push(value); return write ? write(value) : Promise.resolve();
      } };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'tests/native/auth-diagnostics.cjs'), 'utf8'), context);
  return { factory: module.exports.nativeAuthDiagnostics, callbacks, writes, requiredFilesystem: () => requiredFilesystem };
}

test('native factory rejects production or real-provider configuration before filesystem access', () => {
  for (const options of [{ env: { EXPO_PUBLIC_APP_ENV: 'production' } }, { env: { EXPO_PUBLIC_SUPABASE_ANON_KEY: 'real-key' } },
    { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://another-project.invalid' } }, { wrongTransport: true }]) {
    const h = nativeModule(options); assert.throws(h.factory); assert.equal(h.requiredFilesystem(), false);
  }
});

test('native trace writes are batched, serialized, isolated from storage and recover after failure', async () => {
  const first = deferred(); let count = 0;
  const h = nativeModule({ write() { count++; return count === 1 ? first.promise : Promise.resolve(); } });
  const d = h.factory(); assert.equal(h.factory(), d);
  const storage = d.wrapStorage({ getItem: () => 'secret', setItem() {}, removeItem() {} });
  storage.getItem('secret'); storage.getItem('secret'); assert.equal(h.callbacks.length, 1);
  h.callbacks.shift()(); await flush(); assert.equal(h.writes.length, 1);
  storage.getItem('secret'); h.callbacks.shift()(); await flush();
  assert.equal(h.writes.length, 1, 'second snapshot cannot overtake the pending first write');
  for (let i = 0; i < 25; i++) { storage.getItem('secret'); h.callbacks.shift()(); await flush(); }
  assert.equal(h.writes.length, 1, 'a stalled disk keeps only the latest queued snapshot');
  first.reject(Error('private file failure')); await flush();
  assert.equal(h.writes.length, 2); assert.equal(h.writes[0].totalOperations, 2); assert.equal(h.writes[1].totalOperations, 28);
  assert.doesNotMatch(JSON.stringify(h.writes), /secret|private file failure/);
});

test('disposable source overlay changes only the reviewed three anchors and retains SDK lock and storage', () => {
  const original = fs.readFileSync(path.join(root, 'src/services/supabase.ts'), 'utf8');
  const next = nativeAuthOverlay(original);
  const restored = next.replace("\nconst nativeAuthTiming = require('../../tests/native/auth-diagnostics.cjs').nativeAuthDiagnostics();", '')
    .replace('nativeAuthTiming.wrapStorage(AsyncStorage)', 'AsyncStorage').replace('nativeAuthTiming.wrapLock(processLock)', 'processLock');
  assert.equal(restored, original); assert.doesNotMatch(next, /lockAcquireTimeout/);
  assert.throws(() => nativeAuthOverlay(next), /already contains/);
  assert.throws(() => nativeAuthOverlay(original.replace('lock: processLock,', 'lock: changedLock,')), /one reviewed/);
  assert.throws(() => nativeAuthOverlay(original + '\nlock: processLock,'), /one reviewed/);
});

test('disposable preparation retains diagnostic source, original auth hash and exact overlay content', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'platinum-auth-overlay-'));
  const authPath = 'src/services/supabase.ts';
  const originalAuth = fs.readFileSync(path.join(root, authPath));
  const sha = value => crypto.createHash('sha256').update(value).digest('hex');
  const required = ['App.tsx', 'index.js', 'app.config.js', 'package-lock.json', authPath, 'src/navigation/AppNavigator.tsx',
    'modules/boomerang/ios/BoomerangModule.swift', 'modules/boomerang/android/src/main/java/expo/modules/boomerang/BoomerangModule.kt',
    'modules/boomerang/memoryComposition.ts', 'tests/native/auth-diagnostics.cjs', 'tests/native/entry.js',
    'scripts/quality/prepare-native-ui.cjs', 'scripts/quality/native-ui-auth-overlay.cjs', 'scripts/quality/native-ui-ios-entitlements.py', 'scripts/quality/native-ui-ios-url-trace.py', 'scripts/quality/verify-native-ui.cjs',
    'scripts/quality/install-native-ui-tools.sh', 'scripts/quality/run-native-ui-flows.sh', 'scripts/quality/native-ui-flow-results.py', 'scripts/quality/test-ios-app-ui.sh', 'scripts/quality/test-android-app-ui.sh',
    'scripts/quality/native-ui-emulator-diagnostics.py', 'scripts/quality/native-ui-emulator-graphics.py', 'scripts/quality/native-ui-emulator-host-diagnostics.py', 'scripts/quality/verify-native-ui-memory.py', '.github/workflows/native-app-ui.yml'];
  const dependencyFiles = {
    '@supabase/supabase-js': ['package.json', 'dist/index.cjs', 'dist/index.mjs'],
    '@supabase/auth-js': ['package.json', 'src/lib/locks.ts', 'dist/main/index.js', 'dist/module/index.js', 'dist/main/lib/locks.js', 'dist/module/lib/locks.js'],
  };
  for (const [name, selected] of Object.entries(dependencyFiles)) required.push(...selected.map(file => 'node_modules/' + name + '/' + file));
  try {
    for (const file of required) {
      fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
      fs.copyFileSync(path.join(root, file), path.join(directory, file));
    }
    fs.mkdirSync(path.join(directory, 'shared'));
    const env = { ...process.env, CI: 'true', EXPO_PUBLIC_APP_ENV: 'qa',
      EXPO_PUBLIC_SUPABASE_URL: 'https://uaulhuelcfkjwojtymmw.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'native-ui-synthetic-no-provider-key',
      GITHUB_SHA: 'fixture-head', GITHUB_RUN_ID: 'fixture-run' };
    const rejected = spawnSync(process.execPath, ['scripts/quality/prepare-native-ui.cjs'], { cwd: directory, env: { ...env, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'real-provider-key' }, encoding: 'utf8', timeout: 5000 });
    assert.notEqual(rejected.status, 0); assert.deepEqual(fs.readFileSync(path.join(directory, authPath)), originalAuth);
    const result = spawnSync(process.execPath, ['scripts/quality/prepare-native-ui.cjs'], { cwd: directory, env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'native-ui-logs/source.json')));
    for (const [name, selected] of Object.entries(dependencyFiles)) {
      const dependency = manifest.dependencyProvenance[name], installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json')));
      assert.equal(dependency.installedVersion, installed.version); assert.equal(dependency.matchesLockedVersion, true);
      assert.ok(dependency.requireEntry.startsWith('node_modules/' + name + '/'));
      for (const file of selected) assert.equal(dependency.files[file], sha(fs.readFileSync(path.join(root, 'node_modules', name, file))));
    }
    const overlay = manifest.overlays.find(row => row.file === authPath);
    assert.equal(overlay.before, sha(originalAuth)); assert.equal(manifest.hashes[authPath], sha(originalAuth));
    const generated = fs.readFileSync(path.join(directory, authPath));
    assert.equal(overlay.after, sha(generated));
    assert.deepEqual(fs.readFileSync(path.join(directory, 'native-ui-logs', overlay.retained)), generated);
    for (const file of ['tests/native/auth-diagnostics.cjs', 'scripts/quality/native-ui-auth-overlay.cjs', 'scripts/quality/native-ui-ios-url-trace.py', 'scripts/quality/native-ui-emulator-graphics.py', 'scripts/quality/native-ui-emulator-host-diagnostics.py']) {
      assert.equal(manifest.hashes[file], sha(fs.readFileSync(path.join(root, file))));
    }
    assert.deepEqual(fs.readFileSync(path.join(root, authPath)), originalAuth, 'production source was never changed');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
