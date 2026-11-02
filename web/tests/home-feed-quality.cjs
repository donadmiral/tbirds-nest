const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.join(__dirname, '..');
function load(file, overrides = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require: name => overrides[name] ?? require(name),
    performance, AbortController, Map, Set, Promise, URL, setTimeout, clearTimeout, queueMicrotask, console,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' } } });
  return module.exports;
}
const shared = load('../shared/feedSnapshot.ts');
const marketplace = load('../shared/marketplaceRecommendations.ts');
const { createHomeFeedController, filterMutedFeedRows } = load('lib/homeFeedController.ts', { '../../shared/feedSnapshot': shared, '../../shared/marketplaceRecommendations': marketplace, '../../shared/feedTabCache': load('../shared/feedTabCache.ts') });
const row = (id, likes = 0) => ({ post_id: id, author_id: 'author', content: 'Visible content ' + id, created_at: '2026-10-22T12:00:00Z', media: [], products: [], likes_count: likes, sort_key: 100 });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(seedRows = [row('first')], seedError = null, options = {}) {
  const calls = [], saved = new Map(), measurements = [];
  let reply = async (_name, args) => ({ data: args.p_ids ? args.p_ids.map(post_id => ({ post_id, snapshot_eligible: true })) : [row('fresh')], error: null });
  const cache = shared.createFeedSnapshotStore({ getItem: async key => saved.get(key) ?? null, setItem: async (key,value) => saved.set(key,value), removeItem: async key => saved.delete(key) });
  const client = { rpc(name,args) { calls.push({name,args}); return reply(name,args); } };
  const seed = { owner: 'alice', rows: seedRows, mutedWords: [], error: seedError };
  const controller = createHomeFeedController(client, seed, cache, event => measurements.push(event), options.hydrate, undefined, options.mediaContext, options.historyFactory);
  return {controller,client,seed,calls,cache,saved,measurements,setReply(fn){reply=fn;}};
}

test('verified server seed displays immediately without a duplicate initial feed fetch', async () => {
  const h=harness(); assert.equal(h.controller.getSnapshot().rows[0].post_id,'first');
  await h.controller.start(); await tick();
  assert.equal(h.calls.filter(call=>call.name==='get_feed').length,0);
  assert.equal(h.controller.getSnapshot().loading,false);
  h.controller.dispose();
});
test('switching feed while an older response is pending cannot overwrite the current mode', async () => {
  const h=harness(), pending=deferred();
  h.setReply((name,args)=>args.p_mode==='for_you'?pending.promise:Promise.resolve({data:args.p_ids?[]:[row('latest')],error:null}));
  const old=h.controller.load(); h.controller.setMode('latest'); await tick();
  pending.resolve({data:[row('obsolete')],error:null});await old;
  assert.equal(h.controller.getSnapshot().rows[0].post_id,'latest');h.controller.dispose();
});
test('signing out clears visible posts and fences pending requests', async () => {
  const h=harness(), pending=deferred();h.setReply(()=>pending.promise);
  const old=h.controller.load();h.controller.setOwner(null);pending.resolve({data:[row('obsolete')],error:null});await old;
  assert.equal(h.controller.getSnapshot().rows.length,0);assert.equal(h.controller.getSnapshot().owner,null);h.controller.dispose();
});

test('bounded hide fences cannot revive discarded IDs from an old full response', async () => {
  const h = harness(), pending = deferred(); h.setReply(() => pending.promise);
  const old = h.controller.load();
  for (let n = 0; n < 2100; n++) h.controller.hide(`old-${n}`);
  assert.equal(h.controller.remember().hidden.length, 2000);
  pending.resolve({ data: [row('old-0')], error: null }); await old;
  assert.ok(!h.controller.getSnapshot().rows.some(row => row.post_id === 'old-0'));
  assert.equal(h.controller.getSnapshot().loading, false);
  h.controller.dispose();
});

test('a replacement authenticated session activates a new bounded ledger after its first page', async () => {
  const { createSessionHistory } = load('../shared/sessionHistory.ts');
  const created = [], disk = new Map();
  const h = harness([row('alice')], null, { historyFactory: options => {
    const value = createSessionHistory({ ...options, namespace: 'test-' + created.length,
      storage: { read: async keys => keys.map(key => disk.get(key) ?? null), write: async entries => entries.forEach(([key,value]) => disk.set(key,value)),
        clear: async prefix => { for (const key of disk.keys()) if (key.startsWith(prefix)) disk.delete(key); } } }); created.push(value); return value;
  } });
  await h.controller.start(); assert.ok(h.controller.getSnapshot().history);
  h.controller.setOwner('bob'); await tick(); await tick();
  assert.equal(created.length, 2); assert.equal(created[0].available(), false);
  assert.equal(h.controller.getSnapshot().owner, 'bob'); assert.ok(h.controller.getSnapshot().history);
  assert.equal(h.controller.getSnapshot().rows[0].post_id, 'fresh'); h.controller.dispose();
});
test('background refresh keeps reading position, holds new posts and removes revoked rows', async () => {
  const older=row('older'),h=harness([row('first'),older,row('revoked')]);
  h.setReply(async(name)=>({data:name==='get_feed'?[row('new'),row('first',5)]:['new','first','older'].map(post_id=>({post_id,snapshot_eligible:true})),error:null}));
  await h.controller.load(false,true);
  const s=h.controller.getSnapshot();assert.deepEqual(Array.from(s.rows,r=>r.post_id),['first','older']);assert.equal(s.rows[0].likes_count,5);assert.equal(s.pending,1);
  assert.equal(s.rows[1],older,'Revalidating visibility must not reset an unchanged retained card');h.controller.dispose();
});
test('network errors preserve readable posts and release the loading state for retry', async () => {
  const h=harness();h.setReply(async()=>({data:null,error:{message:'offline'}}));await h.controller.load();
  assert.equal(h.controller.getSnapshot().rows[0].post_id,'first');assert.equal(h.controller.getSnapshot().error,'The feed could not load. Please try again.');assert.equal(h.controller.getSnapshot().loading,false);
  assert.equal(h.measurements[0].outcome,'error');h.controller.dispose();
});
test('pagination requests are deduplicated and old pages cannot enter a refreshed feed', async () => {
  const h=harness(Array.from({length:20},(_,i)=>row(String(i)))),pending=deferred();h.setReply(()=>pending.promise);
  const one=h.controller.load(true);await h.controller.load(true);assert.equal(h.calls.length,1);
  h.controller.setOwner(null);pending.resolve({data:[row('old-page')],error:null});await one;
  assert.equal(h.controller.getSnapshot().rows.length,0);h.controller.dispose();
});

test('appending a page preserves existing row and media identity and renews only the new media', async () => {
  const { renewFeedMedia } = load('../shared/feedMedia.ts'), hydrated = [];
  const expiry = Date.now() + 180000;
  const seeds = Array.from({ length: 20 }, (_, i) => ({ ...row('shown-' + i), _mediaExpiresAt: expiry,
    media: [{ id: 'clip-' + i, url: 'https://media.example/authorized-' + i + '.mp4', media_type: 'video' }] }));
  const h = harness(seeds, null, { hydrate: rows => renewFeedMedia(rows, async incoming => {
    hydrated.push(...incoming.map(item => item.post_id));
    return incoming.map(item => ({ ...item, _mediaExpiresAt: expiry }));
  }) });
  h.setReply(async () => ({ data: [{ ...row('next'), media: [{ id: 'photo', url: 'https://media.example/next.jpg', media_type: 'image' }] }], error: null }));
  await h.controller.load(true);
  const result = h.controller.getSnapshot().rows;
  assert.equal(result.length, 21);
  assert.deepEqual(hydrated, ['next'], 'Still-current media never repeats authorization hydration while paging');
  seeds.forEach((seed, index) => {
    assert.equal(result[index], seed, 'An appended page must not rerender an unchanged retained card');
    assert.equal(result[index].media, seed.media, 'Existing media metadata keeps its identity');
  });
  h.controller.dispose();
});

test('appending a page still replaces expiring media while preserving other retained rows', async () => {
  const { renewFeedMedia } = load('../shared/feedMedia.ts'), hydrated = [];
  const expiry = Date.now() + 180000;
  const seeds = Array.from({ length: 20 }, (_, i) => ({ ...row('shown-' + i), _mediaExpiresAt: i === 0 ? Date.now() + 59000 : expiry,
    media: [{ id: 'clip-' + i, url: 'https://media.example/old-' + i + '.mp4', media_type: 'video' }] }));
  const h = harness(seeds, null, { hydrate: rows => renewFeedMedia(rows, async incoming => {
    hydrated.push(...incoming.map(item => item.post_id));
    return incoming.map(item => ({ ...item, _mediaExpiresAt: expiry,
      media: item.media.map(media => ({ ...media, url: 'https://media.example/renewed-' + media.id + '.mp4' })) }));
  }) });
  h.setReply(async () => ({ data: [row('next')], error: null }));
  await h.controller.load(true);
  const result = h.controller.getSnapshot().rows;
  assert.deepEqual(hydrated, ['shown-0', 'next']);
  assert.notEqual(result[0], seeds[0]);
  assert.notEqual(result[0].media, seeds[0].media);
  assert.equal(result[0].media[0].url, 'https://media.example/renewed-clip-0.mp4');
  assert.equal(result[0]._mediaExpiresAt, expiry);
  assert.equal(result[1], seeds[1]);
  assert.equal(seeds[0].media[0].url, 'https://media.example/old-0.mp4', 'Renewal does not mutate earlier snapshots');
  h.controller.dispose();
});

test('media normalization removes unavailable sources without copying or mutating valid retained rows', async () => {
  const good = { id: 'visible', url: 'https://media.example/visible.jpg', media_type: 'image' };
  const unavailable = { ...row('unavailable'), media: [good, { id: 'denied', url: null }, { id: 'empty', url: '' }] };
  const seeds = [unavailable, ...Array.from({ length: 19 }, (_, i) => row('shown-' + i))];
  const h = harness(seeds);
  h.setReply(async () => ({ data: [{ ...row('next'), media: undefined }], error: null }));
  await h.controller.load(true);
  const result = h.controller.getSnapshot().rows;
  assert.equal(result[0].media.length, 1);
  assert.equal(result[0].media[0], good);
  assert.notEqual(result[0], unavailable);
  assert.equal(unavailable.media.length, 3, 'Filtering does not mutate a retained snapshot');
  assert.equal(result[1], seeds[1]);
  assert.equal(result.at(-1).media.length, 0, 'Missing media is still normalized to an empty list');
  h.controller.dispose();
});
test('muted words apply to server rows and hidden posts cannot return after refresh', async () => {
  assert.equal(filterMutedFeedRows([row('hidden'),row('visible')],['hidden']).length,1);
  const h=harness();h.controller.hide('first');h.setReply(async(name,args)=>({data:args.p_ids?[]:[row('first'),row('another')],error:null}));await h.controller.load();
  assert.deepEqual(Array.from(h.controller.getSnapshot().rows,r=>r.post_id),['another']);h.controller.dispose();
});
test('the actual HomeFeed server rendering includes post content before JavaScript hydration', () => {
  const h=harness();const empty=()=>null;
  const overrides={
    '@/lib/navigationCache':{getNavigationStore:()=>({getSnapshot:()=>({owner:null,scope:null}),getServerSnapshot:()=>({owner:null,scope:null}),subscribe:()=>()=>{},cache:{read:()=>null}})},
    '@/lib/sessionHistory': { createWebSessionHistory: () => { throw Error('Server render must not start client history.'); } },
    '../../shared/feedLive':load('../shared/feedLive.ts'), '@/lib/usePostInteractions':{applyPostInteractionsLive:()=>true},
    '@/lib/mediaPrefs': { dataSaverEnabled: () => false },
    '@/lib/homeFeedController':{createHomeFeedController}, '@/lib/homeFeedScroll':load('lib/homeFeedScroll.ts'), '@/lib/contentMedia':{hydratePostMedia:async rows=>rows}, '@/lib/feedCache':{getFeedCache:()=>h.cache}, '../../shared/feedSnapshot':shared, '../../shared/feedMedia':load('../shared/feedMedia.ts'),
    '@/lib/supabase/client':{createClient:()=>h.client}, 'next/navigation':{useRouter:()=>({push(){},refresh(){},replace(){}}),useSearchParams:()=>new URLSearchParams()},
    '@/components/PostCard':{PostCard:({post})=>React.createElement('article',null,post.content)},
    '@/components/StoryRings':{StoryRings:empty}, '@/components/Composer':{Composer:empty},
    '@/components/AnnouncementBanner':{AnnouncementBanner:empty}, '@/components/SponsoredCard':{SponsoredCard:empty}, '@/lib/ads':{getActivePromos:async()=>[]},
    '../../shared/marketplaceRecommendations':marketplace,
    './MarketplaceShelf':load('components/MarketplaceShelf.tsx', { '../../shared/marketplaceRecommendations':marketplace }),
  };
  const {default:HomeFeed}=load('components/HomeFeed.tsx',overrides);
  const html=renderToStaticMarkup(React.createElement(HomeFeed,{seed:h.seed}));
  assert.match(html,/Visible content first/);assert.match(html,/data-feed-content="true"/);
  assert.match(html,/data-feed-owner="alice" data-feed-mode="for_you"/);
  assert.doesNotMatch(html,/animate-pulse/);
});

test('authorized live batches update absolute counts without moving rows, media or the current scroll anchor', () => {
  const h = harness([row('first'), row('second')]), first = h.controller.getSnapshot().rows[0], second = h.controller.getSnapshot().rows[1];
  h.controller.applyLive('alice', ['first'], [{ post_id: 'first', content: 'Edited', body: null, likes_count: 20, comments_count: 3,
    reposts_count: 4, bookmarks_count: 5, views_count: 6, viewer_liked: true, viewer_bookmarked: true, viewer_reposted: false }], 100);
  const state = h.controller.getSnapshot();
  assert.deepEqual(Array.from(state.rows, value => value.post_id), ['first', 'second']);
  assert.equal(state.rows[0].likes_count, 20); assert.equal(state.rows[0].content, 'Edited');
  assert.equal(state.rows[0].media, first.media); assert.equal(state.rows[1], second); assert.equal(state.scrollRestore, null);
  assert.equal(h.calls.length, 0, 'Canonical batch application itself does not fan out into per-card reads');
  h.controller.applyLive('bob', ['first'], [], 200); assert.equal(h.controller.getSnapshot().rows.length, 2); h.controller.dispose();
});

test('lost access removes matching retained rows and tab caches without turning revocation into a permanent hide', async () => {
  const h = harness([row('first'), row('second')]);
  h.controller.setMode('latest', 345); await tick();
  h.controller.applyLive('alice', ['first'], [], Date.now());
  h.setReply(async (_name, args) => ({ data: args.p_ids ? args.p_ids.map(post_id => ({ post_id, snapshot_eligible: true })) : [row('second')], error: null }));
  h.controller.setMode('for_you', 123);
  assert.deepEqual(Array.from(h.controller.getSnapshot().rows, value => value.post_id), ['second']);
  assert.equal(h.controller.getSnapshot().scrollRestore.top, 345, 'Revocation preserves that tab\'s document position');
  await tick(); await new Promise(resolve => setTimeout(resolve, 2));
  h.setReply(async (_name, args) => ({ data: args.p_ids ? args.p_ids.map(post_id => ({ post_id, snapshot_eligible: true })) : [row('first')], error: null }));
  await h.controller.load(); assert.equal(h.controller.getSnapshot().rows[0].post_id, 'first', 'Later reauthorization can restore access'); h.controller.dispose();
});

test('a late full feed response cannot revive a revoked post or undo a newer authorized batch during hydration', async () => {
  const hydration = deferred(), h = harness([row('first'), row('second')], null, { hydrate: () => hydration.promise });
  await h.controller.start(); await tick(); assert.ok(h.saved.size > 0, 'The test starts with a real public disk snapshot');
  h.setReply(async (_name, args) => ({ data: args.p_ids ? args.p_ids.map(post_id => ({ post_id, snapshot_eligible: true })) : [row('first', 1), row('second', 1)], error: null }));
  const pending = h.controller.load(false, true); await tick();
  h.controller.applyLive('alice', ['first', 'second'], [{ post_id: 'second', content: 'Newer', body: null, likes_count: 15,
    comments_count: 4, reposts_count: 1, bookmarks_count: 0, views_count: 7, viewer_liked: true, viewer_bookmarked: false, viewer_reposted: false }], Date.now() + 1);
  hydration.resolve([row('first', 1), row('second', 1)]); await pending;
  const state = h.controller.getSnapshot(); assert.deepEqual(Array.from(state.rows, value => value.post_id), ['second']);
  assert.equal(state.rows[0].likes_count, 15); assert.equal(state.rows[0].content, 'Newer');
  await tick(); assert.ok([...h.saved.values()].every(value => !JSON.parse(value).rows.some(row => row.post_id === 'first')), 'A request started before purge cannot rewrite the revoked row to disk');
  h.controller.dispose();
});

test('a global head hint performs one bounded read independent of retained scroll depth', async () => {
  let hydrations = 0;
  const h = harness(Array.from({ length: 1000 }, (_, index) => row(String(index))), null, { hydrate: async rows => { hydrations++; return rows; } });
  const before = h.controller.getSnapshot().rows;
  h.setReply(async () => ({ data: [row('new'), row('0')], error: null }));
  const signal = new AbortController().signal;
  await h.controller.checkHead({ signal, current: () => true });
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, 'get_feed'); assert.equal(h.calls[0].args.p_limit, 20);
  assert.equal(h.controller.getSnapshot().pending, 1); assert.equal(h.controller.getSnapshot().rows, before);
  assert.equal(hydrations, 0, 'A hint never renews media or runs the full feed pipeline'); h.controller.dispose();
});

test('live content edits retain muted-word filtering without permanently hiding a post', async () => {
  const h = harness([row('first'), row('second')]);
  const controller = createHomeFeedController(h.client, { ...h.seed, mutedWords: ['muted text'] }, h.cache);
  controller.applyLive('alice', ['first'], [{ post_id: 'first', content: 'Now has muted text', body: null,
    likes_count: 1, comments_count: 0, reposts_count: 0, bookmarks_count: 0, views_count: 0,
    viewer_liked: false, viewer_bookmarked: false, viewer_reposted: false }], Date.now());
  assert.deepEqual(Array.from(controller.getSnapshot().rows, value => value.post_id), ['second']);
  await new Promise(resolve => setTimeout(resolve, 2));
  h.setReply(async () => ({ data: [row('first')], error: null })); await controller.load();
  assert.equal(controller.getSnapshot().rows[0].post_id, 'first'); controller.dispose(); h.controller.dispose();
});

test('background cancellation stops retained access batches and fences a late visibility result', async () => {
  const h = harness(Array.from({ length: 501 }, (_, index) => row(String(index)))), held = deferred();
  let active = true; const controller = new AbortController();
  h.setReply(() => held.promise);
  const work = h.controller.reconcileLiveAccess(null, { signal: controller.signal, current: () => active });
  assert.equal(h.calls.length, 2); active = false; controller.abort(); held.resolve({ data: [], error: null }); await work;
  assert.equal(h.calls.length, 2, 'No further access batch starts while the feed is paused');
  assert.equal(h.controller.getSnapshot().rows.length, 501, 'An obsolete empty result cannot remove the resumed feed'); h.controller.dispose();
});

test('metadata refresh preserves current exact media grants and same-account session changes reauthorize', async () => {
  const content = load('../shared/contentMedia.ts');
  const reuse = load('../shared/feedMediaReuse.ts', { './contentMedia': content });
  const adapter = load('lib/contentMedia.ts', { '../../shared/contentMedia': content, '../../shared/feedMediaReuse': reuse, './supabase/client': { createClient() {} } });
  const original = 'https://example.supabase.co/storage/v1/object/public/post-media/author/clip.mp4';
  const capability = 'https://example.supabase.co/functions/v1/media-content/post-media/author/clip.mp4?token=' + 'a'.repeat(64);
  const old = { ...row('first'), media: [{ id: 'clip', url: capability, media_type: 'video' }], _mediaExpiresAt: Date.now() + 180000 };
  const incoming = { ...row('first', 7), media: [{ id: 'clip', url: original, media_type: 'video' }] };
  const h = harness([old]); h.setReply(async (name, args) => ({ data: args.p_ids ? args.p_ids.map(post_id => ({ post_id, snapshot_eligible: true })) : [incoming], error: null }));
  let scope = 'alice:1'; const hydration = [];
  const c = createHomeFeedController(h.client, h.seed, h.cache, undefined, async rows => { hydration.push(rows); return rows; }, null,
    { scope: () => scope, retain: adapter.retainFeedMedia });
  await c.load(false, true);
  assert.equal(c.getSnapshot().rows[0].media[0].url, capability);
  assert.equal(c.getSnapshot().rows[0].likes_count, 7);
  const memory = c.remember(12); assert.equal(memory.tab.mediaScope, 'alice:1');
  scope = 'alice:2'; c.setMediaSession('alice', scope);
  assert.equal(c.getSnapshot().rows.length, 0, 'Old decoded media is removed before the next session read');
  await tick();
  assert.equal(hydration.at(-1)[0].media[0].url, original, 'New session cannot reuse the old grant');
  assert.notEqual(c.getSnapshot().rows[0], old, 'Reference preservation never crosses authenticated sessions');
  assert.notEqual(c.getSnapshot().rows[0].media, old.media);
  const restored = createHomeFeedController(h.client, { ...h.seed, rows: [] }, h.cache, undefined, undefined, memory,
    { scope: () => scope, retain: adapter.retainFeedMedia });
  assert.equal(restored.getSnapshot().rows.length, 0, 'Memory from another session is not displayed');
  restored.dispose(); c.dispose(); h.controller.dispose();
});

test('authorized refresh applies changed media sources and edit recipes instead of retaining obsolete identity', async () => {
  const content = load('../shared/contentMedia.ts');
  const reuse = load('../shared/feedMediaReuse.ts', { './contentMedia': content });
  const adapter = load('lib/contentMedia.ts', { '../../shared/contentMedia': content, '../../shared/feedMediaReuse': reuse, './supabase/client': { createClient() {} } });
  const { renewFeedMedia } = load('../shared/feedMedia.ts');
  const canonical = name => 'https://example.supabase.co/storage/v1/object/public/post-media/author/' + name;
  const capability = (name, token) => 'https://example.supabase.co/functions/v1/media-content/post-media/author/' + name + '?token=' + token.repeat(64);
  for (const change of [{ file: 'replacement.mp4', trimStart: 0 }, { file: 'clip.mp4', trimStart: 2 }]) {
    const expiry = Date.now() + 180000, hydration = [];
    const original = { ...row('first'), _mediaExpiresAt: expiry,
      media: [{ id: 'clip', url: capability('clip.mp4', 'a'), media_type: 'video', edit: { trimStart: 0 } }] };
    const incoming = { ...row('first', 9),
      media: [{ id: 'clip', url: canonical(change.file), media_type: 'video', edit: { trimStart: change.trimStart } }] };
    const h = harness([original], null, {
      mediaContext: { scope: () => 'alice:1', retain: adapter.retainFeedMedia },
      hydrate: rows => renewFeedMedia(rows, async values => {
        hydration.push(...values);
        return values.map(item => ({ ...item, _mediaExpiresAt: expiry,
          media: item.media.map(media => ({ ...media, url: capability(change.file, 'b') })) }));
      }),
    });
    h.setReply(async (_name, args) => ({ data: args.p_ids ? args.p_ids.map(post_id => ({ post_id, snapshot_eligible: true })) : [incoming], error: null }));
    await h.controller.load(false, true);
    const current = h.controller.getSnapshot().rows[0];
    assert.equal(hydration.length, 1, 'Actual media changes require renewed authorization');
    assert.equal(hydration[0].media[0].url, canonical(change.file));
    assert.notEqual(current, original);
    assert.notEqual(current.media, original.media);
    assert.equal(current.media[0].url, capability(change.file, 'b'));
    assert.equal(current.media[0].edit.trimStart, change.trimStart);
    assert.equal(current.likes_count, 9, 'Fresh non-media metadata still updates');
    h.controller.dispose();
  }
});

test('same-account A to B to A session changes fence pending feed hydration', async () => {
  const h = harness(), delayed = deferred(); let scope = 'alice:1';
  const c = createHomeFeedController(h.client, h.seed, h.cache, undefined, () => delayed.promise, null,
    { scope: () => scope, retain: (_old, incoming) => incoming });
  const old = c.load(); await tick();
  scope = 'bob:2'; c.setMediaSession('bob', scope);
  scope = 'alice:3'; c.setMediaSession('alice', scope);
  delayed.resolve([row('obsolete')]); await old;
  assert.equal(c.getSnapshot().rows.some(item => item.post_id === 'obsolete'), false);
  c.dispose(); h.controller.dispose();
});

test('first Auth initialization replaces a pending null-scope retry without leaving the feed locked', async () => {
  const h = harness([], 'Initial feed unavailable'), delayed = deferred(); let scope = null, reads = 0;
  h.setReply(async (name, args) => name === 'get_feed'
    ? ++reads === 1 ? delayed.promise : { data: [row('authorized')], error: null }
    : { data: args.p_ids.map(post_id => ({ post_id, snapshot_eligible: true })), error: null });
  const c = createHomeFeedController(h.client, h.seed, h.cache, undefined, async rows => rows, null,
    { scope: () => scope, retain: (_old, incoming) => incoming });
  const starting = c.start(); scope = 'alice:1'; c.setMediaSession('alice', scope, true); await tick();
  delayed.resolve({ data: [row('obsolete')], error: null }); await starting;
  assert.equal(c.getSnapshot().rows[0].post_id, 'authorized');
  assert.equal(c.getSnapshot().loading, false); assert.equal(c.getSnapshot().loadingMore, false);
  assert.equal(reads, 2); c.dispose(); h.controller.dispose();
});

test('switching modes clears previous results while the requested mode is loading or failed', async () => {
  const h = harness(), pending = deferred(); h.setReply(() => pending.promise);
  h.controller.setMode('trending'); assert.equal(h.controller.getSnapshot().rows.length, 0);
  pending.resolve({ data: null, error: { message: 'private-token' } }); await tick();
  assert.equal(h.controller.getSnapshot().rows.length, 0);
  assert.doesNotMatch(h.controller.getSnapshot().error, /private-token/); h.controller.dispose();
});
test('initial feed retains authorized text without protected URLs when signing fails', async () => {
  const media = load('../shared/contentMedia.ts');
  const initial = load('lib/initialFeed.ts', { './contentMedia': { hydratePostMedia: async () => { throw Error('secret-signing-error'); } },
    './withTimeout': load('lib/withTimeout.ts'), '../../shared/contentMedia': media });
  const raw = { ...row('public'), media_url: 'https://example.supabase.co/storage/v1/object/public/post-media/owner/photo.jpg',
    media: [{ url: 'https://example.supabase.co/storage/v1/object/public/post-media/owner/photo.jpg', media_type: 'image' }] };
  const client = { rpc: async () => ({ data: [raw], error: null }), from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { muted_words: ['blocked'] }, error: null }) }) }) }) };
  const result = await initial.loadInitialFeed(client, 'alice');
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].content, raw.content);
  assert.equal(result.rows[0].media.length, 0); assert.equal(result.rows[0].media_url, null);
  assert.match(result.error, /media/); assert.doesNotMatch(JSON.stringify(result), /secret-signing-error|photo.jpg/);
});
test('initial feed fails closed when mute preferences cannot be loaded', async () => {
  const initial = load('lib/initialFeed.ts', { './contentMedia': { hydratePostMedia: async value => value },
    './withTimeout': load('lib/withTimeout.ts'), '../../shared/contentMedia': load('../shared/contentMedia.ts') });
  const client = { rpc: async () => ({ data: [row('muted')], error: null }), from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: Error('preferences unavailable') }) }) }) }) };
  const result = await initial.loadInitialFeed(client, 'alice');
  assert.equal(result.rows.length, 0); assert.ok(result.error);
});

test('returning from Trending restores For You without publishing a transient empty state', async () => {
  const h = harness([row('remembered')]), pending = deferred(), seen=[];
  h.setReply(async (name,args) => ({data:args.p_ids?args.p_ids.map(post_id=>({post_id,snapshot_eligible:true})):[row('trending')],error:null}));
  h.controller.setMode('trending'); await tick();
  h.setReply((name,args) => name==='get_feed'?pending.promise:Promise.resolve({data:args.p_ids.map(post_id=>({post_id,snapshot_eligible:true})),error:null}));
  h.controller.subscribe(()=>seen.push(h.controller.getSnapshot()));
  h.controller.setMode('for_you');
  assert.equal(h.controller.getSnapshot().rows[0].post_id,'remembered');
  assert.ok(seen.every(state=>state.mode!=='for_you'||state.rows.length>0));
  pending.resolve({data:[row('remembered',3)],error:null});await tick();
  assert.equal(h.controller.getSnapshot().rows[0].likes_count,3);h.controller.dispose();
});

test('a restored tab cannot expose the previous account and hidden posts stay hidden', async () => {
  const h=harness([row('remembered')]);
  h.setReply(async(name,args)=>({data:args.p_ids?[]:[row('trend')],error:null}));
  h.controller.setMode('trending');await tick();h.controller.hide('remembered');
  h.controller.setMode('for_you');assert.equal(h.controller.getSnapshot().rows.length,0);
  h.controller.setOwner(null);h.controller.setMode('trending');assert.equal(h.controller.getSnapshot().rows.length,0);h.controller.dispose();
});


test('a disk snapshot cached before the first response acquires a real cursor after returning to its tab', async () => {
  const h = harness([], 'offline'), original = deferred();
  h.cache.setAccount('alice');
  await h.cache.write('alice', 'forYou', [row('snapshot')], new Set(['snapshot']));
  let firstRequest = true;
  h.setReply(async (name, args) => {
    if (name === 'get_feed_visibility') return { data: args.p_ids.map(post_id => ({ post_id, snapshot_eligible: true })), error: null };
    if (args.p_mode === 'for_you' && firstRequest) { firstRequest = false; return original.promise; }
    if (args.p_mode === 'trending') return { data: [row('trend')], error: null };
    if (args.p_cursor_id) return { data: [row('next-page')], error: null };
    return { data: Array.from({ length: 20 }, (_, i) => row(i === 0 ? 'snapshot' : 'fresh-' + i)), error: null };
  });
  const initial = h.controller.start(); await tick();
  assert.equal(h.controller.getSnapshot().rows[0].post_id, 'snapshot');
  h.controller.setMode('trending'); await tick();
  h.controller.setMode('for_you'); await tick();
  assert.equal(h.controller.getSnapshot().rows[0].post_id, 'snapshot');
  assert.equal(h.controller.getSnapshot().hasMore, true, 'confirmed first page replaces the snapshot pagination state');
  await h.controller.load(true);
  assert.equal(h.calls.filter(call => call.name === 'get_feed').at(-1).args.p_cursor_id, 'fresh-19');
  assert.ok(h.controller.getSnapshot().rows.some(item => item.post_id === 'next-page'));
  original.resolve({ data: [row('obsolete')], error: null }); await initial;
  assert.ok(!h.controller.getSnapshot().rows.some(item => item.post_id === 'obsolete'));
  h.controller.dispose();
});

test('a new Home route restores its selected mode, rows, cursor and scroll synchronously while refreshing', async()=>{
  const h=harness(Array.from({length:20},(_,i)=>row('home-'+i)));
  h.setReply(async(name,args)=>({data:args.p_ids?args.p_ids.map(post_id=>({post_id,snapshot_eligible:true})):Array.from({length:20},(_,i)=>row('trend-'+i)),error:null}));
  h.controller.setMode('trending',420);await tick();
  h.controller.finishScrollRestore(h.controller.getSnapshot().scrollRestore.id);
  const memory=h.controller.remember(875);h.controller.dispose();
  const gate=deferred(),requests=[],client={rpc(name,args){requests.push({name,args});return name==='get_feed'?gate.promise:Promise.resolve({data:args.p_ids.map(post_id=>({post_id,snapshot_eligible:true})),error:null});}};
  const now=performance.now(),resumed=createHomeFeedController(client,h.seed,h.cache,()=>{},async rows=>rows,memory),elapsed=performance.now()-now;
  assert.equal(resumed.getSnapshot().mode,'trending');assert.equal(resumed.getSnapshot().rows[0].post_id,'trend-0');assert.equal(resumed.getSnapshot().scrollRestore.top,875);
  assert.equal(resumed.getSnapshot().loading,false);assert.ok(elapsed<100,'resolved state is synchronous without a timer or network wait');
  const states=[];resumed.subscribe(()=>states.push(resumed.getSnapshot()));const pending=resumed.start();await tick();assert.ok(states.every(state=>state.rows.length===20&&!state.loading));
  gate.resolve({data:memory.tab.rows,error:null});await pending;await tick();await resumed.load(true);
  assert.equal(requests.find(call=>call.args.p_cursor_id)?.args.p_cursor_id,'trend-19');
  resumed.setMode('for_you');assert.equal(resumed.getSnapshot().rows[0].post_id,'home-0');assert.equal(resumed.getSnapshot().scrollRestore.top,420);resumed.dispose();
});

test('restored feed refresh failure keeps cached content and an old owner memory cannot seed a new account', async()=>{
  const h=harness([row('known')]),memory=h.controller.remember(450);h.controller.dispose();
  const offline={rpc:async()=>({data:null,error:{message:'offline'}})};
  const restored=createHomeFeedController(offline,h.seed,h.cache,()=>{},async rows=>rows,memory);await restored.start();await tick();
  assert.equal(restored.getSnapshot().rows[0].post_id,'known');assert.equal(restored.getSnapshot().loading,false);assert.ok(restored.getSnapshot().error);restored.dispose();
  const next=createHomeFeedController(offline,{...h.seed,owner:'bob',rows:[row('bob')]},h.cache,()=>{},async rows=>rows,memory);
  assert.deepEqual(Array.from(next.getSnapshot().rows,r=>r.post_id),['bob']);assert.equal(next.getSnapshot().scrollRestore,null);next.dispose();
});
