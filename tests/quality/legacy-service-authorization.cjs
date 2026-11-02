const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { webcrypto } = require('node:crypto');
const load = (name, imports = {}) => {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../supabase/functions/_shared', name), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, Request, Response, Headers, AbortSignal, TextEncoder, TextDecoder, crypto: webcrypto, atob,
    require(name) { if (name in imports) return imports[name]; throw Error(name); },
  });
  return module.exports;
};
const push = load('pushDelivery.ts');
const { createLegacyServiceAuthorizer } = load('legacyServiceAuthorization.ts', { './pushDelivery.ts': push });
const { serviceRoleFetch } = load('serviceRoleFetch.ts', { './boundedFetch.ts': load('boundedFetch.ts') });
const jwt = role => Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.synthetic_signature';
const LEGACY = jwt('service_role'), ANON = jwt('anon');
const request = (token = LEGACY, extra = {}) => new Request('https://synthetic.invalid/push', { headers: { Authorization: 'Bearer ' + token, ...extra } });

test('legacy role decoding alone never authorizes and only a strict verified RPC decision is accepted', async () => {
  for (const decision of [false, null, 'true', [true], { authorized: true }, true]) {
    const calls = [];
    const auth = createLegacyServiceAuthorizer({ base: 'https://synthetic.supabase.co/', publicKey: ANON,
      fetch: async (url, init) => { calls.push({ url, init }); return Response.json(decision); },
    });
    assert.equal(await auth(request(), new AbortController().signal), decision === true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://synthetic.supabase.co/rest/v1/rpc/authorize_legacy_push_service');
    assert.equal(calls[0].init.headers.apikey, ANON); assert.equal(calls[0].init.headers.Authorization, 'Bearer ' + LEGACY);
    assert.equal(calls[0].init.body, '{}'); assert.equal(calls[0].init.redirect, 'error');
  }
});

test('user, anonymous, malformed and opaque credentials cannot use the legacy fallback', async () => {
  let calls = 0;
  const auth = createLegacyServiceAuthorizer({ base: 'https://synthetic.supabase.co', publicKey: ANON,
    fetch: async () => { calls++; return Response.json(true); },
  });
  for (const token of ['', ANON, jwt('authenticated'), 'bad-token', 'sb_secret_fake', 'x'.repeat(5000)]) {
    assert.equal(await auth(request(token), new AbortController().signal), false);
  }
  assert.equal(calls, 0);
});

test('the fallback refuses a privileged apikey and supports the unprivileged publishable format', async () => {
  for (const publicKey of [LEGACY, 'sb_secret_synthetic_secret', '', 'invalid']) {
    let calls = 0; const auth = createLegacyServiceAuthorizer({ base: 'https://synthetic.supabase.co', publicKey,
      fetch: async () => { calls++; return Response.json(true); },
    });
    await assert.rejects(auth(request(), new AbortController().signal), /PUBLIC_AUTH_KEY_UNAVAILABLE/); assert.equal(calls, 0);
  }
  const auth = createLegacyServiceAuthorizer({ base: 'https://synthetic.supabase.co', publicKey: 'sb_publishable_synthetic', fetch: async () => Response.json(true) });
  assert.equal(await auth(request(), new AbortController().signal), true);
});

test('signature or permission denial fails closed and backend outages remain retryable errors', async () => {
  for (const status of [401, 403, 404, 503]) {
    const auth = createLegacyServiceAuthorizer({ base: 'https://synthetic.supabase.co', publicKey: ANON, fetch: async () => new Response('', { status }) });
    if (status < 404) assert.equal(await auth(request(), new AbortController().signal), false);
    else await assert.rejects(auth(request(), new AbortController().signal), /SERVICE_AUTH_UNAVAILABLE/);
  }
});

test('the current service key fast path supports bearer and apikey without trusting public keys', async () => {
  const secret = 'sb_secret_synthetic_service_credential_over_32_bytes';
  assert.equal(await push.servicePushAuthorized(request(secret), secret), true);
  assert.equal(await push.servicePushAuthorized(new Request('https://synthetic.invalid', { headers: { apikey: secret } }), secret), true);
  assert.equal(await push.servicePushAuthorized(request(jwt('authenticated'), { apikey: 'sb_publishable_synthetic' }), secret), false);
});

test('service transport sends opaque keys on apikey and retains unrelated user JWTs and legacy service JWTs', async () => {
  const calls = [], secret = 'sb_secret_synthetic_service_credential_over_32_bytes';
  const fetcher = async (input, init) => { calls.push({ input, init }); return new Response('ok'); };
  await serviceRoleFetch(fetcher, secret)('https://synthetic.supabase.co/rest/v1/rpc/noop', { headers: { apikey: secret, Authorization: 'Bearer ' + secret } });
  assert.equal(calls[0].init.headers.get('Authorization'), null); assert.equal(calls[0].init.headers.get('apikey'), secret);
  await serviceRoleFetch(fetcher, secret)('https://synthetic.supabase.co/rest/v1/rpc/noop', { headers: { Authorization: 'Bearer ' + jwt('authenticated') } });
  assert.equal(calls[1].init.headers.get('Authorization'), 'Bearer ' + jwt('authenticated'));
  await serviceRoleFetch(fetcher, LEGACY)('https://synthetic.supabase.co/rest/v1/rpc/noop', { headers: { apikey: LEGACY, Authorization: 'Bearer ' + LEGACY } });
  assert.equal(calls[2].init.headers.get('Authorization'), 'Bearer ' + LEGACY);
  assert.ok(calls.every(call => call.init.signal instanceof AbortSignal));
});
