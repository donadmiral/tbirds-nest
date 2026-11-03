const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { webcrypto, createHmac } = require('node:crypto');
function load(file, imports = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../functions', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, Request, Response, Headers, URL, AbortSignal, TextEncoder, TextDecoder,
    Uint8Array, Date, crypto: webcrypto, atob, btoa, require(name) { if (name in imports) return imports[name]; throw Error(name); } });
  return module.exports;
}
const p = load('live-core/provider.ts');
const { createLiveHandler } = load('live-core/handler.ts', { './provider.ts': p });
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const host = id(1), guest = id(2), hostIdentity = id(11), guestIdentity = id(12), session = id(20), instance = id(21);
const now = Date.parse('2026-11-02T20:00:00Z');
const context = {
  session_id: session, state: 'live', host_id: host, audience: 'public', recording_enabled: true,
  room_name: 'pc-live-' + session.replaceAll('-', ''), instance_id: instance,
  playback_path: `live/${session}/${instance}/master.m3u8`, role: 'host', provider_identity: hostIdentity,
  allowed_participants: [{ user_id: host, provider_identity: hostIdentity, role: 'host' }, { user_id: guest, provider_identity: guestIdentity, role: 'guest' }],
  max_stage_members: 12,
};
const present = [{ id: id(31), userId: hostIdentity }, { id: id(32), userId: guestIdentity }, { id: id(33), userId: id(99) }];
const config = {
  dailyKey: 'synthetic-private-daily-key', endpointName: 'platinum-live', bucket: 'synthetic-live', region: 'us-west-2',
  assumeRoleArn: 'arn:aws:iam::123456789012:role/DailyLive', cdnOrigin: 'https://live.synthetic.invalid',
  signerUrl: '', signerSecret: '', webhookSecret: Buffer.alloc(32, 8).toString('base64'), domainId: id(90), workerSecret: '',
};
const plain = v => JSON.parse(JSON.stringify(v));
test('on-air host resolves through scoped provider identity and excludes backstage sources', () => {
  const out = p.buildLiveLayout({ preset: 'host' }, context, present, true);
  assert.deepEqual(plain(out.layout.participants), { video: [id(31)], audio: [id(31)] });
  assert.equal(out.layout.composition_id, 'daily:baseline');
  assert.equal(out.published[0].provider_identity, hostIdentity);
});
test('every scene update reapplies audio/video membership and rejects removed participants', () => {
  const scene = { preset: 'game', participant_id: guestIdentity };
  const out = p.buildLiveLayout(scene, context, present, false);
  assert.deepEqual(plain(out.layout.participants), { video: [id(31), id(32)], audio: [id(31), id(32)] });
  assert.equal(out.layout.composition_params['videoSettings.preferScreenshare'], true);
  assert.throws(() => p.buildLiveLayout(scene, { ...context, allowed_participants: [context.allowed_participants[0]] }, present, false), /SOURCE_NOT_CONNECTED/);
  assert.throws(() => p.buildLiveLayout({ preset: 'grid', participant_ids: [id(33)] }, context, present, false), /SOURCE_NOT_CONNECTED/);
  assert.equal(p.validScene({ preset: 'host', rtmpUrl: 'rtmp://attacker.invalid' }), false);
});
test('playback accepts canonical session manifest paths and rejects traversal and cross-session paths', () => {
  assert.equal(p.validPlaybackPath(context.playback_path, session), true);
  for (const candidate of [`live/${id(22)}/${instance}/master.m3u8`, `live/${session}/------------------------------------/master.m3u8`,
    `live/${session}/${instance}/masterXm3u8`, `live/${session}/${instance}/../master.m3u8`, context.playback_path + '?token=forged']) {
    assert.equal(p.validPlaybackPath(candidate, session), false, candidate);
  }
});
test('HLS rendition configuration keeps recordings and every object inside session-scoped storage', () => {
  const endpoint = p.hlsEndpoint(config, context);
  assert.equal(endpoint.hls_config.storage.path_template, `live/${session}/{instance_id}`);
  assert.equal(endpoint.hls_config.save_hls_recording, true);
  assert.deepEqual(plain(endpoint.hls_config.variants.map(v => v.height)), [1080, 720, 360, 180]);
  assert.throws(() => p.hlsEndpoint({ ...config, assumeRoleArn: '' }, context), /NOT_READY/);
});
test('signed Daily events reject expired, forged and missing signatures', async () => {
  const event = { version: '1.0.0', type: 'streaming.started', id: 'event-1', payload: { instance_id: instance } };
  const timestamp = String(now / 1000);
  const sign = value => createHmac('sha256', Buffer.from(config.webhookSecret, 'base64')).update(`${timestamp}.${JSON.stringify(value)}`).digest('base64');
  assert.equal(await p.verifyDailyWebhook(event, timestamp, sign(event), config.webhookSecret, now), true);
  assert.equal(await p.verifyDailyWebhook({ ...event, id: 'tampered' }, timestamp, sign(event), config.webhookSecret, now), false);
  assert.equal(await p.verifyDailyWebhook(event, timestamp, sign(event), config.webhookSecret, now + 300001), false);
  assert.equal(await p.verifyDailyWebhook(event, timestamp, null, config.webhookSecret, now), false);
});
function harness(options = {}) {
  const calls = [], requests = [];
  const token = 'header.' + Buffer.from(JSON.stringify({ sub: host, session_id: id(80) })).toString('base64url') + '.signature';
  let checks = 0;
  const caller = {
    auth: { getUser: async () => ({ data: { user: options.unauthorized ? null : { id: host } }, error: null }) },
    rpc: async (name, args) => {
      calls.push({ name, args }); checks++;
      if (options.revoked && checks > 1) return { data: null, error: { message: 'ACCESS_DENIED' } };
      return { data: { provider_identity: hostIdentity, role: 'host' }, error: null };
    },
  };
  const service = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { ...context, ...options.context }, error: null }; } };
  const deps = { caller: () => caller, service, config: { ...config, ...options.config }, now: () => now,
    fetch: async (url, init) => { requests.push({ url, init }); return Response.json(options.signed || {}); } };
  return { calls, requests, async run(mode = 'playback', body = { sessionId: session }) {
    const response = await createLiveHandler(mode, deps)(new Request('https://synthetic.invalid/live', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(body),
    }));
    return { status: response.status, data: await response.json() };
  } };
}
test('verified public playback returns canonical HLS without exposing stage credentials', async () => {
  const h = harness(), r = await h.run();
  assert.equal(r.status, 200); assert.equal(r.data.url, config.cdnOrigin + '/' + context.playback_path);
  assert.equal(r.data.format, 'hls'); assert.equal(r.data.token, undefined); assert.equal(h.requests.length, 0);
  assert.equal(h.calls.filter(c => c.name === 'live_provider_access').length, 2);
});
test('private playback fails closed without delivery signing and checks revocation after signing', async () => {
  const privateCase = harness({ context: { audience: 'invite' } });
  assert.equal((await privateCase.run()).status, 503);
  const signedUrl = `${config.cdnOrigin}/_live/capability/${context.playback_path}`;
  const settings = { signerUrl: 'https://sign.synthetic.invalid/sign', signerSecret: 'synthetic-signer-credential' };
  const good = harness({ context: { audience: 'invite' }, config: settings, signed: { url: signedUrl, expiresAt: new Date(now + 60000).toISOString() } });
  assert.equal((await good.run()).status, 200);
  const revoked = harness({ context: { audience: 'invite' }, config: settings, revoked: true, signed: { url: signedUrl, expiresAt: new Date(now + 60000).toISOString() } });
  assert.equal((await revoked.run()).status, 403);
  const injected = harness({ context: { audience: 'invite' }, config: settings, signed: { url: 'https://attacker.invalid/stream', expiresAt: new Date(now + 60000).toISOString() } });
  assert.equal((await injected.run()).status, 400);
});
test('no anonymous user reaches service context or provider network', async () => {
  const h = harness({ unauthorized: true });
  assert.equal((await h.run()).status, 401); assert.equal(h.calls.length, 0); assert.equal(h.requests.length, 0);
});

const { createMaintenanceHandler } = load('live-maintenance/handler.ts');
const tick = 'pc_live_' + 'a'.repeat(64);
const inspectionHeader = 'X-Platinum-Live-Inspect-Provider';
const domain = { domain_name: 'platinum-live', domain_id: 'abcdef01-abcd-4abc-8abc-abcdef012345' };
function maintenance(options = {}) {
  const calls = [], requests = [], events = [];
  const cover = { id: id(40), lease_id: id(41), object_path: `${host}/${session}/${id(42)}.jpg`, user_id: host };
  const handler = createMaintenanceHandler({
    dailyKey: options.missingKey ? '' : config.dailyKey,
    configuration: { DAILY_API_KEY: !options.missingKey },
    rpc: async (name, args) => {
      calls.push({ name, args }); events.push(name);
      if (name === 'validate_live_worker_tick_v1') return { data: options.authorized !== false, error: null };
      if (name === 'live_maintenance') return { data: { swept: 3 }, error: options.databaseError ? { message: 'private database error' } : null };
      if (name === 'live_claim_outbox') return { data: { items: [] }, error: null };
      if (name === 'live_claim_cover_cleanup') return { data: { items: options.cover ? [cover] : [] }, error: null };
      if (name === 'live_check_cover_cleanup') return { data: { absent: false, object_path: cover.object_path }, error: null };
      if (name === 'live_finish_cover_cleanup') return { data: { ok: true }, error: null };
      if (name === 'finish_live_worker_tick_v1') return { data: options.finishConfirmed !== false, error: null };
      throw Error(name);
    },
    removeCover: async () => { events.push('removeCover'); return { error: options.coverError ? { message: 'private storage error' } : null }; },
    fetch: async (url, init) => {
      requests.push({ url, init }); events.push('inspectProvider');
      return options.fetch ? options.fetch(url, init) : Response.json({ ...domain, ...options.domain,
        config: { private_hook: 'https://private.synthetic.invalid/hook' }, api_key: config.dailyKey, extra: 'private provider data' });
    },
  });
  return { calls, requests, events, async run({ authorization = 'Bearer ' + tick, inspect = '1' } = {}) {
    const headers = { Authorization: authorization };
    if (inspect !== null) headers[inspectionHeader] = inspect;
    const response = await handler(new Request('https://synthetic.invalid/live-maintenance', { method: 'POST', headers }));
    return { status: response.status, data: await response.json() };
  } };
}
test('provider inspection never bypasses one-use tick authentication', async () => {
  for (const authorization of ['', 'Bearer app.jwt.signature', 'Bearer synthetic-service-key', tick]) {
    const h = maintenance(), result = await h.run({ authorization });
    assert.equal(result.status, 401); assert.equal(h.calls.length, 0); assert.equal(h.requests.length, 0);
  }
  const rejected = maintenance({ authorized: false });
  assert.equal((await rejected.run()).status, 401);
  assert.deepEqual(rejected.calls.map(call => call.name), ['validate_live_worker_tick_v1']);
  assert.equal(rejected.requests.length, 0);
});
test('ordinary maintenance and non-opt-in header values never inspect the Daily domain', async () => {
  for (const inspect of [null, '', '0', 'true', '1, 1']) {
    const h = maintenance(), result = await h.run({ inspect });
    assert.equal(result.status, 200); assert.equal(result.data.ok, true);
    assert.equal(result.data.provider_inspection, undefined); assert.equal(h.requests.length, 0);
    assert.equal(h.calls.at(-1).name, 'finish_live_worker_tick_v1');
    assert.equal(h.calls.at(-1).args.p_succeeded, true);
  }
});
test('explicit inspection returns only validated domain identifiers after cleanup is acknowledged', async () => {
  const h = maintenance({ cover: true, domain: { domain_id: domain.domain_id.toUpperCase() } }), result = await h.run();
  assert.equal(result.status, 200); assert.equal(result.data.ok, true); assert.equal(result.data.covers_erased, 1);
  assert.deepEqual(result.data.provider_inspection, { ok: true, ...domain });
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, 'https://api.daily.co/v1/');
  assert.equal(h.requests[0].init.method, 'GET'); assert.equal(h.requests[0].init.redirect, 'error');
  assert.equal(h.requests[0].init.headers.Authorization, 'Bearer ' + config.dailyKey);
  assert.ok(h.requests[0].init.signal instanceof AbortSignal);
  assert.equal(h.events.at(-1), 'inspectProvider'); assert.equal(h.events.at(-2), 'finish_live_worker_tick_v1');
  assert.ok(h.events.indexOf('removeCover') < h.events.indexOf('finish_live_worker_tick_v1'));
  assert.equal(h.calls.filter(call => call.name === 'finish_live_worker_tick_v1').length, 1);
  assert.equal(JSON.stringify(result.data).includes(config.dailyKey), false);
  assert.equal(JSON.stringify(result.data).includes('private'), false);
});
test('inspection does not run when maintenance or its completion acknowledgement fails', async () => {
  for (const options of [{ databaseError: true }, { cover: true, coverError: true }, { finishConfirmed: false }]) {
    const h = maintenance(options), result = await h.run();
    assert.equal(result.status, 503); assert.equal(h.requests.length, 0); assert.equal(result.data.provider_inspection, undefined);
    assert.equal(h.calls.at(-1).name, 'finish_live_worker_tick_v1');
    assert.equal(h.calls.at(-1).args.p_succeeded, false);
  }
});
test('inspection errors are sanitized and cannot undo completed cleanup or finish the tick again', async () => {
  const cases = [
    { missingKey: true },
    { fetch: async () => { throw Error('network failure with ' + config.dailyKey); } },
    { fetch: async () => { throw TypeError('redirect to https://private.synthetic.invalid/' + config.dailyKey); } },
    { fetch: async () => new Response(JSON.stringify({ error: config.dailyKey }), { status: 401 }) },
    { fetch: async () => new Response(null, { status: 302, headers: { Location: 'https://private.synthetic.invalid/' } }) },
    { fetch: async () => new Response('{"private":' + config.dailyKey) },
    { fetch: async () => Response.json([domain]) },
    { fetch: async () => Response.json(null) },
  ];
  for (const options of cases) {
    const h = maintenance({ cover: true, ...options }), result = await h.run();
    assert.equal(result.status, 200); assert.equal(result.data.ok, true); assert.equal(result.data.covers_erased, 1);
    assert.deepEqual(result.data.provider_inspection, { ok: false, error: 'PROVIDER_INSPECTION_UNAVAILABLE' });
    assert.equal(h.calls.filter(call => call.name === 'finish_live_worker_tick_v1').length, 1);
    assert.equal(h.calls.at(-1).args.p_succeeded, true);
    assert.equal(JSON.stringify(result.data).includes(config.dailyKey), false);
    if (options.missingKey) assert.equal(h.requests.length, 0);
  }
});
test('domain inspection accepts DNS labels up to 63 characters and rejects malformed identifiers', async () => {
  for (const domain_name of ['a', 'a'.repeat(63), 'valid-domain-123']) {
    const result = await maintenance({ domain: { domain_name } }).run();
    assert.equal(result.data.provider_inspection.ok, true); assert.equal(result.data.provider_inspection.domain_name, domain_name);
  }
  const invalid = [
    ...['', 'a'.repeat(64), '-bad', 'bad-', 'bad.name', 'bad_name', 'bad/name', 'é', 'bad\n'].map(domain_name => ({ domain_name })),
    { domain_name: null }, { domain_id: 'not-a-uuid' }, { domain_id: 42 }, { domain_id: domain.domain_id + '\n' },
  ];
  for (const fields of invalid) {
    const result = await maintenance({ domain: fields }).run();
    assert.deepEqual(result.data.provider_inspection, { ok: false, error: 'PROVIDER_INSPECTION_UNAVAILABLE' }, JSON.stringify(fields));
  }
});
test('inspection cancels provider errors without reading raw error bodies', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 403 });
  const result = await maintenance({ fetch: async () => response }).run();
  assert.equal(cancelled, true); assert.equal(result.status, 200); assert.equal(result.data.provider_inspection.ok, false);
});
test('inspection enforces the 32 KB limit on streamed bytes and cancels oversized replies', async () => {
  const serialized = JSON.stringify({ ...domain, padding: '' });
  const atLimit = JSON.stringify({ ...domain, padding: 'x'.repeat(32768 - Buffer.byteLength(serialized)) });
  assert.equal(Buffer.byteLength(atLimit), 32768);
  assert.deepEqual((await maintenance({ fetch: async () => new Response(atLimit) }).run()).data.provider_inspection, { ok: true, ...domain });
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('é'.repeat(16385))); },
    cancel() { cancelled = true; },
  }));
  const result = await maintenance({ fetch: async () => response }).run();
  assert.equal(cancelled, true); assert.equal(result.status, 200);
  assert.deepEqual(result.data.provider_inspection, { ok: false, error: 'PROVIDER_INSPECTION_UNAVAILABLE' });
});
test('inspection times out an unresponsive provider without changing maintenance success', { timeout: 8000 }, async () => {
  let aborted = false;
  const h = maintenance({ fetch: async (_url, init) => new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(Error('inspection did not enforce its deadline')), 7000);
    init.signal.addEventListener('abort', () => { aborted = true; clearTimeout(deadline); reject(Error('provider timed out ' + config.dailyKey)); }, { once: true });
  }) });
  const result = await h.run();
  assert.equal(aborted, true); assert.equal(result.status, 200); assert.equal(result.data.ok, true);
  assert.deepEqual(result.data.provider_inspection, { ok: false, error: 'PROVIDER_INSPECTION_UNAVAILABLE' });
  assert.equal(h.calls.filter(call => call.name === 'finish_live_worker_tick_v1').length, 1);
});
