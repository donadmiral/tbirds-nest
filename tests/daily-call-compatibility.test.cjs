const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const load = (file, dependencies = {}) => {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Request, Response, AbortSignal, TextEncoder, TextDecoder, Date,
    require(name) { if (name in dependencies) return dependencies[name]; throw Error('Unexpected import ' + name); },
  });
  return module.exports;
};
const shared = load('supabase/functions/_shared/pushDelivery.ts');
const { createCompatibleDailyTokenHandler } = load('supabase/functions/daily-get-token/compatibility.ts', { '../_shared/pushDelivery.ts': shared });
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const OWNER = id(1), RECEIVER = id(2), OUTSIDER = id(3), SESSION = id(4), ADMISSION = id(5), NEXT_ADMISSION = id(6), GROUP = id(7);
const NOW = Date.parse('2026-11-02T00:00:00Z');
function harness(options = {}) {
  const reads = [], provider = [];
  let identity = ADMISSION, removed = !!options.removed;
  const session = { id: SESSION, initiator_id: OWNER, receiver_id: RECEIVER, conversation_id: GROUP,
    status: 'active', is_group_call: false, created_at: new Date(NOW - 30000).toISOString(), ...options.session };
  const uid = options.user || OWNER;
  const service = { from(table) {
    const read = { table, filters: {} }; reads.push(read);
    return { select() { return this; }, eq(key, value) { read.filters[key] = value; return this; }, abortSignal(signal) { read.signal = signal; return this; },
      async maybeSingle() { return { error: options.readError === table ? Error('synthetic unavailable') : null,
        data: ({ call_sessions: options.missing ? null : session,
          call_participants: { status: options.partStatus || 'joined', provider_identity: identity },
          conversation_members: removed ? null : { user_id: uid }, profiles: { full_name: 'Synthetic caller' },
        })[table] }; },
    };
  } };
  const handler = createCompatibleDailyTokenHandler({ service, dailyKey: 'synthetic-provider-key', now: () => NOW,
    caller: () => ({ auth: { getUser: async () => ({ data: { user: options.unauthenticated ? null : { id: uid, is_anonymous: !!options.anonymous } }, error: null }) } }),
    fetch: async (url, init) => {
      const call = { url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }; provider.push(call);
      if (url.endsWith('/meeting-tokens')) {
        if (options.rotateAtToken) identity = NEXT_ADMISSION;
        if (options.endAtToken) session.status = 'ended';
        return Response.json(options.badToken ? {} : { token: 'synthetic-token' }, { status: options.tokenError ? 503 : 200 });
      }
      if (options.removeAtRoom) removed = true;
      const room = { url: 'https://synthetic.daily.co/' + SESSION, privacy: options.publicRoom ? 'public' : 'private' };
      if (call.method === 'POST') return Response.json(room, { status: options.createRace ? 409 : 200 });
      const gets = provider.filter(entry => entry.method === 'GET').length;
      return Response.json(room, { status: options.create && gets === 1 ? 404 : 200 });
    },
  });
  return { reads, provider, async run(body = { callSessionId: SESSION }, method = 'POST') {
    const response = await handler(new Request('https://synthetic.invalid/token', { method, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }));
    return { status: response.status, body: await response.json() };
  } };
}

test('legacy direct requests retain response shape and six-hour reconnect grant while binding the real identity', async () => {
  for (const user of [OWNER, RECEIVER]) {
    const h = harness({ user }); const result = await h.run({ callSessionId: SESSION.toUpperCase(), user_id: OUTSIDER, isOwner: true });
    assert.equal(result.status, 200); assert.deepEqual(result.body, { roomUrl: 'https://synthetic.daily.co/' + SESSION, token: 'synthetic-token' });
    const token = h.provider.find(call => call.url.endsWith('/meeting-tokens')).body.properties;
    assert.equal(token.user_id, user); assert.equal(token.is_owner, user === OWNER); assert.equal(token.room_name, SESSION);
    assert.equal(token.exp, NOW / 1000 + 21600); assert.equal(token.eject_at_token_exp, undefined);
    assert.equal(token.user_name, 'Synthetic caller');
  }
});

test('joined group callers get the current admission identity with optional old-client omission supported', async () => {
  const h = harness({ session: { is_group_call: true } });
  assert.equal((await h.run()).status, 200);
  assert.equal((await h.run({ callSessionId: SESSION, expectedProviderIdentity: ADMISSION.toUpperCase() })).status, 200);
  assert.ok(h.provider.filter(call => call.url.endsWith('/meeting-tokens')).every(call => call.body.properties.user_id === ADMISSION));
  const stale = harness({ session: { is_group_call: true } });
  assert.equal((await stale.run({ callSessionId: SESSION, expectedProviderIdentity: NEXT_ADMISSION })).status, 409);
  assert.equal(stale.provider.length, 0);
});

test('anonymous, unauthenticated and unrelated users cannot reach the provider', async () => {
  for (const options of [{ anonymous: true }, { unauthenticated: true }, { user: OUTSIDER }]) {
    const h = harness(options); assert.ok([401, 403].includes((await h.run()).status)); assert.equal(h.provider.length, 0);
  }
});

test('historical, left, removed and expired call memberships cannot mint fresh credentials', async () => {
  for (const partStatus of ['invited', 'declined', 'left']) {
    const h = harness({ partStatus, session: { is_group_call: true } }); assert.equal((await h.run()).status, 403); assert.equal(h.provider.length, 0);
  }
  const removed = harness({ removed: true, session: { is_group_call: true } }); assert.equal((await removed.run()).status, 403);
  for (const status of ['ended', 'missed', 'declined']) {
    const h = harness({ session: { status } }); assert.equal((await h.run()).status, 409); assert.equal(h.provider.length, 0);
  }
  for (const fields of [{ expires_at: new Date(NOW - 1).toISOString() }, { created_at: new Date(NOW - 91000).toISOString() }]) {
    const h = harness({ session: { status: 'ringing', ...fields } }); assert.equal((await h.run()).status, 409); assert.equal(h.provider.length, 0);
  }
});

test('access changes during room or token preparation cannot return a stale credential', async () => {
  for (const options of [{ removeAtRoom: true, session: { is_group_call: true } }, { rotateAtToken: true, session: { is_group_call: true } }, { endAtToken: true }]) {
    const h = harness(options); const result = await h.run(); assert.equal(result.status, 409); assert.equal(result.body.token, undefined);
  }
});

test('room creation retains old visible settings and a concurrent create safely reuses the private room', async () => {
  const h = harness({ create: true, createRace: true }); assert.equal((await h.run()).status, 200);
  const room = h.provider.find(call => call.url.endsWith('/rooms') && call.method === 'POST').body;
  assert.deepEqual(room, { name: SESSION, privacy: 'private', properties: { exp: NOW / 1000 + 21600, eject_at_room_exp: true, enable_screenshare: false, start_video_off: false } });
  assert.equal(h.provider.filter(call => call.method === 'GET').length, 2);
  const existing = harness(); await existing.run(); assert.equal(existing.provider.filter(call => !call.url.endsWith('/meeting-tokens') && call.method !== 'GET').length, 0);
});

test('failed access reads, unexpected public rooms and malformed provider tokens fail closed', async () => {
  for (const readError of ['call_sessions', 'call_participants', 'conversation_members']) {
    const h = harness({ readError, session: { is_group_call: true } }); assert.equal((await h.run()).status, 503); assert.equal(h.provider.length, 0);
  }
  for (const options of [{ publicRoom: true }, { badToken: true }, { tokenError: true }]) {
    const h = harness(options); const result = await h.run(); assert.equal(result.status, 502); assert.equal(result.body.token, undefined);
  }
});

test('invalid request fields and methods cannot create rooms or tokens', async () => {
  for (const body of [{}, { callSessionId: 'room/name' }, { callSessionId: SESSION, expectedProviderIdentity: null }]) {
    const h = harness(); assert.equal((await h.run(body)).status, 400); assert.equal(h.provider.length, 0);
  }
  const h = harness(); assert.equal((await h.run({}, 'GET')).status, 405); assert.equal(h.reads.length, 0);
});
