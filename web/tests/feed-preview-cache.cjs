const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
function load(file, imports = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => imports[name], URL, TextEncoder, TextDecoder, Uint8Array, AbortController, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' } }, setTimeout: (...args) => { const timer = setTimeout(...args); timer.unref(); return timer; }, clearTimeout });
  return module.exports;
}
const media = load('../shared/mediaDelivery.ts');
const { createFeedPreviewCache, PREVIEW_TTL, PREVIEW_BUDGET, previewObject } = load('lib/feedPreviewCache.ts', { '../../shared/mediaDelivery': media });
const base = 'https://project.supabase.co';
const uri = 'data:image/jpeg;base64,/9j/AAAA';
const cap = name => `${base}/functions/v1/media-content/post-media/${name}.jpg?token=${'a'.repeat(64)}`;
const row = id => ({ post_id: id, media: [{ id: 'media-' + id, url: cap(id), media_type: 'image', width: 1200, height: 900 }] });
function setup({ raster = async () => ({ uri, width: 160, height: 120 }) } = {}) {
  let now = 100, record = null, captures = 0;
  const storage = { read: async () => record, write: async value => { record = structuredClone(value); }, clear: async () => { record = null; } };
  const factory = () => createFeedPreviewCache({ storage, crypto: webcrypto, base, now: () => now, raster: (...args) => { captures++; return raster(...args); } });
  return { cache: factory(), factory, storage, get record() { return record; }, get captures() { return captures; }, time(value) { now = value; } };
}

test('a browser restart restores only ciphertext using a non-extractable key and the same session identity', async () => {
  const h = setup(); await h.cache.setSession('alice', 'alice:session-a');
  await h.cache.write('alice', [row('post')], new Set(['post']));
  assert.equal(h.record.key.extractable, false);
  await assert.rejects(webcrypto.subtle.exportKey('raw', h.record.key));
  assert.ok(!JSON.stringify(h.record).includes(uri));
  assert.ok(!new TextDecoder().decode(h.record.encrypted).includes('post'));
  const restored = h.factory(); await restored.setSession('alice', 'alice:session-a');
  assert.equal(restored.getSnapshot().previews[0].uri, uri);
  assert.equal(restored.getSnapshot().previews[0].width, 1200);
  assert.equal(restored.getSnapshot().previews[0].object, 'post-media/post.jpg');
  assert.ok(!JSON.stringify(restored.getSnapshot()).includes('?token='));
  await restored.clear(); await h.cache.clear();
});

test('another session, logout and an expired record purge previews instead of restoring old pixels', async () => {
  const h = setup(); await h.cache.setSession('alice', 'alice:one'); await h.cache.write('alice', [row('post')], new Set(['post']));
  const replacement = h.factory(); await replacement.setSession('alice', 'alice:two');
  assert.equal(replacement.getSnapshot().previews.length, 0); assert.equal(h.record, null);
  await h.cache.write('alice', [row('post')], new Set(['post'])); h.time(100 + PREVIEW_TTL + 1);
  const expired = h.factory(); await expired.setSession('alice', 'alice:one');
  assert.equal(expired.getSnapshot().previews.length, 0); assert.equal(h.record, null);
  await h.cache.setSession(null, null); assert.equal(h.cache.getSnapshot().previews.length, 0); assert.equal(h.record, null);
});

test('only eligible nonsensitive images and explicit video covers are rasterized, at most three previews', async () => {
  const h = setup(); await h.cache.setSession('alice', 'alice:one');
  const privateRow = row('private'), sensitive = row('sensitive'), once = row('once'), video = row('video');
  sensitive.media[0].is_sensitive = true; once.media[0].view_once = true; video.media[0].media_type = 'video';
  const rows = [privateRow, sensitive, once, video, row('1'), row('2'), row('3'), row('4')];
  await h.cache.write('alice', rows, new Set(rows.filter(value => value !== privateRow).map(value => value.post_id)));
  assert.equal(h.captures, 3); assert.equal(h.cache.getSnapshot().previews.length, 3);
  assert.ok(h.cache.getSnapshot().previews.every(value => ['1','2','3'].includes(value.postId)));
  await h.cache.clear();
  video.media[0].edit = { coverUrl: cap('cover') }; await h.cache.write('alice', [video], new Set(['video']));
  assert.equal(h.cache.getSnapshot().previews[0].mediaType, 'video'); await h.cache.clear();
});

test('the pixel payload budget excludes oversized previews and capture failures do not break content', async () => {
  const h = setup({ raster: async source => { if (source.includes('fail')) throw Error('CORS'); return { uri: 'data:image/jpeg;base64,' + 'A'.repeat(PREVIEW_BUDGET), width: 1, height: 1 }; } });
  await h.cache.setSession('alice', 'alice:one');
  await h.cache.write('alice', [row('large'), row('fail')], new Set(['large', 'fail']));
  assert.equal(h.cache.getSnapshot().previews.length, 0); assert.equal(h.record, null); await h.cache.clear();
});

test('a logout during raster work aborts the capture and prevents late durable writes', async () => {
  let resolve, signal; const h = setup({ raster: (_url, value) => { signal = value; return new Promise(done => { resolve = done; }); } });
  await h.cache.setSession('alice', 'alice:one'); const work = h.cache.write('alice', [row('post')], new Set(['post']));
  await new Promise(setImmediate); await h.cache.setSession(null, null); assert.equal(signal.aborted, true);
  resolve({ uri, width: 1, height: 1 }); await work;
  assert.equal(h.record, null); assert.equal(h.cache.getSnapshot().previews.length, 0);
});

test('public preview identity ignores a valid capability rotation but rejects other origins and private buckets', () => {
  assert.equal(previewObject(cap('one'), base), previewObject(cap('one').replace('a'.repeat(64), 'b'.repeat(64)), base));
  assert.equal(previewObject(cap('one').replace(base, 'https://other.example'), base), null);
  assert.equal(previewObject(cap('one').replace('post-media', 'chat-media'), base), null);
  assert.equal(previewObject(cap('one').replace('a'.repeat(64), 'invalid'), base), null);
});

test('fresh ineligibility removes formerly public pixels from memory and disk', async () => {
  const h = setup(); await h.cache.setSession('alice', 'alice:one');
  await h.cache.write('alice', [row('post')], new Set(['post']));
  await h.cache.write('alice', [row('post')], new Set());
  assert.equal(h.cache.getSnapshot().previews.length, 0); assert.equal(h.record, null);
});

test('capture attempts stay bounded during failures and snapshots hide expired pixels even before a throttled timer fires', async () => {
  const h = setup({ raster: async () => null }); await h.cache.setSession('alice', 'alice:one');
  const rows = Array.from({ length: 20 }, (_, i) => row(String(i)));
  await h.cache.write('alice', rows, new Set(rows.map(value => value.post_id))); assert.equal(h.captures, 3);
  const other = setup(); await other.cache.setSession('alice', 'alice:one'); await other.cache.write('alice', [row('post')], new Set(['post']));
  other.time(100 + PREVIEW_TTL); assert.equal(other.cache.getSnapshot().previews.length, 0); await other.cache.clear();
});

test('the real preview hook checks current account, post, media object, sensitivity and expiry', async () => {
  const h = setup(); await h.cache.setSession('alice', 'alice:one'); await h.cache.write('alice', [row('post')], new Set(['post']));
  let owner = 'alice';
  const { useFeedPreview } = load('lib/useFeedPreview.ts', {
    react: { useSyncExternalStore: (_subscribe, read) => read() },
    './feedPreviews': { getFeedPreviewStore: () => h.cache },
    './feedPreviewCache': { previewObject },
    './navigationCache': { getNavigationStore: () => ({ getSnapshot: () => ({ owner }) }) },
  });
  const media = row('post').media[0];
  assert.equal(useFeedPreview('post', media).uri, uri);
  assert.equal(useFeedPreview('different', media), null);
  assert.equal(useFeedPreview('post', { ...media, url: cap('different-object') }), null);
  assert.equal(useFeedPreview('post', { ...media, is_sensitive: true }), null);
  owner = 'bob'; assert.equal(useFeedPreview('post', media), null);
  owner = 'alice'; h.time(100 + PREVIEW_TTL); assert.equal(useFeedPreview('post', media), null); await h.cache.clear();
});
