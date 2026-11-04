const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

function load(file, imports = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../functions', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Request, Response, Headers, URL, AbortSignal,
    TextEncoder, TextDecoder, Uint8Array, Date, crypto: webcrypto, atob, btoa,
    require(name) { if (name in imports) return imports[name]; throw Error('Unexpected import: ' + name); },
  });
  return module.exports;
}
const provider = load('live-core/provider.ts');
const acknowledgement = load('_shared/dailyCommandAcknowledgement.ts');
const { createLiveHandler, dailyCommandAccepted } = load('live-core/handler.ts', {
  './provider.ts': provider, '../_shared/dailyCommandAcknowledgement.ts': acknowledgement,
});
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const host = id(1), session = id(2), operation = id(3), lease = id(4), identity = id(5);
const room = 'pc-live-' + session.replaceAll('-', '');
const token = 'synthetic.' + Buffer.from(JSON.stringify({ sub: host, session_id: id(6) })).toString('base64url') + '.signature';
const config = {
  dailyKey: 'synthetic-only-key', endpointName: 'platinum-live', bucket: 'synthetic-live', region: 'us-east-2',
  assumeRoleArn: 'arn:aws:iam::123456789012:role/SyntheticLive', cdnOrigin: 'https://synthetic.invalid',
  signerUrl: '', signerSecret: '', webhookSecret: '', domainId: id(7), workerSecret: '',
};

async function execute(action, acknowledgement, options = {}) {
  const writes = [], requests = [];
  let authorityChecks = 0;
  const context = {
    session_id: session, state: action === 'stop' ? 'ending' : action === 'scene' ? 'live' : 'starting',
    host_id: host, audience: 'followers', recording_enabled: true, room_name: room,
    instance_id: id(8), playback_path: null, role: 'host', provider_identity: identity,
    allowed_participants: [{ provider_identity: identity, user_id: host, role: 'host' }],
    max_stage_members: 12, action, lease_id: lease, payload: { scene: { preset: 'host' } },
  };
  const caller = {
    auth: { getUser: async () => ({ data: { user: options.unauthorized ? null : { id: host } }, error: null }) },
    rpc: async (name, args) => {
      assert.equal(name, 'live_prepare_control');
      assert.equal(args.p_request_id, operation);
      authorityChecks++;
      if (options.revoked && authorityChecks > 1) return { data: null, error: { message: 'ACCESS_DENIED' } };
      return { data: { operation_id: operation, status: 'queued', result: null }, error: null };
    },
  };
  const service = { rpc: async (name, args) => {
    if (name === 'live_service_context') return { data: context, error: null };
    assert.equal(name, 'live_finish_control', 'No synthetic webhook or state shortcut is permitted');
    writes.push(args);
    return { data: { ok: args.p_accepted, state: args.p_accepted ? context.state : 'unconfirmed', session_id: session }, error: null };
  } };
  const fetcher = async (url, init) => {
    requests.push(String(url));
    if (String(url).includes('/live-streaming/')) return Response.json(acknowledgement, { status: options.httpStatus || 200 });
    if (String(url).includes('/presence?')) return Response.json({ total_count: 1, data: [{ id: id(9), userId: identity }] });
    assert.equal(String(url), 'https://api.daily.co/v1/rooms/' + room);
    return Response.json({
      privacy: 'private', url: 'https://synthetic.daily.co/' + room,
      config: { streaming_endpoints: provider.hlsEndpoints(config, context), max_participants: 12 },
    });
  };
  const response = await createLiveHandler('control', { caller: () => caller, service, config, fetch: fetcher })(new Request('https://synthetic.invalid/control', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: session, requestId: operation, action, scene: { preset: 'host' } }),
  }));
  return { status: response.status, body: await response.json(), writes, requests, authorityChecks };
}

test('only explicit, non-conflicting Daily delivery acknowledgements are accepted', () => {
  for (const value of [{ status: 'sent' }, { sent: true }, { sent: 'true' }, { status: 'sent', sent: true }]) {
    assert.equal(dailyCommandAccepted(value), true);
  }
  for (const value of [null, [], 'sent', {}, { ok: true }, { status: 'queued' }, { sent: 1 },
    { status: 'sent', sent: false }, { status: 'failed', sent: true }, { status: 'sent', error: 'rejected' },
    { sent: true, error: { code: 'rejected' } }]) assert.equal(dailyCommandAccepted(value), false);
});

test('start, stop and scene accept status sent without inventing a LIVE transition', async () => {
  for (const action of ['start', 'stop', 'scene']) {
    const result = await execute(action, { status: 'sent' });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.state, action === 'start' ? 'starting' : action === 'stop' ? 'ending' : 'live');
    assert.equal(result.writes.length, 1);
    assert.equal(result.writes[0].p_accepted, true);
    assert.equal(result.writes[0].p_lease_id, lease);
    assert.equal(result.authorityChecks, 2);
  }
});

test('legacy acknowledgements remain supported and conflicting responses remain failed', async () => {
  for (const value of [{ sent: true }, { sent: 'true' }]) assert.equal((await execute('start', value)).body.ok, true);
  for (const value of [{}, { status: 'sent', sent: false }, { status: 'sent', error: 'rejected' }, { status: 'failed', sent: true }]) {
    const result = await execute('start', value);
    assert.equal(result.status, 503);
    assert.equal(result.writes.length, 1);
    assert.equal(result.writes[0].p_accepted, false);
  }
});

test('HTTP errors never become accepted commands even with a sent-shaped body', async () => {
  const result = await execute('start', { status: 'sent' }, { httpStatus: 400 });
  assert.equal(result.status, 503);
  assert.equal(result.writes[0].p_accepted, false);
});

test('missing authentication prevents all provider traffic and state completion', async () => {
  const result = await execute('start', { status: 'sent' }, { unauthorized: true });
  assert.equal(result.status, 401);
  assert.equal(result.requests.length, 0);
  assert.equal(result.writes.length, 0);
});

test('authority revoked immediately before provider control prevents broadcast start', async () => {
  const result = await execute('start', { status: 'sent' }, { revoked: true });
  assert.equal(result.status, 403);
  assert.equal(result.requests.filter(url => url.includes('/live-streaming/')).length, 0);
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].p_accepted, false);
});
