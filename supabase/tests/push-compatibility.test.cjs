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
    crypto: webcrypto, setTimeout, clearTimeout, Date, Promise, Set, Map,
    require(name) { if (name in dependencies) return dependencies[name]; throw Error('Unexpected dependency ' + name); },
  });
  return module.exports;
}
const delivery = load('supabase/functions/_shared/pushDelivery.ts');
const { createCompatiblePushHandler } = load('supabase/functions/send-push-notification/compatibility.ts', { '../_shared/pushDelivery.ts': delivery });
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ACTOR = id(1), RECIPIENT = id(2), THIRD = id(3), NOTICE = id(4), GROUP = id(5);
const SERVICE = 'synthetic-service-only-credential-at-least-32-bytes';
const NOW = Date.parse('2026-11-02T12:00:00Z');
const token = (n, legacy = false) => `${legacy ? 'ExponentPushToken' : 'ExpoPushToken'}[synthetic_${n}]`;

function harness(options = {}) {
  const rows = {
    notifications: options.noNotice ? [] : [{ id: NOTICE, recipient_id: RECIPIENT, actor_id: ACTOR, type: 'message', message: 'Stored preview', body_preview: '', data: { conversation_id: GROUP }, created_at: new Date(NOW - 1000).toISOString(), ...options.notice }],
    profiles: [{ id: ACTOR, full_name: 'Caller' }, { id: RECIPIENT, full_name: 'Recipient', notif_prefs: {}, ...options.profile }],
    user_push_tokens: (options.tokens || [token(1)]).map(expo_push_token => ({ user_id: RECIPIENT, expo_push_token })),
    conversation_members: [{ user_id: RECIPIENT, conversation_id: GROUP, last_read_at: '2026-11-01T00:00:00Z' }],
    messages: [
      { id: id(10), receiver_id: RECIPIENT, sender_id: ACTOR, read_at: null, deleted_at: null },
      { id: id(11), receiver_id: RECIPIENT, sender_id: ACTOR, read_at: null, deleted_at: null },
      { id: id(12), conversation_id: GROUP, sender_id: ACTOR, deleted_at: null, created_at: '2026-11-02T00:00:00Z' },
      { id: id(13), receiver_id: THIRD, sender_id: ACTOR, read_at: null, deleted_at: null },
    ],
  };
  const queries = [], external = [];
  function builder(table) {
    const q = { table, filters: [], count: false, single: false };
    const chain = {
      select(columns, opts) { q.columns = columns; q.count = !!opts?.count; return chain; },
      eq(k, v) { q.filters.push(row => row[k] === v); return chain; },
      neq(k, v) { q.filters.push(row => row[k] !== v); return chain; },
      is(k, v) { q.filters.push(row => row[k] === v); return chain; },
      gt(k, v) { q.filters.push(row => row[k] > v); return chain; },
      gte(k, v) { q.filters.push(row => row[k] >= v); return chain; },
      filter(k, _op, v) { q.filters.push(row => String(row.data?.[k.replace('data->>', '')]) === v); return chain; },
      limit(value) { q.limit = value; return chain; }, abortSignal(signal) { q.signal = signal; return chain; },
      maybeSingle() { q.single = true; return chain; }, single() { q.single = true; return chain; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        queries.push(q);
        if (options.errorColumns && q.columns.includes(options.errorColumns)) return { data: null, error: Error('synthetic unavailable') };
        let found = (rows[table] || []).filter(row => q.filters.every(matches => matches(row)));
        if (q.limit) found = found.slice(0, q.limit);
        if (q.count) return { data: null, count: options.collapseCount && table === 'notifications' ? options.collapseCount : found.length, error: null };
        return { data: q.single ? found[0] || null : found, error: null };
      }).then(resolve, reject); },
    };
    return chain;
  }
  const fetch = async (url, init) => {
    const payload = JSON.parse(init.body); external.push({ url, payload });
    if (options.provider) return options.provider(url, init, payload);
    return Response.json({ data: payload.map((_, i) => ({ status: 'ok', id: `ticket-${external.length}-${i}` })) });
  };
  return { rows, queries, external, push: createCompatiblePushHandler({ service: { from: builder }, serviceKey: SERVICE, fetch, now: () => NOW, deadlineMs: options.deadlineMs, authorizeLegacyService: options.authorizeLegacyService }) };
}
const request = (body = { record: { id: NOTICE } }, auth = SERVICE) => new Request('https://synthetic.invalid/push', {
  method: 'POST', headers: auth ? { Authorization: 'Bearer ' + auth } : {}, body: JSON.stringify(body),
});

test('compatible push rejects anonymous and user callers before any database or provider access', async () => {
  for (const auth of [null, 'synthetic-anon-key', 'synthetic-user-jwt']) {
    const h = harness(); assert.equal((await h.push(request(undefined, auth))).status, 401);
    assert.equal(h.queries.length, 0); assert.equal(h.external.length, 0);
  }
});

test('legacy service fallback requires strict authorization before loading notification rows', async () => {
  for (const decision of [false, 'true', [true], null]) {
    const h = harness({ authorizeLegacyService: async () => decision });
    assert.equal((await h.push(request(undefined, 'legacy-service-fixture'))).status, 401);
    assert.equal(h.queries.length, 0); assert.equal(h.external.length, 0);
  }
  const verified = harness({ authorizeLegacyService: async () => true });
  assert.equal((await verified.push(request(undefined, 'legacy-service-fixture'))).status, 200); assert.equal(verified.external.length, 1);
  const unavailable = harness({ authorizeLegacyService: async () => { throw Error('auth unavailable'); } });
  assert.equal((await unavailable.push(request(undefined, 'legacy-service-fixture'))).status, 503); assert.equal(unavailable.queries.length, 0);
});

test('service webhook uses canonical recipient, content and route fields while preserving legacy title and message badge', async () => {
  const h = harness({ notice: { data: { conversation_id: GROUP, type: 'forged', category: 'calls', notificationId: 'forged' } } });
  const response = await h.push(request({ record: { id: NOTICE, recipient_id: THIRD, type: 'system', message: 'Forged preview', data: { unsafe: true } } }));
  assert.equal(response.status, 200); assert.equal((await response.json()).sent, 1);
  const sent = h.external[0].payload[0];
  assert.equal(sent.to, token(1)); assert.equal(sent.title, 'Caller'); assert.equal(sent.body, 'Stored preview'); assert.equal(sent.badge, 3);
  assert.equal(sent.data.type, 'message'); assert.equal(sent.data.category, 'messages'); assert.equal(sent.data.notificationId, NOTICE);
  assert.equal(sent.data.unsafe, undefined); assert.equal(sent.data.conversation_id, GROUP);
  assert.ok(h.queries.every(query => query.signal instanceof AbortSignal));
});

test('quiet hours, notification preferences, missing events and the separate call ring flow remain respected', async () => {
  for (const options of [{ noNotice: true }, { profile: { quiet_from: 11, quiet_to: 13 } },
    { profile: { notif_messages: false } }, { profile: { notif_prefs: { messages: false } } },
    { profile: { notif_prefs: { message: false } } }, { notice: { type: 'incoming_call' } }]) {
    const h = harness(options); assert.equal((await h.push(request())).status, 200); assert.equal(h.external.length, 0);
  }
});

test('preference lookup failures cannot silently send through quiet hours or muted categories', async () => {
  for (const errorColumns of ['quiet_from', 'notif_messages']) {
    const h = harness({ errorColumns }); assert.equal((await h.push(request())).status, 503); assert.equal(h.external.length, 0);
  }
});

test('collapse milestones and group message title retain their deployed behavior', async () => {
  const collapsed = harness({ notice: { type: 'like' }, collapseCount: 2 });
  assert.equal((await collapsed.push(request())).status, 200); assert.equal(collapsed.external.length, 0);
  const milestone = harness({ notice: { type: 'like' }, collapseCount: 5 });
  await milestone.push(request()); assert.equal(milestone.external[0].payload[0].title, 'Caller and 4 others liked your post');
  const group = harness({ notice: { data: { is_group: true, group_name: 'Friends' } } });
  await group.push(request()); assert.equal(group.external[0].payload[0].title, 'Friends');
});

test('both Expo token formats deduplicate and every provider batch is at most 100', async () => {
  const tokens = Array.from({ length: 210 }, (_, i) => token(i, i === 1));
  const h = harness({ tokens: [...tokens, tokens[0], 'invalid'] });
  const result = await (await h.push(request())).json();
  assert.equal(result.sent, 210); assert.deepEqual(h.external.map(call => call.payload.length), [100, 100, 10]);
  const overflow = harness({ tokens: Array.from({ length: 1001 }, (_, i) => token(i)) });
  assert.equal((await overflow.push(request())).status, 500); assert.equal(overflow.external.length, 0);
});

test('provider HTTP failures, malformed tickets and explicit rejection are never counted as accepted', async () => {
  for (const provider of [async () => Response.json({ error: 'throttled' }, { status: 429 }), async () => Response.json({ data: [{}] })]) {
    const h = harness({ provider }); const response = await h.push(request()); const result = await response.json();
    assert.equal(response.status, 502); assert.equal(result.sent, 0); assert.equal(result.unknown, 1);
  }
  const rejected = harness({ provider: async () => Response.json({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }) });
  const result = await (await rejected.push(request())).json(); assert.equal(result.sent, 0); assert.equal(result.rejected, 1);
});

test('a provider timeout is bounded and uncertain delivery does not immediately send twice', async () => {
  const h = harness({ deadlineMs: 25, provider: () => new Promise(() => {}) });
  const keepAlive = setTimeout(() => {}, 200);
  try {
    const response = await h.push(request()); const result = await response.json();
    assert.equal(response.status, 502); assert.equal(result.sent, 0); assert.equal(result.unknown, 1); assert.equal(h.external.length, 1);
  } finally { clearTimeout(keepAlive); }
});

test('a service request needs a stored UUID and OPTIONS is a side-effect-free CORS preflight', async () => {
  const h = harness(); assert.equal((await h.push(request({ recipient_id: RECIPIENT }))).status, 400);
  assert.equal((await h.push(new Request('https://synthetic.invalid/push', { method: 'OPTIONS' }))).status, 200);
  assert.equal(h.queries.length, 0); assert.equal(h.external.length, 0);
});
