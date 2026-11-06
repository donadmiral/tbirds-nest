const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { webcrypto } = require('node:crypto');
const moduleValue = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../functions/live-provider-configure/handler.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleValue, exports: moduleValue.exports, Request, Response, Headers, URL, AbortSignal, TextEncoder, TextDecoder,
  Uint8Array, Date, crypto: webcrypto, atob, btoa });
const { createProviderConfigureHandler } = moduleValue.exports;
const storageModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../functions/live-provider-configure/storage.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: storageModule, exports: storageModule.exports,
  require(name) { assert.equal(name, './handler.ts'); return moduleValue.exports; } });
const { verifyStorage } = storageModule.exports;
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const token = 'pc_live_config_' + 'b'.repeat(64), origin = 'https://abcdefghijklmnopqrst.supabase.co';
const target = origin + '/functions/v1/live-provider-webhook', secret = Buffer.alloc(32, 37).toString('base64');
const dailyKey = 'synthetic-daily-secret-canary', domainId = id(1), operationId = id(2), webhookId = id(3);
const events = ['streaming.started', 'streaming.updated', 'streaming.ended', 'streaming.error', 'streaming.warning'];
const configured = (changes = {}) => ({ uuid: webhookId, url: target, hmac: secret, domainId, state: 'ACTIVE',
  retryType: 'exponential', eventTypes: events, ...changes });
const plain = value => JSON.parse(JSON.stringify(value));
function harness(options = {}) {
  const requests = [], calls = []; let consumed = false, hooks = options.hooks || [], reads = 0;
  const deps = {
    projectOrigin: origin, dailyKey, domainId, webhookSecret: secret,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'claim_live_provider_operation_v1') {
        if (options.unauthorized || consumed || args.p_token !== token) return { data: null, error: null };
        consumed = true;
        return { data: { operation_id: operationId, action: options.action || 'register_webhook', project_origin: options.claimOrigin || origin,
          expires_at: new Date(Date.now() + (options.expiresIn || 120000)).toISOString() }, error: null };
      }
      assert.equal(name, 'finish_live_provider_operation_v1');
      return { data: options.finish !== false, error: null };
    },
    fetch: async (url, init) => {
      requests.push({ url, init });
      assert.ok(url.startsWith('https://api.daily.co/v1/'));
      assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, 'Bearer ' + dailyKey);
      if (options.fetch) return options.fetch(url, init);
      if (url === 'https://api.daily.co/v1/') return Response.json({ domain_id: options.domainId || domainId, domain_name: 'platinumcircles', private_settings: dailyKey });
      if (url === 'https://api.daily.co/v1/webhooks' && init.method === 'GET') {
        reads++;
        return Response.json(options.listEnvelope ? { data: hooks, has_more: true } : options.drift && reads > 1 ? [configured({ hmac: 'wrong-secret' })] : hooks);
      }
      if (url === 'https://api.daily.co/v1/webhooks' && init.method === 'POST') {
        assert.deepEqual(JSON.parse(init.body), { url: target, eventTypes: events, retryType: 'exponential', hmac: secret });
        hooks = [configured()]; return Response.json(hooks[0]);
      }
      assert.equal(url, 'https://api.daily.co/v1/webhooks/' + webhookId); assert.equal(init.method, 'GET');
      return Response.json(options.singletonArray ? [hooks[0]] : hooks[0]);
    },
  };
  const handler = createProviderConfigureHandler({ ...deps, ...options.deps });
  return { requests, calls, async run(authorization = 'Bearer ' + token, body = {}, signal) {
    const response = await handler(new Request(origin + '/functions/v1/live-provider-configure', {
      method: 'POST', headers: { Authorization: authorization }, body: JSON.stringify(body), ...(signal ? { signal } : {}),
    }));
    assert.match(response.headers.get('cache-control'), /no-store/);
    const result = await response.json(), text = JSON.stringify(result);
    for (const canary of [token, secret, dailyKey, target, 'private-provider-echo']) assert.equal(text.includes(canary), false);
    return { status: response.status, data: result };
  } };
}
test('only dedicated issued tokens reach claim, and failed claims never contact Daily', async () => {
  for (const authorization of ['', 'Bearer app.jwt.signature', 'Bearer ' + secret, 'Bearer ' + dailyKey, 'Bearer pc_live_' + 'b'.repeat(64)]) {
    const h = harness(); assert.equal((await h.run(authorization)).status, 401); assert.equal(h.calls.length, 0); assert.equal(h.requests.length, 0);
  }
  for (const options of [{ unauthorized: true }, {}]) {
    const h = harness(options); assert.equal((await h.run('Bearer pc_live_config_' + 'c'.repeat(64))).status, 401);
    assert.equal(h.calls.length, 1); assert.equal(h.requests.length, 0);
  }
});
test('an empty documented list creates one fixed webhook, verifies list and detail, then acknowledges completion', async () => {
  for (const singletonArray of [false, true]) {
    const h = harness({ singletonArray }), result = await h.run();
    assert.equal(result.status, 200); assert.equal(result.data.ok, true); assert.equal(result.data.result.code, 'WEBHOOK_REGISTERED');
    assert.equal(result.data.provider.hmac_matches, true);
    assert.deepEqual(h.requests.map(request => request.init.method), ['GET', 'GET', 'POST', 'GET', 'GET']);
    assert.equal(h.calls.at(-1).name, 'finish_live_provider_operation_v1'); assert.equal(h.calls.at(-1).args.p_succeeded, true);
    assert.deepEqual(plain(h.calls.at(-1).args.p_result), { code: 'WEBHOOK_REGISTERED', resource_id: webhookId, mutation_attempted: true, configuration_matches: true });
  }
});
test('an existing exact ACTIVE registration is verified without any provider write', async () => {
  const h = harness({ hooks: [configured()] }), result = await h.run();
  assert.equal(result.status, 200); assert.equal(result.data.result.code, 'WEBHOOK_ALREADY_CONFIGURED');
  assert.equal(result.data.result.mutation_attempted, false); assert.ok(h.requests.every(request => request.init.method === 'GET'));
});
test('duplicates and same-endpoint configuration conflicts never trigger updates or another create', async () => {
  const cases = [[configured(), configured()], ...[
    { hmac: 'mismatched' }, { state: 'FAILED' }, { retryType: 'circuit-breaker' }, { domainId: id(8) },
    { eventTypes: [...events, 'meeting.started'] }, { basicAuth: 'private-provider-echo' }, { url: target + '?duplicate=1' },
  ].map(change => [configured(change)])];
  for (const hooks of cases) {
    const h = harness({ hooks }), result = await h.run();
    assert.equal(result.status, 409); assert.equal(result.data.result.code, 'PROVIDER_WEBHOOK_CONFLICT');
    assert.ok(h.requests.every(request => request.init.method === 'GET')); assert.equal(h.calls.at(-1).args.p_succeeded, false);
  }
});
test('domain/origin/expiry binding and nonempty input bodies fail before any provider mutation', async () => {
  for (const options of [{ claimOrigin: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co' }, { expiresIn: 1000 }]) {
    const h = harness(options), result = await h.run(); assert.equal(result.status, 503); assert.equal(h.requests.length, 0);
  }
  const wrongDomain = harness({ domainId: id(9) });
  assert.equal((await wrongDomain.run()).status, 409); assert.equal(wrongDomain.requests.length, 1);
  const payload = harness(); assert.equal((await payload.run('Bearer ' + token, { url: 'https://private-provider-echo.invalid' })).status, 503);
  assert.equal(payload.requests.length, 0);
});
test('concurrent uses of one claimed token perform at most one registration', async () => {
  const h = harness(), results = await Promise.all([h.run(), h.run()]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
  assert.equal(h.requests.filter(request => request.init.method === 'POST').length, 1);
});
test('pagination ambiguity, malformed bodies, redirects and oversized provider responses fail closed', async () => {
  const envelope = harness({ listEnvelope: true }); assert.equal((await envelope.run()).status, 503);
  assert.ok(envelope.requests.every(request => request.init.method === 'GET'));
  for (const fetch of [async () => new Response('x'.repeat(65537)), async () => new Response(null, { status: 302, headers: { Location: 'https://private-provider-echo.invalid' } }),
    async () => new Response('not-json'), async () => { throw Error(dailyKey + secret + target); }]) {
    const h = harness({ fetch }), result = await h.run(); assert.equal(result.status, 503); assert.equal(h.requests.length, 1);
  }
});
test('safe diagnostic enums preserve known causes without provider text, credentials or URLs', async () => {
  const cases = [
    ['A paid account is required for this operation.', 'billing_required'],
    ['Unable to assume role: AccessDenied sts:AssumeRole', 'role_assumption_denied'],
    ['S3 bucket PutObject access denied', 'storage_access_denied'],
    ['missing required field properties', 'configuration_invalid'],
    ['private-provider-echo ' + dailyKey + secret + target, 'unclassified'],
  ];
  for (const [info, reason] of cases) {
    const h = harness({ fetch: async () => Response.json({ error: 'invalid-request-error', info, secret }, { status: 400 }) });
    const result = await h.run(); assert.equal(result.status, 503);
    assert.equal(result.data.result.provider_status, 400); assert.equal(result.data.result.provider_error, 'invalid-request-error');
    assert.equal(result.data.result.provider_reason, reason);
    assert.equal(h.calls.at(-1).args.p_result.provider_reason, reason);
  }
});
test('configuration drift after create records possible mutation and never retries the POST', async () => {
  const h = harness({ drift: true }), result = await h.run(); assert.equal(result.status, 409);
  assert.equal(result.data.result.mutation_attempted, true); assert.equal(result.data.result.resource_id, webhookId);
  assert.equal(h.requests.filter(request => request.init.method === 'POST').length, 1);
});
test('completion must be independently acknowledged before reporting success', async () => {
  const h = harness({ finish: false }), result = await h.run();
  assert.equal(result.status, 503); assert.equal(result.data.error, 'COMPLETION_UNCONFIRMED'); assert.equal(result.data.ok, false);
});
test('actual storage helper integration records success or unconfirmed cleanup and honors claim binding', async () => {
  for (const options of [{}, { cleanup: false }, { expiresIn: 1000 }, { claimOrigin: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co' }]) {
    let room = null, storageCalls = 0;
    const roomName = 'pc-live-verify-' + operationId.replaceAll('-', '');
    const h = harness({ ...options, action: 'verify_storage', deps: { storage: {
      bucket: 'synthetic-live-storage', region: 'us-east-2', assumeRoleArn: 'arn:aws:iam::123456789012:role/SyntheticDaily', endpointName: 'platinum-live',
      verify: async deps => { storageCalls++; return verifyStorage(deps); },
    } }, fetch: async (url, init) => {
      if (url === 'https://api.daily.co/v1/') return Response.json({ domain_id: domainId, domain_name: 'platinumcircles' });
      if (url === 'https://api.daily.co/v1/rooms' && init.method === 'POST') {
        const body = JSON.parse(init.body); assert.equal(body.name, roomName); assert.equal(body.privacy, 'private');
        room = { id: id(20), name: body.name, privacy: body.privacy, config: body.properties }; return Response.json(room);
      }
      assert.equal(url, 'https://api.daily.co/v1/rooms/' + roomName);
      if (init.method === 'GET') return room ? Response.json(room) : Response.json({ error: 'not-found-error' }, { status: 404 });
      if (init.method === 'POST') { Object.assign(room.config, JSON.parse(init.body).properties); return Response.json(room); }
      assert.equal(init.method, 'DELETE'); return Response.json({ deleted: options.cleanup !== false, name: roomName });
    } });
    const result = await h.run();
    if (options.expiresIn || options.claimOrigin) {
      assert.equal(result.status, 503); assert.equal(storageCalls, 0); assert.equal(h.requests.length, 0);
    } else if (options.cleanup === false) {
      assert.equal(result.status, 503); assert.equal(result.data.result.code, 'STORAGE_CLEANUP_UNCONFIRMED');
      assert.equal(result.data.result.configuration_matches, true); assert.equal(result.data.result.cleanup_confirmed, false);
      assert.equal(h.calls.at(-1).args.p_succeeded, false);
    } else {
      assert.equal(result.status, 200); assert.equal(storageCalls, 1); assert.equal(result.data.result.code, 'STORAGE_VERIFIED');
      assert.equal(result.data.result.cleanup_confirmed, true); assert.equal(h.calls.at(-1).args.p_succeeded, true);
    }
  }
});
test('an aborted provider body read is bounded and still receives an independent completion attempt', async () => {
  const controller = new AbortController();
  const h = harness({ fetch: async () => new Response(new ReadableStream({ start() {} })) });
  const pending = h.run('Bearer ' + token, {}, controller.signal);
  setTimeout(() => controller.abort(), 10);
  const result = await pending; assert.equal(result.status, 503); assert.equal(result.data.result.code, 'PROVIDER_TIMEOUT');
  assert.equal(h.calls.at(-1).name, 'finish_live_provider_operation_v1'); assert.equal(h.calls.at(-1).args.p_succeeded, false);
});
