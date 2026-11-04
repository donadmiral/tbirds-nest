const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the production callbacks with synthetic rows and a recording transport.
// No native runtime, hosted database, credentials or real events are required.
const sharedModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared/feedSnapshot.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, { exports: sharedModule.exports, module: sharedModule });
const { mergeFeedRefresh } = sharedModule.exports;
const mediaModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared/feedMedia.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, { exports: mediaModule.exports, module: mediaModule, setTimeout, clearTimeout });
const { renewFeedMedia } = mediaModule.exports;
const liveMergeModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared/feedLiveMerge.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, { exports: liveMergeModule.exports, module: liveMergeModule });
const { feedSnapshotFresh, mergeNativeFeedLive } = liveMergeModule.exports;
const previewModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared/sharedPostPreview.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, { exports: previewModule.exports, module: previewModule });
const historyModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared/sessionHistory.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: historyModule.exports, module: historyModule, AbortController });


const source = fs.readFileSync(path.join(__dirname, '../src/screens/feed/FeedScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('FeedScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'mapFeedRow') callbacks.mapFeedRow = node;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === '[mutedWords, setMutedWords]') {
    callbacks.mutedInitial = node.initializer.arguments[0];
  }
  if (ts.isVariableDeclaration(node) && ['loadFeed', 'loadMore', 'commitFeedWindow', 'bindFeedHistory'].includes(node.name.getText(ast))) {
    callbacks[node.name.getText(ast)] = node.initializer.arguments[0];
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'liveFence') callbacks.liveFence = node.initializer;
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[0]?.getText(ast).includes("supabase.channel('feed_live')")) {
    callbacks.realtime = node.arguments[0];
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[0]?.getText(ast).includes("select('muted_words')")) callbacks.mutedRefresh = node.arguments[0];
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[0]?.getText(ast).includes('preparedPageWindow.current')) callbacks.preparePage = node.arguments[0];
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useLayoutEffect'
    && node.arguments[0]?.getText(ast).includes('feedTabs.read')) callbacks.restoreTab = node.arguments[0];
  if (ts.isCallExpression(node) && ['useEffect', 'useLayoutEffect'].includes(node.expression.getText(ast))
    && node.arguments[0]?.getText(ast).includes('value.replaceHot(posts)')) {
    callbacks.syncHistoryPosts = node.arguments[0];
    callbacks.syncHistoryPostsPhase = node.expression.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
function compile(name, scope) {
  assert.ok(callbacks[name], 'Production callback exists: ' + name);
  const code = ts.transpileModule('globalThis.run = ' + callbacks[name].getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, scope);
  return scope.run;
}

function harness({ previewRows = [], quotedRows = [], heldTable = null, rpc } = {}) {
  const requests = [], handlers = new Map(), errors = [];
  let currentUser = 'viewer-a', previewState = {}, quotedState = {}, pendingCount = 0, loading = true;
  const pendingResolvers = [];
  const historyDisk = new Map(); let historyNumber = 0, historyWindow = null, historyFailure = false;
  let postState = [{ id: 'shown', user_id: 'author', comments_count: 4800, likes_count: 0 }];
  const feedRows = [{ post_id: 'shown', author_id: 'author', comments_count: 4800, likes_count: 0, sort_key: 1 }];
  const scope = {
    console: { log: (...args) => errors.push(args) }, setTimeout, clearTimeout,
    userId: 'viewer-a', posts: postState, profilesMap: {}, PAGE_SIZE: 20,
    // These legacy-channel cases exercise the supported capability-off path.
    feedBroadcast: false, screenFocused: true, appActive: true,
    feedLiveDeniedAt: { current: {} }, feedLiveAppliedAt: { current: {} },
    feedStampFloor: { current: -1 }, historyRef: { current: null }, historyReady: { current: false },
    historyAlive: { current: true }, historyStop: { current: null }, historyRects: { current: new Map() },
    setHistoryWindow(value) { historyWindow = value; },
    createNativeSessionHistory: options => historyModule.exports.createSessionHistory({ ...options, namespace: 'feed-fixture-' + historyNumber++,
      storage: { read: async keys => keys.map(key => historyDisk.get(key) ?? null),
        write: async entries => { if (historyFailure) throw Error('device quota'); entries.forEach(([key,value]) => historyDisk.set(key,value)); },
        clear: async prefix => { for (const key of historyDisk.keys()) if (key.startsWith(prefix)) historyDisk.delete(key); } } }),
    interactionChangedAt: { current: {} }, busyKeysRef: { current: {} },
    feedSnapshotFresh, mergeNativeFeedLive,
    postsRef: { current: postState }, realtimeTimerRef: { current: null },
    feedRequestRef: { current: 0 }, feedRefreshRequestRef: { current: null }, resolvedFeedRequestRef: { current: 0 }, pageRequestRef: { current: 0 },
    feedScopeRef: { current: 'viewer-a:latest:all' }, discoverCatRef: { current: 'all' },
    feedMediaScopeRef: { current: null }, navigationScope: () => currentUser + ':session-1',
    retainFeedMedia: (_old, incoming) => incoming,
    discoverPageRef: { current: { asOf: '2026-01-01T00:00:00.000Z', offset: 0 } },
    pendingPostsRef: { current: [] }, restoredSnapshotRef: { current: false }, scrollOffsetRef: { current: 0 },
    reconcileFeedVisibility: async (_account, ids) => new Set(ids),
    savePublicFeedSnapshot: async () => {}, feedSnapshots: { clear: async () => {} },
    mergeFeedRefresh, setPendingPostCount: value => { pendingCount = value; },
    hiddenIdsRef: { current: new Set() }, cursorRef: { current: { key: 2, id: 'old' } },
    hasMoreRef: { current: true }, loadingMoreRef: { current: false },
    feedModeRef: { current: 'latest' }, countCacheRef: { current: {} }, likedPostsRef: { current: {} },
    useAuthStore: { getState: () => ({ profile: { id: currentUser } }) },
    loadFeed: () => Promise.resolve(), scheduleRefresh() {},
    overlayCounts: rows => rows, feedModeToServer: mode => mode, isMutedRef: { current: () => false },
    mapFeedRow: compile('mapFeedRow', { scorePost: () => 0 }),
    hydratePostMedia: async rows => rows, renewFeedMedia,
    sharedPostPreview: previewModule.exports.sharedPostPreview,
    withoutPrivateMedia: rows => rows.map(row => ({ ...row, media_url: null,
      post_media: row.post_media?.map(media => ({ ...media, url: null, edit: { ...media.edit, coverUrl: null } })) })),
    hydrateShares() {}, hydrateCollabs() {}, hydratePolls() {}, scorePost: () => 0,
    setLoading(value) { loading = value; }, setVisibleFeedScope() {}, setRefreshing() {}, setLoadingMore() {}, setFeedError(error) { if (error) errors.push(error); },
    setProfilesMap() {}, setLikedPosts() {}, setBookmarkedPosts() {}, setRepostedPosts() {},
    setLikerNames() {}, setQuotedMap(update) { quotedState = typeof update === 'function' ? update(quotedState) : update; }, setWtfSuggestions() {},
    setPosts(update) { postState = typeof update === 'function' ? update(postState) : update; scope.postsRef.current = postState; },
    setCommentPreviews(update) { previewState = typeof update === 'function' ? update(previewState) : update; },
    supabase: {
      rpc: rpc ?? (async name => { assert.equal(name, 'get_feed'); return { data: feedRows, error: null }; }),
      from(table) {
        const request = { table, single: false };
        requests.push(request);
        const query = {
          select() { return query; }, eq() { return query; }, in() { return query; },
          is() { return query; }, neq() { return query; }, order() { return query; }, limit() { return query; },
          maybeSingle() { request.single = true; return query; },
          then(resolve, reject) {
            if (table === heldTable) return new Promise(done => { pendingResolvers.push(done); }).then(resolve, reject);
            const data = table === 'post_comments'
              ? (request.single ? previewRows[0] ?? null : previewRows)
              : table === 'posts' ? quotedRows : table === 'profiles' && request.single ? { full_name: 'Comment author' } : [];
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          },
        };
        return query;
      },
      channel(name) {
        const channel = {
          on(_kind, filter, handler) { handlers.set(name + ':' + filter.event, handler); return channel; },
          subscribe() { return channel; },
        };
        return channel;
      },
      removeChannel() {},
    },
  };
  scope.liveFence = compile('liveFence', scope);
  scope.bindFeedHistory = compile('bindFeedHistory', scope);
  scope.commitFeedWindow = compile('commitFeedWindow', scope);
  return {
    scope, requests, handlers, errors,
    get posts() { return postState; }, get previews() { return previewState; }, get quoted() { return quotedState; },
    get pendingCount() { return pendingCount; }, get loading() { return loading; },
    get historyWindow() { return historyWindow; }, failHistory(value) { historyFailure = value; },
    switchAccount() { currentUser = 'viewer-b'; },
    removePost() { scope.postsRef.current = []; },
    resolvePending(data) { assert.ok(pendingResolvers.length); pendingResolvers.shift()({ data, error: null }); },
  };
}
const comment = (postId = 'shown') => ({ post_id: postId, user_id: 'commenter', body: 'Synthetic comment', likes_count: 1 });

function retainedFeed() {
  const rows = Array.from({ length: 200 }, (_, n) => ({ post_id: `feed-${n}`, author_id: `author-${n}`, content: `Post ${n}`,
    sort_key: 200 - n, likes_count: 0, comments_count: 0, media: [], viewer_liked: n % 2 === 0 }));
  const denied = new Set(), reads = [];
  const h = harness({ rpc(name, args) {
    let data;
    if (name === 'get_feed') {
      const start = args.p_cursor_id ? rows.findIndex(row => row.post_id === args.p_cursor_id) + 1 : 0;
      data = rows.slice(start, start + args.p_limit);
    } else if (name === 'get_feed_rows_by_ids_v1') {
      reads.push(args.p_ids); data = args.p_ids.map(id => rows.find(row => row.post_id === id)).filter(row => row && !denied.has(row.post_id));
    } else throw Error('Unexpected reader ' + name);
    return Object.assign(Promise.resolve({ data, error: null }), { abortSignal() { return this; } });
  } });
  h.scope.historyReady.current = true;
  const refresh = compile('loadFeed', h.scope), more = compile('loadMore', h.scope);
  const measure = () => { const history = h.scope.historyRef.current; history.getSnapshot().pages.forEach(page => history.measure(page.index, 100)); history.setAnchor(h.posts.at(-1).id); };
  return { h, refresh, more, measure, denied, reads };
}

test('an empty tab render cannot erase a history committed before passive effects flush', async () => {
  const h = harness();
  h.scope.historyReady.current = true;
  h.scope.posts = [];
  h.scope.setPosts([]);
  h.scope.visibleFeedScope = h.scope.feedScopeRef.current;
  const sync = compile('syncHistoryPosts', h.scope);
  const passive = [];
  // Layout effects belong to the committed empty render. A passive effect can
  // remain pending while the asynchronous reader installs its next history.
  if (callbacks.syncHistoryPostsPhase === 'useLayoutEffect') sync();
  else passive.push(sync);
  await compile('loadFeed', h.scope)();
  assert.deepEqual(Array.from(h.posts, row => row.id), ['shown']);
  passive.forEach(effect => effect());
  assert.deepEqual(Array.from(h.posts, row => row.id), ['shown']);
  assert.equal(h.historyWindow.pages.length, 1);
  assert.equal(h.historyWindow.pages[0].rows.length, 1);
  await h.scope.historyRef.current.dispose();
});

test('the committed posts synchronization still updates current rows and removes denied content', async () => {
  const h = harness();
  h.scope.historyReady.current = true;
  await compile('loadFeed', h.scope)();
  h.scope.visibleFeedScope = h.scope.feedScopeRef.current;
  h.scope.posts = h.posts.map(row => ({ ...row, likes_count: 19 }));
  h.scope.setPosts(h.scope.posts);
  const sync = compile('syncHistoryPosts', h.scope);
  sync();
  assert.equal(h.historyWindow.rows[0].likes_count, 19);
  h.scope.posts = [];
  h.scope.setPosts([]);
  sync();
  assert.equal(h.historyWindow.rows.length, 0);
  assert.equal(h.historyWindow.pages[0].rows.length, 0);
  await h.scope.historyRef.current.dispose();
});

test('native feed callbacks bound long reading and reauthorize measured cold pages in original order', async () => {
  const f = retainedFeed(); await f.refresh(); const visited = new Set();
  for (let n = 0; n < 10; n++) {
    f.h.posts.forEach(post => visited.add(post.id)); assert.ok(f.h.posts.length <= 120); f.measure();
    if (n < 9) await f.more();
  }
  assert.equal(visited.size, 200); assert.ok(f.h.historyWindow.before > 0);
  f.denied.add('feed-1'); await f.h.scope.historyRef.current.around(0);
  assert.equal(f.h.posts[0].id, 'feed-0'); assert.ok(!f.h.posts.some(post => post.id === 'feed-1'));
  assert.ok(f.reads.every(ids => ids.length <= 100)); await f.h.scope.historyRef.current.dispose();
});

test('native feed cursor advances only after the measured history ledger accepts its next page', async () => {
  const f = retainedFeed(); await f.refresh(); f.measure();
  const before = f.h.posts, cursor = f.h.scope.cursorRef.current;
  f.h.failHistory(true); await f.more();
  assert.equal(f.h.scope.cursorRef.current, cursor); assert.equal(f.h.posts.length, before.length);
  assert.ok(f.h.posts.every((post, index) => post === before[index])); assert.equal(f.h.scope.loadingMoreRef.current, false);
  f.h.failHistory(false); await f.more(); assert.equal(f.h.posts.at(-1).id, 'feed-39');
  assert.equal(f.h.scope.cursorRef.current.id, 'feed-39'); await f.h.scope.historyRef.current.dispose();
});

test('off-feed comment insert and delete cause no lookups or state changes', async () => {
  const h = harness();
  compile('realtime', h.scope)();
  await h.handlers.get('feed_comments:INSERT')({ new: comment('elsewhere') });
  await h.handlers.get('feed_comments:DELETE')({ old: comment('elsewhere') });
  assert.equal(h.requests.length, 0);
  assert.equal(h.posts[0].comments_count, 4800);
  assert.deepEqual(h.previews, {});
});

test('on-feed top-level insert still updates the preview and count', async () => {
  const h = harness();
  compile('realtime', h.scope)();
  await h.handlers.get('feed_comments:INSERT')({ new: comment() });
  assert.equal(h.requests.length, 1);
  assert.equal(h.posts[0].comments_count, 4801);
  assert.equal(h.previews.shown.authorName, 'Comment author');
});

for (const invalidation of ['cleanup', 'account', 'post']) {
  test('late insert lookup cannot repopulate a preview after ' + invalidation + ' changes', async () => {
    const h = harness({ heldTable: 'profiles' });
    const cleanup = compile('realtime', h.scope)();
    const pending = h.handlers.get('feed_comments:INSERT')({ new: comment() });
    await Promise.resolve();
    if (invalidation === 'cleanup') cleanup();
    if (invalidation === 'account') h.switchAccount();
    if (invalidation === 'post') h.removePost();
    h.resolvePending({ full_name: 'Stale author' });
    await pending;
    assert.deepEqual(h.previews, {});
    const count = h.requests.length;
    await h.handlers.get('feed_comments:DELETE')({ old: comment() });
    assert.equal(h.requests.length, count);
  });
}

test('account change while refreshing a deleted comment prevents a follow-up author query', async () => {
  const h = harness({ heldTable: 'post_comments' });
  compile('realtime', h.scope)();
  const pending = h.handlers.get('feed_comments:DELETE')({ old: comment() });
  await Promise.resolve();
  h.switchAccount();
  h.resolvePending(comment());
  await pending;
  assert.deepEqual(h.requests.map(x => x.table), ['post_comments']);
  assert.deepEqual(h.previews, {});
});

for (const callback of ['loadFeed', 'loadMore']) {
  test(callback + ' preserves server comment totals when preview results are capped', async () => {
    const h = harness({ previewRows: Array.from({ length: 1000 }, () => comment()) });
    // Pagination starts with a different post so the received feed row is appended.
    if (callback === 'loadMore') h.scope.setPosts([{ id: 'older', comments_count: 17 }]);
    await compile(callback, h.scope)();
    assert.equal(h.posts.find(post => post.id === 'shown').comments_count, 4800);
    assert.equal(h.previews.shown.body, 'Synthetic comment');
    assert.deepEqual(h.errors, []);
  });
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const row = (id, count = 0) => ({ post_id: id, author_id: 'author', likes_count: 0, comments_count: count, sort_key: 1 });

test('a late refresh cannot overwrite a newer request', async () => {
  const resolves = [];
  const h = harness({ rpc: () => new Promise(resolve => resolves.push(resolve)) });
  const run = compile('loadFeed', h.scope);
  const old = run(); const recent = run();
  resolves[1]({ data: [row('newest')], error: null }); await recent;
  resolves[0]({ data: [row('obsolete')], error: null }); await old;
  assert.deepEqual(Array.from(h.posts, p => p.id), ['newest']);
});

test('refresh cannot render after an account or feed mode switch', async () => {
  for (const reason of ['account', 'mode']) {
    let resolve;
    const h = harness({ rpc: () => new Promise(done => { resolve = done; }) });
    const pending = compile('loadFeed', h.scope)();
    if (reason === 'account') h.switchAccount();
    else h.scope.feedScopeRef.current = 'viewer-a:trending:all';
    resolve({ data: [row('obsolete')], error: null }); await pending;
    assert.equal(h.posts[0].id, 'shown');
  }
});

test('background refresh updates visible rows without moving them and holds new posts', async () => {
  const h = harness({ rpc: async () => ({ data: [row('new-post'), row('shown', 12)], error: null }) });
  await compile('loadFeed', h.scope)(false, true);
  assert.deepEqual(h.posts.map(p => p.id), ['shown']);
  assert.equal(h.posts[0].comments_count, 12);
  assert.equal(h.pendingCount, 1);
  assert.deepEqual(h.errors, []);
});

test('live rows render and stop loading before comment enrichment completes', async () => {
  const h = harness({ heldTable: 'post_comments' });
  const pending = compile('loadFeed', h.scope)(true);
  await tick();
  assert.equal(h.loading, false);
  assert.equal(h.posts[0].id, 'shown');
  h.resolvePending([]); await pending;
});

test('a late pagination response cannot append into a different feed', async () => {
  let resolve;
  const h = harness({ rpc: () => new Promise(done => { resolve = done; }) });
  const pending = compile('loadMore', h.scope)();
  h.scope.feedScopeRef.current = 'viewer-a:trending:all';
  resolve({ data: [row('obsolete')], error: null }); await pending;
  assert.equal(h.posts.length, 1);
  assert.equal(h.posts[0].id, 'shown');
});

test('off-feed reactions and counts never expand account state', () => {
  const h = harness(); compile('realtime', h.scope)();
  h.handlers.get('feed_likes:INSERT')({ new: { post_id: 'elsewhere', user_id: 'other' } });
  h.handlers.get('feed_post_counts:UPDATE')({ new: { id: 'elsewhere', likes_count: 9000 } });
  assert.equal(h.posts[0].likes_count, 0);
  assert.equal(Object.keys(h.scope.countCacheRef.current).length, 0);
});


test('background reconciliation removes revoked posts while preserving older accessible rows', async () => {
  const h = harness({ rpc: async () => ({ data: [row('new-post')], error: null }) });
  h.scope.setPosts([{ id: 'revoked' }, { id: 'older' }]);
  h.scope.reconcileFeedVisibility = async () => new Set(['older']);
  await compile('loadFeed', h.scope)(false, true);
  assert.deepEqual(Array.from(h.posts, p => p.id), ['older']);
  assert.equal(h.pendingCount, 1);
  assert.deepEqual(h.errors, []);
});
test('paging retains its cursor after a signing failure so retry cannot skip a page', async () => {
  const h = harness(); const oldCursor = h.scope.cursorRef.current;
  h.scope.hydratePostMedia = async () => { throw Error('signer offline'); };
  await compile('loadMore', h.scope)();
  assert.equal(h.scope.cursorRef.current, oldCursor);
  assert.equal(h.scope.hasMoreRef.current, true);
});
test('media refresh renews only missing, expiring or suspicious capabilities and retains order', async () => {
  const now = 1000000, valid = { id: 'valid', _mediaExpiresAt: now + 120000 }, expired = { id: 'old', _mediaExpiresAt: now - 1 };
  const rows = [valid, { id: 'new' }, expired, { id: 'forged', _mediaExpiresAt: now + 9999999 }];
  let requested;
  const refreshed = await renewFeedMedia(rows, async values => { requested = values; return values.map(x => ({ ...x, _mediaExpiresAt: now + 300000 })); }, now);
  assert.deepEqual(Array.from(requested, x => x.id), ['new', 'old', 'forged']);
  assert.equal(refreshed[0], valid); assert.deepEqual(Array.from(refreshed, x => x.id), ['valid','new','old','forged']);
  assert.equal(refreshed[2]._mediaExpiresAt, now + 300000);
});

test('native launch applies the known mute preferences before an optional network refresh completes', async () => {
  const profile = { id: 'alice', muted_words: ['BLOCKED'] };
  const initial = compile('mutedInitial', { profile })();
  assert.deepEqual(Array.from(initial), ['blocked']);
  let words = initial, finish;
  const scope = { userId: 'alice', useAuthStore: { getState: () => ({ profile }) },
    setMutedWords: value => { words = value; },
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => new Promise(resolve => { finish = resolve; }) }) }) }) } };
  const cleanup = compile('mutedRefresh', scope)();
  assert.deepEqual(Array.from(words), ['blocked']);
  finish({ data: null, error: Error('offline') }); await tick();
  assert.deepEqual(Array.from(words), ['blocked']); cleanup();
});


test('Discover pages use one category query and background refresh preserves the continuation anchor', async () => {
  const calls = [];
  const h = harness({ rpc: async (name, args) => {
    calls.push({ name, ...args });
    return { data: Array.from({ length: 20 }, (_, i) => row('discover-' + (args.p_offset + i))), error: null };
  } });
  h.scope.feedModeRef.current = 'discover'; h.scope.discoverCatRef.current = 'videos';
  h.scope.feedScopeRef.current = 'viewer-a:discover:videos';
  const refresh = compile('loadFeed', h.scope), more = compile('loadMore', h.scope);
  await refresh();
  const anchor = h.scope.discoverPageRef.current.asOf;
  assert.equal(h.posts.length, 20); assert.equal(h.scope.discoverPageRef.current.offset, 20);
  await more();
  assert.equal(h.posts.length, 40); assert.equal(h.scope.discoverPageRef.current.offset, 40);
  await refresh(false, true);
  assert.equal(h.posts.length, 40); assert.equal(h.scope.discoverPageRef.current.offset, 40);
  assert.equal(h.scope.discoverPageRef.current.asOf, anchor);
  assert.deepEqual(calls.map(c => [c.name, c.p_video, c.p_category, c.p_limit, c.p_offset, c.p_as_of]), [
    ['get_discover_page', true, null, 20, 0, anchor],
    ['get_discover_page', true, null, 20, 20, anchor],
    ['get_discover_page', true, null, 20, 0, anchor],
  ]);
  assert.deepEqual(h.errors, []);
});

test('Discover signing failure retains raw-page offset and retry advances it only after hydration', async () => {
  const offsets = [];
  const h = harness({ rpc: async (_name, args) => {
    offsets.push(args.p_offset);
    return { data: Array.from({ length: 20 }, (_, i) => row('next-' + i)), error: null };
  } });
  h.scope.feedModeRef.current = 'discover';
  h.scope.discoverPageRef.current.offset = 20;
  h.scope.hydratePostMedia = async () => { throw Error('signer offline'); };
  const more = compile('loadMore', h.scope);
  await more(); assert.equal(h.scope.discoverPageRef.current.offset, 20);
  assert.equal(h.posts.length, 1); assert.ok(h.errors.some(e => typeof e === 'string' && e.includes('Could not load more')));
  h.scope.hydratePostMedia = async rows => rows;
  await more(); assert.equal(h.scope.discoverPageRef.current.offset, 40);
  assert.deepEqual(offsets, [20, 20]); assert.equal(h.posts.length, 21);
});

test('pagination unlocks before enrichment and an older completion cannot unlock a newer page', async () => {
  let calls = 0, secondResponse;
  const h = harness({ heldTable: 'post_comments', rpc: () => {
    calls++;
    return calls === 1
      ? Promise.resolve({ data: Array.from({ length: 20 }, (_, i) => row('page-one-' + i)), error: null })
      : new Promise(resolve => { secondResponse = resolve; });
  } });
  const more = compile('loadMore', h.scope);
  const first = more(); await tick();
  assert.equal(h.posts.length, 21);
  assert.equal(h.scope.loadingMoreRef.current, false);
  const second = more(); await tick();
  assert.equal(calls, 2);
  assert.equal(h.scope.loadingMoreRef.current, true);
  h.resolvePending([]); await first;
  assert.equal(h.scope.loadingMoreRef.current, true);
  secondResponse({ data: [row('page-two')], error: null }); await tick();
  h.resolvePending([]); await second;
  assert.equal(h.posts.length, 22);
  assert.equal(h.scope.loadingMoreRef.current, false);
  assert.deepEqual(h.errors, []);
});

test('pagination retains capability expiry through the actual feed row mapper', async () => {
  const h = harness();
  const expiry = Date.now() + 180_000;
  h.scope.hydratePostMedia = async rows => rows.map(row => ({ ...row, _mediaExpiresAt: expiry }));
  h.scope.setPosts([{ id: 'older' }]);
  await compile('loadMore', h.scope)();
  assert.equal(h.posts.find(post => post.id === 'shown')._mediaExpiresAt, expiry);
});

test('next-page preparation runs before the end, once per visible window, and respects saver/focus/errors', () => {
  let requests = 0;
  const scope = { screenFocused: true, appActive: true, dataSaver: false, loading: false, loadingMore: false,
    feedError: null, search: '', hasMoreRef: { current: true }, feedScopeRef: { current: 'account:latest' },
    loadingMoreRef: { current: false }, feedRefreshRequestRef: { current: null }, feedRequestRef: { current: 1 },
    preparedPageWindow: { current: null }, displayPosts: Array.from({ length: 20 }, (_, i) => ({ id: String(i) })),
    activePostId: '0', loadMore() { requests++; return Promise.resolve(); } };
  const prepare = compile('preparePage', scope);
  prepare(); assert.equal(requests, 0);
  scope.activePostId = '13'; prepare(); assert.equal(requests, 1);
  prepare(); assert.equal(requests, 1);
  scope.activePostId = '14'; scope.feedRefreshRequestRef.current = 1;
  prepare(); assert.equal(requests, 1);
  scope.feedRefreshRequestRef.current = null;
  for (const [key, blocked] of [['dataSaver', true], ['screenFocused', false], ['appActive', false], ['loadingMore', true], ['feedError', 'offline'], ['search', 'searching']]) {
    const prior = scope[key]; scope[key] = blocked; scope.activePostId = '14'; prepare(); scope[key] = prior;
    assert.equal(requests, 1);
  }
  prepare(); assert.equal(requests, 2);
  scope.displayPosts.push(...Array.from({ length: 20 }, (_, i) => ({ id: String(i + 20) })));
  prepare(); assert.equal(requests, 2);
});

test('tab restore restores the rows original media session instead of assigning the previous tab session', () => {
  const h = harness(), cached = new Map();
  cached.set('viewer-a:trending:all', { rows: [{ id: 'old-tab-post' }], mediaScope: 'viewer-a:old-session' });
  Object.assign(h.scope, {
    feedMode: 'trending', discoverCat: 'all', visibleFeedScope: 'viewer-a:latest:all',
    loading: false, feedError: null, likedPosts: {}, bookmarkedPosts: {}, repostedPosts: {},
    feedTabs: { save: (key, value) => cached.set(key, value), read: key => cached.get(key) },
    requestAnimationFrame: fn => fn(), feedListRef: { current: null }, loadFeedRef: { current: null },
  });
  h.scope.feedMediaScopeRef.current = 'viewer-a:new-session';
  h.scope.feedScopeRef.current = 'viewer-a:trending:all';
  compile('restoreTab', h.scope)();
  assert.equal(h.posts[0].id, 'old-tab-post');
  assert.equal(h.scope.feedMediaScopeRef.current, 'viewer-a:old-session');
  assert.equal(cached.get('viewer-a:latest:all').mediaScope, 'viewer-a:new-session');
});

for (const callback of ['loadFeed', 'loadMore']) {
  test(callback + ' shows safe source context while grants load, then the exact source poster', async () => {
    const source = { id: 'original', user_id: 'source-author', content: 'Original caption',
      post_media: [{ url: 'private-original.mp4', media_type: 'video/mp4', edit: { coverUrl: 'private-original.jpg' } }] };
    const h = harness({ quotedRows: [source], rpc: async () => ({ data: [{ ...row('reshare'), quoted_post_id: 'original' }], error: null }) });
    let finish;
    h.scope.hydratePostMedia = rows => rows[0]?.id === 'original'
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(rows);
    const work = compile(callback, h.scope)(); await tick();
    assert.equal(h.quoted.original.content, 'Original caption');
    assert.equal(h.quoted.original.media.media_type, 'video');
    assert.equal(h.quoted.original.media.url, '');
    assert.equal(h.quoted.original.media.thumbnail_url, null);
    finish([{ ...source, post_media: [{ ...source.post_media[0], url: 'authorized-original.mp4', edit: { coverUrl: 'authorized-original.jpg' } }] }]);
    await work;
    assert.equal(h.quoted.original.media.thumbnail_url, 'authorized-original.jpg');
    assert.equal(h.quoted.original.mediaCount, 1);
    assert.deepEqual(h.errors, []);
  });
}


test('restoring a disk snapshot establishes its first cursor without moving the reader', async () => {
  const h = harness({ rpc: async () => ({ data: Array.from({ length: 20 }, (_, i) => row(i ? 'fresh-' + i : 'shown')), error: null }) });
  h.scope.cursorRef.current = null; h.scope.restoredSnapshotRef.current = true;
  h.scope.scrollOffsetRef.current = 240;
  await compile('loadFeed', h.scope)(false, true);
  assert.equal(h.posts[0].id, 'shown'); assert.equal(h.scope.scrollOffsetRef.current, 240);
  assert.equal(h.scope.cursorRef.current.id, 'fresh-19'); assert.equal(h.scope.hasMoreRef.current, true);
  assert.equal(h.scope.restoredSnapshotRef.current, false);
});

test('pagination cannot race a restored-tab refresh and skip its next page', async () => {
  const requests = [];
  const h = harness({ rpc: async (_name, args) => {
    requests.push(args);
    return { data: args.p_cursor_id ? [row('next-page')] : [row('shown')], error: null };
  } });
  let release;
  h.scope.reconcileFeedVisibility = () => new Promise(resolve => { release = resolve; });
  const refresh = compile('loadFeed', h.scope)(false, true); await tick();
  const more = compile('loadMore', h.scope); await more();
  assert.equal(requests.length, 1, 'pagination waits for the retained-page refresh to commit');
  release(new Set(['shown'])); await refresh;
  await more();
  assert.equal(requests.length, 2); assert.equal(requests[1].p_cursor_id, 'old');
  assert.deepEqual(Array.from(h.posts, post => post.id), ['shown', 'next-page']);
  assert.equal(h.scope.cursorRef.current.id, 'next-page');
});


test('a timed-out refresh releases pagination and cannot overwrite a later page', async () => {
  const requests = [], timers = [];
  let finishRefresh;
  const h = harness({ rpc: async (_name, args) => {
    requests.push(args);
    if (!args.p_cursor_id) return new Promise(resolve => { finishRefresh = resolve; });
    return { data: [row('after-timeout')], error: null };
  } });
  h.scope.setTimeout = callback => { timers.push(callback); return timers.length; };
  h.scope.clearTimeout = () => {};
  const refresh = compile('loadFeed', h.scope)(false, true);
  timers[0]();
  await compile('loadMore', h.scope)();
  assert.equal(requests.length, 2);
  finishRefresh({ data: [row('obsolete-refresh')], error: null }); await refresh;
  assert.deepEqual(Array.from(h.posts, post => post.id), ['shown', 'after-timeout']);
  assert.equal(h.scope.cursorRef.current.id, 'after-timeout');
  assert.equal(h.scope.feedRefreshRequestRef.current, null);
});
