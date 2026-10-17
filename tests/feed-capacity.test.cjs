const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the production callbacks with synthetic rows and a recording transport.
// No native runtime, hosted database, credentials or real events are required.
const source = fs.readFileSync(path.join(__dirname, '../src/screens/feed/FeedScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('FeedScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['loadFeed', 'loadMore'].includes(node.name.getText(ast))) {
    callbacks[node.name.getText(ast)] = node.initializer.arguments[0];
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[0]?.getText(ast).includes("supabase.channel('feed_live')")) {
    callbacks.realtime = node.arguments[0];
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

function harness({ previewRows = [], heldTable = null } = {}) {
  const requests = [], handlers = new Map(), errors = [];
  let currentUser = 'viewer-a', previewState = {}, pendingResolve;
  let postState = [{ id: 'shown', user_id: 'author', comments_count: 4800, likes_count: 0 }];
  const feedRows = [{ post_id: 'shown', author_id: 'author', comments_count: 4800, likes_count: 0, sort_key: 1 }];
  const scope = {
    console: { log: (...args) => errors.push(args) }, setTimeout, clearTimeout,
    userId: 'viewer-a', posts: postState, profilesMap: {}, PAGE_SIZE: 20,
    postsRef: { current: postState }, realtimeTimerRef: { current: null },
    hiddenIdsRef: { current: new Set() }, cursorRef: { current: { key: 2, id: 'old' } },
    hasMoreRef: { current: true }, loadingMoreRef: { current: false },
    feedModeRef: { current: 'latest' }, countCacheRef: { current: {} }, likedPostsRef: { current: {} },
    useAuthStore: { getState: () => ({ profile: { id: currentUser } }) },
    loadFeed: () => Promise.resolve(), scheduleRefresh() {},
    overlayCounts: rows => rows, feedModeToServer: mode => mode, isMuted: () => false,
    mapFeedRow: row => ({ ...row, id: row.post_id, user_id: row.author_id }),
    hydrateShares() {}, hydrateCollabs() {}, hydratePolls() {}, scorePost: () => 0,
    setLoading() {}, setRefreshing() {}, setLoadingMore() {}, setFeedError(error) { if (error) errors.push(error); },
    setProfilesMap() {}, setLikedPosts() {}, setBookmarkedPosts() {}, setRepostedPosts() {},
    setLikerNames() {}, setQuotedMap() {}, setWtfSuggestions() {},
    setPosts(update) { postState = typeof update === 'function' ? update(postState) : update; scope.postsRef.current = postState; },
    setCommentPreviews(update) { previewState = typeof update === 'function' ? update(previewState) : update; },
    supabase: {
      rpc: async name => { assert.equal(name, 'get_feed'); return { data: feedRows, error: null }; },
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
