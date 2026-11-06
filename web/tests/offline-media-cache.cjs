const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const { Blob } = require('node:buffer');
function load(file, imports = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => imports[name], URL, TextEncoder, TextDecoder, Uint8Array, Blob, AbortController, Map, Set, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' } }, setTimeout, clearTimeout });
  return module.exports;
}
const delivery = load('../shared/mediaDelivery.ts');
const preview = load('lib/feedPreviewCache.ts', { '../../shared/mediaDelivery': delivery });
const { createOfflineMediaCache, OFFLINE_MEDIA_TTL, OFFLINE_MEDIA_BUDGET, OFFLINE_MEDIA_ITEM_LIMIT } = load('lib/offlineMediaCache.ts', { './feedPreviewCache': preview });
const base = 'https://project.supabase.co';
const cap = name => `${base}/functions/v1/media-content/post-media/${name}?token=${'a'.repeat(64)}`;
const row = (id, kind = 'image') => ({ post_id: id, _mediaVersions: { [`post-media/${id}.${kind === 'image' ? 'jpg' : 'mp4'}`]: 'v1' }, media: [{ id: `media-${id}`, url: cap(`${id}.${kind === 'image' ? 'jpg' : 'mp4'}`), media_type: kind, width: 4096, height: 2160 }] });
const bytes = new Uint8Array(200_000).map((_, index) => index % 251);
function setup(download = async (_url, kind) => new Blob([bytes], { type: kind === 'image' ? 'image/jpeg' : 'video/mp4' })) {
  let now = Date.now(), session = null, captures = 0, reads = 0;
  const records = new Map();
  const storage = {
    session: async () => session, indexes: async () => [...records.values()].map(({ encrypted, iv, ...index }) => index),
    start: async value => { records.clear(); session = value; }, clear: async () => { records.clear(); session = null; },
    read: async id => { reads++; return records.get(id) ?? null; }, write: async value => { records.set(value.id, structuredClone(value)); }, remove: async ids => { for (const id of ids) records.delete(id); },
  };
  const factory = () => createOfflineMediaCache({ storage, crypto: webcrypto, base, now: () => now, download: (...args) => { captures++; return download(...args); } });
  return { cache: factory(), factory, storage, records, get session() { return session; }, get captures() { return captures; }, get reads() { return reads; }, time(value) { now = value; } };
}

test('original image and video bytes survive restart exactly, without plaintext or signed URLs on disk', async () => {
  const h = setup(); await h.cache.setSession('alice', 'alice:a');
  await h.cache.write('alice', [row('image'), row('video', 'video')], new Set(['image', 'video']));
  assert.equal(h.records.size, 2); assert.equal(h.session.key.extractable, false);
  for (const record of h.records.values()) {
    assert.equal(record.encrypted.byteLength, bytes.length + 16);
    assert.ok(!JSON.stringify(record).includes('?token='));
    assert.notDeepEqual(new Uint8Array(record.encrypted).slice(0, 100), bytes.slice(0, 100));
  }
  const restored = h.factory(); await restored.setSession('alice', 'alice:a');
  assert.equal(h.reads, 0, 'startup reads only metadata, not original blobs');
  for (const id of ['image', 'video']) {
    const asset = await restored.read(id, `media-${id}`);
    assert.equal(asset.width, 4096); assert.deepEqual(new Uint8Array(await asset.blob.arrayBuffer()), bytes);
    assert.equal(asset.mediaType, id); // image, video retain their real playback type
  }
});

test('new sessions, other accounts, logout and expiry cannot read old originals', async () => {
  for (const replacement of [['alice', 'alice:b'], ['bob', 'bob:a'], [null, null]]) {
    const h = setup(); await h.cache.setSession('alice', 'alice:a'); await h.cache.write('alice', [row('one')], new Set(['one']));
    const next = h.factory(); await next.setSession(...replacement);
    assert.equal(await next.read('one', 'media-one'), null); assert.equal(h.records.size, 0);
  }
  const h = setup(); await h.cache.setSession('alice', 'alice:a'); await h.cache.write('alice', [row('one')], new Set(['one']));
  h.time(Date.now() + OFFLINE_MEDIA_TTL + 1000);
  assert.equal(await h.cache.read('one', 'media-one'), null);
  const next = h.factory(); await next.setSession('alice', 'alice:a'); assert.equal(h.records.size, 0);
});

test('private, ephemeral, restricted, sensitive and unbound media are never downloaded', async () => {
  const h = setup(); await h.cache.setSession('alice', 'alice:a');
  const rows = [row('private'), ...['view_once','is_ephemeral','is_sensitive','is_paywalled','deleted_at','expires_at'].map(key => ({ ...row(key), [key]: true })), row('foreign'), row('chat')];
  rows.at(-2).media[0].url = 'https://evil.example/picture.jpg'; rows.at(-1).media[0].url = cap('secret.jpg').replace('post-media', 'chat-media');
  await h.cache.write('alice', rows, new Set(rows.slice(1).map(item => item.post_id)));
  assert.equal(h.captures, 0); assert.equal(h.records.size, 0);
});

test('fresh denial and failed replacement remove old pixels, while purge permits future caching', async () => {
  let fail = false; const h = setup(async () => fail ? null : new Blob([bytes], { type: 'image/jpeg' }));
  await h.cache.setSession('alice', 'alice:a'); await h.cache.write('alice', [row('one')], new Set(['one']));
  await h.cache.write('alice', [row('one')], new Set()); assert.equal(await h.cache.read('one', 'media-one'), null);
  await h.cache.clear(); await h.cache.write('alice', [row('one')], new Set(['one'])); assert.equal(h.records.size, 1);
  fail = true; const replacement = row('one'); replacement.media[0].url = cap('replacement.jpg');
  await h.cache.write('alice', [replacement], new Set(['one']));
  const next = h.factory(); await next.setSession('alice', 'alice:a'); assert.equal(await next.read('one', 'media-one'), null);
});

test('simultaneous reads deduplicate and unrelated writes preserve the first asset version', async () => {
  const h = setup(); await h.cache.setSession('alice', 'alice:a'); await h.cache.write('alice', [row('one')], new Set(['one']));
  const version = h.cache.version('one', 'media-one');
  const [first, second] = await Promise.all([h.cache.read('one', 'media-one'), h.cache.read('one', 'media-one')]);
  assert.equal(h.reads, 1); assert.equal(first, second);
  await h.cache.write('alice', [row('two')], new Set(['two'])); assert.equal(h.cache.version('one', 'media-one'), version);
  await h.cache.write('alice', [row('one')], new Set(['one'])); assert.equal(h.captures, 2, 'cached originals are not downloaded repeatedly');
});

test('tampering with expiry or object binding fails authenticated decryption', async () => {
  for (const change of [value => { value.width++; }, value => { value.object = 'post-media/other.jpg'; }]) {
    const h = setup(); await h.cache.setSession('alice', 'alice:a'); await h.cache.write('alice', [row('one')], new Set(['one']));
    const record = [...h.records.values()][0]; change(record);
    const next = h.factory(); await next.setSession('alice', 'alice:a'); assert.equal(await next.read('one', 'media-one'), null);
  }
});

test('logout during a download prevents a late write and aborts its signal', async () => {
  let release, signal; const h = setup((_url, _kind, parent) => { signal = parent; return new Promise(resolve => { release = resolve; }); });
  await h.cache.setSession('alice', 'alice:a'); const writing = h.cache.write('alice', [row('one')], new Set(['one']));
  await new Promise(setImmediate); await h.cache.setSession(null, null); assert.equal(signal.aborted, true);
  release(new Blob([bytes], { type: 'image/jpeg' })); await writing; assert.equal(h.records.size, 0);
});

test('download count, item size, total bytes and entry count are bounded', async () => {
  const h = setup(async () => new Blob([new Uint8Array(OFFLINE_MEDIA_ITEM_LIMIT)], { type: 'image/jpeg' }));
  await h.cache.setSession('alice', 'alice:a'); const rows = Array.from({ length: 8 }, (_, i) => row(String(i)));
  await h.cache.write('alice', rows, new Set(rows.map(item => item.post_id)));
  assert.equal(h.captures, 6); assert.ok([...h.records.values()].reduce((sum, item) => sum + item.bytes, 0) <= OFFLINE_MEDIA_BUDGET);
  assert.equal(h.records.size, 4);
  const tooLarge = setup(async () => new Blob([new Uint8Array(OFFLINE_MEDIA_ITEM_LIMIT + 1)], { type: 'image/jpeg' }));
  await tooLarge.cache.setSession('alice', 'alice:a'); await tooLarge.cache.write('alice', [row('one')], new Set(['one'])); assert.equal(tooLarge.records.size, 0);
});

test('quota failure does not reject refresh or leave a usable partial original', async () => {
  const h = setup(); h.storage.write = async () => { throw Error('QuotaExceededError'); };
  await h.cache.setSession('alice', 'alice:a'); await assert.doesNotReject(h.cache.write('alice', [row('one')], new Set(['one'])));
  assert.equal(await h.cache.read('one', 'media-one'), null);
});


test('a same-path source version replacement never restores the obsolete original', async () => {
  const h = setup(); await h.cache.setSession('alice', 'alice:a'); await h.cache.write('alice', [row('one')], new Set(['one']));
  assert.equal(await h.cache.read('one','media-one','post-media/one.jpg','v2'), null);
  const fresh = row('one'); fresh._mediaVersions['post-media/one.jpg'] = 'v2';
  await h.cache.write('alice',[fresh],new Set(['one']));
  assert.equal(h.captures,2); assert.equal((await h.cache.read('one','media-one')).sourceVersion,'v2');
  assert.equal(h.records.size,1);
});

test('clear during session bootstrap restarts the same identity and still permits future writes', async () => {
  const h = setup(); let release, entered; const reading = new Promise(resolve => { entered = resolve; });
  h.storage.session = () => new Promise(resolve => { release = resolve; entered(); });
  const first = h.cache.setSession('alice','alice:a'); await reading;
  h.storage.session = async () => null; await h.cache.clear(); release(null); await first;
  await h.cache.write('alice',[row('one')],new Set(['one'])); assert.equal(h.records.size,1);
});
