const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const C = '10000000-0000-4000-8000-000000000003';
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, AbortController, Date, setTimeout, clearTimeout,
    console: { log() {} }, ...globals,
    require(name) { if (!(name in mocks)) throw Error('Unmocked ' + name); return mocks[name]; },
  });
  return module.exports;
}
function fixture(options = {}) {
  const subscriptions = new Set(), requests = [], writes = [];
  let session = { user: { id: A }, access_token: 'captured-A-token' }, calls = 0;
  const record = { id: C, caller_id: B, receiver_id: A, channel_id: C, conversation_id: C,
    is_group_call: !!options.group, is_video: true, status: 'ringing', created_at: new Date().toISOString() };
  const callService = {
    async getCall(id, request) { requests.push({ kind: 'call', id, request }); calls++; return options.getCall ? options.getCall(record, calls, request) : record; },
    async declineCall(id, request) { writes.push({ kind: 'direct', id, request }); return options.decline ? options.decline() : true; },
    async declineGroupCall(id, userId, request) { writes.push({ kind: 'group', id, userId, request }); if (options.declineError) throw Error('offline'); },
  };
  const supabase = {
    auth: {
      getSession: () => options.sessionGate?.promise ?? Promise.resolve({ data: { session }, error: null }),
      onAuthStateChange(fn) { subscriptions.add(fn); return { data: { subscription: { unsubscribe: () => subscriptions.delete(fn) } } }; },
    },
    from(table) {
      const query = { kind: table, headers: {}, filters: {}, select(fields) { query.fields = fields; return query; },
        eq(key, value) { query.filters[key] = value; return query; },
        setHeader(key, value) { query.headers[key] = value; return query; },
        abortSignal(signal) { query.signal = signal; return query; },
        async maybeSingle() {
          requests.push(query);
          if (options.query) return options.query(table, query);
          if (table === 'call_participants') return { data: { status: options.membership ?? 'invited', created_at: new Date().toISOString() }, error: null };
          return { data: table === 'conversations' ? { group_name: 'Stored group' } : { full_name: 'Stored caller', avatar_url: null }, error: null };
        },
      }; return query;
    },
  };
  const shared = load('shared/notificationTap.ts');
  const api = load('src/services/incomingCallAccess.ts', { '../../shared/notificationTap': shared, './supabase': { supabase }, './callService': { callService } });
  const payload = { callId: C, callerName: 'Forged display name', recipientId: A };
  return { api, requests, writes, record, payload, subscriptions,
    switchTo(id, token = 'token-' + id) { session = id ? { user: { id }, access_token: token } : null; for (const fn of subscriptions) fn(id ? 'SIGNED_IN' : 'SIGNED_OUT', session); },
    read(override = payload, timeout) { return api.withIncomingCallSession(override, ctx => api.readIncomingCall(override, ctx), timeout); },
  };
}

test('payload parsing accepts actual Expo and Notifee video formats and rejects malformed routes', () => {
  const h = fixture();
  for (const video of [true, 'true', '1', 1]) assert.equal(h.api.parseCallPayload({ type: 'incoming_call', call_id: C, is_video: video }).isVideo, true);
  for (const value of [null, [], { call_id: '../call' }, { call_id: {} }, { type: 'message', call_id: C }, { call_id: C, recipient_id: {} }]) assert.equal(h.api.parseCallPayload(value), null);
  const p = h.api.parseCallPayload({ callId: C, recipient_id: A, caller_name: 'x'.repeat(1000), caller_avatar: 'untrusted-avatar' });
  assert.equal(p.callerName.length, 160); assert.equal(p.callerAvatar, null); assert.equal(p.recipientId, A);
});

test('recipient identity, active status and fresh invitation precede any native display', async () => {
  const h = fixture();
  await assert.rejects(h.read({ ...h.payload, recipientId: B }), /another account/); assert.equal(h.requests.length, 0);
  h.record.receiver_id = B; assert.equal(await h.read(), null);
  h.record.receiver_id = A; h.record.status = 'ended'; assert.equal(await h.read(), null);
  h.record.status = 'ringing'; h.record.created_at = new Date(Date.now() - 60000).toISOString(); assert.equal(await h.read(), null);
  assert.equal(h.subscriptions.size, 0);
});

test('stored caller metadata, original bearer and AbortSignal are used for every read', async () => {
  const h = fixture(), result = await h.read();
  assert.equal(result.payload.callerName, 'Stored caller'); assert.equal(result.payload.recipientId, A);
  assert.equal(result.payload.isVideo, true); assert.equal(h.requests.length, 3);
  for (const request of h.requests) {
    assert.equal(request.request?.accessToken ?? request.headers.Authorization, request.request ? 'captured-A-token' : 'Bearer captured-A-token');
    assert.equal((request.request?.signal ?? request.signal).aborted, true, 'operation lifetime closes after all reads');
  }
  assert.equal(h.subscriptions.size, 0);
});

test('group calls require this account to remain invited, including the final recheck', async () => {
  const joined = fixture({ group: true, membership: 'joined' }); assert.equal(await joined.read(), null);
  let membershipReads = 0;
  const removed = fixture({ group: true, query: async table => ({ data: table === 'call_participants'
    ? { status: ++membershipReads === 1 ? 'invited' : 'declined', created_at: new Date().toISOString() }
    : { group_name: 'Stored group' }, error: null }) });
  assert.equal(await removed.read(), null); assert.equal(membershipReads, 2);
  const invited = fixture({ group: true }); invited.record.created_at = new Date(Date.now() - 3600000).toISOString();
  assert.equal((await invited.read()).payload.callerName, 'Stored group', 'new invitation can belong to an older active group');
});

test('a call ending while its profile loads cannot open a stale screen', async () => {
  const gate = deferred(), h = fixture({ query: () => gate.promise });
  const pending = h.read(); await flush(); h.record.status = 'ended'; gate.resolve({ data: { full_name: 'Caller' }, error: null });
  assert.equal(await pending, null);
});

test('A to B to A rejects pending work without rebinding its bearer', async () => {
  const gate = deferred(), h = fixture({ getCall: () => gate.promise });
  const pending = h.read(); await flush();
  h.switchTo(B); h.switchTo(A);
  await assert.rejects(pending, /account changed/); gate.resolve(h.record); await flush();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].request.accessToken, 'captured-A-token');
  assert.equal(h.requests[0].request.signal.aborted, true); assert.equal(h.subscriptions.size, 0);
});

test('deadline and owner teardown settle uncooperative transports and prevent late action', async () => {
  const h = fixture({ getCall: () => new Promise(() => {}) });
  await assert.rejects(h.read(h.payload, 3), /expired/); assert.equal(h.subscriptions.size, 0);
  const controller = new AbortController(), gate = deferred(); let actions = 0;
  const cold = fixture({ sessionGate: gate });
  const pending = cold.api.withIncomingCallSession(cold.payload, async () => { actions++; }, 15000, controller.signal);
  controller.abort(); await assert.rejects(pending, /expired/);
  gate.resolve({ data: { session: { user: { id: A }, access_token: 'A' } } }); await flush();
  assert.equal(actions, 0); assert.equal(cold.subscriptions.size, 0);
});

test('group decline uses the actual stored call kind and original owner', async () => {
  const h = fixture({ group: true });
  assert.equal(await h.api.declineIncomingCall(h.payload), true);
  assert.deepEqual(h.writes.map(x => [x.kind, x.id, x.userId, x.request.accessToken]), [['group', C, A, 'captured-A-token']]);
});

test('offline and unconfirmed direct declines remain retryable', async () => {
  const offline = fixture({ decline: () => { throw Error('offline'); } });
  await assert.rejects(offline.api.declineIncomingCall(offline.payload), /offline/);
  const unchanged = fixture({ decline: () => false }); assert.equal(await unchanged.api.declineIncomingCall(unchanged.payload), false);
  const ended = fixture({ decline: () => false, getCall: (record, count) => ({ ...record, status: count > 1 ? 'ended' : 'ringing' }) });
  assert.equal(await ended.api.declineIncomingCall(ended.payload), true);
});

function taskFixture(options = {}) {
  const h = fixture(options), rings = [], notifications = [], dismissals = [];
  const api = load('src/services/callBackgroundTask.ts', {
    './incomingCallAccess': h.api,
    './androidCallNotification': { async showIncomingCall(payload, session) { if (session.current()) rings.push(payload); return options.fullscreen !== false; } },
    'expo-notifications': { async scheduleNotificationAsync(value) { notifications.push(value); if (options.schedule) await options.schedule(h); return 'local-notification'; }, async dismissNotificationAsync(id) { dismissals.push(id); } },
    'react-native': { Platform: { OS: 'android' } },
    './nativeCallService': { nativeCallService: { prepareForIncomingCall: async () => options.nativeReady ?? false, displayIncomingCall: () => false } },
    'expo-task-manager': { defineTask() {} },
  });
  return { ...h, api, rings, notifications, dismissals };
}

test('task errors and unrelated data cannot ring before authorization', async () => {
  const h = taskFixture();
  await h.api.handleIncomingCallTask({ data: { type: 'incoming_call', call_id: C }, error: Error('task failure') });
  await h.api.handleIncomingCallTask({ data: { type: 'message', call_id: C } });
  assert.equal(h.rings.length, 0); assert.equal(h.requests.length, 0);
});

test('duplicate background deliveries coalesce while using stored recipient metadata', async () => {
  const h = taskFixture(), event = { data: { notification: { data: { body: JSON.stringify({ type: 'incoming_call', call_id: C, caller_name: 'Forged', recipient_id: A }) } } } };
  await Promise.all([h.api.handleIncomingCallTask(event), h.api.handleIncomingCallTask(event)]);
  assert.equal(h.rings.length, 1); assert.equal(h.rings[0].callerName, 'Stored caller');
});

test('native display failure falls back with authoritative recipient routing', async () => {
  const h = taskFixture({ fullscreen: false, nativeReady: true });
  await h.api.handleIncomingCallTask({ data: { type: 'incoming_call', call_id: C, recipient_id: A } });
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].content.data.recipient_id, A);
  assert.equal(h.notifications[0].content.title, 'Stored caller');
});

function notifeeFixture(options = {}) {
  let background, foreground; const cancelled = [], declines = [], shown = [];
  const h = fixture(options);
  const api = load('src/services/androidCallNotification.ts', {
    './incomingCallAccess': { ...h.api, async declineIncomingCall(payload) { declines.push(payload); if (options.fail) throw Error('offline'); return options.done !== false; } },
    'react-native': { Platform: { OS: 'android' } },
    '@notifee/react-native': { default: {
      onBackgroundEvent(fn) { background = fn; }, onForegroundEvent(fn) { foreground = fn; return () => {}; },
      async cancelNotification(id) { cancelled.push(id); }, createChannel: async () => { if (options.channel) await options.channel(h); },
      async displayNotification(value) { shown.push(value); if (options.display) await options.display(h); },
      getInitialNotification: async () => ({ notification: { data: { call_id: C, recipient_id: A } }, pressAction: { id: options.initial ?? 'answer' } }),
    } },
  });
  return { ...h, api, cancelled, declines, shown, show: () => h.api.withIncomingCallSession(h.payload, session => api.showIncomingCall(h.payload, session)), background: (...args) => background(...args), foreground: (...args) => foreground(...args) };
}
const event = (type, action) => ({ type, detail: { notification: { data: { type: 'incoming_call', call_id: C, recipient_id: A } }, pressAction: { id: action } } });

test('Notifee distinguishes dismissed0 from action2 and only confirms successful declines', async () => {
  const h = notifeeFixture(); await h.background(event(2, 'answer')); assert.equal(h.cancelled.length, 0);
  await h.background(event(0, 'incoming')); assert.equal(h.cancelled.length, 1);
  await h.background(event(2, 'decline')); assert.equal(h.declines.length, 1); assert.equal(h.cancelled.length, 2);
  for (const options of [{ fail: true }, { done: false }]) {
    const pending = notifeeFixture(options); await pending.background(event(2, 'decline')); assert.equal(pending.cancelled.length, 0);
  }
});

test('unknown and decline initial actions cannot open the incoming call screen', async () => {
  for (const initial of ['decline', 'unknown']) assert.equal(await notifeeFixture({ initial }).api.consumeInitialCallNotification(), null);
  const h = notifeeFixture(); assert.equal((await h.api.consumeInitialCallNotification()).answer, true);
  const actions = []; h.api.listenForegroundCallActions((_payload, action) => actions.push(action));
  h.foreground(event(2, 'unknown')); h.foreground(event(2, 'answer')); h.foreground(event(2, 'decline'));
  assert.deepEqual(actions, ['answer', 'decline']);
});

test('a notification whose display finishes after account teardown is immediately removed', async () => {
  const h = notifeeFixture({ display: async owner => { owner.switchTo(B); } });
  await assert.rejects(h.show(), /changed|expired/);
  await flush(); assert.deepEqual(h.cancelled, ['call-' + C]);
});

test('native notification timeout respects the remaining authoritative invitation lifetime', async () => {
  const h = notifeeFixture();
  h.record.created_at = new Date(Date.now() - 41000).toISOString();
  assert.equal(await h.show(), true);
  assert.ok(h.shown[0].android.timeoutAfter > 0 && h.shown[0].android.timeoutAfter <= 4000);
  h.record.created_at = new Date(Date.now() - 50000).toISOString();
  assert.equal(await h.show(), false); assert.equal(h.shown.length, 1);
  const parsed = fixture().api.parseCallPayload({ call_id: C, expiresAt: Number.MAX_SAFE_INTEGER });
  assert.equal(parsed.expiresAt, undefined, 'a push cannot extend the stored invitation lifetime');
});

test('a caller ending while Android creates its notification channel cannot ring', async () => {
  const h = notifeeFixture({ channel: async owner => { owner.record.status = 'ended'; } });
  assert.equal(await h.show(), false); assert.equal(h.shown.length, 0);
});

test('an invitation expiring during notification display is removed on completion', async () => {
  const h = notifeeFixture({ display: async () => { await new Promise(resolve => setTimeout(resolve, 45)); } });
  h.record.created_at = new Date(Date.now() - 44980).toISOString();
  assert.equal(await h.show(), false); assert.equal(h.shown.length, 1);
  assert.deepEqual(h.cancelled, ['call-' + C]);
});

test('an invitation expiring during Expo fallback scheduling is removed on completion', async () => {
  const h = taskFixture({ fullscreen: false, schedule: async () => { await new Promise(resolve => setTimeout(resolve, 50)); } });
  h.record.created_at = new Date(Date.now() - 44970).toISOString();
  await h.api.handleIncomingCallTask({ data: { type: 'incoming_call', call_id: C, recipient_id: A } });
  assert.equal(h.notifications.length, 1); assert.deepEqual(h.dismissals, ['local-notification']);
});
