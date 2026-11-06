const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const Reconciler = require('react-reconciler');
const { DefaultEventPriority } = require('react-reconciler/constants');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/screens/feed/FeedScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('FeedScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let result;
  function visit(node) { if (predicate(node)) result = node; ts.forEachChild(node, visit); }
  visit(ast); assert.ok(result, 'Expected actual FeedScreen implementation'); return result;
}
const initializer = name => find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name).initializer;
const callback = name => initializer(name).arguments[0].getText(ast);
function evaluate(code, scope = {}, fileName = 'fixture.tsx') {
  return vm.runInNewContext(ts.transpileModule(code, { fileName, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports: {}, require, ...scope });
}
function load(file) {
  const module = { exports: {} };
  evaluate(fs.readFileSync(path.join(root, file), 'utf8'), { module, exports: module.exports }, file);
  return module.exports;
}
const { feedHistoryPages, FEED_HISTORY_PAGE_ROWS } = load('shared/feedHistoryPages.ts');
const { createSessionHistory } = load('shared/sessionHistory.ts');
const list = find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'TapTopFlatList');
// Exercise the production list identity/data/renderer attributes. Its header,
// network handlers and sheets are unrelated to this reconciliation boundary.
const attributes = new Set(['key', 'data', 'numColumns', 'columnWrapperStyle', 'keyExtractor', 'renderItem',
  'initialNumToRender', 'maxToRenderPerBatch', 'windowSize']);
const listSource = `<TapTopFlatList ${list.attributes.properties.filter(item =>
  ts.isJsxAttribute(item) && attributes.has(item.name.getText(ast))).map(item => item.getText(ast)).join(' ')} />`;
const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
function nativeRenderer() {
  const container = { children: [] }, errors = [], context = {};
  let priority = 0;
  const append = (parent, child) => { const old = parent.children.indexOf(child); if (old >= 0) parent.children.splice(old, 1); parent.children.push(child); };
  const remove = (parent, child) => { parent.children.splice(parent.children.indexOf(child), 1); };
  const insert = (parent, child, before) => { const old = parent.children.indexOf(child); if (old >= 0) parent.children.splice(old, 1); parent.children.splice(parent.children.indexOf(before), 0, child); };
  const renderer = Reconciler({
    supportsMutation: true, supportsPersistence: false, supportsHydration: false, isPrimaryRenderer: true,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit() {}, preparePortalMount() {},
    createInstance: (type, props) => ({ type, props, children: [] }), createTextInstance: text => ({ type: 'text', text, children: [] }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    insertBefore: insert, insertInContainerBefore: insert, removeChild: remove, removeChildFromContainer: remove,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate(node, _type, _previous, props) { node.props = props; }, commitTextUpdate(node, _previous, text) { node.text = text; },
    clearContainer(node) { node.children.length = 0; }, detachDeletedInstance() {},
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority(value) { priority = value; }, resolveUpdatePriority: () => DefaultEventPriority,
    maySuspendCommit: () => false, supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
  });
  const fail = error => errors.push(error);
  const tree = renderer.createContainer(container, 0, null, false, null, '', fail, fail, fail, null);
  return { container, render(element) { renderer.updateContainerSync(element, tree, null, null); renderer.flushSyncWork(); assert.deepEqual(errors, []); } };
}
const ref = current => ({ current });
const rows = count => Array.from({ length: count }, (_, i) => ({ id: `post-${i}`, _rk: `post-${i}`, user_id: 'author', sourceVersion: 'exact-version', uri: `file:///decrypted/${i}.png` }));
function fixture({ mode = 'forYou', posts = rows(14), displayPosts = posts } = {}) {
  const host = nativeRenderer(), mounts = new Map(), unmounts = new Map();
  const scope = {
    React, View: 'View', posts, displayPosts, historyWindow: null, historyItems: [], feedMode: mode, TILE_W: 178, dataSaver: false,
    feedHistoryPages, historyRef: ref(null), historyStop: ref(null), historyAlive: ref(true), postsRef: ref(posts),
    feedScopeRef: ref(`account:${mode}:all`), historyGeometryScope: ref(null), historyMeasureGeneration: ref(0),
    historyPageNodes: ref(new Map()), historyRowNodes: ref(new Map()), historyPageHeights: ref(new Map()), historyRects: ref(new Map()),
    historyHeaderHeight: ref(0), historyViewport: ref(300), scrollOffsetRef: ref(0), promoRowsRef: ref(displayPosts.filter(post => !posts.includes(post))),
    commentsForRef: ref(null), seenSentRef: ref(new Set()), seenPendingRef: ref(new Set()), activePostId: null,
    useAuthStore: { getState: () => ({ profile: { id: 'account' } }) }, navigationScope: () => 'account:session', currentAuthorId: () => 'account',
    setActivePostId(id) { scope.activePostId = id; }, setHistoryMeasureEpoch(value) { scope.epoch = value; },
    setPosts(value) { scope.posts = value; }, setHistoryWindow(value) { scope.historyWindow = value; },
    setProfilesMap() {}, setLikedPosts() {}, setBookmarkedPosts() {}, setRepostedPosts() {}, setFeedError() {},
  };
  function Card({ post }) {
    React.useLayoutEffect(() => {
      mounts.set(post.id, (mounts.get(post.id) ?? 0) + 1);
      return () => unmounts.set(post.id, (unmounts.get(post.id) ?? 0) + 1);
    }, []);
    return React.createElement('Image', { id: post.id, uri: post.uri, version: post.sourceVersion });
  }
  scope.renderPost = ({ item }) => React.createElement(Card, { post: item });
  scope.TapTopFlatList = function List(props) {
    return React.createElement('List', props, props.data.map((item, index) =>
      React.createElement('Cell', { key: props.keyExtractor(item), pageKey: props.keyExtractor(item) }, props.renderItem({ item, index }))));
  };
  // Keep one VM global object so the extracted production closures see updates.
  const context = vm.createContext({ exports: {}, require, ...scope });
  const run = code => {
    const compiled = ts.transpileModule(`const result = (${code});`, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    return vm.runInContext(`(function () { ${compiled}\nreturn result; })()`, context);
  };
  for (const name of ['onViewableItemsChanged', 'bindFeedHistory']) context[name] = run(`(${callback(name)})`);
  function FeedList() {
    Object.assign(context, { posts: scope.posts, displayPosts: scope.displayPosts, historyWindow: scope.historyWindow });
    context.historyItems = run(`(${callback('historyItems')})()`);
    context.reportHistoryVisible = run(`(${callback('reportHistoryVisible')})`);
    context.renderHistoryPage = run(`(${callback('renderHistoryPage')})`);
    return run(`(${listSource})`);
  }
  return { scope, context, mounts, unmounts, host,
    render() { host.render(React.createElement(FeedList)); },
    layout() {
      for (const page of context.historyItems) {
        const cell = walk(host.container).find(node => node.type === 'Cell' && node.props.pageKey === `history:${page.index}`);
        const pageNode = cell.children[0].children[0];
        const grid = mode === 'discover';
        const pageHeight = Math.ceil(page.rows.length / (grid ? 2 : 1)) * 100;
        pageNode.props.onLayout({ nativeEvent: { layout: { height: pageHeight } } });
        pageNode.children.forEach((node, index) => node.props.onLayout({ nativeEvent: { layout: { y: Math.floor(index / (grid ? 2 : 1)) * 100, height: 100 } } }));
      }
    },
    async promote(allowed = posts) {
      const disk = new Map();
      const history = createSessionHistory({ namespace: 'feed-test', id: post => post.id, current: () => true,
        pageRows: FEED_HISTORY_PAGE_ROWS, fetch: async () => [], storage: {
          read: async keys => keys.map(key => disk.get(key) ?? null), write: async entries => entries.forEach(([key, value]) => disk.set(key, value)), clear: async () => disk.clear(),
        } });
      await history.append(allowed.map(post => ({ ...post })));
      context.bindFeedHistory(history);
      scope.displayPosts = scope.displayPosts.filter(post => !posts.some(old => old.id === post.id) || allowed.some(current => current.id === post.id));
      this.render(); return history;
    },
  };
}

test('the one-post cold snapshot keeps its mounted image when reconnect enables history', async () => {
  const h = fixture({ posts: rows(1) }); h.render(); h.layout();
  const image = walk(h.host.container).find(node => node.type === 'Image');
  const history = await h.promote();
  assert.equal(walk(h.host.container).find(node => node.type === 'Image'), image);
  assert.equal(h.mounts.get('post-0'), 1); assert.equal(h.unmounts.size, 0);
  assert.equal(h.scope.activePostId, 'post-0'); await history.dispose();
});

test('cached feed promotion keeps the mounted native image and six-post groups with synthetic rows', async () => {
  const posts = rows(14), promo = { id: 'promotion' }, shelf = { id: '__marketplace' }, suggestions = { id: '__wtf' };
  const displayPosts = [...posts.slice(0, 3), shelf, ...posts.slice(3, 6), promo, ...posts.slice(6, 8), suggestions, ...posts.slice(8)];
  const h = fixture({ posts, displayPosts }); h.render(); h.layout();
  const images = new Map(walk(h.host.container).filter(node => node.type === 'Image').map(node => [node.props.id, node]));
  const originalGroups = Array.from(h.context.historyItems, page => Array.from(page.rows, row => row.id));
  assert.deepEqual(originalGroups, [
    ['post-0', 'post-1', 'post-2', '__marketplace', 'post-3', 'post-4', 'post-5', 'promotion'],
    ['post-6', 'post-7', '__wtf', 'post-8', 'post-9', 'post-10', 'post-11'], ['post-12', 'post-13'],
  ]);
  assert.equal(h.scope.activePostId, 'post-0', 'Cached first-frame visibility selects the playable post without history readiness');
  const rect = h.scope.historyRects.current.get('post-0'), node = h.scope.historyPageNodes.current.get(0);
  const history = await h.promote();
  assert.equal(h.scope.historyRects.current.get('post-0'), rect);
  assert.equal(h.scope.historyPageNodes.current.get(0), node);
  assert.equal(history.getSnapshot().pages[0].height, 800, 'Promotion retains actual geometry, including synthetic rows');
  assert.deepEqual(Array.from(h.context.historyItems, page => Array.from(page.rows, row => row.id)), originalGroups);
  for (const image of walk(h.host.container).filter(node => node.type === 'Image')) assert.equal(image, images.get(image.props.id));
  assert.equal(h.unmounts.size, 0); assert.ok([...h.mounts.values()].every(count => count === 1));
  h.context.reportHistoryVisible(); assert.equal(h.scope.activePostId, 'post-0');
  assert.ok(h.scope.seenPendingRef.current.has('post-0'));
  await history.dispose();
});

test('Discover keeps the same two-column tile positions and page wrappers across promotion', async () => {
  const h = fixture({ mode: 'discover' }); h.render(); h.layout();
  const before = walk(h.host.container).filter(node => node.type === 'Image');
  const groups = Array.from(h.context.historyItems, page => Array.from(page.rows, row => row.id));
  assert.deepEqual(groups.map(group => group.length), [6, 6, 2]);
  const history = await h.promote();
  const after = walk(h.host.container).filter(node => node.type === 'Image');
  before.forEach((image, index) => assert.equal(after[index], image));
  for (const cell of walk(h.host.container).filter(node => node.type === 'Cell')) {
    const page = cell.children[0].children[0];
    assert.equal(page.props.style.flexDirection, 'row'); assert.equal(page.props.style.flexWrap, 'wrap');
    assert.equal(page.props.style.columnGap, 10); assert.equal(page.props.style.paddingHorizontal, 12);
    assert.ok(page.children.every(row => row.props.style.width === 178));
  }
  assert.equal(walk(h.host.container).find(node => node.type === 'List').props.numColumns, 1);
  assert.equal(h.unmounts.size, 0); await history.dispose();
});

test('offline page visibility uses measured preceding-page heights and keeps scope boundaries', () => {
  const h = fixture(); h.render(); h.layout();
  h.scope.scrollOffsetRef.current = 600; h.context.reportHistoryVisible();
  assert.equal(h.scope.activePostId, 'post-6');
  assert.ok(h.scope.seenPendingRef.current.has('post-6'));
  h.scope.feedScopeRef.current = 'other-account:forYou:all';
  h.context.bindFeedHistory(null);
  assert.equal(h.scope.historyRects.current.size, 0); assert.equal(h.scope.historyPageHeights.current.size, 0);
  assert.equal(h.scope.historyPageNodes.current.size, 0); assert.equal(h.scope.historyRowNodes.current.size, 0);
  h.context.reportHistoryVisible(); assert.equal(h.scope.activePostId, null, 'A new scope cannot use the old account visibility');
});

test('a denied post is removed on promotion instead of retained for image continuity', async () => {
  const posts = rows(7), h = fixture({ posts }); h.render(); h.layout();
  const history = await h.promote(posts.filter(post => post.id !== 'post-0'));
  assert.equal(walk(h.host.container).some(node => node.type === 'Image' && node.props.id === 'post-0'), false);
  assert.equal(h.unmounts.get('post-0'), 1); assert.equal(h.scope.historyRects.current.has('post-0'), false);
  await history.dispose();
});
