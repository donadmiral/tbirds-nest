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


const source = fs.readFileSync(path.join(__dirname, '../src/screens/feed/FeedScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('FeedScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === '[mutedWords, setMutedWords]') {
    callbacks.mutedInitial = node.initializer.arguments[0];
  }
  if (ts.isVariableDeclaration(node) && ['loadFeed', 'loadMore'].includes(node.name.getText(ast))) {
    callbacks[node.name.getText(ast)] = node.initializer.arguments[0];
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[0]?.getText(ast).includes("supabase.channel('feed_live')")) {
    callbacks.realtime = node.arguments[0];
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[0]?.getText(ast).includes("select('muted_words')")) callbacks.mutedRefresh = node.arguments[0];
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

function harness({ previewRows = [], heldTable = null, rpc } = {}) {
  const requests = [], handlers = new Map(), errors = [];
  let currentUser = 'viewer-a', previewState = {}, pendingResolve, pendingCount = 0, loading = true;
  let postState = [{ id: 'shown', user_id: 'author', comments_count: 4800, likes_count: 0 }];
  const feedRows = [{ post_id: 'shown', author_id: 'author', comments_count: 4800, likes_count: 0, sort_key: 1 }];
  const scope = {
    console: { log: (...args) => errors.push(args) }, setTimeout, clearTimeout,
    userId: 'viewer-a', posts: postState, profilesMap: {}, PAGE_SIZE: 20,
    postsRef: { current: postState }, realtimeTimerRef: { current: null },
    feedRequestRef: { current: 0 }, feedRefreshRequestRef: { current: null }, resolvedFeedRequestRef: { current: 0 }, pageRequestRef: { current: 0 },
    feedScopeRef: { current: 'viewer-a:latest:all' }, discoverCatRef: { current: 'all' },
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
    mapFeedRow: row => ({ ...row, id: row.post_id, user_id: row.author_id }),
    hydratePostMedia: async rows => rows, renewFeedMedia,
    hydrateShares() {}, hydrateCollabs() {}, hydratePolls() {}, scorePost: () => 0,
    setLoading(value) { loading = value; }, setVisibleFeedScope() {}, setRefreshing() {}, setLoadingMore() {}, setFeedError(error) { if (error) errors.push(error); },
    setProfilesMap() {}, setLikedPosts() {}, setBookmarkedPosts() {}, setRepostedPosts() {},
    setLikerNames() {}, setQuotedMap() {}, setWtfSuggestions() {},
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
            if (table === heldTable) return new Promise(done => { pendingResolve = done; }).then(resolve, reject);
            const data = table === 'post_comments'
              ? (request.single ? previewRows[0] ?? null : previewRows)
              : table === 'profiles' && request.single ? { full_name: 'Comment author' } : [];
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
  return {
    scope, requests, handlers, errors,
    get posts() { return postState; }, get previews() { return previewState; },
    get pendingCount() { return pendingCount; }, get loading() { return loading; },
    switchAccount() { currentUser = 'viewer-b'; },
    removePost() { scope.postsRef.current = []; },
    resolvePending(data) { assert.ok(pendingResolve); pendingResolve({ data, error: null }); },
  };
}
const comment = (postId = 'shown') => ({ post_id: postId, user_id: 'commenter', body: 'Synthetic comment', likes_count: 1 });

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
