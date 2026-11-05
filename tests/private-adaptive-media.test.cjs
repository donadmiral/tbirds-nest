const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const endpoint = 'https://qa.supabase.co/functions/v1/private-hls';
const messageId = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000001';
const leaseId = '30000000-0000-4000-8000-000000000001';
function harness(options = {}) {
  let now = 1800000000000, current = true;
  const exports = {}, calls = [], timers = new Map();
  let timerId = 0;
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared/privateAdaptiveMedia.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, AbortController, Date: Clock,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
  });
  const uri = (asset = 'master.m3u8') => endpoint + '?' + new URLSearchParams({ messageId, requestId, leaseId, sourceVersion: 'version_1', asset });
  const payload = () => ({ ready: true, hlsUrl: uri(), sourceVersion: 'version_1', expiresAt: new Date(now + 60000).toISOString() });
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (JSON.parse(init.body).action === 'close') return new Response('{}');
    if (options.fetch) return options.fetch(url, init, payload());
    return Response.json({ ...payload(), ...options.payload });
  };
  const session = exports.createPrivateAdaptiveSession({ endpoint: options.endpoint ?? endpoint, token: 'session-secret', apiKey: 'public-key', messageId, requestId, fetch, current: () => current });
  return { session, calls, timers, uri, payload, advance: ms => now += ms, stop: () => { current = false; } };
}
test('one open grant supplies authenticated headers for every registered child without tokens in URLs', async () => {
  const h = harness();
  const a = h.session.open(), b = h.session.open();
  assert.equal(a, b);
  const source = await a;
  assert.equal(h.calls.length, 1);
  assert.equal(source.headers.Authorization, 'Bearer session-secret');
  assert.equal(h.session.authorize(h.uri('r0/index.m3u8')).Authorization, 'Bearer session-secret');
  assert.equal(h.session.authorize(h.uri('r0/seg00000.ts')).apikey, 'public-key');
  assert.equal(source.uri.includes('secret'), false);
  assert.equal(h.calls[0].init.redirect, 'error');
  assert.equal(h.calls[0].init.cache, 'no-store');
  assert.deepEqual(h.calls.map(c => c.body.action), ['open']);
  await h.session.close();
});
test('loader authorization rejects foreign hosts, paths, identities, versions, leases and unregistered assets', async () => {
  const h = harness(); await h.session.open();
  const bad = [h.uri().replace('qa.supabase.co', 'evil.example'), h.uri().replace('/private-hls?', '/other?'),
    h.uri().replace(messageId, requestId), h.uri().replace(requestId, messageId), h.uri().replace('version_1', 'version_2'),
    h.uri().replace(leaseId, messageId), h.uri('../source.mp4'), h.uri('r0/key.bin'), h.uri('r0/seg00000.ts') + '&token=secret',
    h.uri() + '&asset=master.m3u8', h.uri() + '#fragment'];
  for (const url of bad) assert.equal(h.session.authorize(url), null, url);
  await h.session.close();
});
test('closing while open is delayed is terminal and sends one separate HLS revoke', async () => {
  let resolve;
  const h = harness({ fetch: (_url, _init, body) => new Promise(r => { resolve = () => r(Response.json(body)); }) });
  const pending = h.session.open();
  await h.session.close();
  assert.equal(h.calls[0].init.signal.aborted, true);
  resolve();
  assert.equal(await pending, null);
  assert.equal(await h.session.open(), null);
  assert.equal(h.session.authorize(h.uri()), null);
  await h.session.close();
  assert.deepEqual(h.calls.map(c => c.body.action), ['open', 'close']);
});
test('account change during the request cannot expose the late source', async () => {
  let resolve;
  const h = harness({ fetch: (_url, _init, body) => new Promise(r => { resolve = () => r(Response.json(body)); }) });
  const pending = h.session.open();h.stop();resolve();
  assert.equal(await pending, null);
  assert.equal(h.session.closed, true);
  assert.equal(h.session.authorize(h.uri()), null);
});
test('expired playback refuses more children and cannot reopen its request', async () => {
  const h = harness();await h.session.open();h.advance(60001);
  assert.equal(h.session.authorize(h.uri('r0/seg00001.ts')), null);
  assert.equal(await h.session.open(), null);
  assert.equal(h.session.closed, true);
});
test('unavailable, malformed, expired and excessive grants preserve original fallback by returning null', async () => {
  for (const payload of [{ready:false},{sourceVersion:'bad/version'},{expiresAt:'bad'},
    {expiresAt:new Date(1800000000000-1).toISOString()}, {expiresAt:new Date(1800000000000+906000).toISOString()},
    {hlsUrl:'https://evil.example/master.m3u8'}]) {
    const h = harness({payload});assert.equal(await h.session.open(), null);assert.equal(h.session.closed, true);
  }
});
test('optional open timeout aborts and revokes without accepting a late server reply', async () => {
  let resolve;
  const h = harness({fetch: (_url,_init,body) => new Promise(r => {resolve = () => r(Response.json(body));})});
  const pending = h.session.open();[...h.timers.values()][0]();resolve();
  assert.equal(await pending, null);assert.equal(h.calls[0].init.signal.aborted, true);
  assert.equal(h.session.closed, true);
});
test('a changed account revokes loader access immediately and returned headers cannot change future authorization', async () => {
  const h = harness();const source = await h.session.open();source.headers.Authorization='tampered';
  assert.equal(h.session.authorize(h.uri()).Authorization,'Bearer session-secret');h.stop();
  assert.equal(h.session.authorize(h.uri()),null);await h.session.close();
});
test('invalid endpoint sends no session token or requests', async () => {
  for(const endpoint of ['http://qa.supabase.co/functions/v1/private-hls','https://user:pass@qa.supabase.co/functions/v1/private-hls','https://qa.supabase.co/functions/v1/private-hls?token=x']) {
    const h=harness({endpoint});assert.equal(await h.session.open(),null);await h.session.close();assert.equal(h.calls.length,0);
  }
});
