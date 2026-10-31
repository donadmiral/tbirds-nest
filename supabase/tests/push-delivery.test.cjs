const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
function load(relative, dependencies = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Request, Response, AbortSignal, TextEncoder, TextDecoder,
    crypto: webcrypto, setTimeout, clearTimeout, console, Date, Promise, Set, Map,
    require(name) { if (name in dependencies) return dependencies[name]; throw Error('Unexpected dependency ' + name); },
  });
  return module.exports;
}
const policy = load('shared/notificationPreferences.ts');
const delivery = load('supabase/functions/_shared/pushDelivery.ts');
const imports = { '../../../shared/notificationPreferences.ts': policy, '../_shared/pushDelivery.ts': delivery };
const { createPushNotificationHandler } = load('supabase/functions/send-push-notification/handler.ts', imports);
const { createVoipPushHandler } = load('supabase/functions/send-voip-push/handler.ts', imports);
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const OWNER = id(1), PEER = id(2), THIRD = id(3), CALL = id(4), NOTICE = id(5), CONVERSATION = id(6);
const SERVICE = 'synthetic-service-only-credential-at-least-32-bytes';
const NOW = Date.parse('2026-10-31T01:00:00Z');
const token = (n, legacy = false) => `${legacy ? 'ExponentPushToken' : 'ExpoPushToken'}[synthetic_${n}]`;
function harness(options = {}) {
  const profile = { id: PEER, full_name: 'Recipient', notif_prefs: {}, deactivated_at: null, ...options.profile };
  const call = { id: CALL, initiator_id: OWNER, receiver_id: PEER, conversation_id: CONVERSATION,
    is_group_call: false, is_video: true, status: 'ringing', created_at: new Date(NOW - 1000).toISOString(), expires_at: new Date(NOW + 89000).toISOString(), agora_channel: CALL, ...options.call };
  const rows = {
    notifications: options.noNotice ? [] : [{ id: NOTICE, recipient_id: PEER, actor_id: OWNER, type: 'message', message: 'Stored preview', body_preview: '', data: { conversation_id: CONVERSATION }, created_at: new Date(NOW - 1000).toISOString(), ...options.notice }],
    profiles: [{ id: OWNER, full_name: 'Caller' }, profile], call_sessions: [call], call_participants: [{ user_id: PEER, call_session_id: CALL, status: 'invited' }],
    user_push_tokens: options.tokens || [{ id: id(10), user_id: PEER, expo_push_token: token(1), voip_token: null, platform: 'android', updated_at: '2026-10-30T01:00:00' }],
  };
  const queries = [], external = [], claims = new Set(); let authorizations = 0, eligibilityChecks = 0;
  function builder(table, rpcArgs) {
    const q = { table, filters: [], op: 'select', single: false, count: false, rpcArgs };
    const chain = {
      select(columns, opts) { q.columns = columns; q.count = !!opts?.count; return chain; },
      eq(key, value) { q.filters.push([key, value]); return chain; },
      in(key, value) { q.filters.push([key, value]); return chain; },
      gte() { return chain; }, filter() { return chain; }, limit(value) { q.limit = value; return chain; },
      abortSignal(signal) { q.signal = signal; return chain; }, maybeSingle() { q.single = true; return chain; },
      delete() { q.op = 'delete'; return chain; }, update(patch) { q.op = 'update'; q.patch = patch; return chain; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        queries.push(q);
        if (q.rpcArgs) {
          if (table === 'get_notification_badge_count') return options.badgeError ? { data: null, error: new Error('unavailable') } : { data: 7, error: null };
          if (table === 'authorize_call_push') return { data: options.allowed !== false && (++authorizations <= (options.revokeAfter ?? Infinity)), error: null };
          if (table === 'call_push_dispatch_allowed') return { data: options.dispatchAllowed !== false && (++eligibilityChecks <= (options.removeRecipientAfter ?? Infinity)), error: null };
          if (table === 'claim_call_push_dispatch') {
            if (options.claimError) return { data: null, error: new Error('unavailable') };
            const key = rpcArgs.p_call_id + ':' + rpcArgs.p_recipient;
            if (options.alreadyClaimed || claims.has(key)) return { data: false, error: null };
            claims.add(key); return { data: true, error: null };
          }
          throw Error('Unexpected RPC ' + table);
        }
        let found = (rows[table] || []).filter(row => q.filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
        if (q.op === 'delete') rows[table] = rows[table].filter(row => !found.includes(row));
        if (q.op === 'update') found.forEach(row => Object.assign(row, q.patch));
        if (q.limit) found = found.slice(0, q.limit);
        if (q.count) return { data: null, count: found.length, error: null };
        return { data: q.single ? found[0] || null : found, error: null };
      }).then(resolve, reject); },
    };
    return chain;
  }
  const db = { from: table => builder(table), rpc: (name, args) => builder(name, args) };
  const fetch = async (url, init) => {
    const payload = JSON.parse(init.body); external.push({ url, init, payload });
    if (options.provider) return options.provider(url, init, payload);
    if (url.includes('apple.com')) return new Response(null, { status: 200 });
    return Response.json({ data: payload.map((_, i) => ({ status: 'ok', id: 'ticket-' + external.length + '-' + i })) });
  };
  const caller = () => ({ auth: { getUser: async () => ({ data: { user: options.authError ? null : { id: options.callerId || OWNER, is_anonymous: !!options.anonymous } }, error: options.authError ? new Error('unauthorized') : null }) }, rpc: db.rpc });
  const push = createPushNotificationHandler({ service: db, serviceKey: SERVICE, fetch, now: () => NOW, deadlineMs: options.deadlineMs });
  const voip = createVoipPushHandler({ service: db, serviceKey: SERVICE, caller, fetch, now: () => NOW, deadlineMs: options.deadlineMs,
    apnsTopic: 'app.platinumcircles.mobile.qa.voip', apnsEnvironment: options.apnsEnvironment,
    apnsToken: async () => { if (options.noApns) throw Error('missing credentials'); return 'synthetic-apns-provider-token'; },
  });
  return { push, voip, external, queries, rows, profile, call, claims };
}
const request = (body, authorization = SERVICE) => new Request('https://qa.example.invalid/push', { method: 'POST',
  headers: authorization === null ? {} : { Authorization: 'Bearer ' + authorization }, body: JSON.stringify(body) });

test('ordinary push refuses anonymous, anon-key and user JWT callers before any database or provider access', async () => {
  for (const auth of [null, 'synthetic-anon-key', 'synthetic-user-jwt']) {
    const h = harness(); assert.equal((await h.push(request({ id: NOTICE }, auth))).status, 401);
    assert.equal(h.queries.length, 0); assert.equal(h.external.length, 0);
  }
});

test('a service webhook can deliver only the stored notification, ignoring forged recipient, type, text and routing', async () => {
  const h = harness({ notice: { data: { conversation_id: CONVERSATION, type: 'incoming_call', category: 'calls', notificationId: 'forged', unsafe: 'x'.repeat(8000) } } });
  const response = await h.push(request({ record: { id: NOTICE, recipient_id: THIRD, type: 'system', message: 'Forged text' } }));
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.accepted, 1);
  const message = h.external[0].payload[0];
  assert.equal(message.body, 'Stored preview'); assert.equal(message.data.type, 'message'); assert.equal(message.data.category, 'messages');
  assert.equal(message.data.notificationId, NOTICE); assert.equal(message.data.unsafe, undefined); assert.equal(message.badge, 7);
  assert.ok(h.queries.filter(q => q.table === 'user_push_tokens').every(q => q.filters.some(([key, value]) => key === 'user_id' && value === PEER)));
});

test('missing, expired, muted and quiet-hour notifications do not reach a provider', async () => {
  for (const options of [{ noNotice: true }, { notice: { created_at: '2026-10-29T00:00:00Z' } }, { profile: { notif_prefs: { all: false } } },
    { profile: { notif_prefs: { messages: false } } }, { profile: { quiet_from: 22, quiet_to: 7 } }, { profile: { deactivated_at: '2026-10-30' } }]) {
    const h = harness(options); assert.equal((await h.push(request({ id: NOTICE }))).status, 200); assert.equal(h.external.length, 0);
  }
});

test('both Expo token formats work, duplicate registrations send once and unknown badges do not clear the icon', async () => {
  const h = harness({ badgeError: true, tokens: [token(1), token(2, true), token(1), 'invalid'].map((value, i) => ({ id: id(10 + i), user_id: PEER, expo_push_token: value, platform: 'ios', updated_at: 'now' })) });
  assert.equal((await h.push(request({ id: NOTICE }))).status, 200);
  assert.equal(h.external[0].payload.length, 2); assert.equal(h.external[0].payload[0].badge, undefined);
});

test('Expo batches never exceed100, and a revocation prevents later batches', async () => {
  const batches = []; let allowed = 0;
  const result = await delivery.sendExpoPushes(Array.from({ length: 230 }, (_, i) => ({ to: token(i) })), {
    signal: new AbortController().signal, maySend: async () => ++allowed < 3,
    fetch: async (_url, init) => { const payload = JSON.parse(init.body); batches.push(payload.length); return Response.json({ data: payload.map((_, i) => ({ status: 'ok', id: 'receipt-' + i })) }); },
  });
  assert.deepEqual(batches, [100, 100]); assert.equal(result.accepted, 200); assert.equal(result.rejected, 30);
});

test('provider errors and malformed tickets are never counted as delivered or accepted', async () => {
  for (const provider of [async () => Response.json({ errors: [{ code: 'UNAUTHORIZED' }] }, { status: 401 }), async () => Response.json({ data: [{}] })]) {
    const h = harness({ provider }), response = await h.push(request({ id: NOTICE }));
    assert.equal(response.status, 502); const result = await response.json(); assert.equal(result.accepted, 0); assert.equal(result.unknown, 1);
  }
});

test('DeviceNotRegistered cleanup names the original owner, token and registration timestamp', async () => {
  const h = harness({ provider: async () => Response.json({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }) });
  const result = await (await h.push(request({ id: NOTICE }))).json(); assert.equal(result.rejected, 1);
  const removed = h.queries.find(q => q.table === 'user_push_tokens' && q.op === 'delete');
  assert.deepEqual(removed.filters, [['id', id(10)], ['user_id', PEER], ['expo_push_token', token(1)], ['updated_at', '2026-10-30T01:00:00']]);
});

test('call ringing requires a verified nonanonymous user and live caller authorization', async () => {
  for (const options of [{ authError: true }, { anonymous: true }, { allowed: false }]) {
    const h = harness(options), response = await h.voip(request({ callId: CALL }, 'synthetic-user-jwt'));
    assert.ok([401, 403].includes(response.status)); assert.equal(h.external.length, 0);
    assert.equal(h.queries.some(q => q.table === 'call_sessions'), false);
  }
});

test('a caller cannot ring someone else call, an ended call or an expired call', async () => {
  for (const options of [{ callerId: THIRD }, { call: { status: 'ended' } }, { call: { expires_at: new Date(NOW - 1).toISOString() } }, { call: { created_at: new Date(NOW - 91_000).toISOString(), expires_at: new Date(NOW + 90_000).toISOString() } }]) {
    const h = harness(options); await h.voip(request({ callId: CALL }, 'synthetic-user-jwt')); assert.equal(h.external.length, 0);
  }
});

test('call push respects master/category/quiet preferences and requires the database dispatch claim', async () => {
  for (const options of [{ profile: { notif_prefs: { all: false } } }, { profile: { notif_prefs: { calls: false } } },
    { profile: { quiet_from: 23, quiet_to: 6 } }, { alreadyClaimed: true }, { claimError: true }]) {
    const h = harness(options); await h.voip(request({ callId: CALL }, 'synthetic-user-jwt')); assert.equal(h.external.length, 0);
  }
});

test('database trigger and client races acquire only one recipient dispatch and produce one ring', async () => {
  const h = harness(); const results = await Promise.all([h.voip(request({ callId: CALL })), h.voip(request({ callId: CALL }, 'synthetic-user-jwt'))]);
  assert.ok(results.every(response => response.status === 200)); assert.equal(h.external.length, 1); assert.equal(h.claims.size, 1);
});

test('revocation during preparation stops ringing before the provider sees a request', async () => {
  const h = harness({ revokeAfter: 1 }); await h.voip(request({ callId: CALL }, 'synthetic-user-jwt'));
  assert.equal(h.external.length, 0); assert.equal(h.claims.size, 0);
});

test('recipient removal after the claim prevents both trusted and user-initiated rings', async () => {
  for (const authorization of [SERVICE, 'synthetic-user-jwt']) {
    const h = harness({ dispatchAllowed: false });
    const response = await h.voip(request({ callId: CALL }, authorization));
    assert.equal(response.status, 200); assert.equal(h.claims.size, 1); assert.equal(h.external.length, 0);
    assert.ok(h.queries.some(q => q.table === 'call_push_dispatch_allowed' && q.rpcArgs.p_recipient === PEER));
  }
});

test('recipient revocation between provider batches stops the later devices', async () => {
  const h = harness({ removeRecipientAfter: 1, tokens: Array.from({ length: 150 }, (_, i) => ({
    id: id(100 + i), user_id: PEER, expo_push_token: token(i), voip_token: null, platform: 'android', updated_at: 'now',
  })) });
  const result = await (await h.voip(request({ callId: CALL }))).json();
  assert.equal(result.accepted, 100); assert.equal(result.rejected, 50); assert.equal(h.external.length, 1);
  assert.equal(h.queries.filter(q => q.table === 'call_push_dispatch_allowed').length, 2);
});

const iosToken = { id: id(20), user_id: PEER, platform: 'ios', expo_push_token: token(20), voip_token: 'a'.repeat(64), updated_at: '2026-10-30T01:00:00' };
test('APNs uses the QA topic, explicit environment, original CallKit UUID and immediate expiration', async () => {
  const h = harness({ tokens: [iosToken], apnsEnvironment: 'sandbox' });
  assert.equal((await h.voip(request({ callId: CALL }, 'synthetic-user-jwt'))).status, 200);
  assert.equal(h.external[0].url, 'https://api.sandbox.push.apple.com/3/device/' + iosToken.voip_token);
  assert.equal(h.external[0].init.headers['apns-topic'], 'app.platinumcircles.mobile.qa.voip');
  assert.equal(h.external[0].init.headers['apns-expiration'], '0'); assert.equal(h.external[0].payload.uuid, CALL);
  assert.equal(h.external[0].payload.hasVideo, true);
});

test('missing APNs credentials cannot prevent an eligible Android receiver from ringing', async () => {
  const h = harness({ noApns: true, tokens: [iosToken, { id: id(21), user_id: PEER, platform: 'android', expo_push_token: token(21), updated_at: 'now' }] });
  const result = await (await h.voip(request({ callId: CALL }, 'synthetic-user-jwt'))).json();
  assert.equal(result.accepted, 1); assert.equal(result.unknown, 1); assert.equal(h.external.length, 1); assert.ok(h.external[0].url.includes('exp.host'));
});

test('APNs rejection is reported and does not retry a token against a different environment', async () => {
  const h = harness({ tokens: [iosToken], provider: async () => Response.json({ reason: 'BadDeviceToken' }, { status: 400 }) });
  const result = await (await h.voip(request({ callId: CALL }, 'synthetic-user-jwt'))).json();
  assert.equal(result.accepted, 0); assert.equal(result.rejected, 1); assert.equal(h.external.length, 1);
});

test('provider timeout is bounded and records an uncertain attempt without blindly sending again', async () => {
  const h = harness({ deadlineMs: 30, provider: () => new Promise(() => {}) });
  const keepAlive = setTimeout(() => {}, 200);
  try {
    const response = await h.voip(request({ callId: CALL }, 'synthetic-user-jwt'));
    const result = await response.json(); assert.equal(result.accepted, 0); assert.equal(result.unknown, 1); assert.equal(h.external.length, 1);
  } finally { clearTimeout(keepAlive); }
});
