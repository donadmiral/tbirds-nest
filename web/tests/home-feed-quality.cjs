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
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require: name => overrides[name] ?? require(name),
    performance, AbortController, Map, Set, Promise, URL, setTimeout, clearTimeout, queueMicrotask, console,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' } } });
  return module.exports;
}
const shared = load('../shared/feedSnapshot.ts');
const { createHomeFeedController, filterMutedFeedRows } = load('lib/homeFeedController.ts', { '../../shared/feedSnapshot': shared });
const row = (id, likes = 0) => ({ post_id: id, author_id: 'author', content: 'Visible content ' + id, created_at: '2026-10-22T12:00:00Z', media: [], products: [], likes_count: likes, sort_key: 100 });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(seedRows = [row('first')]) {
  const calls = [], saved = new Map(), measurements = [];
  let reply = async (_name, args) => ({ data: args.p_ids ? args.p_ids.map(post_id => ({ post_id, snapshot_eligible: true })) : [row('fresh')], error: null });
  const cache = shared.createFeedSnapshotStore({ getItem: async key => saved.get(key) ?? null, setItem: async (key,value) => saved.set(key,value), removeItem: async key => saved.delete(key) });
  const client = { rpc(name,args) { calls.push({name,args}); return reply(name,args); } };
  const seed = { owner: 'alice', rows: seedRows, mutedWords: [], error: null };
  const controller = createHomeFeedController(client, seed, cache, event => measurements.push(event));
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
test('background refresh keeps reading position, holds new posts and removes revoked rows', async () => {
  const h=harness([row('first'),row('older'),row('revoked')]);
  h.setReply(async(name)=>({data:name==='get_feed'?[row('new'),row('first',5)]:['new','first','older'].map(post_id=>({post_id,snapshot_eligible:true})),error:null}));
  await h.controller.load(false,true);
  const s=h.controller.getSnapshot();assert.deepEqual(Array.from(s.rows,r=>r.post_id),['first','older']);assert.equal(s.rows[0].likes_count,5);assert.equal(s.pending,1);h.controller.dispose();
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
test('muted words apply to server rows and hidden posts cannot return after refresh', async () => {
  assert.equal(filterMutedFeedRows([row('hidden'),row('visible')],['hidden']).length,1);
  const h=harness();h.controller.hide('first');h.setReply(async(name,args)=>({data:args.p_ids?[]:[row('first'),row('another')],error:null}));await h.controller.load();
  assert.deepEqual(Array.from(h.controller.getSnapshot().rows,r=>r.post_id),['another']);h.controller.dispose();
});
test('the actual HomeFeed server rendering includes post content before JavaScript hydration', () => {
  const h=harness();const empty=()=>null;
  const overrides={
    '@/lib/homeFeedController':{createHomeFeedController}, '@/lib/contentMedia':{hydratePostMedia:async rows=>rows}, '@/lib/feedCache':{getFeedCache:()=>h.cache}, '../../shared/feedSnapshot':shared, '../../shared/feedMedia':load('../shared/feedMedia.ts'),
    '@/lib/supabase/client':{createClient:()=>h.client}, 'next/navigation':{useRouter:()=>({push(){},refresh(){},replace(){}})},
    '@/components/PostCard':{PostCard:({post})=>React.createElement('article',null,post.content)},
    '@/components/StoryRings':{StoryRings:empty}, '@/components/Composer':{Composer:empty},
    '@/components/AnnouncementBanner':{AnnouncementBanner:empty}, '@/components/SponsoredCard':{SponsoredCard:empty}, '@/lib/ads':{getActivePromos:async()=>[]},
  };
  const {default:HomeFeed}=load('components/HomeFeed.tsx',overrides);
  const html=renderToStaticMarkup(React.createElement(HomeFeed,{seed:h.seed}));
  assert.match(html,/Visible content first/);assert.match(html,/data-feed-content="true"/);
  assert.doesNotMatch(html,/animate-pulse/);
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
