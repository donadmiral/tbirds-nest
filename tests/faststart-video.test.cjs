const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const crypto = require('node:crypto').webcrypto;
const root = path.join(__dirname, '../supabase/functions/faststart-video');
function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Request, Response, Blob, Uint8Array, DataView, TextEncoder, crypto });
  return exports;
}
const { createFaststartHandler } = load('handler.ts'), { faststartRemux } = load('remux.ts');
const owner = '00000000-0000-4000-8000-000000000001', objectId = '00000000-0000-4000-8000-000000000002';
const lease = '00000000-0000-4000-8000-000000000003', serviceKey = 'local-service-only-test-key-longer-than-thirty-two';
const payload = { type: 'INSERT', record: { id: objectId, bucket_id: 'story-media', name: `${owner}/capture.mp4`, version: 'original-version' } };
function box(type, data = Buffer.alloc(0)) {
  const result = Buffer.alloc(8 + data.length); result.writeUInt32BE(result.length); result.write(type, 4); data.copy(result, 8); return result;
}
const ftyp = box('ftyp', Buffer.from('isom0000')), mdat = box('mdat', Buffer.from('original media bytes'));
const offsets = Buffer.alloc(12); offsets.writeUInt32BE(1, 4); offsets.writeUInt32BE(ftyp.length + 8, 8);
const moov = box('moov', box('trak', box('mdia', box('minf', box('stbl', box('stco', offsets))))));
const video = Buffer.concat([ftyp, mdat, moov]);
function setup(options = {}) {
  const calls = [], writes = [], downloads = []; let currentBytes = Buffer.from(video);
  const db = { async rpc(name, args) {
    calls.push([name, args]);
    if (name === 'claim_faststart_video_remux') return { data: options.unbound ? null : {
      lease_id: lease, object_id: objectId, object_version: 'original-version', etag: 'source-etag', metadata: { caption: 'preserved' },
      ...options.proof,
    }, error: options.claimError ? {} : null };
    if (name === 'check_faststart_video_remux') return { data: options.changed !== true, error: options.checkError ? {} : null };
    return { data: null, error: null };
  } };
  const handler = createFaststartHandler({
    serviceKey, db, remux: faststartRemux,
    async download(...args) {
      downloads.push(args);
      if (options.downloadError) throw new Error('network');
      return { blob: options.huge ? { size: 200 * 1024 * 1024 + 1 } : new Blob([options.fast ? faststartRemux(video).buf : video], { type: 'video/mp4' }), etag: options.etag ?? '"source-etag"' };
    },
    async update(...args) {
      writes.push(args);
      if (options.writeError) return { error: { message: 'FASTSTART_OBJECT_CHANGED' } };
      currentBytes = Buffer.from(args[2]); return { error: null };
    },
  });
  const run = (body = payload, key = serviceKey, method = 'POST') => handler(new Request('https://function.test', {
    method, headers: { Authorization: `Bearer ${key}` }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  }));
  return { run, calls, writes, downloads, bytes: () => currentBytes };
}
test('ordinary JWTs and wrong methods never reach privileged preflight or storage', async () => {
  const h = setup(); assert.equal((await h.run(payload, 'ordinary-user-jwt')).status, 401);
  assert.equal((await h.run(payload, serviceKey, 'GET')).status, 405);
  assert.equal(h.calls.length, 0); assert.equal(h.downloads.length, 0);
});
test('an unbound object or unavailable preflight stays untouched and is not even downloaded', async () => {
  for (const options of [{ unbound: true }, { claimError: true }]) {
    const h = setup(options); assert.match(await (await h.run()).text(), /no registered provenance/);
    assert.equal(h.downloads.length, 0); assert.equal(h.writes.length, 0); assert.deepEqual(h.bytes(), video);
  }
});
test('private buckets, missing versions, image files and invalid locators cannot reach processing', async () => {
  for (const change of [{ bucket_id: 'chat-media' }, { version: undefined }, { id: 'invalid' }, { name: `${owner}/photo.jpg` }, { name: `${owner}/../capture.mp4` }]) {
    const h = setup(); await h.run({ ...payload, record: { ...payload.record, ...change } }); assert.equal(h.calls.length, 0);
  }
});
test('the authorized same-version path remuxes real bytes and supplies only the guarded capability metadata', async () => {
  const h = setup(); assert.equal(await (await h.run()).text(), 'remuxed');
  assert.equal(h.writes.length, 1); assert.equal(h.downloads[0][2], 'original-version');
  assert.equal(h.downloads[0][3], lease);
  const [bucket, name, bytes, mime, metadata] = h.writes[0];
  assert.equal(bucket, 'story-media'); assert.equal(name, payload.record.name); assert.equal(mime, 'video/mp4');
  assert.deepEqual(JSON.parse(JSON.stringify(metadata)), { caption: 'preserved', platinum_faststart_lease: lease });
  const output = Buffer.from(bytes); assert.equal(output.length, video.length);
  assert.equal(output.toString('ascii', ftyp.length + 4, ftyp.length + 8), 'moov');
  assert.deepEqual(output.subarray(ftyp.length + moov.length), mdat);
  assert.equal(h.calls.at(-1)[0], 'release_faststart_video_remux');
});
test('a stale downloaded ETag cannot overwrite the current generation', async () => {
  const h = setup({ etag: 'old-cache-etag' }); assert.match(await (await h.run()).text(), /downloaded version changed/);
  assert.equal(h.writes.length, 0); assert.deepEqual(h.bytes(), video);
  assert.equal(h.calls.at(-1)[0], 'release_faststart_video_remux');
});
test('binding or version changes after download skip the write and release the lease', async () => {
  for (const options of [{ changed: true }, { checkError: true }]) {
    const h = setup(options); assert.match(await (await h.run()).text(), /object access changed/);
    assert.equal(h.writes.length, 0); assert.equal(h.calls.at(-1)[0], 'release_faststart_video_remux');
  }
});
test('a final SQL race rejection has no fallback upsert, delete or unguarded retry', async () => {
  const h = setup({ writeError: true }); assert.equal(await (await h.run()).text(), 'rewrite not confirmed');
  assert.equal(h.writes.length, 1); assert.deepEqual(h.bytes(), video);
  assert.equal(h.calls.at(-1)[0], 'release_faststart_video_remux');
});
test('download failures, already-faststart files and oversized files release their capability without rewriting', async () => {
  for (const options of [{ downloadError: true }, { fast: true }, { huge: true }]) {
    const h = setup(options); await h.run(); assert.equal(h.writes.length, 0);
    assert.equal(h.calls.at(-1)[0], 'release_faststart_video_remux');
  }
});
test('a malformed or mismatched server proof never authorizes a download', async () => {
  for (const proof of [{ object_id: owner }, { object_version: 'other' }, { etag: '' }, { metadata: null }]) {
    const h = setup({ proof }); await h.run(); assert.equal(h.downloads.length, 0); assert.equal(h.writes.length, 0);
  }
});
test('the actual entry uses an authenticated uncached download and a non-upserting Storage update', async () => {
  let captured; const requests = [], updates = [];
  const client = { storage: { from: bucket => ({ update: async (...args) => { updates.push({ bucket, args }); return { error: null }; } }) } };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'index.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports: {}, URL, AbortSignal,
    require: name => name.includes('supabase-js') ? { createClient: () => client }
      : name.includes('handler') ? { createFaststartHandler: deps => { captured = deps; return () => {}; } } : { faststartRemux },
    Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://project.test' : serviceKey }, serve: () => {} },
    fetch: async (...args) => { requests.push(args); return new Response(video, { headers: { ETag: '"source-etag"' } }); },
  });
  const downloaded = await captured.download('story-media', `${owner}/with space.mp4`, 'version-1', lease);
  assert.equal(downloaded.etag, '"source-etag"');
  assert.equal(requests[0][0].origin, 'https://project.test');
  assert.match(requests[0][0].pathname, /\/storage\/v1\/object\/authenticated\/story-media\/.*with%20space.mp4$/);
  assert.equal(requests[0][0].searchParams.get('faststart_version'), 'version-1');
  assert.equal(requests[0][1].cache, 'no-store');
  await captured.update('story-media', payload.record.name, video, 'video/mp4', { platinum_faststart_lease: lease });
  assert.equal(updates[0].args[2].upsert, false); assert.equal(updates[0].args[2].metadata.platinum_faststart_lease, lease);
});
