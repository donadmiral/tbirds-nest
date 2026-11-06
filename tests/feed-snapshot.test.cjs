const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const moduleScope = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared/feedSnapshot.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: moduleScope, exports: moduleScope.exports });
const { createFeedSnapshotStore, publicSnapshotRows, mergeFeedRefresh, feedPrefetchUrls, FEED_SNAPSHOT_MAX_AGE } = moduleScope.exports;
const url = id => `https://example.supabase.co/storage/v1/object/public/posts/${id}.jpg`;
const row = id => ({ post_id: id, author_id: 'author', content: 'Public post', created_at: '2026-10-22T12:00:00Z', media: [{ id, url: url(id), media_type: 'image' }] });
const plain = value => JSON.parse(JSON.stringify(value));
const memory = () => {
  const values = new Map();
  return { values, getItem: async key => values.get(key) ?? null, setItem: async (key, value) => values.set(key, value), removeItem: async key => values.delete(key) };
};

test('snapshot whitelist strips private fields, signed media, and ineligible rows', () => {
  const input = { ...row('public'), email: 'private@example.test', products: [{ private: true }], link: { secret: true },
    author_avatar: 'https://example.test/avatar?token=secret', viewer_liked: true,
    media: [...row('public').media, { url: url('private') + '?token=secret', media_type: 'image' }] };
  const saved = publicSnapshotRows([input, row('followers-only')], new Set(['public']));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].email, undefined);
  assert.equal(saved[0].link, undefined);
  assert.equal(saved[0].author_avatar, null);
  assert.equal(saved[0].media.length, 1);
  assert.equal(saved[0].viewer_liked, true);
  assert.deepEqual(plain(saved[0].products), []);
});

test('snapshot is bounded and duplicates do not consume extra slots', () => {
  const rows = Array.from({ length: 35 }, (_, index) => row(String(index)));
  const saved = publicSnapshotRows([rows[0], ...rows], new Set(rows.map(r => r.post_id)));
  assert.equal(saved.length, 20);
  assert.equal(new Set(saved.map(r => r.post_id)).size, 20);
});

test('eligible signed media keeps only reserved geometry and identity across disk reads', async () => {
  const source = { ...row('reserved'), media: [{ id: 'm1', url: 'https://example.supabase.co/storage/v1/object/sign/post-media/private.jpg?token=secret',
    media_type: 'video', width: 1080, height: 1920, sort_order: 0,
    edit: { aspect: 'original', aspectRatio: .5625, coverUrl: 'https://private.invalid/cover?token=secret', captions: [{ text: 'private' }] } }] };
  const storage = memory(), store = createFeedSnapshotStore(storage);
  store.setAccount('a'); await store.write('a', 'forYou', [source], new Set(['reserved']));
  const raw = [...storage.values.values()][0];
  assert.ok(!raw.includes('secret')); assert.ok(!raw.includes('private')); assert.ok(!raw.includes('post-media'));
  const media = (await store.read('a', 'forYou')).rows[0].media[0];
  assert.deepEqual(plain(media), { id: 'm1', url: '', media_type: 'image', width: 1080, height: 1920,
    sort_order: 0, edit: { aspect: 'original', aspectRatio: .5625 }, _startupPlaceholder: true, _startupPreview: true, _startupMediaType: 'video' });
});

test('legacy media rotation survives the snapshot without an explicit aspect and rejects non-finite values', async () => {
  for (const mediaUrl of [url('legacy'), 'https://example.supabase.co/storage/v1/object/sign/post-media/legacy.jpg?token=secret']) {
    for (const rotation of [0, 45, 90, 270, -90]) {
      const source = { ...row('legacy'), media: [{ id: 'm1', url: mediaUrl, media_type: 'image',
        width: 1920, height: 1080, edit: { rotation } }] };
      const store = createFeedSnapshotStore(memory()); store.setAccount('a');
      await store.write('a', 'forYou', [source], new Set(['legacy']));
      const media = (await store.read('a', 'forYou')).rows[0].media[0];
      assert.equal(media.edit.rotation, rotation);
      assert.equal(media.edit.aspect, undefined); assert.equal(media.edit.aspectRatio, undefined);
      assert.equal(media.width, 1920); assert.equal(media.height, 1080);
    }
  }
  for (const rotation of [Infinity, -Infinity, NaN, '90', null]) {
    const source = { ...row('legacy'), media: [{ ...row('legacy').media[0], edit: { rotation } }] };
    assert.equal(publicSnapshotRows([source], new Set(['legacy']))[0].media[0].edit.rotation, undefined);
  }
});

test('saved snapshots expire and cannot be read by another owner or mode', async () => {
  let now = 1000;
  const storage = memory(); const store = createFeedSnapshotStore(storage, () => now);
  store.setAccount('a'); await store.write('a', 'latest', [row('one')], new Set(['one']));
  assert.equal((await store.read('a', 'latest')).rows[0].post_id, 'one');
  assert.equal(await store.read('b', 'latest'), null);
  assert.equal(await store.read('a', 'trending'), null);
  assert.equal(await store.read('a', 'discover'), null);
  now += FEED_SNAPSHOT_MAX_AGE + 1;
  assert.equal(await store.read('a', 'latest'), null);
});

test('ordinary public feed survives an overnight cold launch but never exceeds one day', async () => {
  let now = 1000;
  const storage = memory(), first = createFeedSnapshotStore(storage, () => now);
  first.setAccount('a'); await first.write('a', 'forYou', [row('one')], new Set(['one']));
  now += 12 * 60 * 60_000;
  const restarted = createFeedSnapshotStore(storage, () => now); restarted.setAccount('a');
  assert.equal((await restarted.read('a', 'forYou')).rows[0].post_id, 'one');
  assert.equal(FEED_SNAPSHOT_MAX_AGE, 24 * 60 * 60_000);
  now += 12 * 60 * 60_000 + 1;
  assert.equal(await restarted.read('a', 'forYou'), null);
});

test('ephemeral, revoked, restricted and sensitive rows or media never become durable public snapshots', () => {
  for (const flag of ['view_once', 'is_view_once', 'is_ephemeral', 'expires_at', 'deleted_at', 'revoked_at', 'is_restricted', 'is_sensitive']) {
    assert.equal(publicSnapshotRows([{ ...row('one'), [flag]: true }], new Set(['one'])).length, 0);
    const post = row('one'); post.media[0][flag] = true;
    assert.equal(publicSnapshotRows([post], new Set(['one']))[0].media.length, 0);
  }
});

test('invalid, future, foreign-owner and obsolete-version persisted data fail closed', async () => {
  for (const value of ['{broken', JSON.stringify({ version: 1, owner: 'b', mode: 'latest', savedAt: 100, rows: [row('one')] }),
    JSON.stringify({ version: 2, owner: 'a', mode: 'latest', savedAt: 100, rows: [row('one')] }),
    JSON.stringify({ version: 1, owner: 'a', mode: 'latest', savedAt: 101, rows: [row('one')] })]) {
    const storage = memory(); storage.values.set('pc-feed-v1:a:latest', value);
    const store = createFeedSnapshotStore(storage, () => 100); store.setAccount('a');
    assert.equal(await store.read('a', 'latest'), null);
  }
});

test('signing out purges a write already in flight and prevents resurrection', async () => {
  const storage = memory(); let finishWrite; let started;
  const writeStarted = new Promise(resolve => { started = resolve; });
  storage.setItem = (key, value) => new Promise(resolve => {
    started(); finishWrite = () => { storage.values.set(key, value); resolve(); };
  });
  const store = createFeedSnapshotStore(storage); store.setAccount('a');
  const old = store.write('a', 'latest', [row('one')], new Set(['one']));
  await writeStarted; store.setAccount(null); finishWrite(); await old;
  store.setAccount('b'); await store.read('b', 'latest');
  assert.equal(storage.values.size, 0);
  await store.write('a', 'latest', [row('one')], new Set(['one']));
  assert.equal(storage.values.size, 0);
});

test('visibility changes invalidate eligibility checks that started before clearing', async () => {
  const storage = memory(); const store = createFeedSnapshotStore(storage); store.setAccount('a');
  const oldRevision = store.revision(); await store.clear('a');
  await store.write('a', 'latest', [row('one')], new Set(['one']), oldRevision);
  assert.equal(await store.read('a', 'latest'), null);
});

test('an empty verified live feed removes the older snapshot', async () => {
  const storage = memory(); const store = createFeedSnapshotStore(storage); store.setAccount('a');
  await store.write('a', 'latest', [row('one')], new Set(['one']));
  await store.write('a', 'latest', [], new Set());
  assert.equal(await store.read('a', 'latest'), null);
});

test('refresh merge updates in place and only user-requested replacement reorders', () => {
  const current = [{ id: 'one', likes: 1 }, { id: 'two', likes: 2 }];
  const incoming = [{ id: 'new' }, { id: 'two', likes: 3 }, { id: 'one', likes: 4 }, { id: 'new' }];
  const held = mergeFeedRefresh(current, incoming, true);
  assert.deepEqual(plain(held.rows), [{ id: 'one', likes: 4 }, { id: 'two', likes: 3 }]);
  assert.deepEqual(plain(held.pending), [{ id: 'new' }]);
  assert.deepEqual(plain(mergeFeedRefresh(current, incoming, false).rows).map(r => r.id), ['new', 'two', 'one']);
});

test('prefetch is capped to nearby safe images and video posters, never video bytes', () => {
  const rows = [row('a'), { media: [{ media_type: 'video', url: url('video'), edit: { coverUrl: url('cover') } }] },
    { media: [{ media_type: 'image', url: url('sensitive'), is_sensitive: true }, { media_type: 'image', url: url('signed') + '?token=x' }] }, row('outside')];
  assert.deepEqual(plain(feedPrefetchUrls(rows, 0, false)), [url('a'), url('cover')]);
  assert.deepEqual(plain(feedPrefetchUrls(rows, 0, true)), []);
  assert.deepEqual(plain(feedPrefetchUrls(rows, 3, false)), [url('outside')]);
});

test('no-store media uses mounted views, never a separate image cache prefetch', () => {
  const rows = [{ media: [
    { media_type: 'image', url: 'https://fixture.supabase.co/functions/v1/media-content/post-media/image.jpg?token=secret' },
    { media_type: 'image', url: 'https://fixture.supabase.co/storage/v1/object/sign/post-media/image.jpg?token=secret' },
  ] }, { media: [{ media_type: 'image', url: url('once'), view_once: true }] }];
  assert.deepEqual(plain(feedPrefetchUrls(rows, 0, false)), []);
});
