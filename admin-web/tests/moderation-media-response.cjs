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
  const proofSignals = [];
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/moderationMediaResponse.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    './adminAuth': { async getAdmin() { events.push(['auth']); authCount++; if (options.authPendingAt === authCount) return new Promise(() => {}); return options.unauthenticated || (options.revoked && authCount > 1) ? null : authCount>1 && options.afterAdmin ? {...admin,...options.afterAdmin}:admin; } },
    './adminAssurance': { async canAccessOperations() { return !options.assuranceDenied && !(options.assuranceRevoked && authCount>1); } },
    './permissions': { canPerform(role, permission) { assert.equal(permission, 'post_moderate'); return role==='moderator'&&!options.permissionDenied; } },
    './supabaseAdmin': { serviceClient() { events.push(['client']); return { rpc(name, args) {
      const pending = (async () => {
      events.push(['proof', name, { ...args }]); proofCount++;
      if (options.proofPendingAt === proofCount) return new Promise(() => {});
      if (options.proofError) return { error: { message: 'secret diagnostic' }, data: null };
      if(options.derived)return {error:null,data:options.derived(proofCount,args)};
      if (options.unbound || (options.removed && proofCount > 1)) return { error: null, data: null };
      if (options.badProof) return { error: null, data: { object_id: 'not-an-id', object_version: true } };
      return { error: null, data: { ...object, ...(options.changed && proofCount > 1 ? { object_version: 'version-two' } : {}) } };
      })();
      pending.abortSignal = signal => { proofSignals.push(signal); return pending; };
      return pending;
    } }; } },
  };
  vm.runInNewContext(code, { module, exports: module.exports, URL, URLSearchParams, Set, Map, Request, Response, Headers, AbortSignal, AbortController, ReadableStream, Uint8Array,
    atob, setTimeout, clearTimeout, crypto: webcrypto, process: { env: { NEXT_PUBLIC_SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'fixture-server-key' } },
    async fetch(url, init) {
      events.push(['fetch', String(url), init]);
      if (options.fetchError) throw new Error('upstream leaked secret');
      if (options.fetch) { upstream = await options.fetch(url, init); return upstream; }
      const status = options.status || 200;
      upstream = new Response(init.method === 'HEAD' ? null : status === 206 ? 'fixt' : 'fixture-media-bytes', { status, headers: {
        'Content-Type': options.mime || 'image/jpeg', 'Cache-Control': 'public,max-age=31536000', 'ETag': 'private-etag',
        'Accept-Ranges': 'bytes', ...(status === 206 ? { 'Content-Range': 'bytes 0-3/20', 'Content-Length': '4' } : {}),
      } });
      return upstream;
    },
    require(name) { if (name === 'server-only') return {}; if (dependencies[name]) return dependencies[name]; throw Error('Unexpected dependency: ' + name); },
  });
  const request = (params = {}, init = {}) => new Request('https://admin.example.test/api/moderation-media?' + new URLSearchParams({ kind: 'post', id, bucket: 'post-media', path: 'owner/photo.jpg', ...params }), init);
  return { ...module.exports, request, events, proofSignals, upstream: () => upstream };
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
  assert.equal(fetched[2].headers['Accept-Encoding'], 'identity');
  assert.equal(f.proofSignals.length, 2);
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
  assert.equal(response.headers.get('content-length'), '4'); assert.equal(await response.text(), 'fixt');
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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const shortDeadlines = { startupTimeoutMs: 20, streamIdleTimeoutMs: 20 };
const videoHeaders = { 'Content-Type': 'video/mp4' };

test('first-byte stalls and unresponsive cancellation cannot leave a preview request pending', { timeout: 1000 }, async () => {
  let cancelled = 0;
  const f = fixture({ fetch: async () => new Response(new ReadableStream({
    pull() { return new Promise(() => {}); },
    cancel() { cancelled++; return new Promise(() => {}); },
  }), { headers: videoHeaders }) });
  const response = await f.moderationMediaResponse(f.request(), shortDeadlines);
  assert.equal(response.status, 503); assert.equal(cancelled, 1);
  assert.equal(f.events.find(event => event[0] === 'fetch')[2].signal.aborted, true);
  assert.doesNotMatch(await response.text(), /secret|fixture-server-key/);
});

test('startup deadline covers staff and post-header authorization rechecks without releasing any bytes', { timeout: 1000 }, async () => {
  for (const options of [{ authPendingAt: 1 }, { proofPendingAt: 1 }, { proofPendingAt: 2 }, { authPendingAt: 2 }]) {
    const f = fixture(options);
    const response = await f.moderationMediaResponse(f.request(), shortDeadlines);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /fixture-media-bytes/);
    if (f.proofSignals.length) assert.ok(f.proofSignals.every(signal => signal.aborted));
  }
  const f = fixture({ revoked: true, fetch: async () => new Response(new ReadableStream({ cancel() { return new Promise(() => {}); } }), { headers: videoHeaders }) });
  assert.equal((await f.moderationMediaResponse(f.request(), shortDeadlines)).status, 403);
});

test('client cancellation interrupts pending bytes and prevents late fetch responses from becoming previews', { timeout: 1000 }, async () => {
  let resolveFetch, cancelled = 0;
  const controller = new AbortController();
  const f = fixture({ fetch: () => new Promise(resolve => { resolveFetch = resolve; }) });
  const pending = f.moderationMediaResponse(f.request({}, { signal: controller.signal }), { startupTimeoutMs: 500 });
  while (!resolveFetch) await delay(0);
  controller.abort();
  assert.equal((await pending).status, 499);
  resolveFetch(new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: videoHeaders }));
  await delay(0); assert.equal(cancelled, 1);
});

test('queued bytes survive a paused reader while true upstream inactivity fails promptly', { timeout: 1000 }, async () => {
  const bytes = new TextEncoder().encode('video');
  let reads = 0;
  const healthy = fixture({ fetch: async () => new Response(new ReadableStream({ pull(stream) {
    if (reads++ < 2) stream.enqueue(bytes); else stream.close();
  } }), { headers: { ...videoHeaders, 'Content-Length': '10' } }) });
  const response = await healthy.moderationMediaResponse(healthy.request(), shortDeadlines);
  await delay(45);
  const reader = response.body.getReader();
  assert.equal((await reader.read()).value.byteLength, 5);
  await delay(45);
  assert.equal((await reader.read()).value.byteLength, 5);
  assert.equal((await reader.read()).done, true);

  let first = true;
  const stalled = fixture({ fetch: async () => new Response(new ReadableStream({ pull(stream) {
    if (first) { first = false; stream.enqueue(bytes); } else return new Promise(() => {});
  } }), { headers: videoHeaders }) });
  const failure = await stalled.moderationMediaResponse(stalled.request(), shortDeadlines);
  const failedReader = failure.body.getReader();
  assert.equal((await failedReader.read()).value.byteLength, 5);
  await assert.rejects(failedReader.read(), /interrupted/);
});

test('compressed, redirected and inconsistent byte-range responses are rejected before delivery', async () => {
  for (const options of [
    { headers: { 'Content-Encoding': 'gzip' } },
    { status: 206, headers: { 'Content-Range': 'bytes 0-3/20', 'Content-Length': '5' } },
    { headers: { 'Content-Length': '3' } },
    { redirected: true },
  ]) {
    const f = fixture({ fetch: async () => {
      const response = new Response('1234', { status: options.status || 200, headers: { ...videoHeaders, ...options.headers } });
      if (options.redirected) Object.defineProperty(response, 'redirected', { value: true });
      return response;
    } });
    assert.equal((await f.moderationMediaResponse(f.request(), shortDeadlines)).status, 503);
  }
  const f = fixture({ fetch: async () => new Response('short', { headers: { ...videoHeaders, 'Content-Length': '8' } }) });
  const response = await f.moderationMediaResponse(f.request(), shortDeadlines);
  await assert.rejects(response.text(), /interrupted/);
});
const originalPath=id+'/video.mp4',lease='00000000-0000-4000-8000-000000000088';
const rendition={...object,lease,bytes:20,path:id+'/_renditions_v2/'+objectId+'/'+lease+'/fallback.mp4',version:'rend-2',etag:'private-etag'};
test('approved compatible moderation reads forward ranges only to the exact enrolled private output',async()=>{
 const f=fixture({status:206,mime:'video/mp4',derived:()=>rendition}),r=await f.moderationMediaResponse(f.request({representation:'compatible',path:originalPath},{headers:{Range:'bytes=0-3'}}));
 assert.equal(r.status,206);assert.equal(await r.text(),'fixt');assert.equal(r.headers.get('Location'),null);assert.match(r.headers.get('Cache-Control'),/no-store/);
 assert.equal(f.events.filter(x=>x[0]==='auth').length,2);
 for(const [_,rpc,args] of f.events.filter(x=>x[0]==='proof')){assert.equal(rpc,'admin_bound_post_representation_v1');assert.equal(args.p_path,originalPath);assert.equal(args.p_bucket,'post-media');}
 const [_,href,init]=f.events.find(x=>x[0]==='fetch');assert.equal(new URL(href).pathname,'/storage/v1/object/authenticated/adaptive-media/'+rendition.path);assert.equal(init.headers.Range,'bytes=0-3');
});
test('poster and progressive both recheck staff identity, permission, assurance and immutable proof',async()=>{
 const jpg=Buffer.from('ffd8ffe0'+'00'.repeat(42)+'ffd9','hex'),hash=require('node:crypto').createHash('sha256').update(jpg).digest('hex');
 for(const rep of ['poster','compatible'])for(const fail of ['pass','permission','assurance','revoked','lost-assurance','wrong-post','changed']){
  const f=fixture({status:206,mime:'video/mp4',permissionDenied:fail==='permission',assuranceDenied:fail==='assurance',revoked:fail==='revoked',assuranceRevoked:fail==='lost-assurance',
   derived:(i,args)=>fail==='wrong-post'||(fail==='changed'&&i===2)?null:rep==='poster'?{...object,lease,bytes:jpg.length,hash,jpeg:args.p_payload?jpg.toString('base64'):null}:rendition});
  const r=await f.moderationMediaResponse(f.request({representation:rep,path:originalPath},{headers:{Range:'bytes=0-3'}}));
  if(fail==='pass'){if(rep==='poster'){assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),jpg);assert.equal(f.events.some(x=>x[0]==='fetch'),false);}else assert.equal(r.status,206);}
  else {assert.equal(r.status,fail==='wrong-post'?404:403);assert.equal(r.headers.get('Content-Type'),'application/json');}
 }
});
test('the derived selector does not accept a new bucket, arbitrary output path, duplicate mode or unregistered source',async()=>{
 const f=fixture({derived:()=>({...rendition,path:rendition.path.replace(id,'00000000-0000-4000-8000-000000000099')})});
 assert.equal((await f.moderationMediaResponse(f.request({representation:'compatible',path:originalPath}))).status,503);
 assert.equal((await f.moderationMediaResponse(f.request({representation:'poster',bucket:'adaptive-media',path:originalPath}))).status,400);
 assert.equal((await f.moderationMediaResponse(f.request({representation:'unknown',path:originalPath}))).status,400);
 assert.equal((await f.moderationMediaResponse(new Request(f.request({representation:'poster'}).url+'&representation=compatible'))).status,400);
 assert.equal(f.events.some(x=>x[0]==='fetch'),false);
});
test('a replaced staff account or session, or lost role, stops ready adaptive bytes',async()=>{
 for(const afterAdmin of [{id:objectId},{sessionId:id},{role:'analyst'}]){
  const f=fixture({derived:()=>rendition,afterAdmin,status:206,mime:'video/mp4'}),r=await f.moderationMediaResponse(f.request({representation:'compatible',path:originalPath},{headers:{Range:'bytes=0-3'}}));
  assert.equal(r.status,403);assert.doesNotMatch(await r.text(),/fixt/);assert.equal(f.upstream().bodyUsed,true);
 }
});
