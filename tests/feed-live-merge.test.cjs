const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared/feedLiveMerge.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports });
const { mergeNativeFeedLive, feedSnapshotFresh } = moduleUnderTest.exports;
const row = (id, n = 1) => ({ id, content: 'Content ' + id, likes_count: n, comments_count: n,
  reposts_count: n, bookmarks_count: n, shares_count: n, views_count: n, media: [{ url: 'current.jpg' }] });
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('a deferred native hydration cannot revive a revoked row or replace newer canonical counts/content', async () => {
  const hydration = defer(), fence = { denied: {}, applied: {}, mutated: {}, pending: () => false };
  let current = [row('revoked'), row('updated')];
  const refresh = (async () => mergeNativeFeedLive(await hydration.promise, current, 100, fence))();
  fence.denied.revoked = 150; fence.applied.updated = 151; current = [{ ...row('updated', 8), content: 'Canonical edit' }];
  const oldUpdated = { ...row('updated'), media: [{ url: 'renewed.jpg' }] }; hydration.resolve([row('revoked'), oldUpdated]);
  const result = await refresh;
  assert.deepEqual(Array.from(result, post => post.id), ['updated']); assert.equal(result[0].likes_count, 8);
  assert.equal(result[0].comments_count, 8); assert.equal(result[0].content, 'Canonical edit');
  assert.equal(result[0].media, oldUpdated.media, 'New media grants are retained without resetting current social state');
});

test('native actor flags, counts and enrichment reject pre-mutation snapshots but accept a later authorized read', () => {
  let pending = true;
  const fence = { denied: {}, applied: {}, mutated: { post: 110 }, pending: () => pending };
  const current = row('post', 4), incoming = row('post');
  assert.equal(feedSnapshotFresh('post', 120, fence), false);
  assert.equal(mergeNativeFeedLive([incoming], [current], 120, fence)[0].likes_count, 4);
  pending = false; fence.mutated.post = 130;
  assert.equal(feedSnapshotFresh('post', 120, fence), false);
  assert.equal(mergeNativeFeedLive([incoming], [current], 120, fence)[0].likes_count, 4);
  assert.equal(feedSnapshotFresh('post', 140, fence), true);
  assert.equal(mergeNativeFeedLive([incoming], [current], 140, fence)[0], incoming);
});

test('temporary native denial fences old reads without permanently hiding later reauthorization', () => {
  const fence = { denied: { post: 200 }, applied: {}, mutated: {}, pending: () => false };
  assert.equal(mergeNativeFeedLive([row('post')], [], 150, fence).length, 0);
  assert.equal(mergeNativeFeedLive([row('post')], [], 250, fence).length, 1);
});
