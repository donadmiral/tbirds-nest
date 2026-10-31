const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const { createFixture } = require('../native/audit/backend-fixture.cjs');
const ORIGIN = 'https://uaulhuelcfkjwojtymmw.supabase.co';
const OWNER = '10000000-0000-4000-8000-000000000001';
const PEER = '10000000-0000-4000-8000-000000000002';
const STORY = '40000000-0000-4000-8000-000000000001';
const LISTING = '70000000-0000-4000-8000-000000000001';
const POST = '20000000-0000-4000-8000-000000000001';
const source = file => fs.readFileSync(path.resolve(file), 'utf8');
const compile = (code, fileName = 'probe.tsx') => ts.transpileModule(code, {
  fileName, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const treeText = node => node == null ? '' : Array.isArray(node) ? node.map(treeText).join(' ')
  : typeof node === 'object' ? treeText(node.props?.children) : String(node);

async function signed(id, failReads = false) {
  const fixture = createFixture();
  const sdk = createClient(ORIGIN, 'synthetic-no-provider-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => {
      if (failReads && /\/rpc\/(get_story_poll|get_market_orders)$/.test(String(input))) {
        return Promise.resolve(new Response(JSON.stringify({ code: '42501', message: 'Controlled denied read' }), { status: 403, headers: { 'content-type': 'application/json' } }));
      }
      return fixture.fetch(input, init);
    } },
  });
  const auth = await sdk.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  assert.equal(auth.error, null); fixture.selectAuditCase(id, 'baseline');
  return { fixture, sdk };
}

function storyPollReader(sdk) {
  const file = 'src/services/storiesService.ts', code = source(file);
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'getStoryPoll') found.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(found.length, 1);
  return vm.runInNewContext(compile(`({${found[0]}})`), { supabase: sdk, console: { log() {} } }).getStoryPoll;
}
function pollVotersTitle(poll) {
  const file = 'src/screens/stories/StoryViewerScreen.tsx', code = source(file);
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), matches = [];
  function visit(node) {
    if (ts.isJsxExpression(node) && node.expression && node.expression.getText(ast).startsWith('poll?.options.find(')) matches.push(node.expression.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(matches.length, 1);
  return vm.runInNewContext(compile(`(${matches[0]})`), { poll, pollVotersOptionId: null });
}

// Execute the whole production MarketOrderPanel. Native hosts, React's hook
// scheduler and the current auth store are controlled; RPC transport is the
// actual installed SDK and the actual audit fixture. No live payment callback
// is invoked and no child native component is mounted.
function orderPanel(sdk) {
  const slots = [], effects = [], cache = new Map();
  let cursor = 0, dirty = false, tree;
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'Fragment',
    useState(value) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof value === 'function' ? value() : value };
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }];
    },
    useRef(value) { const i = cursor++; if (!slots[i]) slots[i] = { current: value }; return slots[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { deps, fn }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) {
      const previous = slots[i]; slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
    } },
  };
  const theme = { ink: { primary: '#000', secondary: '#555' }, surface: { raised: '#ddd', canvas: '#eee' }, status: { danger: '#f00' } };
  const auth = selector => selector({ session: { user: { id: OWNER } } }); auth.getState = () => ({ session: { user: { id: OWNER } } });
  function load(file) {
    file = path.resolve(file); if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} }; cache.set(file, mod.exports);
    const requireFor = name => {
      if (name === 'react') return { ...react, default: react };
      if (name === 'react-native') return { ...Object.fromEntries(['ActivityIndicator', 'Modal', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map(key => [key, key])), Alert: { alert() { throw new Error('No commerce action authorized by this read test'); } } };
      if (name === 'react-native-get-random-values') return {};
      if (name.endsWith('/stores/authStore')) return { useAuthStore: auth };
      if (name.endsWith('/services/supabase')) return { supabase: sdk };
      if (name.endsWith('/theme/useTheme')) return { useTheme() {}, themedSheet: factory => factory(theme) };
      if (name.endsWith('/SendMoneySheet')) return { default: 'SendMoneySheet' };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
      throw new Error('Unexpected module in focused order panel: ' + name);
    };
    new Function('require', 'module', 'exports', compile(source(file), file))(requireFor, mod, mod.exports);
    return mod.exports;
  }
  const Component = load('src/components/market/MarketOrderPanel.tsx').default;
  const render = () => { cursor = 0; dirty = false; tree = Component({ listing: { id: LISTING, seller_id: PEER, status: 'available', currency: 'USD' } }); while (effects.length) effects.shift()(); };
  return {
    async flush() { render(); for (let i = 0; i < 12; i++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) render(); } return tree; },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('actual Story service and viewer title accept the SQL null result for a story with no poll', async () => {
  const { sdk, fixture } = await signed('stories-storyviewer');
  const poll = await storyPollReader(sdk)(STORY);
  assert.equal(pollVotersTitle(poll), 'Voters');
  assert.equal(poll, null);
  assert.deepEqual(fixture.receipt.unhandled, []);
  assert.deepEqual(fixture.receipt.audit.diagnostics, []);
});

for (const id of ['market-listingdetail', 'market-offer-cancel']) test(`actual MarketOrderPanel renders the SQL empty page in ${id}`, async () => {
  const { sdk, fixture } = await signed(id); const h = orderPanel(sdk);
  try {
    const tree = await h.flush();
    assert.match(treeText(tree), /No orders yet\./);
    assert.match(treeText(tree), /Request order/);
    assert.deepEqual(fixture.receipt.unhandled, []);
    assert.deepEqual(fixture.receipt.audit.diagnostics, []);
  } finally { h.dispose(); }
});

test('the original array fixture reproduces the exact retained StoryViewer and order-panel exceptions', async () => {
  assert.throws(() => pollVotersTitle([]), /find/);
  const sdk = { rpc: () => Promise.resolve({ data: [], error: null }) };
  const h = orderPanel(sdk);
  try { await assert.rejects(h.flush(), /length/); } finally { h.dispose(); }
});

test('new object/null reads keep exact case/argument guards and do not authorize commerce mutations', async () => {
  for (const [id, name, args] of [
    ['stories-storyviewer', 'get_story_poll', { p_story_id: STORY }],
    ['market-listingdetail', 'get_market_orders', { p_listing_id: LISTING, p_before: null, p_before_id: null, p_limit: 20 }],
  ]) {
    const { sdk } = await signed(id);
    assert.equal((await sdk.rpc(name, { ...args, p_extra: true })).status, 501);
    assert.equal((await sdk.rpc(name, { ...args, [name === 'get_story_poll' ? 'p_story_id' : 'p_listing_id']: OWNER })).status, 501);
    assert.equal((await sdk.rpc(name, args, { get: true })).status, 501);
    assert.equal((await sdk.rpc('create_market_order', { p_expected_user: OWNER, p_listing_id: LISTING })).status, 501);
  }
});

test('actual denied poll and order reads remain errors rather than empty successful state', async () => {
  const story = await signed('stories-storyviewer', true);
  await assert.rejects(storyPollReader(story.sdk)(STORY), error => error.code === '42501');
  const market = await signed('market-listingdetail', true); const h = orderPanel(market.sdk);
  try {
    const text = treeText(await h.flush());
    assert.match(text, /Could not update the order/);
    assert.doesNotMatch(text, /No orders yet/);
  } finally { h.dispose(); }
});

function loadPure(file) {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compile(source(file), file))(() => { throw new Error('Unexpected dependency in pure client helper'); }, mod, mod.exports);
  return mod.exports;
}
function actualCallback(file, name, values, updates) {
  const code = source(file), ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), found = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found.push(node.initializer.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(found.length, 1);
  const setters = Object.fromEntries([...new Set([...found[0].matchAll(/\b(set[A-Z]\w*)\(/g)].map(match => match[1]))]
    .map(key => [key, value => { updates[key] = typeof value === 'function' ? value(updates[key]) : value; }]));
  return vm.runInNewContext(compile(`(${found[0]})`), { useCallback: fn => fn, ...setters, ...values });
}

test('actual newly reachable Post and Comments load callbacks complete every unconditional read without a hidden501', async () => {
  const { sdk, fixture } = await signed('feed-post');
  const updates = {}, order = loadPure('shared/orderRequest.ts'), media = loadPure('shared/contentMedia.ts');
  const post = actualCallback('src/screens/feed/PostScreen.tsx', 'load', {
    postId: POST, userId: OWNER, supabase: sdk, loadEpoch: { current: 0 }, identityRef: { current: { postId: POST, userId: OWNER } },
    bounded: work => order.orderTimeout(work, 15000, 'Post read failed'),
    hydratePostMedia: rows => media.hydrateContentMedia(sdk, ORIGIN, rows, 'post'),
  }, updates);
  await post();
  assert.equal(updates.setPost.id, POST); assert.equal(updates.setPost.author.full_name, 'Jordan Ellis');
  assert.equal(updates.setLoadError, null); assert.equal(updates.setLoading, false);
  const comments = actualCallback('src/components/feed/CommentsPanel.tsx', 'load', {
    postId: POST, userId: OWNER, postAuthorId: PEER, supabase: sdk,
    loadRevision: { current: 0 }, activeScope: { current: { key: POST + ':' + OWNER, generation: 1 } },
    onCountRef: { current: count => { updates.count = count; } },
    loadCommentHighlights: loadPure('shared/commentHighlights.ts').loadCommentHighlights,
  }, updates);
  await comments();
  for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates.setCanComment, true); assert.equal(updates.setLoaded, true); assert.equal(updates.count, 0);
  assert.equal(updates.setPinnedId, null); assert.equal(updates.setLoadError, null);
  assert.deepEqual(Array.from(updates.setItems), []);
  assert.deepEqual(fixture.receipt.unhandled, []);
  assert.deepEqual(fixture.receipt.audit.diagnostics, []);
});

test('actual Search success callback finishes all verticals and analytics with the scripted peer and no hidden501', async () => {
  const { sdk, fixture } = await signed('feed-search-controls'); const updates = {};
  const media = loadPure('shared/contentMedia.ts');
  const scope = OWNER + ':qa_jordan:top';
  const search = actualCallback('src/screens/feed/SearchScreen.tsx', 'runSearch', {
    myId: OWNER, postMode: 'top', supabase: sdk, identity: { current: 'login-a' }, request: { current: 0 },
    mounted: { current: true }, searchScope: { current: scope },
    profileRead: loadPure('src/utils/profileRead.ts').profileRead,
    withoutPrivateMedia: rows => media.replaceContentMedia(rows, ORIGIN, new Map()),
    hydratePostMedia: rows => media.hydrateContentMedia(sdk, ORIGIN, rows, 'post'),
    normalizeProfilePost() { throw new Error('No seeded post matches the scripted peer search'); },
  }, updates);
  await search('qa_jordan');
  for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates.setPeople[0].full_name, 'Jordan Ellis');
  for (const key of ['setJobs', 'setListings', 'setPosts']) assert.equal(updates[key].length, 0);
  assert.equal(Object.keys(updates.setErrors).length, 0); assert.equal(updates.setLoading, false);
  assert.equal(updates.setVisibleScope, scope); assert.equal(fixture.receipt.audit.searchEvents.length, 1);
  assert.deepEqual(fixture.receipt.unhandled, []);
});

test('comment permission and optional pin reads reject unrelated posts, fields, cases and pin writes', async () => {
  const { sdk } = await signed('feed-post');
  assert.equal((await sdk.rpc('can_comment', { p_post_id: OWNER })).status, 501);
  assert.equal((await sdk.rpc('can_comment', { p_post_id: POST, p_extra: true })).status, 501);
  assert.equal((await sdk.from('post_comment_pins').select('*').eq('post_id', POST)).status, 501);
  assert.equal((await sdk.from('post_comment_pins').select('comment_id').eq('post_id', OWNER)).status, 501);
  assert.equal((await sdk.from('post_comment_pins').insert({ post_id: POST, comment_id: OWNER })).status, 501);
  const other = await signed('feed-search-controls');
  assert.equal((await other.sdk.rpc('can_comment', { p_post_id: POST })).status, 501);
  assert.equal((await other.sdk.from('post_comment_pins').select('comment_id').eq('post_id', POST)).status, 501);
});
