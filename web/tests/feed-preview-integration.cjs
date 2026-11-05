const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function setup(write = async () => {}) {
  let revision = 1, previewWrites = 0, previewClears = 0;
  const base = { revision: () => revision, setAccount() {}, write, read: async () => ({ rows: [{ post_id: 'post', media: [] }] }), clear: async () => { revision++; } };
  const previews = { write: async () => { previewWrites++; }, clear: async () => { previewClears++; } };
  const imports = { '../../shared/feedSnapshot': { createFeedSnapshotStore: () => base }, './supabase/client': { createClient: () => ({ auth: { onAuthStateChange() {} } }) },
    './feedPreviews': { getFeedPreviewStore: () => previews, loadFeedPreviews: async () => [{ postId: 'post', mediaId: 'media', object: 'post-media/photo', uri: 'data:image/jpeg;base64,AA==', width: 1200, height: 900 }] } };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/feedCache.ts'), 'utf8'), { fileName: 'feedCache.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => imports[name], window: {}, Promise });
  return { store: module.exports.getFeedCache(), invalidate() { revision++; }, get previewWrites() { return previewWrites; }, get previewClears() { return previewClears; } };
}

test('an older public eligibility write cannot repopulate previews after the feed was invalidated', async () => {
  let release; const h = setup(() => new Promise(resolve => { release = resolve; }));
  const work = h.store.write('alice', 'forYou', [], new Set(), 1);
  h.invalidate(); release(); await work; assert.equal(h.previewWrites, 0);
});

test('valid writes forward eligible rows and clear invalidates both public text and encrypted pixels', async () => {
  const h = setup(); await h.store.write('alice', 'forYou', [], new Set(), 1); assert.equal(h.previewWrites, 1);
  await h.store.clear('alice'); assert.equal(h.previewClears, 1);
});

test('offline text snapshots receive a preview-only image with the original dimensions and object identity', async () => {
  const h = setup(); const result = await h.store.read('alice', 'forYou'), media = result.rows[0].media[0];
  assert.equal(media._startupPreview, true); assert.equal(media._previewObject, 'post-media/photo');
  assert.equal(media.width, 1200); assert.equal(media.height, 900); assert.equal(media.media_type, 'image');
});

test('an invalidated snapshot cannot return after asynchronous preview restoration', async () => {
  const h = setup(), work = h.store.read('alice', 'forYou'); h.invalidate();
  assert.equal(await work, null);
});
