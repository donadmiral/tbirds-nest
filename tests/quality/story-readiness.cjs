const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const tick = () => new Promise(setImmediate);
function harness() {
  let now = 100000, scope = '1:viewer', reads = 0, resolveRead, listener;
  const images = [], videos = [], clears = [];
  const date = class extends Date { static now() { return now; } };
  function load(file, imports = {}) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { exports, require: name => { if (!(name in imports)) throw Error(name); return imports[name]; }, Date: date, setTimeout, clearTimeout, AbortController });
    return exports;
  }
  const media = load('shared/mediaDelivery.ts');
  const service = load('src/services/storyReadiness.ts', {
    'react-native': { Image: { prefetch: async uri => { images.push(uri); return true; } } },
    '../../shared/navigationCache': load('shared/navigationCache.ts'),
    '../../shared/mediaDelivery': media, '../../shared/storyPlayback': load('shared/storyPlayback.ts'),
    '../../modules/boomerang/storyVideo': { clearStoryVideoWarmPool: () => clears.push(scope), prewarmStoryVideo: (...args) => videos.push(args) },
    '../lib/navigationCache': { navigationScope: () => scope, subscribeNavigationScope: fn => { listener = fn; } },
    './storiesService': { storiesService: { getUserStories: () => { reads++; return new Promise(resolve => { resolveRead = resolve; }); } } },
  });
  const story = (extra = {}) => ({ id: 'story', user_id: 'author', media_type: 'video', media_url: 'https://media/clip.mp4', thumbnail_url: 'https://media/poster.jpg', expires_at: new Date(200000).toISOString(), _mediaExpiresAt: 190000, ...extra });
  return { ...service, images, videos, clears, story, get reads() { return reads; }, resolve(rows) { resolveRead(rows); }, advance(ms) { now += ms; }, switch(next) { scope = next; listener(); } };
}

test('a story tap joins its ring read, transfers the result once and warms its video before playback', async () => {
  const h = harness(), pending = h.prefetchStoryEntry('author', { full_name: 'Author' });
  await tick();
  const tap = h.takeStoryEntry('author');
  assert.equal(h.reads, 1);
  h.resolve([h.story()]);
  const [warm, entry] = await Promise.all([pending, tap]);
  assert.equal(entry.stories[0].id, 'story');
  assert.equal(entry, warm);
  assert.equal(h.videos.length, 1);
  assert.equal(h.videos[0][0], 'https://media/clip.mp4');
  assert.equal(await h.takeStoryEntry('author'), null);
});
test('changing sessions discards both cached results and late reads, including an A to B to A round trip', async () => {
  const h = harness(), pending = h.prefetchStoryEntry('author');
  await tick(); h.switch('2:other'); h.switch('3:viewer');
  h.resolve([h.story()]);
  assert.equal(await pending, null);
  assert.equal(await h.takeStoryEntry('author'), null);
  assert.equal(h.videos.length, 0);
  assert.equal(h.clears.length, 2);
});
test('expired story authorization and the short payload TTL force a fresh read', async () => {
  const h = harness(); let pending = h.prefetchStoryEntry('author'); await tick(); h.resolve([h.story({ _mediaExpiresAt: 104000 })]); await pending;
  assert.equal(await h.takeStoryEntry('author'), null);
  pending = h.prefetchStoryEntry('author'); await tick(); h.resolve([h.story()]); await pending;
  h.advance(20001);
  assert.equal(await h.takeStoryEntry('author'), null);
});
test('private posters are never sent through the image disk prefetcher and public duplicates coalesce', async () => {
  const h = harness();
  h.prewarmStoryMedia(h.story({ thumbnail_url: 'https://example.supabase.co/functions/v1/media-content/story-media/poster.jpg?token=secret' }));
  assert.equal(h.images.length, 0);
  h.prewarmStoryMedia(h.story()); h.prewarmStoryMedia(h.story());
  await tick(); assert.deepEqual(h.images, ['https://media/poster.jpg']);
});
test('ring cache keeps at most three author payloads and invalidation prevents stale reopening', async () => {
  const h = harness();
  for (const author of ['a', 'b', 'c', 'd']) { const p = h.prefetchStoryEntry(author); await tick(); h.resolve([h.story()]); await p; }
  assert.equal(await h.takeStoryEntry('a'), null);
  h.invalidateStoryEntries();
  assert.equal(await h.takeStoryEntry('d'), null);
});
test('invalidating stories during an unchanged session stops the old read from warming media', async () => {
  const h = harness(), pending = h.prefetchStoryEntry('author');
  await tick(); h.invalidateStoryEntries(); h.resolve([h.story()]);
  assert.equal(await pending, null); await tick();
  assert.equal(h.videos.length, 0); assert.equal(h.images.length, 0);
});
