const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function load(file, modules = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const context = { exports: {}, URL, require: name => { if (!(name in modules)) throw Error(name); return modules[name]; } };
  vm.runInNewContext(code, context); return context.exports;
}
const content = load('shared/contentMedia.ts'), frame = load('shared/postMediaEditing.ts');
const base = 'https://example.supabase.co';
const url = name => `${base}/storage/v1/object/sign/post-media/a/${name}.jpg?token=do-not-save`;
const jpeg = '/9j/abcd';
const row = (post = 'p1', media = 'm1', extra = {}) => ({ post_id: post, media: [{ id: media, media_type: 'image',
  url: url(media), width: 1200, height: 1600, edit: { aspect: 'original' }, ...extra }] });
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness(render) {
  let saved = null, scope = 1, policy;
  const calls = [], removed = [], writes = [];
  const snapshot = { peek: owner => owner === 'a' ? saved : null, hydrate: async () => saved,
    write: async (owner, value) => { saved = policy.sanitize(value); writes.push({ owner, value: saved }); },
    clear: async () => { saved = null; } };
  const service = load('src/services/feedStartupPreviews.ts', {
    'expo-image-manipulator': { SaveFormat: { JPEG: 'jpeg' }, manipulateAsync: async (...args) => {
      calls.push(args); return render ? render(...args) : { uri: `file:///preview-${calls.length}.jpg`, base64: jpeg, width: 160, height: 210 };
    } },
    'expo-file-system/legacy': { deleteAsync: async uri => { removed.push(uri); } },
    '../../shared/contentMedia': content, '../../shared/postMediaEditing': frame,
    './supabase': { SUPABASE_URL: base }, './startupSnapshots': {
      startupSnapshots: { revision: () => scope }, createStartupSnapshot: (_id, options) => { policy = options; return snapshot; },
    },
  });
  return { service, calls, removed, writes, snapshot, change: () => scope++, get policy() { return policy; } };
}

test('only current public eligible ordinary image pixels enter the encrypted bounded preview store', async () => {
  const h = harness();
  await h.service.saveFeedStartupPreviews('a', [row(), row('private', 'private'), row('once', 'once', { view_once: true }),
    row('sensitive', 'sensitive', { is_sensitive: true }), row('bad', 'bad', { url: 'https://other.test/a.jpg' })],
    new Set(['p1', 'once', 'sensitive', 'bad']), () => true);
  assert.equal(h.calls.length, 1); assert.equal(h.removed.length, 1);
  assert.equal(h.policy.storage, 'secure'); assert.equal(h.policy.maxBytes, 24 * 1024); assert.equal(h.policy.ttlMs, 24 * 60 * 60_000);
  const saved = h.writes[0].value; assert.equal(saved.length, 1);
  assert.equal(saved[0].width, 1200); assert.equal(saved[0].height, 1600); assert.equal(saved[0].aspectRatio, .75);
  assert.ok(!JSON.stringify(saved).includes('do-not-save')); assert.ok(!JSON.stringify(saved).includes('https:'));
  const restored = h.service.applyFeedStartupPreviews('a', [{ post_id: 'p1', media: [] }]);
  assert.equal(restored[0].media[0].url, `data:image/jpeg;base64,${jpeg}`);
  assert.equal(restored[0].media[0]._startupPreview, true);
  assert.equal(h.service.applyFeedStartupPreviews('b', [{ post_id: 'p1', media: [] }])[0].media.length, 0);
});

test('video previews use only a cover image and preserve the final frame without creating a video player source', async () => {
  const h = harness();
  await h.service.saveFeedStartupPreviews('a', [row('p1', 'm1', { media_type: 'video', url: url('video'),
    edit: { coverUrl: url('cover'), aspectRatio: 1.5 } })], new Set(['p1']), () => true);
  assert.equal(h.calls[0][0], url('cover'));
  const media = h.service.applyFeedStartupPreviews('a', [{ post_id: 'p1', media: [] }])[0].media[0];
  assert.equal(media.media_type, 'image'); assert.equal(media._startupMediaType, 'video'); assert.equal(media.edit.aspectRatio, 1.5);
  const fresh = { post_id: 'p1', media: [{ id: 'fresh', url: url('fresh') }] };
  assert.equal(h.service.applyFeedStartupPreviews('a', [fresh])[0], fresh);
});

test('applying encrypted pixels fills only the matching reserved slot and keeps its frame', async () => {
  const h = harness();
  await h.service.saveFeedStartupPreviews('a', [row()], new Set(['p1']), () => true);
  const edit = { aspectRatio: 1.5 }, reserved = { id: 'm1', url: '', media_type: 'image',
    width: 1800, height: 1200, edit, _startupPlaceholder: true, _startupPreview: true };
  const other = { ...reserved, id: 'other' };
  const result = h.service.applyFeedStartupPreviews('a', [{ post_id: 'p1', media: [reserved, other] }])[0];
  assert.equal(result.media[0].url, `data:image/jpeg;base64,${jpeg}`);
  assert.equal(result.media[0].width, 1800); assert.equal(result.media[0].height, 1200); assert.equal(result.media[0].edit, edit);
  assert.equal(result.media[1], other);
});

test('a session change or explicit clear during decode rejects old pixels and removes the temporary file', async () => {
  for (const change of ['scope', 'clear']) {
    const wait = gate(), h = harness(() => wait.promise);
    const pending = h.service.saveFeedStartupPreviews('a', [row()], new Set(['p1']), () => true);
    if (change === 'scope') h.change(); else await h.service.clearFeedStartupPreviews('a');
    wait.resolve({ uri: 'file:///late.jpg', base64: jpeg, width: 160, height: 210 }); await pending;
    assert.equal(h.writes.length, 0); assert.deepEqual(h.removed, ['file:///late.jpg']);
  }
});

test('large previews get one bounded smaller retry and every generated file is removed', async () => {
  let n = 0; const h = harness(() => ({ uri: `file:///${++n}.jpg`, base64: n === 1 ? '/9j/' + 'a'.repeat(8000) : jpeg, width: 160, height: 210 }));
  await h.service.saveFeedStartupPreviews('a', [row()], new Set(['p1']), () => true);
  assert.deepEqual(h.calls.map(call => call[1][0].resize.width), [160, 96]);
  assert.equal(h.removed.length, 2); assert.equal(h.writes[0].value.length, 1);
});

test('snapshot sanitizer rejects non-JPEG data and strips extra capabilities', () => {
  const h = harness();
  const valid = { postId: 'p1', mediaId: 'm1', objectKey: 'post-media/a/photo.jpg', kind: 'image', width: 200, height: 300,
    aspectRatio: .75, uri: `data:image/jpeg;base64,${jpeg}`, secret: url('capability') };
  assert.ok(!JSON.stringify(h.service.sanitizeFeedPreviews([valid])).includes('token='));
  for (const uri of ['data:image/svg+xml;base64,abc', url('x'), 'file:///x.jpg']) assert.equal(h.service.sanitizeFeedPreviews([{ ...valid, uri }]).length, 0);
});

test('feed restore shares disk work and waits for slow encrypted pixels without crossing an account change', async () => {
  let diskReads = 0, revision = 0;
  const wait = gate(), snapshot = { rows: [{ post_id: 'p1', media: [] }], savedAt: Date.now() };
  const service = load('src/services/feedSnapshot.ts', {
    '@react-native-async-storage/async-storage': { default: {} },
    '../../shared/feedSnapshot': { FEED_SNAPSHOT_MAX_AGE: 86400000, createFeedSnapshotStore: () => ({
      revision: () => revision, setAccount: () => { revision++; }, read: async () => { diskReads++; return snapshot; },
      write: async () => {}, clear: async () => {},
    }) },
    './supabase': { supabase: {} }, '../stores/authStore': { useAuthStore: { getState: () => ({ profile: { id: 'a' } }) } },
    './offlineFeedMedia': { offlineFeedMedia: { warm: async () => {}, peek: () => null, reconcile: async () => {} }, saveOfflineFeedMedia: async () => {} },
    './feedStartupPreviews': { feedStartupPreviews: { hydrate: () => wait.promise },
      applyFeedStartupPreviews: (_owner, rows) => rows.map(row => ({ ...row, hasPixels: true })),
      clearFeedStartupPreviews: async () => {}, saveFeedStartupPreviews: async () => {},
    },
  });
  service.feedSnapshots.setAccount('a');
  const one = service.feedSnapshots.read('a', 'forYou'), two = service.feedSnapshots.read('a', 'forYou');
  let ready = false; void one.then(() => { ready = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(diskReads, 1); assert.equal(ready, false);
  wait.resolve();
  assert.equal((await one).rows[0].hasPixels, true); await two;
  const late = service.feedSnapshots.read('a', 'forYou');
  service.feedSnapshots.setAccount('b'); assert.equal(await late, null);
});

test('encrypted previews arriving after launch fill reserved frames without changing geometry, content or order', async () => {
  const { mergeLateFeedPreviews } = load('shared/feedSnapshot.ts');
  const wait = gate(); let hydrated = false;
  const preview = { id: 'm1', url: `data:image/jpeg;base64,${jpeg}`, media_type: 'image',
    _startupPreview: true, width: 1200, height: 1600, edit: { aspectRatio: .75 } };
  const reserved = { ...preview, url: '', _startupPlaceholder: true };
  const snapshot = { rows: [{ post_id: 'p1', content: 'disk text', media: [reserved] }], savedAt: Date.now() };
  const service = load('src/services/feedSnapshot.ts', {
    '@react-native-async-storage/async-storage': { default: {} },
    '../../shared/feedSnapshot': { FEED_SNAPSHOT_MAX_AGE: 86400000, createFeedSnapshotStore: () => ({
      revision: () => 1, setAccount: () => {}, read: async () => snapshot, write: async () => {}, clear: async () => {},
    }) },
    './supabase': { supabase: {} }, '../stores/authStore': { useAuthStore: { getState: () => ({ profile: { id: 'a' } }) } },
    './offlineFeedMedia': { offlineFeedMedia: { warm: async () => {}, peek: () => null, reconcile: async () => {} }, saveOfflineFeedMedia: async () => {} },
    './feedStartupPreviews': { feedStartupPreviews: { hydrate: async () => { await wait.promise; hydrated = true; } },
      applyFeedStartupPreviews: (_owner, rows) => hydrated ? rows.map(row => ({ ...row, media: [preview] })) : rows,
      clearFeedStartupPreviews: async () => {}, saveFeedStartupPreviews: async () => {},
    },
  });
  const pending = service.feedSnapshots.read('a', 'forYou');
  await Promise.resolve(); await Promise.resolve();
  const warm = service.feedSnapshots.peek('a', 'forYou');
  assert.equal(warm.rows[0].media[0].url, '');
  const current = [{ id: 'unmatched', content: 'keep me', media: [] },
    { id: 'p1', content: 'optimistic text', likes: 7, media: warm.rows[0].media }];
  wait.resolve();
  const late = (await pending).rows.map(row => ({ ...row, id: row.post_id }));
  const next = mergeLateFeedPreviews(current, late);
  assert.equal(next[0], current[0]);
  assert.equal(next[1].id, 'p1'); assert.equal(next[1].content, 'optimistic text'); assert.equal(next[1].likes, 7);
  assert.equal(next[1].media[0].url, preview.url); assert.equal(next[1].media[0].edit, reserved.edit);
  assert.equal(frame.postAspectRatio(next[1].media[0].edit,next[1].media[0].width,next[1].media[0].height),
    frame.postAspectRatio(reserved.edit,reserved.width,reserved.height));
  assert.equal(current[1].media[0].url, '');
});

test('late preview merge never replaces mounted media or accepts fresh URLs from a stale snapshot', () => {
  const { mergeLateFeedPreviews } = load('shared/feedSnapshot.ts');
  const current = [{ id: 'fresh', content: 'network', media: [{ id: 'new', url: url('new'), width: 600, height: 400 }] },
    { id: 'empty', media: [] }, { id: 'reserved', media: [{ id: 'held', url: '', width: 900, height: 1600 }] }];
  const incoming = current.map(row => ({ id: row.id, media: [{ url: `data:image/jpeg;base64,${jpeg}`, _startupPreview: true }] }));
  incoming[1].media = [{ url: url('expired') }];
  incoming.push({ id: 'not-mounted', media: [{ url: `data:image/jpeg;base64,${jpeg}`, _startupPreview: true }] });
  assert.equal(mergeLateFeedPreviews(current, incoming), current);
});
