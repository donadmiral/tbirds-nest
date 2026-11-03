const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const moduleValue = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'supabase/functions/live-sign/handler.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleValue, exports: moduleValue.exports, crypto: crypto.webcrypto, Response, TextEncoder, TextDecoder, Uint8Array, URL, Date });
const { createLiveSigner } = moduleValue.exports;
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0'), session = id(1), instance = id(2);
const now = Date.parse('2026-11-02T20:00:00Z');
const config = { secret: 'synthetic-service-secret-32-bytes-minimum', signingKey: 'synthetic-cdn-secret-32-bytes-minimum', keyId: 'key1', cdnOrigin: 'https://live.synthetic.invalid' };
const body = { sessionId: session, userId: id(3), path: `live/${session}/${instance}/master.m3u8`, expiresAt: new Date(now + 120000).toISOString() };
async function sign(options = {}) {
  const response = await createLiveSigner(config, () => now)(new Request('https://synthetic.invalid/live-sign', {
    method: 'POST', headers: { Authorization: options.authorization || `Bearer ${config.secret}` }, body: JSON.stringify({ ...body, ...options.body }),
  })); return { status: response.status, value: await response.json() };
}
function edgeHandler({ unknownKey = false, time = now, signingKeys = { 'signing:key1': config.signingKey } } = {}) {
  const source = fs.readFileSync(path.join(root, 'infrastructure/live/viewer-request.js'), 'utf8')
    .replace("import cf from 'cloudfront';", '').replace("const crypto = require('crypto');", '') + '\nmodule.exports=handler;';
  const module = { exports: {} };
  vm.runInNewContext(source, { module, crypto, Date: { now: () => time }, cf: { kvs: () => ({ get: async key => {
    if (unknownKey || !Object.hasOwn(signingKeys, key)) throw Error('missing'); return signingKeys[key];
  } }) } }); return module.exports;
}
const event = uri => ({ request: { method: 'GET', uri, querystring: { ignored: { value: '1' } }, headers: { authorization: { value: 'not-forwarded' } } } });
test('signer and real edge verifier agree and strip capability only after validation', async () => {
  const signed = await sign(); assert.equal(signed.status, 200);
  const url = new URL(signed.value.url), result = await edgeHandler()(event(url.pathname));
  assert.equal(result.uri, '/' + body.path); assert.deepEqual(Object.keys(result.querystring), []);
  assert.equal(result.headers.authorization, undefined);
  const segment = url.pathname.replace('master.m3u8', '720/segment0001.ts');
  assert.equal((await edgeHandler()(event(segment))).uri, '/' + body.path.replace('master.m3u8', '720/segment0001.ts'));
});
test('edge blocks direct origin paths, expired tokens, forged tokens and cross-session assets', async () => {
  const signed = await sign(), uri = new URL(signed.value.url).pathname;
  for (const candidate of ['/' + body.path, uri.replace(`/live/${session}/`, `/live/${id(9)}/`), uri.replace('master.m3u8', '../private.ts'), uri.replace('key1.', 'key2.')]) {
    assert.equal((await edgeHandler()(event(candidate))).statusCode, 403);
  }
  assert.equal((await edgeHandler({ time: now + 120000 })(event(uri))).statusCode, 403);
  assert.equal((await edgeHandler({ unknownKey: true })(event(uri))).statusCode, 403);
});
test('signing rejects public callers, unbounded expiry and arbitrary paths', async () => {
  assert.equal((await sign({ authorization: 'Bearer public' })).status, 401);
  assert.equal((await sign({ body: { expiresAt: new Date(now + 121000).toISOString() } })).status, 400);
  assert.equal((await sign({ body: { path: 'private/secret.mp4' } })).status, 400);
  assert.equal((await sign({ body: { sessionId: id(9) } })).status, 400);
});
test('signer rejects noncanonical UUIDs instead of issuing an edge-incompatible capability', async () => {
  const uppercaseSession = 'AB000000-0000-4000-8000-000000000001';
  const uppercaseInstance = 'CD000000-0000-4000-8000-000000000002';
  assert.equal((await sign({ body: { sessionId: uppercaseSession, path: `live/${uppercaseSession}/${instance}/master.m3u8` } })).status, 400);
  assert.equal((await sign({ body: { path: `live/${session}/${uppercaseInstance}/master.m3u8` } })).status, 400);
  const canonical = await sign({ body: { sessionId: uppercaseSession.toLowerCase(), path: `live/${uppercaseSession.toLowerCase()}/${uppercaseInstance.toLowerCase()}/master.m3u8` } });
  assert.equal(canonical.status, 200);
  assert.equal((await edgeHandler()(event(new URL(canonical.value.url).pathname))).uri,
    `/live/${uppercaseSession.toLowerCase()}/${uppercaseInstance.toLowerCase()}/master.m3u8`);
});
test('HLS child playlists, initialization objects, segments and HEAD requests preserve the authorized scope', async () => {
  const signed = await sign(), uri = new URL(signed.value.url).pathname;
  for (const child of ['720/index.m3u8', '720/init.mp4', '720/seg001.m4s', '720/seg001.ts', 'captions.vtt']) {
    const request = event(uri.replace('master.m3u8', child)); request.request.method = 'HEAD';
    request.request.headers.range = { value: 'bytes=0-127' }; request.request.headers.cookie = { value: 'unrelated=private' };
    const result = await edgeHandler()(request);
    assert.equal(result.uri, '/' + body.path.replace('master.m3u8', child));
    assert.equal(result.headers.range.value, 'bytes=0-127'); assert.equal(result.headers.cookie, undefined);
  }
  for (const child of ['../secret.ts', '%2e%2e/secret.ts', '720/%2fsecret.ts', '720//secret.ts', '720/file.json']) {
    assert.equal((await edgeHandler()(event(uri.replace('master.m3u8', child)))).statusCode, 403);
  }
});
test('CORS preflights require a valid capability and never authorize writes or bearer headers', async () => {
  const signed = await sign(), uri = new URL(signed.value.url).pathname;
  const preflight = (path, method = 'GET', requested = 'Range, Accept') => {
    const e = event(path); e.request.method = 'OPTIONS';
    e.request.headers['access-control-request-method'] = { value: method };
    e.request.headers['access-control-request-headers'] = { value: requested }; return e;
  };
  const allowed = await edgeHandler()(preflight(uri));
  assert.equal(allowed.statusCode, 204); assert.equal(allowed.headers['access-control-allow-origin'].value, '*');
  assert.equal(allowed.headers['cache-control'].value, 'private, no-store');
  assert.equal((await edgeHandler()(preflight('/' + body.path))).statusCode, 403);
  assert.equal((await edgeHandler({ time: now + 120000 })(preflight(uri))).statusCode, 403);
  assert.equal((await edgeHandler()(preflight(uri, 'PUT'))).statusCode, 403);
  assert.equal((await edgeHandler()(preflight(uri, 'GET', 'authorization'))).statusCode, 403);
});
test('rotation can overlap keys while removed, altered and unknown keys fail closed', async () => {
  const old = await sign(), newKey = { ...config, keyId: 'key2', signingKey: 'synthetic-next-cdn-secret-32-bytes-minimum' };
  const nextResponse = await createLiveSigner(newKey, () => now)(new Request('https://synthetic.invalid/live-sign', {
    method: 'POST', headers: { Authorization: `Bearer ${newKey.secret}` }, body: JSON.stringify(body),
  }));
  const next = await nextResponse.json(); assert.equal(nextResponse.status, 200);
  const oldUri = new URL(old.value.url).pathname, newUri = new URL(next.url).pathname;
  const overlapping = edgeHandler({ signingKeys: { 'signing:key1': config.signingKey, 'signing:key2': newKey.signingKey } });
  assert.equal((await overlapping(event(oldUri))).uri, '/' + body.path);
  assert.equal((await overlapping(event(newUri))).uri, '/' + body.path);
  const retired = edgeHandler({ signingKeys: { 'signing:key2': newKey.signingKey } });
  assert.equal((await retired(event(oldUri))).statusCode, 403);
  assert.equal((await retired(event(newUri))).uri, '/' + body.path);
  assert.equal((await edgeHandler({ signingKeys: { 'signing:key1': newKey.signingKey } })(event(oldUri))).statusCode, 403);
});
