const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(file, imports = {}) {
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, file), 'utf8')), {
    module, exports: module.exports, require: name => { assert.ok(name in imports, name); return imports[name]; },
    AbortController, Promise, Map, Set, Date, atob, setTimeout, clearTimeout,
  });
  return module.exports;
}
const sharedNavigation = load('shared/navigationCache.ts');
const handoff = load('shared/reactDraftHandoff.ts');
const source = fs.readFileSync(path.join(root, 'src/screens/feed/FeedScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('FeedScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function visit(node) {
  if (ts.isFunctionExpression(node) && node.name) functions.set(node.name.text, node.getText(ast));
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) functions.set(node.name.text, node.initializer.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
function actual(name, context) {
  assert.ok(functions.has(name), name);
  return vm.runInNewContext(compile(`(${functions.get(name)})`), context);
}
const session = (owner, id) => ({ user: { id: owner }, access_token: `head.${Buffer.from(JSON.stringify({ session_id: id })).toString('base64url')}.signature` });
const capture = (uri = 'reaction.mp4', postId = 'original-a') => ({ uri, mimeType: 'video/mp4', width: 720, height: 1280, duration: 8, source: postId ? { postId, creatorId: 'creator-a', creatorName: 'Original creator' } : {} });
const tick = () => new Promise(resolve => setImmediate(resolve));
function bridgeFixture() {
  let auth = { session: session('alice', 'one') };
  const listeners = new Set();
  const useAuthStore = { getState: () => auth, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  const navigation = load('src/lib/navigationCache.ts', { '../../shared/navigationCache': sharedNavigation, '../stores/authStore': { useAuthStore } });
  const bridge = load('src/utils/reactCaptureBridge.ts', { '../stores/authStore': { useAuthStore }, '../lib/navigationCache': navigation });
  return { bridge, navigation, change(owner, id = 'one') { auth = { session: owner ? session(owner, id) : null }; listeners.forEach(fn => fn()); } };
}
function feedFixture(media = [], quote = null) {
  const h = bridgeFixture(), queued = [], thumbnails = [], writes = [];
  const context = {
    ...handoff, ...h.bridge, navigationScope: h.navigation.navigationScope,
    reactDraftScope: h.navigation.navigationScope(), composerMedia: media,
    composerMediaRef: { current: media }, quotingPostRef: { current: quote },
    publicationBusy: { current: false }, publicationAttempt: { current: null },
    VideoThumbnails: { getThumbnailAsync: () => new Promise(resolve => thumbnails.push(resolve)) },
    setComposerMedia: updater => queued.push(updater),
    setSelectedComposerMedia: value => writes.push(['selected', value]),
    setComposerReview: value => writes.push(['review', value]),
    setComposerOpen: value => writes.push(['open', value]),
  };
  const append = actual('appendPendingReactCapture', context);
  const confirm = actual('confirmReactCaptureAppend', context);
  return {
    ...h, context, thumbnails, queued, writes, append,
    offer(value = capture()) { assert.equal(h.bridge.setPendingReactCapture(value, context.reactDraftScope), true); },
    replaceMedia(value) { context.composerMedia = value; context.composerMediaRef.current = value; },
    commit() {
      for (const update of queued.splice(0)) context.composerMedia = update(context.composerMedia);
      context.composerMediaRef.current = context.composerMedia;
    },
    confirm() { context.pendingReactCapture = h.bridge.peekPendingReactCapture(); confirm(); },
  };
}

test('bridge retains the original export until a matching acknowledgement and rejects replacement', () => {
  const h = bridgeFixture(), scope = h.navigation.navigationScope(), original = capture();
  let events = 0;
  const unsubscribe = h.bridge.subscribePendingReactCapture(() => events++);
  assert.equal(h.bridge.setPendingReactCapture(original, scope), true);
  original.source.creatorName = 'Changed after handoff';
  assert.equal(h.bridge.peekPendingReactCapture().source.creatorName, 'Original creator');
  assert.equal(h.bridge.setPendingReactCapture(capture('other.mp4', 'original-b'), scope), false);
  assert.equal(h.bridge.setPendingReactCapture(capture('reaction.mp4', 'original-b'), scope), true);
  assert.equal(h.bridge.peekPendingReactCapture().source.postId, 'original-a');
  assert.equal(h.bridge.acknowledgePendingReactCapture('other.mp4'), false);
  assert.equal(h.bridge.peekPendingReactCapture().uri, 'reaction.mp4');
  assert.equal(events, 1);
  assert.equal(h.bridge.acknowledgePendingReactCapture('reaction.mp4'), true);
  assert.equal(h.bridge.peekPendingReactCapture(), null);
  assert.equal(events, 2);
  unsubscribe();
});

test('bridge clears on account changes and rejects null or stale A → B → A scopes', () => {
  const h = bridgeFixture(), old = h.navigation.navigationScope();
  assert.equal(h.bridge.setPendingReactCapture(capture(), null), false);
  assert.equal(h.bridge.setPendingReactCapture(capture(), old), true);
  h.change('bob');
  assert.equal(h.bridge.peekPendingReactCapture(), null);
  h.change('alice');
  assert.notEqual(h.navigation.navigationScope(), old);
  assert.equal(h.bridge.setPendingReactCapture(capture('late.mp4'), old), false);
  const current = h.navigation.navigationScope();
  assert.equal(h.bridge.setPendingReactCapture(capture('current.mp4'), current), true);
  assert.equal(h.bridge.setPendingReactCapture(capture('late.mp4'), old), false);
  assert.equal(h.bridge.peekPendingReactCapture().uri, 'current.mp4');
  h.change(null);
  assert.equal(h.bridge.peekPendingReactCapture(), null);
});

test('Feed acknowledges only after the actual append has committed, then opens that media', async () => {
  const h = feedFixture([{ uri: 'draft.jpg' }]); h.offer(); h.append();
  h.confirm(); assert.ok(h.bridge.peekPendingReactCapture());
  h.thumbnails.shift()({ uri: 'thumb.jpg' }); await tick();
  assert.equal(h.queued.length, 1);
  h.confirm(); assert.ok(h.bridge.peekPendingReactCapture(), 'Scheduling state is not a successful append');
  h.commit();
  assert.equal(h.context.composerMedia.length, 2);
  assert.equal(h.context.composerMedia[1].reactSource.postId, 'original-a');
  assert.ok(h.bridge.peekPendingReactCapture());
  h.confirm();
  assert.equal(h.bridge.peekPendingReactCapture(), null);
  assert.deepEqual(h.writes, [['selected', 1], ['review', false], ['open', true]]);
});

test('focus loss during thumbnail work keeps the take for a successful later retry', async () => {
  const h = feedFixture(); h.offer(); const blur = h.append(); blur();
  h.thumbnails.shift()({ uri: 'late.jpg' }); await tick();
  assert.equal(h.queued.length, 0); assert.ok(h.bridge.peekPendingReactCapture());
  h.append(); h.thumbnails.shift()({ uri: 'retry.jpg' }); await tick(); h.commit(); h.confirm();
  assert.equal(h.context.composerMedia.length, 1); assert.equal(h.bridge.peekPendingReactCapture(), null);
});

test('a busy publication, full draft, and different original each retain the completed take', async () => {
  for (const block of ['busy', 'full', 'source']) {
    const h = feedFixture(); h.offer();
    if (block === 'busy') h.context.publicationAttempt.current = { postId: 'publishing' };
    if (block === 'full') h.replaceMedia(Array.from({ length: 10 }, (_, i) => ({ uri: `${i}.jpg` })));
    if (block === 'source') h.replaceMedia([{ uri: 'other.mp4', reactSource: { postId: 'original-b' } }]);
    h.append(); h.commit(); h.confirm();
    assert.ok(h.bridge.peekPendingReactCapture(), block); assert.equal(h.thumbnails.length, 0);
    const status = handoff.reactCaptureAppendStatus(h.context.composerMedia, capture(), null, block === 'busy');
    assert.equal(status, block); assert.match(handoff.reactCapturePendingMessage(status), /kept here/);
    h.context.publicationAttempt.current = null; h.replaceMedia([]);
    h.append(); h.thumbnails.shift()({ uri: 'next-post.jpg' }); await tick(); h.commit(); h.confirm();
    assert.equal(h.context.composerMedia.length, 1); assert.equal(h.bridge.peekPendingReactCapture(), null);
  }
});

test('the final updater rejects a publication or full draft that appeared during thumbnail work', async () => {
  for (const block of ['busy', 'full']) {
    const h = feedFixture(); h.offer(); h.append();
    h.thumbnails.shift()({ uri: 'thumb.jpg' }); await tick();
    if (block === 'busy') h.context.publicationBusy.current = true;
    else h.replaceMedia(Array.from({ length: 10 }, (_, i) => ({ uri: `${i}.jpg` })));
    h.commit(); h.confirm();
    assert.ok(h.bridge.peekPendingReactCapture(), block);
    assert.equal(h.context.composerMedia.some(item => item.uri === 'reaction.mp4'), false);
  }
});

test('late Feed append and React launch cannot cross an A → B → A session roundtrip', async () => {
  const h = feedFixture(); h.offer(); h.append();
  h.change('bob'); h.change('alice');
  h.thumbnails.shift()({ uri: 'late.jpg' }); await tick(); h.commit(); h.confirm();
  assert.equal(h.context.composerMedia.length, 0);
  const launch = feedFixture(), navigated = []; let finish;
  Object.assign(launch.context, {
    reactLaunchBusy: { current: false }, canEditPostDraft: () => true,
    prepareReactPostSource: () => new Promise(resolve => { finish = resolve; }),
    Keyboard: { dismiss() {} }, navigation: { navigate: (...args) => navigated.push(args) }, Alert: { alert() {} },
  });
  const work = actual('openReact', launch.context)({ id: 'original-a' });
  launch.change('bob'); launch.change('alice'); finish({ postId: 'original-a', uri: 'source.jpg', kind: 'image' }); await work;
  assert.equal(navigated.length, 0);
});

test('one original controls preview and publication, while local clips do not invent a quote', () => {
  const first = { uri: 'one.mp4', reactSource: capture().source };
  const same = { uri: 'two.mp4', reactSource: capture('two.mp4').source };
  const local = { uri: 'local.mp4', reactSource: {} };
  const original = handoff.reactDraftAttribution([local, first, same]);
  assert.equal(original.conflict, false); assert.equal(original.postId, 'original-a');
  assert.equal(original.source.creatorName, 'Original creator');
  assert.equal(handoff.reactDraftAttribution([first], 'original-b').conflict, true);
  assert.equal(handoff.reactDraftAttribution([first, { uri: 'different.mp4', reactSource: { postId: 'original-b' } }]).conflict, true);
  assert.equal(handoff.reactDraftAttribution([local]).postId, null);
  assert.equal(handoff.reactDraftAttribution([local], 'quoted-manually').postId, 'quoted-manually');
  const preview = actual('composerAttribution', { reactDraftAttribution: handoff.reactDraftAttribution, composerMedia: [first, same], quotingPost: null });
  assert.equal(preview.postId, original.postId);
});

test('manual Quote cannot replace a React original already present in the draft', () => {
  const writes = [], alerts = [];
  const openQuote = actual('openQuote', {
    useCallback: fn => fn, canEditPostDraft: () => true, reactDraftAttribution: handoff.reactDraftAttribution,
    composerMediaRef: { current: [{ uri: 'one.mp4', reactSource: capture().source }] },
    Alert: { alert: (...args) => alerts.push(args) }, setComposerOpen: value => writes.push(['open', value]), setQuotingPost: value => writes.push(['quote', value]),
  });
  openQuote({ id: 'original-b' });
  assert.equal(alerts.length, 1); assert.equal(writes.some(([key]) => key === 'quote'), false);
  openQuote({ id: 'original-a' });
  assert.equal(writes.filter(([key]) => key === 'quote').length, 1);
});
