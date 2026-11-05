const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
function harness(kind = 'image') {
  let slots = [], cursor = 0, effects = [], revision = 1, owner = 'alice', version = 'one', created = 0, reads = 0;
  const revoked = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((value, j) => value !== slots[i].deps[j])) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
    useSyncExternalStore(_subscribe, read) { return read(); },
  };
  const asset = { postId: 'post', mediaId: 'media', object: 'post-media/file', sourceVersion: 'v1', mediaType: kind, expiresAt: Date.now() + 60000, blob: new Blob(['original']) };
  const store = { getSnapshot: () => ({ owner, revision }), subscribe() {}, version: (_post, _id, _object, expected) => expected === 'v1' ? version : null, read: async () => { reads++; return version ? asset : null; } };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/useOfflineMedia.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, process: { env: {} }, Date, URL: { createObjectURL: () => `blob:original-${++created}`, revokeObjectURL: url => revoked.push(url) },
    navigator: { onLine: true }, window: { addEventListener() {}, removeEventListener() {} },
    setTimeout: (...args) => { const timer = setTimeout(...args); timer.unref(); return timer; }, clearTimeout,
    require: name => ({ react: hooks, './offlineMedia': { getOfflineMediaStore: () => store }, './navigationCache': { getNavigationStore: () => ({ getSnapshot: () => ({ owner }) }) }, './feedPreviewCache': { previewObject: url => url === 'authorized' ? 'post-media/file' : null } })[name],
  });
  let media = { id: 'media', url: '', media_type: 'image', _startupPreview: true, _sourceVersion: 'v1' };
  return { revoked, get reads() { return reads; }, get created() { return created; },
    render() { cursor = 0; const value = module.exports.useOfflineMedia('post', media); const pending = effects; effects = []; pending.forEach(fn => fn()); return value; },
    update() { revision++; }, deny() { revision++; version = null; }, owner(value) { owner = value; revision++; }, source(value) { media = value; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('unrelated background downloads never revoke or replace a displayed original URL', async () => {
  const h = harness(); h.render(); await new Promise(setImmediate);
  const original = h.render(); assert.equal(original.url, 'blob:original-1'); assert.equal(original._startupPreview, false);
  for (let i = 0; i < 6; i++) { h.update(); assert.equal(h.render().url, original.url); await new Promise(setImmediate); }
  assert.equal(h.reads, 1); assert.equal(h.created, 1); assert.deepEqual(h.revoked, []);
  h.deny(); assert.equal(h.render().url, ''); assert.deepEqual(h.revoked, ['blob:original-1']); h.unmount();
});

test('a restored video keeps the same player source when fresh matching metadata arrives', async () => {
  const h = harness('video'); h.render(); await new Promise(setImmediate);
  const original = h.render(); assert.equal(original.media_type, 'video');
  h.source({ id: 'media', url: 'authorized', media_type: 'video', _sourceVersion: 'v1' });
  assert.equal(h.render().url, original.url); await new Promise(setImmediate);
  assert.equal(h.render().url, original.url); assert.equal(h.reads, 1); assert.deepEqual(h.revoked, []); h.unmount();
});

test('account change prevents old pixels synchronously before asynchronous effect cleanup', async () => {
  const h = harness(); h.render(); await new Promise(setImmediate); assert.match(h.render().url, /^blob:/);
  h.owner('bob'); assert.equal(h.render().url, ''); assert.ok(h.revoked.includes('blob:original-1')); h.unmount();
});


test('startup metadata with a newer or missing source version never restores stale original bytes', async () => {
  const h = harness();
  h.source({id:'media',url:'',media_type:'image',_startupPreview:true,_sourceVersion:'v2'});
  assert.equal(h.render().url,''); await new Promise(setImmediate); assert.equal(h.render().url,''); assert.equal(h.reads,0);
  h.source({id:'media',url:'',media_type:'image',_startupPreview:true});
  assert.equal(h.render().url,''); await new Promise(setImmediate); assert.equal(h.render().url,''); assert.equal(h.reads,0); h.unmount();
});
