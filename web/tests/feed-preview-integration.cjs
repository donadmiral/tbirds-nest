const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function setup(write = async () => {}, media = []) {
  let revision = 1, previewWrites = 0, previewClears = 0;
  const base = { revision: () => revision, setAccount() {}, write, read: async () => ({ rows: [{ post_id: 'post', media }] }), clear: async () => { revision++; } };
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

test('matching dimension placeholders receive pixels without changing dimensions, order or crop', async () => {
  const first = { id: 'media', url: '', media_type: 'image', width: 1080, height: 1920, sort_order: 0, edit: { aspectRatio: 0.8 }, _startupPlaceholder: true, _startupPreview: true, _startupMediaType: 'video' };
  const other = { ...first, id: 'another', sort_order: 1 };
  const h = setup(undefined, [first, other]), result = await h.store.read('alice', 'forYou');
  const [filled, untouched] = result.rows[0].media;
  assert.match(filled.url, /^data:image\/jpeg/); assert.equal(filled.width, 1080); assert.equal(filled.height, 1920);
  assert.equal(filled.edit, first.edit); assert.equal(filled._startupMediaType, 'video'); assert.equal(filled._startupPlaceholder, false);
  assert.equal(untouched, other);
});

test('cached previews never replace a different or already authorized media object', async () => {
  for (const media of [{ id: 'different', url: '', _startupPlaceholder: true }, { id: 'media', url: 'https://current.example/authorized', _startupPlaceholder: false }]) {
    const h = setup(undefined, [media]), result = await h.store.read('alice', 'forYou');
    assert.equal(result.rows[0].media[0], media);
  }
});
