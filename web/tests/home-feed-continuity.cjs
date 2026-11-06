const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
// Use the installed matching React/reconciler pair for an actual mutation
// renderer. No browser, generated markup comparison, or copied list renderer.
const runtimeRequire = createRequire(path.join(root, 'package.json'));
const React = runtimeRequire('react');
const Reconciler = runtimeRequire('react-reconciler');
const { DefaultEventPriority } = runtimeRequire('react-reconciler/constants');
const source = fs.readFileSync(path.join(root, 'web/components/HomeFeed.tsx'), 'utf8');
const ast = ts.createSourceFile('HomeFeed.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let result;
  const visit = node => { if (predicate(node)) result = node; ts.forEachChild(node, visit); };
  visit(ast); assert.ok(result, 'Expected actual HomeFeed implementation'); return result;
}
const pageSource = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'FeedHistoryPage').getText(ast);
const listSource = find(node => ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
  ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'data-feed-content')).getText(ast);
const compile = (source, fileName = 'fixture.tsx') => ts.transpileModule(source, { fileName, compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
function load(file, overrides = {}) {
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, file), 'utf8'), file), { module, exports: module.exports,
    require: name => overrides[name] ?? runtimeRequire(name), AbortController, performance, setTimeout, clearTimeout, queueMicrotask,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' } } });
  return module.exports;
}
const { createSessionHistory, HISTORY_PAGE_ROWS } = load('shared/sessionHistory.ts');
const { isMarketplacePost, MARKETPLACE_SHELF_AFTER } = load('shared/marketplaceRecommendations.ts');
const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
function hostRenderer() {
  const container = { children: [] }, errors = [], context = {};
  let priority = 0;
  const append = (parent, child) => { const old = parent.children.indexOf(child); if (old >= 0) parent.children.splice(old, 1); parent.children.push(child); };
  const remove = (parent, child) => { parent.children.splice(parent.children.indexOf(child), 1); };
  const insert = (parent, child, before) => { const old = parent.children.indexOf(child); if (old >= 0) parent.children.splice(old, 1); parent.children.splice(parent.children.indexOf(before), 0, child); };
  const renderer = Reconciler({
    supportsMutation: true, supportsPersistence: false, supportsHydration: false, isPrimaryRenderer: true,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit() {}, preparePortalMount() {},
    createInstance(type, props) {
      const node = { type, props, children: [] };
      node.getBoundingClientRect = () => ({ height: walk(node).filter(child => child.type === 'img').length * 100 });
      return node;
    },
    createTextInstance: text => ({ type: 'text', text, children: [] }),
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
const rows = count => Array.from({ length: count }, (_, index) => ({ post_id: `post-${index}`, author_id: 'author',
  media: [{ id: `image-${index}`, url: `https://media.example/${index}.jpg`, width: 1200, height: 900 }] }));
function fixture(posts = rows(14)) {
  const host = hostRenderer(), mounts = new Map(), unmounts = new Map(), measured = [];
  let history = null;
  function Card({ post }) {
    React.useLayoutEffect(() => {
      mounts.set(post.post_id, (mounts.get(post.post_id) ?? 0) + 1);
      return () => unmounts.set(post.post_id, (unmounts.get(post.post_id) ?? 0) + 1);
    }, []);
    return React.createElement('img', { id: post.post_id, src: post.media[0].url, width: 1200, height: 900 });
  }
  const context = vm.createContext({ require: runtimeRequire, exports: {}, useRef: React.useRef, useLayoutEffect: React.useLayoutEffect,
    ResizeObserver: class { observe() {} disconnect() {} }, HISTORY_PAGE_ROWS, isMarketplacePost, MARKETPLACE_SHELF_AFTER,
    posts, state: { history: null, historyEpoch: 0 }, mode: 'for_you', promos: [{ post_id: 'sponsored' }], marketplaceItems: [],
    FeedPostCard: React.memo(Card), SponsoredCard: () => React.createElement('aside'), MarketplaceShelf: () => React.createElement('aside'),
    listRef: { current: null }, observeSeen() {}, controller: { measurePage(index, height) { measured.push([index, height]); history?.measure(index, height); } },
  });
  const renderSource = compile(`${pageSource}\nfunction RenderFeed() { return (${listSource}); }`);
  vm.runInContext(renderSource, context);
  return { context, host, mounts, unmounts, measured,
    images: () => walk(host.container).filter(node => node.type === 'img'),
    pages: () => walk(host.container).filter(node => node.props?.['data-history-page'] !== undefined),
    render() { host.render(React.createElement(context.RenderFeed)); },
    async promote(allowed = context.posts) {
      const disk = new Map(), previous = history;
      history = createSessionHistory({ namespace: 'web-continuity', id: row => row.post_id, current: () => true, fetch: async () => [], storage: {
        read: async keys => keys.map(key => disk.get(key) ?? null), write: async entries => entries.forEach(([key, value]) => disk.set(key, value)), clear: async () => disk.clear(),
      } });
      await history.append(allowed.map(row => ({ ...row })));
      context.posts = history.getSnapshot().rows;
      context.state = { history: history.getSnapshot(), historyEpoch: context.state.historyEpoch + 1 };
      this.render(); await previous?.dispose(); return history;
    },
    async dispose() { host.render(null); await history?.dispose(); },
  };
}

test('the first cached web image and its parents remain mounted when optional history activates', async () => {
  const h = fixture(rows(1)); h.render();
  const image = h.images()[0], page = h.pages()[0], history = await h.promote();
  assert.equal(h.images()[0], image); assert.equal(h.pages()[0], page);
  assert.equal(h.mounts.get('post-0'), 1); assert.equal(h.unmounts.size, 0);
  assert.equal(history.getSnapshot().pages[0].height, 100, 'Activation remeasures the existing parent for eviction geometry');
  await h.dispose();
});

test('all five-row web groups preserve image nodes through delayed history and ledger replacement', async () => {
  const h = fixture(); h.render();
  const images = h.images(), pages = h.pages();
  assert.deepEqual(pages.map(page => walk(page).filter(node => node.type === 'img').length), [5, 5, 4]);
  h.render(); assert.deepEqual(h.images(), images, 'Waiting or failed readiness changes no parent identity');
  const first = await h.promote();
  h.images().forEach((image, index) => assert.equal(image, images[index]));
  h.pages().forEach((page, index) => assert.equal(page, pages[index]));
  assert.deepEqual(Array.from(first.getSnapshot().pages, page => page.height), [500, 500, 400]);
  const second = await h.promote();
  h.images().forEach((image, index) => assert.equal(image, images[index]));
  assert.deepEqual(Array.from(second.getSnapshot().pages, page => page.height), [500, 500, 400]);
  assert.equal(h.unmounts.size, 0); assert.ok([...h.mounts.values()].every(count => count === 1)); await h.dispose();
});

test('a restored ledger remeasures its existing image parents after rebinding the disposed controller', async () => {
  const { createHomeFeedController } = load('web/lib/homeFeedController.ts', {
    '../../shared/feedSnapshot': load('shared/feedSnapshot.ts'), '../../shared/feedTabCache': load('shared/feedTabCache.ts'),
    '../../shared/contentMedia': load('shared/contentMedia.ts'), '../../shared/marketplaceRecommendations': { isMarketplacePost },
  });
  const posts = rows(7), seed = { owner: 'alice', rows: posts, mutedWords: [], error: null };
  let resolveLive;
  const live = new Promise(resolve => { resolveLive = resolve; });
  const client = { rpc: (name, args) => name === 'get_feed' ? live : Promise.resolve({
    data: args.p_ids.map(post_id => ({ post_id, snapshot_eligible: true })), error: null,
  }) };
  const snapshots = { setAccount() {}, revision: () => 0, read: async () => null, write: async () => {}, clear: async () => {} };
  const factory = options => {
    const disk = new Map();
    return createSessionHistory({ ...options, namespace: 'restored-web', storage: {
      read: async keys => keys.map(key => disk.get(key) ?? null), write: async entries => entries.forEach(([key, value]) => disk.set(key, value)), clear: async () => disk.clear(),
    } });
  };
  const previous = createHomeFeedController(client, seed, snapshots, undefined, undefined, null, undefined, factory);
  await previous.start(); previous.measurePage(0, 400); previous.measurePage(1, 160);
  const memory = previous.remember(200), ledger = memory.tab.history; previous.dispose();
  const resumed = createHomeFeedController(client, { ...seed, rows: [], pending: true, preferencesReady: false }, snapshots,
    undefined, undefined, memory, undefined, factory, async () => []);
  const h = fixture(resumed.getSnapshot().rows);
  h.context.controller = resumed; h.context.state = resumed.getSnapshot(); h.render();
  const images = h.images(), pages = h.pages();
  assert.deepEqual(Array.from(ledger.getSnapshot().pages, page => page.height), [400, 160], 'The first child layout runs while the old controller is disposed');
  const starting = resumed.start();
  h.context.state = resumed.getSnapshot(); h.context.posts = h.context.state.rows; h.render();
  assert.equal(h.context.state.historyEpoch, 1, 'The first live binding remeasures even when ledger identity is unchanged');
  assert.deepEqual(Array.from(ledger.getSnapshot().pages, page => page.height), [500, 200], 'Rebinding measures the current layout without a ResizeObserver notification');
  h.images().forEach((image, index) => assert.equal(image, images[index]));
  h.pages().forEach((page, index) => assert.equal(page, pages[index]));
  assert.equal(h.unmounts.size, 0); assert.ok([...h.mounts.values()].every(count => count === 1));
  resolveLive({ data: posts, error: null }); await starting;
  resumed.dispose(); await h.dispose(); await ledger.dispose();
});

test('continuity does not retain denied posts or cards from an obsolete account or tab', async () => {
  const h = fixture(rows(7)); h.render();
  await h.promote(h.context.posts.filter(row => row.post_id !== 'post-0'));
  assert.equal(h.images().some(image => image.props.id === 'post-0'), false); assert.equal(h.unmounts.get('post-0'), 1);
  h.context.posts = rows(2).map(row => ({ ...row, post_id: 'latest-' + row.post_id }));
  h.context.mode = 'latest'; h.context.state = { history: null, historyEpoch: h.context.state.historyEpoch + 1 }; h.render();
  assert.ok(h.images().every(image => image.props.id.startsWith('latest-')));
  h.context.posts = []; h.render(); assert.equal(h.images().length, 0);
  assert.equal(h.unmounts.get('latest-post-0'), 1); await h.dispose();
});
