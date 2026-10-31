const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function load(file, mocks, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, console: { log() {} }, Date, setTimeout, clearTimeout,
    ...globals, require(name) { if (!(name in mocks)) throw Error('Unexpected import ' + name); return mocks[name]; } });
  return module.exports;
}

function fixture(options = {}) {
  const listeners = new Map(), voip = new Map(), removed = [], calls = [];
  let time = 1000, setupCount = 0, clears = 0;
  const native = {
    async setup() { setupCount++; if (options.failSetup && setupCount === 1) throw Error('setup unavailable'); await options.setup?.promise; },
    addEventListener(name, handler) { listeners.set(name, handler); return { remove() { removed.push(name); if (listeners.get(name) === handler) listeners.delete(name); } }; },
    getInitialEvents: () => options.initial?.promise ?? Promise.resolve(options.events ?? []),
    clearInitialEvents: () => { clears++; },
  };
  const push = {
    RNVoipPushRemoteNotificationsRegisteredEvent: 'registered',
    RNVoipPushRemoteNotificationReceivedEvent: 'received',
    addEventListener: (name, handler) => { assert.equal(voip.has(name), false, 'one dispatcher per VoIP event'); voip.set(name, handler); },
    registerVoipToken() {},
  };
  const shared = load('shared/notificationTap.ts', {});
  const { nativeCallService: service } = load('src/services/nativeCallService.ts', {
    'expo-constants': { nativeBuildVersion: '10', appOwnership: 'standalone' },
    'react-native': { Platform: { OS: options.platform ?? 'ios' } },
    '../../shared/notificationTap': shared,
    'react-native-callkeep': { default: native },
    'react-native-voip-push-notification': { default: push },
  }, { Date: { now: () => time } });
  return { service, listeners, voip, removed, calls,
    setupCount: () => setupCount, clears: () => clears, advance: ms => { time += ms; },
    attach(name = 'owner') { return service.listen({ onAnswer: id => calls.push([name, 'answer', id]), onEnd: id => calls.push([name, 'end', id]) }); },
    fire(name, value) { const fn = listeners.get(name); assert.ok(fn, name + ' listener registered'); fn(value); },
  };
}

test('native actions arriving during setup wait for the current owner and setup runs once', async () => {
  const setup = deferred(), h = fixture({ setup });
  const first = h.service.setup(), second = h.service.setup();
  h.fire('answerCall', { callUUID: A });
  assert.deepEqual(h.calls, []);
  h.attach();
  assert.deepEqual(h.calls, [['owner', 'answer', A]]);
  setup.resolve(); await Promise.all([first, second]); await flush();
  assert.equal(h.setupCount(), 1); assert.equal(h.calls.length, 1);
});

test('a native hangup before owner hydration supersedes its queued answer', async () => {
  const h = fixture(); await h.service.setup();
  h.fire('answerCall', { callUUID: A }); h.fire('endCall', { callUUID: A }); h.attach();
  assert.deepEqual(h.calls, [['owner', 'end', A]]);
});

test('cold initial answer and end actions replay as one final hangup', async () => {
  const h = fixture({ events: [
    { name: 'RNCallKeepPerformAnswerCallAction', data: { callUUID: A } },
    { name: 'RNCallKeepPerformEndCallAction', data: { callUUID: A } },
  ] });
  h.attach(); await flush();
  assert.deepEqual(h.calls, [['owner', 'end', A]]); assert.equal(h.clears(), 1);
});

test('native event, initial cache and didLoad replay never answer the same call twice', async () => {
  const initial = deferred(), h = fixture({ initial }); h.attach(); await flush();
  h.fire('answerCall', { callUUID: A });
  const events = [{ name: 'RNCallKeepPerformAnswerCallAction', data: { callUUID: A } }];
  h.fire('didLoadWithEvents', events); initial.resolve(events); await flush();
  assert.deepEqual(h.calls, [['owner', 'answer', A]]);
});

test('old owner teardown cannot remove a replacement owner or receive delayed initial actions', async () => {
  const initial = deferred(), h = fixture({ initial });
  const offA = h.attach('A'); await flush();
  const offB = h.attach('B'); offA();
  initial.resolve([{ name: 'RNCallKeepPerformAnswerCallAction', data: { callUUID: B } }]); await flush();
  assert.deepEqual(h.calls, [['B', 'answer', B]]);
  offB(); h.fire('endCall', { callUUID: B });
  assert.equal(h.calls.length, 1);
});

test('expired actions and malformed identifiers never reach a later listener', async () => {
  const h = fixture(); await h.service.setup();
  h.fire('answerCall', { callUUID: A }); h.fire('endCall', { callUUID: '../call' });
  h.advance(45_001); h.attach(); assert.deepEqual(h.calls, []);
});

test('failed native setup removes partial listeners and a later setup can recover', async () => {
  const h = fixture({ failSetup: true });
  assert.equal(await h.service.setup(), false); await flush();
  assert.equal(h.listeners.size, 0); assert.equal(h.removed.length, 4);
  assert.equal(await h.service.setup(), true); h.attach();
  h.fire('answerCall', { callUUID: A }); assert.equal(h.calls.length, 1);
});

test('VoIP token replay and call replay share one listener without replacing each other', async () => {
  const h = fixture(), tokens = [], reports = [];
  h.service.registerVoipToken(token => tokens.push(token));
  const offOld = h.service.listenForVoipPushes(id => reports.push(['old', id]));
  h.service.listenForVoipPushes((id, recipient) => reports.push(['current', id, recipient])); offOld();
  h.voip.get('didLoadWithEvents')([
    { name: 'registered', data: 'push-token' },
    { name: 'received', data: { uuid: A, recipient_id: B } },
  ]);
  assert.deepEqual(tokens, ['push-token']); assert.deepEqual(reports, [['current', A, B]]);
  h.service.registerVoipToken(token => tokens.push('new-' + token));
  assert.deepEqual(tokens, ['push-token', 'new-push-token']); assert.equal(h.voip.size, 3);
});
