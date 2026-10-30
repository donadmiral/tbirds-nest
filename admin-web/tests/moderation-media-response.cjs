const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const base = 'https://qa.example.test';
const id = '00000000-0000-4000-8000-000000000001';
const objectId = '00000000-0000-4000-8000-000000000002';
const admin = { id, email: 'fixture@example.test', role: 'moderator', aal: 'aal1', sessionId: objectId };
const object = { object_id: objectId, object_version: 'version-one' };

function fixture(options = {}) {
  const events = []; let authCount = 0, proofCount = 0; let upstream;
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/moderationMediaResponse.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    './adminAuth': { async getAdmin() { events.push(['auth']); authCount++; return options.unauthenticated || (options.revoked && authCount > 1) ? null : admin; } },
    './adminAssurance': { async canAccessOperations() { return !options.assuranceDenied; } },
    './permissions': { canPerform(role, permission) { assert.equal(role, 'moderator'); assert.equal(permission, 'post_moderate'); return !options.permissionDenied; } },
    './supabaseAdmin': { serviceClient() { events.push(['client']); return { async rpc(name, args) {
      events.push(['proof', name, { ...args }]); proofCount++;
      if (options.proofError) return { error: { message: 'secret diagnostic' }, data: null };
      if (options.unbound || (options.removed && proofCount > 1)) return { error: null, data: null };
      if (options.badProof) return { error: null, data: { object_id: 'not-an-id', object_version: true } };
      return { error: null, data: { ...object, ...(options.changed && proofCount > 1 ? { object_version: 'version-two' } : {}) } };
    } }; } },
  };
  vm.runInNewContext(code, { module, exports: module.exports, URL, URLSearchParams, Set, Map, Request, Response, Headers, AbortSignal, AbortController,
    setTimeout, clearTimeout, crypto: webcrypto, process: { env: { NEXT_PUBLIC_SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'fixture-server-key' } },
    async fetch(url, init) {
      events.push(['fetch', String(url), init]);
      if (options.fetchError) throw new Error('upstream leaked secret');
      const status = options.status || 200;
      upstream = new Response(init.method === 'HEAD' ? null : 'fixture-media-bytes', { status, headers: {
        'Content-Type': options.mime || 'image/jpeg', 'Cache-Control': 'public,max-age=31536000', 'ETag': 'private-etag',
        'Accept-Ranges': 'bytes', ...(status === 206 ? { 'Content-Range': 'bytes 0-3/20' } : {}),
      } });
      return upstream;
    },
    require(name) { if (name === 'server-only') return {}; if (dependencies[name]) return dependencies[name]; throw Error('Unexpected dependency: ' + name); },
  });
  const request = (params = {}, init = {}) => new Request('https://admin.example.test/api/moderation-media?' + new URLSearchParams({ kind: 'post', id, bucket: 'post-media', path: 'owner/photo.jpg', ...params }), init);
  return { ...module.exports, request, events, upstream: () => upstream };
}

test('moderation bytes require current staff identity, proof and no-cache origin fetch', async () => {
  const f = fixture(); const response = await f.moderationMediaResponse(f.request());
  assert.equal(response.status, 200); assert.equal(await response.text(), 'fixture-media-bytes');
  assert.deepEqual(f.events.map(event => event[0]), ['auth', 'client', 'proof', 'fetch', 'proof', 'auth']);
  const proof = f.events.find(event => event[0] === 'proof');
  assert.equal(proof[1], 'admin_bound_content_media_object');
  assert.deepEqual(proof[2], { p_kind: 'post', p_entity_id: id, p_bucket: 'post-media', p_path: 'owner/photo.jpg', p_origin: base });
  const fetched = f.events.find(event => event[0] === 'fetch'); const url = new URL(fetched[1]);
  assert.equal(url.origin, base); assert.equal(url.pathname, '/storage/v1/object/authenticated/post-media/owner/photo.jpg');
  assert.match(url.searchParams.get('cacheNonce'), /^version-one-/);
  assert.equal(fetched[2].cache, 'no-store'); assert.equal(fetched[2].redirect, 'error');
  assert.equal(fetched[2].headers.Authorization, 'Bearer fixture-server-key');
  for (const key of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control', 'surrogate-control']) assert.match(response.headers.get(key), /no-store/);
  assert.equal(response.headers.get('etag'), null); assert.equal(response.headers.get('vary'), 'Cookie, Range');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
});

for (const [options, status] of [[{ unauthenticated: true }, 401], [{ permissionDenied: true }, 403], [{ assuranceDenied: true }, 403]]) {
  test('denied session or staff permission never reads media ' + JSON.stringify(options), async () => {
    const f = fixture(options); const response = await f.moderationMediaResponse(f.request());
    assert.equal(response.status, status); assert.deepEqual(f.events, [['auth']]); assert.match(response.headers.get('cache-control'), /no-store/);
  });
}
test('cross-site embeddings are rejected before any session or object lookup', async () => {
  const f = fixture(); assert.equal((await f.moderationMediaResponse(f.request({}, { headers: { 'Sec-Fetch-Site': 'cross-site' } }))).status, 403); assert.deepEqual(f.events, []);
});

for (const params of [{ kind: 'chat' }, { id: 'bad' }, { bucket: 'chat-files' }, { path: 'owner/../secret' }, { path: '/root' }, { path: 'owner/%2e%2e/secret' }, { path: 'owner\\file.jpg' }, { path: 'x'.repeat(1025) }]) {
  test('invalid media selector never reaches the Storage service ' + JSON.stringify(params).slice(0, 90), async () => {
    const f = fixture(); assert.equal((await f.moderationMediaResponse(f.request(params))).status, 400);
    assert.equal(f.events.some(event => event[0] === 'fetch' || event[0] === 'proof'), false);
  });
}
test('unbound and unavailable authorization produce no media or secret diagnostic', async () => {
  for (const options of [{ unbound: true }, { proofError: true }, { badProof: true }]) {
    const f = fixture(options); const response = await f.moderationMediaResponse(f.request());
    assert.equal(response.status, options.unbound ? 404 : 503); assert.equal(f.events.some(event => event[0] === 'fetch'), false);
    assert.doesNotMatch(await response.text(), /secret|fixture-server-key/);
  }
});
for (const options of [{ changed: true }, { removed: true }, { revoked: true }]) {
  test('mid-request object change or session revocation cancels upstream bytes ' + JSON.stringify(options), async () => {
    const f = fixture(options); const response = await f.moderationMediaResponse(f.request());
    assert.equal(response.status, 403); assert.doesNotMatch(await response.text(), /fixture-media-bytes/);
    assert.equal((await f.upstream().body.getReader().read()).done, true);
  });
}
test('range forwarding is limited to valid single safe ranges and retains 206 metadata', async () => {
  const f = fixture({ status: 206 }); const response = await f.moderationMediaResponse(f.request({}, { headers: { Range: 'bytes=0-3' } }));
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 0-3/20');
  assert.equal(f.events.find(event => event[0] === 'fetch')[2].headers.Range, 'bytes=0-3');
  for (const range of ['bytes=-', 'bytes=-0', 'bytes=4-1', 'bytes=0-1,4-6', 'bytes=9007199254740992-', 'items=0-3']) {
    const bad = fixture(); assert.equal((await bad.moderationMediaResponse(bad.request({}, { headers: { Range: range } }))).status, 416);
    assert.equal(bad.events.some(event => event[0] === 'fetch'), false);
  }
  for (const range of ['bytes=0-', 'bytes=-100', 'bytes=3-9']) assert.equal(f.validMediaRange(range), true);
});
test('HEAD is authenticated and returns no body; caller abort reaches the fetch', async () => {
  const f = fixture(); const controller = new AbortController();
  const response = await f.moderationMediaResponse(f.request({}, { method: 'HEAD', signal: controller.signal }));
  assert.equal(response.status, 200); assert.equal(await response.text(), '');
  const init = f.events.find(event => event[0] === 'fetch')[2]; assert.equal(init.method, 'HEAD');
  controller.abort(); assert.equal(init.signal.aborted, true);
});
test('unsafe inline types and upstream failures fail closed with no diagnostic leakage', async () => {
  for (const options of [{ mime: 'text/html' }, { mime: 'image/svg+xml' }, { fetchError: true }, { status: 302 }, { status: 404 }, { status: 416 }]) {
    const f = fixture(options); const response = await f.moderationMediaResponse(f.request());
    assert.equal(response.status, options.mime ? 415 : options.status === 404 ? 404 : options.status === 416 ? 416 : 503);
    assert.doesNotMatch(await response.text(), /fixture-media-bytes|secret|fixture-server-key/);
  }
});
test('canonical Unicode filenames are encoded only once and historical generic MIME is repaired narrowly', async () => {
  const f = fixture({ mime: 'application/octet-stream' }); const response = await f.moderationMediaResponse(f.request({ path: 'owner/café portrait.jpg' }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(new URL(f.events.find(event => event[0] === 'fetch')[1]).pathname, '/storage/v1/object/authenticated/post-media/owner/caf%C3%A9%20portrait.jpg');
});
