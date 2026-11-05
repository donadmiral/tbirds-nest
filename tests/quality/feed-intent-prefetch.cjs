const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const turn = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function load(file, imports = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require(name) {
    if (!(name in imports)) throw new Error('Unexpected import ' + name);
    return imports[name];
  }, setTimeout, clearTimeout, AbortController, Date });
  return module.exports;
}
function harness() {
  const cache = load('shared/navigationCache.ts').createNavigationCache();
  cache.setScope('account-a');
  const transition = load('src/lib/screenTransition.ts', {
    './navigationCache': { navigationCache: cache, navigationScope: () => cache.scope() },
  });
  const requests = [], images = [];
  const intent = load('src/services/feedIntent.ts', {
    '../lib/screenTransition': transition,
    '../../shared/feedSnapshot': load('shared/feedSnapshot.ts'),
    'expo-image': { Image: { prefetch(urls, options) { images.push({ urls: [...urls], options }); return Promise.resolve(true); } } },
    './supabase': { supabase: { rpc(name, args) {
      const gate = deferred();
      const request = { name, args, gate };
      requests.push(request);
      return { abortSignal(signal) { request.signal = signal; return gate.promise; } };
    } } },
  });
  return { cache, transition, requests, images, ...intent };
}

test('press-in and press share one profile read and navigation can consume the ready value', async () => {
  const h = harness();
  h.prefetchFeedProfile('person'); h.prefetchFeedProfile('person');
  const ready = h.transition.awaitPrefetched('profile:person');
  await turn();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].name, 'get_profile');
  assert.equal(h.requests[0].args.p_profile_id, 'person');
  assert.equal(h.requests[0].signal.aborted, false);
  const profile = { id: 'person', full_name: 'Person' };
  h.requests[0].gate.resolve({ data: profile, error: null });
  assert.equal(await ready, profile);
  assert.equal(h.transition.takePrefetched('profile:person'), profile);
  h.prefetchFeedProfile('person'); await turn();
  assert.equal(h.requests.length, 1);
});

test('failed or mismatched profile reads are retryable and never cached as a profile', async () => {
  const h = harness();
  for (const result of [{ data: null, error: { code: '42501' } }, { data: { id: 'other' }, error: null }]) {
    h.prefetchFeedProfile('person');
    const ready = h.transition.awaitPrefetched('profile:person');
    await turn();
    h.requests.at(-1).gate.resolve(result);
    assert.equal(await ready, null);
    assert.equal(h.transition.takePrefetched('profile:person'), null);
  }
  assert.equal(h.requests.length, 2);
});

test('account change aborts the actual profile transport and ignores its late response', async () => {
  const h = harness();
  h.prefetchFeedProfile('person');
  const ready = h.transition.awaitPrefetched('profile:person');
  await turn();
  h.cache.setScope('account-b');
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(await ready, null);
  h.requests[0].gate.resolve({ data: { id: 'person' }, error: null });
  await turn();
  assert.equal(h.transition.takePrefetched('profile:person'), null);
});

test('post-open warming excludes private, sensitive and video-byte requests', () => {
  const h = harness();
  const publicImage = 'https://example.supabase.co/storage/v1/object/public/posts/photo.jpg';
  h.prefetchPostImages({ media: [
    { media_type: 'image', url: publicImage },
    { media_type: 'image', url: publicImage + '?token=private' },
  ] }, false);
  assert.deepEqual(h.images.map(x => x.urls), [[publicImage]]);
  assert.equal(h.images[0].options.cachePolicy, 'memory');
  h.prefetchPostImages({ media: [
    { media_type: 'image', url: publicImage, is_sensitive: true },
    { media_type: 'video', url: 'https://example.supabase.co/storage/v1/object/public/posts/movie.mp4' },
  ] }, false);
  h.prefetchPostImages({ media: [{ media_type: 'image', url: 'https://example.supabase.co/storage/v1/object/public/post-media/photo.jpg' }] }, false);
  assert.equal(h.images.length, 1);
});

test('data saver prevents optional post image warming', () => {
  const h = harness();
  h.prefetchPostImages({ media: [{ media_type: 'image', url: 'https://example.supabase.co/storage/v1/object/public/posts/photo.jpg' }] }, true);
  assert.equal(h.images.length, 0);
});
