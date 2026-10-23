const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const sessionId = 'a0000000-0000-4000-8000-000000000001';
const now = Date.now();
function harness(options = {}) {
  let handler; const reads = [], provider = [];
  const session = { id: sessionId, initiator_id: 'owner', receiver_id: 'receiver', conversation_id: 'group',
    is_group_call: false, is_video: true, status: 'active', created_at: new Date(now - 30000).toISOString(), ...options.session };
  const client = {
    auth: { getUser: async () => ({ data: { user: options.unauthenticated ? null : { id: options.user ?? 'owner' } }, error: null }) },
    from(table) {
      const read = { table, filters: {} }; reads.push(read);
      return { select() { return this; }, eq(key, value) { read.filters[key] = value; return this; },
        maybeSingle: async () => ({ data: {
          call_sessions: options.missing ? null : session,
          call_participants: { user_id: options.user ?? 'owner', status: options.partStatus ?? 'joined', provider_identity: 'membership-generation' },
          conversation_members: options.removed ? null : { user_id: options.user ?? 'owner' },
          profiles: { full_name: 'Synthetic QA user' },
        }[table], error: options.readError === table ? { message: 'unavailable' } : null }),
      };
    },
  };
  const room = { url: `https://synthetic.daily.co/${sessionId}`, privacy: options.publicRoom ? 'public' : 'private', config: { enable_screenshare: false } };
  const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/daily-get-token/index.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, Request, Response, Date, AbortSignal,
    Deno: { env: { get: () => 'synthetic-placeholder' }, serve: value => { handler = value; } },
    require: () => ({ createClient: () => client }),
    fetch: async (url, init = {}) => {
      const call = { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null }; provider.push(call);
      if (url.endsWith('/meeting-tokens')) return Response.json(options.badToken ? {} : { token: 'synthetic-meeting-token' }, { status: options.tokenError ? 500 : 200 });
      if (call.method === 'POST') return Response.json(room, { status: options.createRace ? 400 : 200 });
      const gets = provider.filter(item => item.method === 'GET').length;
      return Response.json(room, { status: options.create && gets === 1 ? 404 : 200 });
    },
  });
  const run = async (body = { callSessionId: sessionId }, method = 'POST') => {
    const response = await handler(new Request('https://function.invalid', { method, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }));
    return { status: response.status, body: await response.json() };
  };
  return { run, reads, provider };
}
for (const user of ['owner', 'receiver']) test(`direct ${user} can obtain a token bound to the private session`, async () => {
  const h = harness({ user }); const result = await h.run({ callSessionId: sessionId.toUpperCase(), isOwner: user !== 'owner' });
  assert.equal(result.status, 200); const token = h.provider.find(call => call.url.endsWith('/meeting-tokens')).body.properties;
  assert.equal(token.room_name, sessionId); assert.equal(token.user_id, user); assert.equal(token.is_owner, user === 'owner');
});
test('unauthenticated and unrelated callers cannot contact the room provider', async () => {
  for (const options of [{ unauthenticated: true }, { user: 'outsider' }]) {
    const h = harness(options); assert.ok([401, 403].includes((await h.run()).status)); assert.equal(h.provider.length, 0);
  }
});
test('a joined current group member can join the shared room', async () => {
  const h = harness({ user: 'member', session: { is_group_call: true, receiver_id: null } });
  assert.equal((await h.run()).status, 200);
  assert.equal(h.reads.find(read => read.table === 'call_participants').filters.user_id, 'member');
  assert.equal(h.reads.find(read => read.table === 'conversation_members').filters.conversation_id, 'group');
});
for (const partStatus of ['invited', 'declined', 'left']) test(`a ${partStatus} group participant cannot mint credentials`, async () => {
  const h = harness({ partStatus, session: { is_group_call: true } });
  assert.equal((await h.run()).status, 403); assert.equal(h.provider.length, 0);
});
test('a removed group member, including the original owner, cannot mint credentials', async () => {
  const h = harness({ removed: true, session: { is_group_call: true } });
  assert.equal((await h.run()).status, 403); assert.equal(h.provider.length, 0);
});
for (const status of ['ended', 'missed', 'declined']) test(`a ${status} call cannot mint fresh credentials`, async () => {
  const h = harness({ session: { status } }); assert.equal((await h.run()).status, 409); assert.equal(h.provider.length, 0);
});
test('expired ringing calls are rejected with both explicit and legacy expiry', async () => {
  for (const expiry of [{ expires_at: new Date(now - 1000).toISOString() }, { created_at: new Date(now - 100000).toISOString() }]) {
    const h = harness({ session: { status: 'ringing', ...expiry } });
    assert.equal((await h.run()).status, 409); assert.equal(h.provider.length, 0);
  }
  const h = harness({ session: { status: 'ringing' } }); assert.equal((await h.run()).status, 200);
});
test('new rooms enable screen sharing while preserving privacy, expiry and voice camera defaults', async () => {
  const h = harness({ create: true, session: { is_video: false } }); assert.equal((await h.run()).status, 200);
  const creation = h.provider.find(call => call.url.endsWith('/rooms') && call.method === 'POST').body;
  assert.equal(creation.name, sessionId); assert.equal(creation.privacy, 'private');
  assert.equal(creation.properties.enable_screenshare, true); assert.equal(creation.properties.start_video_off, true);
  assert.equal(creation.properties.eject_at_room_exp, true); assert.ok(creation.properties.exp > now / 1000);
});
test('existing rooms retain their configuration without an unrequested live update', async () => {
  const h = harness(); assert.equal((await h.run()).status, 200);
  assert.equal(h.provider.filter(call => !call.url.endsWith('/meeting-tokens') && call.method !== 'GET').length, 0);
});
test('simultaneous creation recovers by reading the same private room', async () => {
  const h = harness({ create: true, createRace: true }); assert.equal((await h.run()).status, 200);
  assert.equal(h.provider.filter(call => call.method === 'GET').length, 2);
  assert.equal(h.provider.filter(call => call.url.endsWith('/meeting-tokens')).length, 1);
});
test('unexpected public rooms fail closed', async () => {
  const h = harness({ publicRoom: true }); assert.equal((await h.run()).status, 502);
  assert.equal(h.provider.some(call => call.url.endsWith('/meeting-tokens')), false);
});
test('access read errors cannot become authorization or call-not-found success', async () => {
  for (const readError of ['call_sessions', 'call_participants', 'conversation_members']) {
    const h = harness({ readError, session: { is_group_call: true } });
    assert.equal((await h.run()).status, 503); assert.equal(h.provider.length, 0);
  }
});
test('invalid IDs and methods do not reach the provider', async () => {
  for (const id of [null, {}, 'name/room', 'a0000000', '']) {
    const h = harness(); assert.equal((await h.run({ callSessionId: id })).status, 400); assert.equal(h.provider.length, 0);
  }
  const h = harness(); assert.equal((await h.run({}, 'GET')).status, 405);
});
test('failed or malformed provider tokens cannot report a successful call join', async () => {
  for (const options of [{ tokenError: true }, { badToken: true }]) {
    const h = harness(options); const result = await h.run(); assert.equal(result.status, 502); assert.equal(result.body.token, undefined);
  }
});
