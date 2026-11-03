const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), { webcrypto } = require('node:crypto');
const cache = new Map();
function load(file) {
  file = path.resolve(__dirname, '../functions', file); if (cache.has(file)) return cache.get(file);
  const module = { exports: {} }; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => load(path.relative(path.resolve(__dirname, '../functions'), path.resolve(path.dirname(file), name))),
      Request, Response, TextEncoder, TextDecoder, Uint8Array, AbortSignal, crypto: webcrypto, setTimeout, clearTimeout });
  return module.exports;
}
const { createClipQueueHandler } = load('live-clip-scaler/handler.ts');
const secret = 'synthetic-queue-only-secret-1234567890';
function harness(data = { enabled: true, due: true, active: 1 }) {
  const calls = []; return { calls, handler: createClipQueueHandler({ secret, service: { rpc: async (...args) => { calls.push(args); return { data, error: null }; } } }) };
}
const request = (body = { action: 'peek' }, key = secret) => new Request('https://example.invalid', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
test('queue-only authentication rejects worker/user credentials before database access', async () => {
  const h = harness(); for (const key of ['', 'ordinary-user-jwt', 'different-worker-secret-1234567890123456']) assert.equal((await h.handler(request(undefined, key))).status, 401);
  assert.equal(h.calls.length, 0);
});
test('queue credential cannot claim work or override actor, count, or URL', async () => {
  const h = harness(); for (const body of [{ action: 'claim' }, { action: 'peek', limit: 1 }, { action: 'peek', url: 'https://evil.invalid' }, []]) assert.equal((await h.handler(request(body))).status, 400);
  assert.equal(h.calls.length, 0);
});
test('fixed queue response strips unexpected identifiers and secrets from dependency output', async () => {
  const h = harness({ enabled: false, due: true, active: 0, secret: 'CANARY', jobs: ['PRIVATE_JOB'] });
  const response = await h.handler(request()); assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await response.json(), { enabled: false, due: true, active: 0 }); assert.deepEqual(h.calls, [['live_clip_queue_peek']]);
});
test('invalid metadata and methods fail closed', async () => {
  for (const data of [{ enabled: true, due: true, active: 3 }, { enabled: true, due: 1, active: 0 }, null]) assert.equal((await harness(data).handler(request())).status, 503);
  assert.equal((await harness().handler(new Request('https://example.invalid'))).status, 405);
});
