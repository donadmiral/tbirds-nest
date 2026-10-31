const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(file, overrides = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, file), 'utf8')), {
    module, exports: module.exports, require: name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      throw Error('Unexpected dependency ' + name);
    }, AbortController, performance, setTimeout, clearTimeout, queueMicrotask, ...globals,
  });
  return module.exports;
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const row = id => ({ post_id: id, author_id: 'author', content: id, created_at: '2026-10-30T00:00:00Z', media: [], sort_key: 1 });

function scenario(memory) {
  let now = 0, nextId = 0, cleanup;
  const listeners = new Map(), timers = new Map(), frames = new Map(), scrolls = [], calls = [];
  const dispatch = name => [...(listeners.get(name) ?? [])].forEach(callback => callback({}));
  const events = {
    addEventListener(name, callback) { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
  };
  const document = { ...events, visibilityState: 'visible', documentElement: { scrollHeight: 6000 }, body: { scrollHeight: 6000 } };
  const window = { ...events, location: { href: 'https://qa.example/home' }, innerHeight: 800, scrollX: 0, scrollY: 0,
    scrollTo(options) { scrolls.push(options); this.scrollY = options.top; dispatch('scroll'); } };
  const clock = class extends Date { static now() { return now; } };
  const cache = load('../shared/feedTabCache.ts', {}, { Date: clock });
  const marketplace = load('../shared/marketplaceRecommendations.ts');
  const { createHomeFeedController } = load('lib/homeFeedController.ts', { '../../shared/feedTabCache': cache, '../../shared/marketplaceRecommendations': marketplace });
  let reply = async (name, args) => ({ data: name === 'get_feed_visibility' ? args.p_ids.map(post_id => ({ post_id, snapshot_eligible: true })) : Array.from({ length: 20 }, (_, index) => row(args.p_mode + '-' + index)), error: null });
  const client = { rpc(name, args) { calls.push({ name, args }); return reply(name, args); } };
  const snapshots = { setAccount() {}, revision: () => 0, write: async () => {}, clear: async () => {}, read: async () => null };
  const controller = createHomeFeedController(client, { owner: 'alice', rows: Array.from({ length: 20 }, (_, index) => row('seed-' + index)), mutedWords: [], error: null }, snapshots, undefined, undefined, memory);
  const rootElement = { isConnected: true, dataset: { feedOwner: 'alice', feedMode: 'for_you' } };
  const { restoreHomeFeedScroll } = load('lib/homeFeedScroll.ts', {}, { window, document, performance: { now: () => now },
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  // Execute the actual component's restore effect and click handler, rather
  // than a copied version of the HomeFeed wiring.
  const component = fs.readFileSync(path.join(root, 'components/HomeFeed.tsx'), 'utf8');
  const ast = ts.createSourceFile('HomeFeed.tsx', component, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect, choose;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useLayoutEffect' && node.arguments[0]?.getText(ast).includes('restoreHomeFeedScroll')) effect = node.arguments[0].getText(ast);
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'setMode') choose = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(effect && choose, 'actual mode scroll wiring exists');
  let renderedRequest;
  const commit = renderedMode => {
    const state = controller.getSnapshot();
    rootElement.dataset = { feedOwner: state.owner ?? '', feedMode: renderedMode ?? state.mode };
    if (renderedRequest === state.scrollRestore) return;
    cleanup?.(); renderedRequest = state.scrollRestore;
    const module = { exports: {} };
    vm.runInNewContext(compile('export const effect = ' + effect), { module, exports: module.exports, state, controller, feedRef: { current: rootElement }, restoreHomeFeedScroll });
    cleanup = module.exports.effect();
  };
  const handler = { exports: {} };
  vm.runInNewContext(compile('export const choose = ' + choose), { module: handler, exports: handler.exports, controller, window });
  return {
    controller, window, document, rootElement, timers, frames, scrolls, calls, dispatch, commit,
    choose: handler.exports.choose,
    setReply(fn) { reply = fn; },
    height(value) { document.body.scrollHeight = document.documentElement.scrollHeight = value; },
    frame() { now += 16; for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } },
    advance(ms) { const until = now + ms; let steps = 0; while (true) { const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; assert.ok(++steps < 1000); const [id, timer] = next; now = timer.at; timers.delete(id); timer.callback(); } now = until; },
    listenerCount() { return [...listeners.values()].reduce((count, callbacks) => count + callbacks.size, 0); },
    unmount() { cleanup?.(); controller.dispose(); },
  };
}

test('a first mount leaves route restoration in charge and mode clicks remember each document offset', async () => {
  const h = scenario(); h.window.scrollY = 1400; h.commit(); h.frame();
  assert.deepEqual(h.scrolls, []); assert.equal(h.frames.size, 0);
  h.choose('latest'); await settle(); h.commit(); h.frame();
  assert.equal(h.scrolls.at(-1).top, 0);
  h.window.scrollY = 650; h.choose('for_you'); h.commit(); h.frame();
  assert.equal(h.scrolls.at(-1).top, 1400); assert.equal(h.controller.getSnapshot().rows[0].post_id, 'seed-0');
  await settle(); h.window.scrollY = 1550; h.choose('latest'); h.commit(); h.frame();
  assert.equal(h.scrolls.at(-1).top, 650); assert.equal(h.controller.getSnapshot().rows[0].post_id, 'latest-0');
  assert.equal(h.scrolls.every(call => call.behavior === 'instant'), true);
  await settle(); h.unmount(); assert.equal(h.listenerCount(), 0);
});

test('a warm route with enough retained height restores before the first animation frame', () => {
  const previous = scenario(), memory = previous.controller.remember(780); previous.unmount();
  const h = scenario(memory); assert.equal(h.window.scrollY, 0);
  h.commit();
  assert.equal(h.window.scrollY, 780, 'layout commit must restore the existing page before paint');
  assert.equal(h.scrolls.length, 1); assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.controller.getSnapshot().scrollRestore, null); assert.equal(h.listenerCount(), 0);
  h.frame(); h.advance(1000); assert.equal(h.scrolls.length, 1); h.unmount();
});

test('restoration waits for the correct rendered mode and usable content height, then runs only once', async () => {
  const h = scenario(); h.window.scrollY = 1600; h.choose('latest'); await settle(); h.commit(); h.frame();
  h.choose('for_you'); h.height(1000); h.commit('latest'); h.frame();
  assert.equal(h.scrolls.length, 1);
  h.rootElement.dataset.feedMode = 'for_you'; h.advance(100); assert.equal(h.scrolls.length, 1);
  const stale = [...h.timers.values()][0].callback;
  h.height(4000); h.advance(100); assert.equal(h.scrolls.at(-1).top, 1600); assert.equal(h.scrolls.length, 2);
  stale(); await settle(); await h.controller.load(false, true); await h.controller.load(true); h.commit(); h.advance(2000);
  assert.equal(h.scrolls.length, 2); assert.equal(h.controller.getSnapshot().scrollRestore, null);
  h.unmount();
});

test('an uncached mode never scrolls against the previous mode while its request is pending', async () => {
  const h = scenario(), pending = deferred(); h.setReply(() => pending.promise);
  h.window.scrollY = 900; h.choose('trending'); h.commit(); h.frame(); h.advance(300);
  assert.deepEqual(h.scrolls, []); assert.equal(h.controller.getSnapshot().loading, true);
  h.setReply(async (_name, args) => ({ data: args.p_ids.map(post_id => ({ post_id, snapshot_eligible: true })), error: null }));
  pending.resolve({ data: [row('trend')], error: null }); await settle(); h.commit(); h.advance(100);
  assert.equal(h.scrolls.length, 1); assert.equal(h.scrolls[0].top, 0); h.unmount();
});

test('touch, wheel, keyboard, pointer and later clicks cancel delayed restoration without a late jump', async () => {
  for (const event of ['pointerdown', 'touchstart', 'wheel', 'keydown', 'click']) {
    const h = scenario(); h.window.scrollY = 1600; h.choose('latest'); await settle(); h.commit(); h.frame();
    h.choose('for_you'); h.height(1000); h.commit(); h.frame();
    const stale = [...h.timers.values()][0].callback; h.dispatch(event);
    h.window.scrollY = 100; h.height(4000); stale(); h.advance(2000);
    assert.equal(h.scrolls.length, 1, event); assert.equal(h.controller.getSnapshot().scrollRestore, null, event);
    assert.equal(h.listenerCount(), 0, event); await settle(); h.unmount();
  }
});

test('route changes and a separate route scroll restoration supersede pending feed restoration', async () => {
  for (const routeAction of ['push', 'back', 'restore', 'restore-bottom', 'hidden']) {
    const h = scenario(); h.window.scrollY = 1600; h.choose('latest'); await settle(); h.commit(); h.frame();
    h.choose('for_you'); h.height(1000); h.commit(); h.frame();
    const stale = [...h.timers.values()][0].callback;
    if (routeAction === 'push') h.window.location.href = 'https://qa.example/post/one';
    if (routeAction === 'back') h.dispatch('popstate');
    if (routeAction === 'restore') { h.window.scrollY = 100; h.dispatch('scroll'); }
    if (routeAction === 'restore-bottom') { h.window.scrollY = 200; h.dispatch('scroll'); }
    if (routeAction === 'hidden') { h.document.visibilityState = 'hidden'; h.dispatch('visibilitychange'); }
    h.height(4000); stale(); h.advance(2000);
    assert.equal(h.scrolls.length, 1, routeAction); await settle(); h.unmount();
  }
});

test('a browser clamp may wait for media, but an unreachable saved offset settles once at the final height', async () => {
  const h = scenario(); h.window.scrollY = 1600; h.choose('latest'); await settle(); h.commit(); h.frame();
  h.window.scrollY = 900; h.choose('for_you'); h.height(1000); h.commit(); h.window.scrollY = 200; h.dispatch('scroll'); h.frame();
  assert.equal(h.scrolls.length, 1); h.advance(2000);
  assert.equal(h.scrolls.length, 2); assert.equal(h.scrolls.at(-1).top, 200); assert.equal(h.timers.size, 0);
  h.height(5000); h.advance(2000); assert.equal(h.scrolls.length, 2); await settle(); h.unmount();
});

test('rapid changes retain unapplied offsets and obsolete callbacks cannot finish a later mode request', async () => {
  const h = scenario(); h.window.scrollY = 1600; h.choose('latest'); await settle(); h.commit(); h.frame();
  h.window.scrollY = 700; h.choose('for_you'); h.height(1000); h.commit(); h.frame();
  const obsolete = [...h.timers.values()][0].callback;
  h.choose('latest'); h.commit(); const later = h.controller.getSnapshot().scrollRestore;
  obsolete(); assert.equal(h.controller.getSnapshot().scrollRestore.id, later.id);
  h.height(6000); h.advance(100); assert.equal(h.scrolls.at(-1).top, 700); await settle();
  h.choose('for_you'); h.commit(); h.frame(); assert.equal(h.scrolls.at(-1).top, 1600);
  await settle(); h.unmount();
});

test('account switching, an explicit fresh refresh and expiry cannot reuse an old tab offset', async () => {
  const h = scenario(); h.window.scrollY = 1600; h.choose('latest'); await settle(); h.commit(); h.frame();
  h.choose('for_you'); h.height(1000); h.commit(); h.frame();
  const stale = [...h.timers.values()][0].callback;
  await h.controller.load(); h.height(6000); stale(); assert.equal(h.scrolls.length, 1);
  h.controller.setOwner('bob'); await settle(); h.commit(); h.choose('latest'); await settle(); h.commit(); h.frame();
  assert.equal(h.scrolls.at(-1).top, 0); assert.equal(h.controller.getSnapshot().owner, 'bob');
  h.window.scrollY = 500; h.choose('for_you'); await settle(); h.commit(); h.frame();
  h.advance(30 * 60_000 + 1); h.choose('latest'); assert.equal(h.controller.getSnapshot().rows.length, 0);
  assert.equal(h.controller.getSnapshot().scrollRestore.top, 0); await settle(); h.commit(); h.frame();
  assert.equal(h.scrolls.at(-1).top, 0); h.unmount();
});

test('invalid offsets and a cached feed whose rows were hidden reset to the start', async () => {
  for (const invalid of [NaN, Infinity, -4]) {
    const h = scenario(); h.window.scrollY = invalid; h.choose('latest'); await settle();
    h.choose('for_you'); assert.equal(h.controller.getSnapshot().scrollRestore.top, 0); await settle(); h.unmount();
  }
  const h = scenario(); h.window.scrollY = 900; h.choose('latest'); await settle();
  for (let index = 0; index < 20; index++) h.controller.hide('seed-' + index);
  h.choose('for_you'); assert.equal(h.controller.getSnapshot().rows.length, 0); assert.equal(h.controller.getSnapshot().scrollRestore.top, 0);
  await settle(); h.unmount();
});
