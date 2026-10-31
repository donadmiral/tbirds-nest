const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const A = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002';
const CALL = '10000000-0000-4000-8000-000000000003';
const DEFAULT = 'expo.modules.notifications.actions.DEFAULT';
const response = (identifier = 'notice-1', actionIdentifier = DEFAULT, data = { type: 'message', conversation_id: CALL, recipient_id: A }) => ({
  actionIdentifier, notification: { request: { identifier, content: { data } } },
});
function timerFixture() {
  let time = 0, next = 1; const pending = new Map();
  return { pending,
    setTimeout(fn, delay) { const id = next++; pending.set(id, { at: time + delay, fn }); return id; },
    clearTimeout(id) { pending.delete(id); },
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        const due = [...pending].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        time = due[1].at; pending.delete(due[0]); due[1].fn(); await flush();
      }
      time = end; await flush();
    },
  };
}
function load(code, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, AbortController, Promise, Set, Map, console, ...globals });
  return module.exports;
}
function harness(options = {}) {
  const timers = timerFixture(), callbacks = new Set(), handled = [], consumed = [];
  let session = options.cold ? null : { scope: 'A:session-1', userId: A, accessToken: 'original-token-A' }, ready = options.ready !== false;
  const library = load(fs.readFileSync(path.join(root, 'shared/notificationTap.ts'), 'utf8'), timers);
  const controller = library.createNotificationTapController({ session: () => session, ready: () => ready,
    subscribeScope(fn) { callbacks.add(fn); return () => callbacks.delete(fn); }, deadlineMs: 5000,
    handle(data, action, context) { handled.push({ data, action, context }); return options.handle?.(data, action, context); },
    consumed(identifier, action) { consumed.push({ identifier, action }); },
  });
  return { timers, callbacks, controller, library, handled, consumed,
    ready(value) { ready = value; },
    session(value) { session = value; callbacks.forEach(fn => fn()); },
  };
}

test('cold and live notification delivery share one action and one acknowledgement', async () => {
  const gate = deferred(), h = harness({ handle: () => gate.promise });
  const first = h.controller.receive(response()), second = h.controller.receive(response());
  assert.equal(first, second); await flush(); assert.equal(h.handled.length, 1);
  gate.resolve(); await first; await flush();
  await h.controller.receive(response());
  assert.equal(h.handled.length, 1); assert.equal(h.consumed.length, 1); assert.equal(h.timers.pending.size, 0);
  h.controller.dispose();
});

test('cold Auth hydration binds the first account and waits for its ready navigation', async () => {
  const h = harness({ cold: true, ready: false }), task = h.controller.receive(response());
  await h.timers.advance(100); assert.equal(h.handled.length, 0);
  h.session({ scope: 'A:restored', userId: A, accessToken: 'restored-A-token' });
  await flush(); assert.equal(h.handled.length, 0);
  h.ready(true); await h.timers.advance(100); await task;
  assert.equal(h.handled.length, 1); assert.equal(h.handled[0].context.accessToken, 'restored-A-token');
  assert.equal(h.timers.pending.size, 0); h.controller.dispose();
});

test('unready navigation expires without leaving the old recursive polling timer behind', async () => {
  const h = harness({ ready: false }), task = h.controller.receive(response());
  await h.timers.advance(5000); await task;
  assert.equal(h.handled.length, 0); assert.equal(h.timers.pending.size, 0);
  h.ready(true); await h.timers.advance(60000);
  assert.equal(h.handled.length, 0); assert.equal(h.timers.pending.size, 0); h.controller.dispose();
});

test('an A to B to A account switch aborts a pending action and fences its late result', async () => {
  const gate = deferred(), navigated = [];
  const h = harness({ handle: async (_data, _action, context) => { await gate.promise; if (context.current()) navigated.push(context.userId); } });
  const task = h.controller.receive(response()); await flush();
  h.session({ scope: 'B:session-2', userId: B, accessToken: 'token-B' });
  h.session({ scope: 'A:session-3', userId: A, accessToken: 'token-A-new' });
  await task; assert.equal(h.handled[0].context.signal.aborted, true);
  gate.resolve(); await flush(); assert.deepEqual(navigated, []); assert.deepEqual(h.consumed, []);
  assert.equal(h.timers.pending.size, 0); h.controller.dispose();
});

test('deadline settles an uncooperative pending transport and cleanup blocks later responses', async () => {
  const h = harness({ handle: () => new Promise(() => {}) }), task = h.controller.receive(response());
  await flush(); await h.timers.advance(5000); await task;
  assert.equal(h.handled[0].context.signal.aborted, true); assert.equal(h.timers.pending.size, 0);
  h.controller.dispose(); assert.equal(h.callbacks.size, 0);
  await h.controller.receive(response('after-unmount')); assert.equal(h.handled.length, 1);
});

test('decline works without navigation but only for a valid incoming call', async () => {
  const h = harness({ ready: false });
  await h.controller.receive(response('call', 'decline', { type: 'incoming_call', callId: CALL, recipient_id: A }));
  assert.equal(h.handled.length, 1); assert.equal(h.handled[0].data.call_id, CALL); assert.equal(h.handled[0].action, 'decline');
  await h.controller.receive(response('not-call', 'decline'));
  await h.controller.receive(response('invalid-call', 'decline', { type: 'incoming_call', call_id: { unsafe: CALL } }));
  assert.equal(h.handled.length, 1); h.controller.dispose();
});

test('another account, malformed routing and unknown actions cannot route or mutate', async () => {
  const h = harness();
  for (const value of [response('other', DEFAULT, { type: 'message', recipient_id: B }), response('bad-owner', DEFAULT, { type: 'message', recipient_id: {} }),
    response('bad-type', DEFAULT, { type: [] }), response('bad-action', 'unexpected-action')]) await h.controller.receive(value);
  assert.equal(h.handled.length, 0); assert.equal(h.timers.pending.size, 0);
  const parsed = h.library.notificationTapData({ type: 'comment', post_id: CALL, comment_id: '../path', conversation_id: {}, extra: 'untrusted' });
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), { type: 'comment', post_id: CALL });
  h.controller.dispose();
});

test('a failed action may be retried and notification storms have a bounded pending queue', async () => {
  let attempts = 0;
  const h = harness({ handle: () => { if (++attempts === 1) throw Error('temporary'); } });
  await h.controller.receive(response()); assert.equal(h.consumed.length, 0);
  await h.controller.receive(response()); assert.equal(h.consumed.length, 1); h.controller.dispose();
  const waiting = harness({ ready: false });
  for (let i = 0; i < 100; i++) void waiting.controller.receive(response('pending-' + i));
  assert.equal(waiting.timers.pending.size, 32, '16 jobs each own one expiry and one readiness timer');
  waiting.controller.dispose(); assert.equal(waiting.timers.pending.size, 0);
});

function navigatorHarness(options = {}) {
  const timers = timerFixture(), listeners = new Set(), navigations = [], calls = [], guards = [], acknowledgements = [];
  const auth = { session: { user: { id: A }, access_token: 'captured-A-token' }, profile: { username: 'qa' }, loading: false, isPasswordRecovery: false };
  let scope = 'A:one', listener, cleanup, activeCall = null, last = null;
  const initial = deferred();
  const source = fs.readFileSync(path.join(root, 'src/navigation/AppNavigator.tsx'), 'utf8');
  const selected = source.slice(source.indexOf('function useNotificationTapHandler() {'), source.indexOf('\nfunction useBadgeClearOnForeground()'));
  const pure = load(fs.readFileSync(path.join(root, 'shared/notificationTap.ts'), 'utf8'), timers);
  const notifications = {
    addNotificationResponseReceivedListener(fn) { listener = fn; return { remove() { listener = null; } }; },
    getLastNotificationResponseAsync() { return last ? Promise.resolve(last) : initial.promise; },
    async clearLastNotificationResponseAsync() { acknowledgements.push(last?.notification.request.identifier); last = null; },
  };
  const supabase = { from(table) {
    const query = { table, headers: {}, select() { return query; }, eq() { return query; },
      setHeader(key, value) { query.headers[key] = value; return query; }, abortSignal(signal) { query.signal = signal; return query; },
      maybeSingle() { calls.push(query); return options.profileRead?.(query) ?? Promise.resolve({ data: { id: B, full_name: 'QA caller' } }); } };
    return query;
  } };
  const call = { id: CALL, caller_id: B, receiver_id: A, channel_id: CALL, is_group_call: false, is_video: true, status: 'ringing', conversation_id: null };
  const module = load(selected + '\nmodule.exports = { useNotificationTapHandler };', {
    ...timers, ...pure, useEffect(fn) { cleanup = fn(); }, useAuthStore: { getState: () => auth },
    navigationScope: () => scope, subscribeNavigationScope(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    navigationRef: { current: { isReady: () => true, navigate(...args) { navigations.push(args); } } },
    Notifications: notifications, supabase,
    callService: { async getCall(id, context) { calls.push({ id, context }); return options.getCall ? options.getCall(id, context, call) : call; },
      async declineCall(id, context) { calls.push({ decline: id, context }); return options.declineCall ? options.declineCall(id, context) : true; },
      async declineGroupCall(id, userId, context) { calls.push({ declineGroup: id, userId, context }); } },
    setActiveCallNavId(id) { activeCall = id; guards.push(id); },
    isCallNavActive(id) { return id ? activeCall === id : !!activeCall; }, clearCallNavGuard() { activeCall = null; guards.push(null); },
  });
  module.useNotificationTapHandler();
  return { timers, calls, guards, navigations, initial, auth, acknowledgements, cleanup: () => cleanup(),
    receive(value) { last = value; listener(value); },
    switchAccount() { scope = 'B:two'; auth.session = { user: { id: B }, access_token: 'new-B-token' }; listeners.forEach(fn => fn()); },
  };
}

test('actual hook ignores a delayed cold response after a live tap and validates route IDs', async () => {
  const h = navigatorHarness();
  h.receive(response('new-live'));
  h.initial.resolve(response('old-cold', DEFAULT, { type: 'comment', post_id: A })); await flush();
  assert.equal(h.navigations.length, 1); assert.equal(h.navigations[0][0], 'Chat');
  h.receive(response('unsafe-route', DEFAULT, { type: 'message', conversation_id: '../other' })); await flush();
  assert.equal(h.navigations.length, 1); h.cleanup(); assert.equal(h.timers.pending.size, 0);
});

test('actual call tap releases its navigation reservation on account switch during profile loading', async () => {
  const profile = deferred(), h = navigatorHarness({ profileRead: () => profile.promise });
  h.receive(response('call-open', 'answer', { type: 'incoming_call', call_id: CALL, recipient_id: A })); await flush();
  assert.deepEqual(h.guards, [CALL]);
  const query = h.calls.find(value => value.table === 'profiles'); assert.equal(query.headers.Authorization, 'Bearer captured-A-token');
  h.switchAccount(); assert.equal(query.signal.aborted, true); assert.deepEqual(h.guards, [CALL, null]);
  profile.resolve({ data: { id: B, full_name: 'Old result' } }); await flush();
  assert.deepEqual(h.navigations, []); h.cleanup(); assert.equal(h.timers.pending.size, 0);
});

test('actual direct-call decline uses the captured account and never also declines a group call', async () => {
  const h = navigatorHarness(); h.auth.profile = null;
  h.receive(response('call-decline', 'decline', { type: 'incoming_call', call_id: CALL, recipient_id: A })); await flush();
  const declines = h.calls.filter(value => value.decline || value.declineGroup);
  assert.equal(declines.length, 1); assert.equal(declines[0].decline, CALL);
  assert.equal(declines[0].context.accessToken, 'captured-A-token'); assert.deepEqual(h.navigations, []); h.cleanup();
});

test('failed direct decline stays retryable until the stored call confirms the action', async () => {
  let attempts = 0;
  const h = navigatorHarness({ declineCall: () => ++attempts > 1 });
  const tap = response('retry-decline', 'decline', { type: 'incoming_call', call_id: CALL, recipient_id: A });
  h.receive(tap); await flush(); assert.deepEqual(h.acknowledgements, []);
  h.receive(tap); await flush(); assert.equal(attempts, 2); assert.deepEqual(h.acknowledgements, ['retry-decline']);
  h.cleanup();
});

test('a failed call lookup cannot consume the decline response or replace an authoritative missing result', async () => {
  let failing = true;
  const h = navigatorHarness({ getCall: (_id, context) => { assert.equal(context.throwOnError, true); if (failing) throw Error('offline'); return null; } });
  const tap = response('retry-read', 'decline', { type: 'incoming_call', call_id: CALL, recipient_id: A });
  h.receive(tap); await flush(); assert.deepEqual(h.acknowledgements, []);
  failing = false; h.receive(tap); await flush(); assert.deepEqual(h.acknowledgements, ['retry-read']); h.cleanup();
});

test('exhausted call-open transport retries preserve the notification for another attempt', async () => {
  let failing = true;
  const h = navigatorHarness({ getCall: (_id, context, call) => { assert.equal(context.throwOnError, true); if (failing) throw Error('offline'); return call; } });
  const tap = response('retry-open', 'answer', { type: 'incoming_call', call_id: CALL, recipient_id: A });
  h.receive(tap); await flush(); await h.timers.advance(1500);
  assert.equal(h.calls.filter(value => value.id === CALL).length, 3); assert.deepEqual(h.acknowledgements, []); assert.deepEqual(h.navigations, []);
  failing = false; h.receive(tap); await flush();
  assert.equal(h.navigations.length, 1); assert.deepEqual(h.acknowledgements, ['retry-open']); h.cleanup();
});

test('actual pinned call transport propagates errors while retaining the legacy optional contract', async () => {
  const requests = [], failure = Error('database unavailable');
  const supabase = { from(table) {
    const request = { table, headers: {} }; requests.push(request);
    const query = { select() { return query; }, update() { return query; }, eq() { return query; }, maybeSingle() { return query; },
      setHeader(key, value) { request.headers[key] = value; return query; }, abortSignal(signal) { request.signal = signal; return query; },
      then(resolve, reject) { return Promise.resolve({ data: null, error: failure }).then(resolve, reject); } };
    return query;
  } };
  const { callService } = load(fs.readFileSync(path.join(root, 'src/services/callService.ts'), 'utf8'), {
    require(name) { assert.equal(name, './supabase'); return { supabase }; },
  });
  const options = { accessToken: 'original-account-token', signal: new AbortController().signal, throwOnError: true };
  await assert.rejects(callService.getCall(CALL, options), /database unavailable/);
  await assert.rejects(callService.declineCall(CALL, options), /database unavailable/);
  assert.ok(requests.every(request => request.headers.Authorization === 'Bearer original-account-token' && request.signal === options.signal));
  assert.equal(await callService.getCall(CALL), null); assert.equal(await callService.declineCall(CALL), false);
});
