const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const YAML = require('yaml');
const { createClient } = require('@supabase/supabase-js');
const { createFixture } = require('../native/backend-fixture.cjs');
const { feedVideoOverlay, feedRefreshOverlay } = require('../../scripts/quality/native-ui-feed-video-overlay.cjs');
const root = path.resolve(__dirname, '../..');

test('concurrent feed reads materialize one packaged video and refresh preserves its media identity', async () => {
  let calls = 0;
  const fixture = createFixture(() => {}, { feedVideoSource: async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 10)); return 'file:///packaged/fixture.mp4';
  } });
  const client = createClient('https://uaulhuelcfkjwojtymmw.supabase.co', 'native-ui-synthetic-no-provider-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fixture.fetch },
  });
  await client.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  const [first, concurrent] = await Promise.all([client.rpc('get_feed'), client.rpc('get_feed')]);
  const refreshed = await fixture.observeFeedRefresh(async () => await client.rpc('get_feed'));
  await Promise.resolve();
  assert.equal(calls, 1); assert.equal(first.data.length, 8); assert.equal(concurrent.data.length, 8);
  assert.deepEqual(refreshed.data[0].media, first.data[0].media);
  assert.equal(first.data[0].media[0].media_type, 'video');
  assert.equal(first.data.at(-1).content, 'Feed scroll checkpoint.');
  assert.equal((await client.from('post_media_tags').select('*')).data.length, 0);
  assert.equal(fixture.receipt.unhandled.length, 0);
  assert.deepEqual(fixture.receipt.feedRefreshes, [{ before: 2, after: 3, completed: true }]);
  const rejected = Promise.reject(new Error('refresh failed'));
  assert.equal(fixture.observeFeedRefresh(() => rejected), rejected);
  await assert.rejects(rejected, /refresh failed/);
  assert.equal(fixture.receipt.feedRefreshes.at(-1).completed, false);
  assert.equal(fixture.receipt.feedRefreshes.at(-1).after, 3);
  await client.auth.signOut();
});

test('the playback gate requires a painted frame, current ownership, ready source and advancing native time', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/PostCarousel.tsx'), 'utf8');
  const changed = feedVideoOverlay(source);
  const ast = ts.createSourceFile('PostCarousel.tsx', changed, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.throws(() => feedVideoOverlay(changed), /Expected one/);
  const expression = changed.match(/accessibilityLabel=\{(hasFrame[^\n]+)\}/)[1];
  const good = { hasFrame: true, owns: true, sourceReady: true, musicClock: { playing: true, time: 0.5 } };
  assert.equal(vm.runInNewContext(expression, good), 'Native feed video playing');
  for (const bad of [{ hasFrame: false }, { owns: false }, { sourceReady: false },
    { musicClock: { playing: false, time: 1 } }, { musicClock: { playing: true, time: 0 } }]) {
    assert.equal(vm.runInNewContext(expression, { ...good, ...bad }), 'Native feed video waiting');
  }
  const flow = YAML.parseAllDocuments(fs.readFileSync(path.join(root, 'tests/native/flows/feed-video.yaml'), 'utf8'))[1].toJSON();
  assert.equal(flow.filter(command => command.extendedWaitUntil?.visible === 'Native feed video playing').length, 4);
  assert.equal(flow.some(command => command.swipe), true);
  assert.equal(flow.some(command => command.launchApp || command.retry), false);
  const feed = fs.readFileSync(path.join(root, 'src/screens/feed/FeedScreen.tsx'), 'utf8');
  const refresh = feedRefreshOverlay(feed);
  assert.equal(ts.createSourceFile('FeedScreen.tsx', refresh, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0);
  assert.throws(() => feedRefreshOverlay(refresh), /Expected one/);
});
