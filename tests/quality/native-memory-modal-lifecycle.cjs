const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createFilmHarness, walk, words } = require('../helpers/memoryFilmHarness.cjs');

const root = path.resolve(__dirname, '../..');
const modal = h => h.nodes().find(node => node.type === 'Modal');
const postButton = h => h.nodes().find(node => node.type === 'TouchableOpacity' && /Shared from Jordan/.test(words(node)));
const postPages = postId => [{ id: 'shared-page', media_type: 'text', stickers: [{ kind: 'post', postId, postText: 'A shared memory', postAuthorName: 'Jordan' }] }];

for (const action of ['Close memory film', 'Read memory book']) {
  test(`iOS ${action} pauses immediately and waits for one native dismissal`, async () => {
    const h = createFilmHarness(ts, 'native');
    try {
      await h.settle(); h.mediaReady(); await h.settle();
      h.press(action);
      h.press(action === 'Read memory book' ? 'Close memory film' : 'Read memory book');
      assert.equal(h.closed + h.read, 0, 'parent must retain the component during native dismissal');
      await h.settle();
      const closing = modal(h);
      assert.equal(closing.props.visible, false);
      assert.ok(h.nodes().some(node => node.type === 'MemoryStoryFrame'), 'the existing subtree remains mounted');
      assert.equal(h.sounds[0].status.at(-1).shouldPlay, false, 'music stops before native acknowledgement');
      await h.tick(30000);
      assert.equal(h.closed + h.read, 0, 'elapsed time never substitutes for onDismiss');
      closing.props.onDismiss(); closing.props.onDismiss();
      assert.equal(h.read, action === 'Read memory book' ? 1 : 0);
      assert.equal(h.closed, action === 'Close memory film' ? 1 : 0);
    } finally { h.dispose(); }
  });
}

test('iOS native close request uses the same deferred film lifecycle', async () => {
  const h = createFilmHarness(ts, 'native');
  try {
    await h.settle(); modal(h).props.onRequestClose(); await h.settle();
    assert.equal(h.closed, 0); assert.equal(modal(h).props.visible, false);
    modal(h).props.onDismiss(); assert.equal(h.closed, 1);
  } finally { h.dispose(); }
});

test('film unmount invalidates a retained native dismissal callback', async () => {
  const h = createFilmHarness(ts, 'native');
  await h.settle(); h.press('Read memory book'); await h.settle();
  const acknowledge = modal(h).props.onDismiss;
  h.dispose(); acknowledge(); assert.equal(h.read, 0);
});

for (const [name, sessions] of [['same-owner replacement', ['2:owner']], ['account ABA', ['2:other', '3:owner']]]) {
  test(`film ${name} invalidates dismissal before React renders the replacement session`, async () => {
    const h = createFilmHarness(ts, 'native');
    try {
      await h.settle(); h.press('Read memory book'); await h.settle();
      const acknowledge = modal(h).props.onDismiss;
      sessions.forEach(value => h.setSessionScope(value)); acknowledge();
      await h.settle(); assert.equal(h.read, 0); assert.equal(modal(h).props.visible, false);
    } finally { h.dispose(); }
  });
}

test('film book replacement discards the old action and late acknowledgements cannot close the replacement', async () => {
  const h = createFilmHarness(ts, 'native');
  try {
    await h.settle(); h.press('Read memory book'); await h.settle();
    const oldAcknowledgement = modal(h).props.onDismiss;
    h.setBook('book-b'); await h.settle();
    assert.equal(modal(h).props.visible, false, 'replacement waits for the previous native dismissal');
    oldAcknowledgement(); await h.settle();
    assert.equal(h.read, 0); assert.equal(modal(h).props.visible, true);
    h.press('Close memory film'); await h.settle();
    const currentAcknowledgement = modal(h).props.onDismiss;
    oldAcknowledgement(); assert.equal(h.closed, 0);
    currentAcknowledgement(); assert.equal(h.closed, 1);
  } finally { h.dispose(); }
});

test('a stale film control cannot start dismissal of a replacement book', async () => {
  const h = createFilmHarness(ts, 'native');
  try {
    await h.settle(); const close = modal(h).props.onRequestClose;
    h.setBook('book-b'); await h.settle(); close(); await h.settle();
    assert.equal(modal(h).props.visible, true); assert.equal(h.closed, 0);
  } finally { h.dispose(); }
});

test('same-book page and delivery refresh preserves the intended film close', async () => {
  const h = createFilmHarness(ts, 'native');
  try {
    await h.settle(); h.press('Read memory book'); await h.settle();
    const acknowledge = modal(h).props.onDismiss;
    h.setPages([{ id: 'one', media_type: 'image', media_url: 'renewed:first' }]); await h.settle();
    acknowledge(); assert.equal(h.read, 1);
  } finally { h.dispose(); }
});

test('film post handoff waits for native dismissal and retains a refreshed identical source', async () => {
  const h = createFilmHarness(ts, 'native', { pages: postPages('post-a') });
  try {
    await h.settle(); postButton(h).props.onPress(); await h.settle();
    assert.deepEqual(h.posts, []);
    const acknowledge = modal(h).props.onDismiss;
    h.setPages(postPages('post-a')); await h.settle(); acknowledge(); acknowledge();
    assert.deepEqual(h.posts, ['post-a']);
  } finally { h.dispose(); }
});

test('a removed or changed film source cannot dispatch its stale post navigation', async () => {
  const h = createFilmHarness(ts, 'native', { pages: postPages('post-a') });
  try {
    await h.settle(); postButton(h).props.onPress(); await h.settle();
    const acknowledge = modal(h).props.onDismiss;
    h.setPages(postPages('post-b')); await h.settle(); acknowledge(); await h.settle();
    assert.deepEqual(h.posts, []); assert.equal(modal(h).props.visible, true);
  } finally { h.dispose(); }
});

for (const action of ['Close memory film', 'Read memory book']) {
  test(`Android ${action} completes once without an unavailable onDismiss event`, async () => {
    const h = createFilmHarness(ts, 'native', { os: 'android' });
    try {
      await h.settle(); h.press(action); h.press(action); await h.settle();
      assert.equal(h.read, action === 'Read memory book' ? 1 : 0);
      assert.equal(h.closed, action === 'Close memory film' ? 1 : 0);
      modal(h).props.onDismiss(); assert.equal(h.read + h.closed, 1);
    } finally { h.dispose(); }
  });
}

/** Actual TSX + actual dismissal hook. React scheduling, native components,
 * transport, encoder, Photos and UIKit's eventual onDismiss are controlled.
 * This verifies ownership/state transitions, not a simulated iOS rendering cure. */
function exportHarness({ os = 'ios' } = {}) {
  const slots = [], effects = [], tasks = [], events = [];
  let cursor = 0, dirty = true, mounted = true, tree, closed = 0, session = '1:owner';
  let releases = 0, photos = 0;
  const props = { bookId: 'book-a', expected: { title: 'Book A', pages: [{ id: 'page-a' }], revision: 1 }, originalAudio: true, scoreVolume: null, reduceMotion: false, onClose: () => { closed++; events.push('parent-close'); } };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useRef(value) { const i = cursor++; return slots[i] || (slots[i] = { current: value }); },
    useState(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { if (!mounted) return; const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || !same(old.deps, deps)) { slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  react.useLayoutEffect = react.useEffect;
  const native = { Platform: { OS: os }, Modal: 'Modal', View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', ActivityIndicator: 'Spinner', StyleSheet: { create: value => value }, AppState: { addEventListener: () => ({ remove() {} }) }, useWindowDimensions: () => ({ width: 393, height: 852 }) };
  const modules = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }, 'react-native': native,
    'expo-media-library': { requestPermissionsAsync: async () => { photos++; return { granted: true }; }, saveToLibraryAsync: async () => { photos++; } },
    'react-native-view-shot': { captureRef: async () => { throw Error('This lifecycle case does not capture pixels'); }, releaseCapture() {} },
    '../../../modules/boomerang/memoryComposition': { memoryMovieCompositionAvailable: true },
    '../../../shared/memoryMovieAccess': { memoryMovieContentStamp: expected => JSON.stringify(expected) },
    '../../../shared/memoryMoviePlan': { planMemoryMovie: pages => ({ selectedCount: pages.length }) },
    '../../contexts/CallContext': { useCallContext: () => ({ callState: 'idle' }) },
    '../../services/memoryMovieFiles': { memoryMovieStep: work => work },
    '../../services/supabase': { SUPABASE_URL: 'https://fixture.invalid' },
    '../SafeArea': { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) },
    '../stories/StoryPixelImage': { __esModule: true, default: 'StoryPixelImage', StoryPhotoReadinessContext: { Provider: 'Provider' } },
    './MemoryStoryFrame': { __esModule: true, default: 'MemoryStoryFrame' },
    '../lib/navigationCache': { navigationScope: () => session },
    '../../services/memoryMovieExport': { exportNativeMemoryMovie(options) { events.push('export-start'); const task = { options }; tasks.push(task); options.signal.addEventListener('abort', () => events.push('abort'), { once: true }); return new Promise(resolve => { task.resolve = resolve; }); } },
  };
  const cache = new Map();
  function load(file) {
    const absolute = path.join(root, file); if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    const requireModule = name => name.endsWith('useNativeModalDismissal') ? load('src/hooks/useNativeModalDismissal.ts') : (assert.ok(Object.hasOwn(modules, name), name), modules[name]);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { fileName: absolute, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, { module, exports: module.exports, require: requireModule, AbortController, Date, Map, Promise, setTimeout, clearTimeout, requestAnimationFrame: fn => fn() });
    cache.set(file, module.exports); return module.exports;
  }
  const Component = load('src/components/memory/MemoryMovieExport.tsx').default;
  function render() { let attempts = 0; while (dirty && mounted) { assert.ok(++attempts < 30, 'render settles'); dirty = false; cursor = 0; tree = Component(props); while (effects.length) effects.shift()(); } }
  async function flush() { for (let i = 0; i < 6; i++) { render(); await new Promise(resolve => setImmediate(resolve)); } render(); }
  const h = {
    tasks, events, props, flush, nodes: () => walk(tree),
    button(label) { const button = walk(tree).find(node => node.type === 'TouchableOpacity' && (node.props.accessibilityLabel === label || words(node).trim() === label)); assert.ok(button, label); return button; },
    press(label) { const button = h.button(label); assert.ok(!button.props.disabled); button.props.onPress(); },
    update(next) { Object.assign(props, next); dirty = true; },
    session(value) { session = value; dirty = true; },
    finish(index = tasks.length - 1) { tasks[index].resolve({ result: { uri: 'file:///movie.mp4', duration: 4 }, assertRights: async () => {}, release() { releases++; events.push('release'); } }); },
    dispose() { if (mounted) { mounted = false; slots.forEach(slot => slot?.cleanup?.()); } },
    get closed() { return closed; }, get releases() { return releases; }, get photos() { return photos; },
  };
  render(); return h;
}

test('iOS export cancellation aborts immediately, retains its subtree, and notifies parent once after dismissal', async () => {
  const h = exportHarness();
  try {
    await h.flush(); const start = h.button('Create memory movie').props.onPress;
    start(); await h.flush(); h.press('Close movie export'); start(); h.press('Close movie export');
    assert.equal(h.tasks[0].options.signal.aborted, true); assert.equal(h.closed, 0); assert.equal(h.tasks.length, 1);
    await h.flush(); const closing = modal(h);
    assert.equal(closing.props.visible, false); assert.match(words(closing), /Your memory movie/);
    closing.props.onDismiss(); closing.props.onDismiss(); assert.equal(h.closed, 1);
    h.dispose(); h.finish(); await h.flush();
    assert.equal(h.releases, 1, 'a late export result is released without reopening the modal');
  } finally { h.dispose(); }
});

test('closing a ready iOS movie releases its result before native acknowledgement and blocks stale Photos actions', async () => {
  const h = exportHarness();
  try {
    await h.flush(); h.press('Create memory movie'); await h.flush(); h.finish(); await h.flush();
    const save = h.button('Save movie to Photos').props.onPress;
    modal(h).props.onRequestClose(); save();
    assert.equal(h.releases, 1); assert.equal(h.closed, 0); assert.equal(h.photos, 0);
    await h.flush(); modal(h).props.onDismiss(); assert.equal(h.closed, 1);
    assert.deepEqual(h.events, ['export-start', 'abort', 'release', 'parent-close']);
    h.dispose(); assert.equal(h.releases, 1, 'unmount does not release the same result twice');
  } finally { h.dispose(); }
});

test('export unmount invalidates its pending native close acknowledgement', async () => {
  const h = exportHarness(); await h.flush(); h.press('Close movie export'); await h.flush();
  const acknowledge = modal(h).props.onDismiss; h.dispose(); acknowledge(); assert.equal(h.closed, 0);
});

for (const [name, sessions] of [['same-owner replacement', ['2:owner']], ['account ABA', ['2:other', '3:owner']]]) {
  test(`export ${name} cannot dispatch an old close or restart old work`, async () => {
    const h = exportHarness();
    try {
      await h.flush(); const start = h.button('Create memory movie').props.onPress;
      h.press('Close movie export'); await h.flush(); const acknowledge = modal(h).props.onDismiss;
      sessions.forEach(value => h.session(value)); acknowledge(); start(); await h.flush();
      assert.equal(h.closed, 0); assert.equal(h.tasks.length, 0); assert.equal(modal(h).props.visible, false);
    } finally { h.dispose(); }
  });
}

test('export book replacement waits for old dismissal and ignores old callbacks during the replacement close', async () => {
  const h = exportHarness();
  try {
    await h.flush(); h.press('Close movie export'); await h.flush(); const old = modal(h).props.onDismiss;
    h.update({ bookId: 'book-b', expected: { title: 'Book B', pages: [{ id: 'page-b' }], revision: 1 } }); await h.flush();
    assert.equal(modal(h).props.visible, false); old(); await h.flush();
    assert.equal(h.closed, 0); assert.equal(modal(h).props.visible, true);
    h.press('Close movie export'); await h.flush(); const current = modal(h).props.onDismiss;
    old(); assert.equal(h.closed, 0); current(); assert.equal(h.closed, 1);
  } finally { h.dispose(); }
});

test('same-book export presentation refresh preserves its legitimate close', async () => {
  const h = exportHarness();
  try {
    await h.flush(); h.press('Close movie export'); await h.flush(); const acknowledge = modal(h).props.onDismiss;
    h.update({ expected: { title: 'Refreshed Book A', pages: [{ id: 'page-a' }], revision: 2 } }); await h.flush();
    acknowledge(); assert.equal(h.closed, 1);
  } finally { h.dispose(); }
});

test('Android export cancellation remains immediate and exactly once without onDismiss', async () => {
  const h = exportHarness({ os: 'android' });
  try {
    await h.flush(); h.press('Create memory movie'); await h.flush(); h.press('Close movie export'); h.press('Close movie export');
    assert.equal(h.tasks[0].options.signal.aborted, true); assert.equal(h.closed, 1);
    await h.flush(); modal(h).props.onDismiss(); assert.equal(h.closed, 1);
    h.dispose(); h.finish(); await h.flush(); assert.equal(h.releases, 1);
  } finally { h.dispose(); }
});
