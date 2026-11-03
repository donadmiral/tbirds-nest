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
function edgeHandler({ unknownKey = false, time = now } = {}) {
  const source = fs.readFileSync(path.join(root, 'infrastructure/live/viewer-request.js'), 'utf8')
    .replace("import cf from 'cloudfront';", '').replace("import crypto from 'crypto';", '') + '\nmodule.exports=handler;';
  const module = { exports: {} };
  vm.runInNewContext(source, { module, crypto, Date: { now: () => time }, cf: { kvs: () => ({ get: async key => {
    if (unknownKey || key !== 'signing:key1') throw Error('missing'); return config.signingKey;
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
