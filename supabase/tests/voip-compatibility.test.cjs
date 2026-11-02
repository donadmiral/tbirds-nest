const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
function load(file, imports = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, Request, Response, AbortSignal, TextEncoder, TextDecoder, Date, crypto: webcrypto,
    require(name) { if (name in imports) return imports[name]; throw Error(name); },
  });
  return module.exports;
}
const shared = load('supabase/functions/_shared/pushDelivery.ts');
const { createCompatibleVoipHandler } = load('supabase/functions/send-voip-push/compatibility.ts', { '../_shared/pushDelivery.ts': shared });
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const OWNER = id(1), RECEIVER = id(2), OTHER = id(3), CALL = id(4), GROUP = id(5);
const NOW = Date.parse('2026-11-02T00:00:00Z'), SERVICE = 'sb_secret_synthetic_service_credential_over_32_bytes';
const expoToken = n => 'ExpoPushToken[synthetic_' + n + ']';
function harness(options = {}) {
  const queries = [], provider = []; let authCalls = 0;
  const call = { id: CALL, initiator_id: OWNER, receiver_id: RECEIVER, is_group_call: false, conversation_id: GROUP,
    status: 'ringing', created_at: new Date(NOW - 1000).toISOString(), expires_at: new Date(NOW + 89000).toISOString(), is_video: true, channel_id: 'existing-channel', ...options.call };
  const rows = { call_sessions: options.noCall ? [] : [call], profiles: [{ id: OWNER, full_name: 'Existing caller' }],
    call_participants: [{ call_session_id: CALL, user_id: RECEIVER, status: 'invited' }],
    conversation_members: [OWNER, ...(options.removedReceiver ? [] : [RECEIVER])].filter(uid => !options.removedOwner || uid !== OWNER).map(user_id => ({ conversation_id: GROUP, user_id })),
    user_push_tokens: options.tokens || [{ user_id: RECEIVER, platform: 'android', expo_push_token: expoToken(1), voip_token: null }],
  };
  const service = { from(table) {
    const q = { table, filters: [] }; const chain = {
      select() { return chain; }, eq(key, value) { q.filters.push(row => row[key] === value); return chain; },
      in(key, values) { q.filters.push(row => values.includes(row[key])); return chain; },
      limit(value) { q.limit = value; return chain; }, abortSignal(signal) { q.signal = signal; return chain; },
      maybeSingle() { q.single = true; return chain; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        queries.push(q); if (options.errorTable === table) return { error: Error('synthetic unavailable'), data: null };
        if (options.endAtTokens && table === 'user_push_tokens') call.status = 'ended';
        let result = (rows[table] || []).filter(row => q.filters.every(fn => fn(row)));
        if (q.limit) result = result.slice(0, q.limit);
        return { data: q.single ? result[0] || null : result, error: null };
      }).then(resolve, reject); },
    }; return chain;
  } };
  const handler = createCompatibleVoipHandler({ service, serviceKey: SERVICE, now: () => NOW, deadlineMs: options.deadlineMs,
    authorizeLegacyService: async () => options.legacyAllowed ?? false,
    caller: () => ({ auth: { getUser: async () => { authCalls++; return { data: { user: options.authenticated ? { id: options.user || OWNER, is_anonymous: !!options.anonymous } : null }, error: null }; } } }),
    apnsToken: async () => { if (options.noApns) throw Error('synthetic missing signing config'); return 'synthetic-apns-jwt'; },
    androidDataOnly: options.dataOnly, apnsTopic: options.apnsTopic, expoAccessToken: options.expoAccessToken,
    fetch: async (url, init) => {
      const payload = JSON.parse(init.body); provider.push({ url, init, payload });
      if (options.provider) return options.provider(url, init, payload);
      if (url.includes('apple.com')) return new Response(null, { status: options.sandboxFallback && !url.includes('sandbox') ? 400 : 200 });
      return Response.json({ data: payload.map((_, index) => ({ status: 'ok', id: 'ticket-' + index })) });
    },
  });
  return { queries, provider, call, get authCalls() { return authCalls; },
    async run(auth = SERVICE, body = { callId: CALL }) {
      const response = await handler(new Request('https://synthetic.invalid/voip', { method: 'POST', headers: auth ? { Authorization: 'Bearer ' + auth } : {}, body: JSON.stringify(body) }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test('unauthenticated, public-key and anonymous-user callers cannot read call rows or ring devices', async () => {
  for (const [auth, options] of [[null, {}], ['sb_publishable_synthetic', {}], ['synthetic-user-jwt', {}], ['synthetic-user-jwt', { authenticated: true, anonymous: true }]]) {
    const h = harness(options); assert.equal((await h.run(auth)).status, 401); assert.equal(h.queries.length, 0); assert.equal(h.provider.length, 0);
  }
});

test('verified user callers may ring only the call they initiated', async () => {
  for (const user of [OTHER, RECEIVER]) {
    const h = harness({ authenticated: true, user }); assert.equal((await h.run('synthetic-user-jwt')).status, 403);
    assert.equal(h.provider.length, 0); assert.equal(h.queries.some(q => q.table === 'user_push_tokens'), false);
  }
  const owner = harness({ authenticated: true }); assert.equal((await owner.run('synthetic-user-jwt')).status, 200); assert.equal(owner.provider.length, 1);
});

test('trusted current and verified legacy service paths preserve the canonical Android payload', async () => {
  for (const [auth, options] of [[SERVICE, {}], ['synthetic-legacy-service-jwt', { legacyAllowed: true }]]) {
    const h = harness(options); const result = await h.run(auth, { callId: CALL, receiver_id: OTHER, callerName: 'Forged name', isVideo: false });
    assert.equal(result.status, 200); assert.equal(h.authCalls, 0);
    const sent = h.provider[0].payload[0];
    assert.equal(sent.to, expoToken(1)); assert.equal(sent.title, 'Existing caller'); assert.equal(sent.body, 'Incoming video call');
    assert.deepEqual(sent.data, { type: 'incoming_call', call_id: CALL, callId: CALL, caller_name: 'Existing caller', channel_id: 'existing-channel', is_video: true });
    assert.equal(sent.ttl, 45); assert.equal(sent.channelId, 'calls'); assert.equal(sent.categoryId, 'incoming_call'); assert.equal(sent.priority, 'high');
  }
});

test('legacy authorization must be strict and never accepts a truthy nonboolean result', async () => {
  for (const legacyAllowed of ['true', [true], { valid: true }]) {
    const h = harness({ legacyAllowed }); assert.equal((await h.run('synthetic-legacy-service-jwt')).status, 401); assert.equal(h.queries.length, 0);
  }
});

test('ended, expired or removed group-call access cannot trigger a ring', async () => {
  for (const options of [{ call: { status: 'ended' } }, { call: { expires_at: new Date(NOW - 1).toISOString() } },
    { call: { is_group_call: true, receiver_id: null }, removedReceiver: true },
    { call: { is_group_call: true, receiver_id: null }, removedOwner: true }, { endAtTokens: true }]) {
    const h = harness(options); assert.equal((await h.run()).status, 200); assert.equal(h.provider.length, 0);
  }
});

const ios = { user_id: RECEIVER, platform: 'ios', voip_token: 'a'.repeat(64), expo_push_token: expoToken(2) };
test('a QA CallKit topic reaches only the configured provider topic', async () => {
  const h = harness({ tokens:[ios],apnsTopic:'app.platinumcircles.mobile.qa.voip' });
  assert.equal((await h.run()).status,200);
  assert.equal(h.provider[0].init.headers['apns-topic'],'app.platinumcircles.mobile.qa.voip');
});
test('CallKit fields, production topic and the existing development-device fallback remain intact', async () => {
  const h = harness({ tokens: [ios], sandboxFallback: true }); const result = await h.run(); assert.equal(result.status, 200);
  assert.deepEqual(h.provider[0].payload, { aps: {}, uuid: CALL, callerName: 'Existing caller', handle: 'PlatinumCircles', hasVideo: true, callId: CALL, isVideo: true });
  assert.equal(h.provider[0].init.headers['apns-topic'], 'app.platinumcircles.mobile.voip');
  assert.ok(h.provider[0].url.startsWith('https://api.push.apple.com/'));
  assert.ok(h.provider[1].url.startsWith('https://api.sandbox.push.apple.com/'));
  assert.deepEqual(result.body.apns, ['sandbox200']);
});

test('missing APNs configuration does not stop Android and data-only mode retains the existing shape', async () => {
  const h = harness({ noApns: true, dataOnly: true, tokens: [ios, { user_id: RECEIVER, platform: 'android', expo_push_token: expoToken(1) }] });
  assert.equal((await h.run()).status, 200); assert.equal(h.provider.length, 1);
  const sent = h.provider[0].payload[0]; assert.equal(sent.title, undefined); assert.equal(sent.body, undefined); assert.equal(sent.sound, undefined);
  assert.equal(sent.data.type, 'incoming_call');
});

test('provider batching deduplicates registrations and never counts rejected or uncertain tickets as accepted', async () => {
  const tokens = Array.from({ length: 210 }, (_, i) => ({ user_id: RECEIVER, platform: 'android', expo_push_token: expoToken(i) }));
  const h = harness({ tokens: [...tokens, tokens[0]] }); const result = await h.run();
  assert.equal(result.body.expo.accepted, 210); assert.deepEqual(h.provider.map(call => call.payload.length), [100, 100, 10]);
  const rejected = harness({ provider: async () => Response.json({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }) });
  assert.equal((await rejected.run()).body.expo.accepted, 0);
  const failed = harness({ provider: async () => Response.json({ errors: [] }, { status: 429 }) });
  const failedResult = await failed.run(); assert.equal(failedResult.status, 502); assert.equal(failedResult.body.expo.unknown, 1);
});

test('database failures, invalid call IDs and a bounded provider timeout cannot authorize delivery', async () => {
  const db = harness({ errorTable: 'call_sessions' }); assert.equal((await db.run()).status, 503); assert.equal(db.provider.length, 0);
  const invalid = harness(); assert.equal((await invalid.run(SERVICE, { callId: 'any-room' })).status, 400); assert.equal(invalid.queries.length, 0);
  const slow = harness({ deadlineMs: 25, provider: () => new Promise(() => {}) });
  const keepAlive = setTimeout(() => {}, 200);
  try { assert.equal((await slow.run()).status, 502); assert.equal(slow.provider.length, 1); } finally { clearTimeout(keepAlive); }
});
