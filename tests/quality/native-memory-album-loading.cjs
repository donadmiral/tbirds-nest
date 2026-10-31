const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { navigationBook, OWNER } = require('../native/memory-fixture.cjs');

const root = path.resolve(__dirname, '../..');
const screenFile = 'src/screens/profile/MemoryAlbumScreen.tsx';
const turn = () => new Promise(resolve => setImmediate(resolve));
const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const book = (id = 'book-a', pages = navigationBook().pages) => ({ ...navigationBook(), id, title: `Book ${id}`, pages, count: pages.length });
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object'
  ? [node, ...(node.type === 'Modal' && !node.props.visible ? [] : nodes(node.props?.children))] : [];
const words = node => Array.isArray(node) ? node.map(words).join('') : typeof node === 'string' || typeof node === 'number'
  ? String(node) : node && typeof node === 'object' ? words(node.props?.children) : '';

/** Execute the complete production screen and pure shared helpers. React hook
 * scheduling, native primitives/animation acknowledgement, auth, transport and
 * media delivery are controlled. This proves component state/ownership; it is
 * not a native-pixel test or a diagnosis of the retained iPhone loading delay. */
function harness({ heldAuth = false, heldMedia = false } = {}) {
  const slots = [], effects = [], books = [], reactions = [], toggles = [], media = [], soundtrackSaves = [], authListeners = new Set(), appListeners = new Set();
  let cursor = 0, dirty = true, mounted = true, tree, owner = OWNER, postUnmountWrites = 0;
  const session = deferred();
  if (!heldAuth) session.resolve({ data: { session: { user: { id: owner }, access_token: 'synthetic-test-token' } }, error: null });
  const props = { route: { params: { ownerId: OWNER, albumId: 'book-a' } }, navigation: { goBack() {}, push() {}, navigate() {}, replace() {} } };
  const react = {
    useRef(value) { const i = cursor++; return slots[i] || (slots[i] = { current: value }); },
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) {
        const slot = { value: typeof initial === 'function' ? initial() : initial };
        slot.set = next => {
          if (!mounted) { postUnmountWrites++; return; }
          const value = typeof next === 'function' ? next(slot.value) : next;
          if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
        };
        slots[i] = slot;
      }
      return [slots[i].value, slots[i].set];
    },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++, previous = slots[i];
      if (!previous || !same(previous.deps, deps)) { slots[i] = { deps }; effects.push({ i, previous, fn }); }
    },
  };
  react.useLayoutEffect = react.useEffect;
  const jsx = (type, props, key) => ({ type, props, key });
  const appState = { currentState: 'active', addEventListener(_type, fn) { appListeners.add(fn); return { remove: () => appListeners.delete(fn) }; } };
  class AnimatedValue { setValue() {} stopAnimation() {} interpolate() { return 1; } }
  const native = Object.fromEntries(['View', 'Text', 'TouchableOpacity', 'Modal', 'TextInput', 'FlatList', 'ActivityIndicator', 'StatusBar', 'ScrollView', 'KeyboardAvoidingView'].map(name => [name, name]));
  Object.assign(native, {
    AppState: appState, Alert: { alert() {} }, Platform: { OS: 'ios' },
    StyleSheet: { create: value => value, absoluteFill: {}, hairlineWidth: 1 },
    useWindowDimensions: () => ({ width: 393, height: 852 }),
    AccessibilityInfo: { isReduceMotionEnabled: async () => true, addEventListener: () => ({ remove() {} }) },
    Animated: { Value: AnimatedValue, View: 'AnimatedView', timing: () => ({ start: callback => callback?.({ finished: true }), stop() {} }) },
    Easing: { out: value => value, cubic: 1 },
  });
  const palette = { surface: { canvas: '#fff', hairline: '#ddd', scrim: '#333' }, ink: { primary: '#123', secondary: '#567', muted: '#999', inverse: '#fff' }, brand: { base: '#123', tintBg: '#eee' }, status: { danger: '#f00' } };
  function queued(list, info) {
    const task = { ...deferred(), ...info }; list.push(task);
    task.promise.setHeader = (name, value) => { task.headers = { ...task.headers, [name]: value }; return task.promise; };
    task.promise.abortSignal = signal => { task.signal = signal; return task.promise; };
    return task.promise;
  }
  const supabase = {
    auth: {
      getSession: () => session.promise,
      onAuthStateChange(callback) { authListeners.add(callback); return { data: { subscription: { unsubscribe: () => authListeners.delete(callback) } } }; },
    },
    rpc(name, args) {
      if (name === 'get_memory_book') return queued(books, { args, owner });
      if (name === 'get_memory_albums') return Promise.resolve({ data: { is_owner: true, books: [] }, error: null });
      if (name === 'toggle_story_reaction') return queued(toggles, { args, owner });
      if (name === 'save_memory_book_soundtrack') return queued(soundtrackSaves, { args, owner });
      throw Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      assert.ok(['profiles', 'story_reactions'].includes(table), table);
      let promise;
      const query = {
        select() { return query; }, eq() { return query; }, in(_key, ids) { query.ids = [...ids]; return query; },
        maybeSingle() { return Promise.resolve({ data: { full_name: 'Owner' }, error: null }); },
        then(yes, no) { promise ||= queued(reactions, { owner, ids: query.ids }); return promise.then(yes, no); },
      };
      return query;
    },
  };
  const mocks = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': native,
    '@react-navigation/native': { useIsFocused: () => true }, '@expo/vector-icons': { Feather: 'Feather' }, 'expo-image': { Image: 'ExpoImage' },
    'src/services/supabase': { supabase },
    'src/services/contentMedia': {
      hydrateMemoryAlbumMedia: rows => heldMedia ? queued(media, { rows }) : Promise.resolve(rows),
      hydrateStoryMedia: async rows => rows,
    },
    'src/theme/useTheme': { useTheme: () => ({ t: palette, isDark: false }), themedSheet: fn => fn(palette) },
    'src/contexts/CallContext': { useCallContext: () => ({ callState: 'idle' }) },
    'src/components/SafeArea': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) },
    'src/components/MemoryAlbumCard': { COVER_COLORS: { cream: { cover: '#eee' } } },
    'src/components/memory/MemoryCreativeControls': { MemoryCoverControls: 'MemoryCoverControls', MemoryFilmControls: 'MemoryFilmControls' },
    'src/components/memory/MemoryBookDesigner': { MemoryStoryTile: 'MemoryStoryTile' },
    'src/components/memory/MemoryPageTurn': { __esModule: true, default: 'MemoryPageTurn', MemoryTurnPreview: 'MemoryTurnPreview' },
    'src/hooks/useMemoryPlayback': { useMemoryPlayback: () => 0 },
    'src/hooks/useSoundtrackPlayer': { useSoundtrackPlayer: () => ({ error: null, loading: false }) },
    'modules/boomerang/storyVideo': { StoryVideoView: 'VideoView', useStoryVideoPlayer() { throw Error('Text-only loading cases must not instantiate a video player'); } },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const absolute = path.join(root, file), module = { exports: {} };
    const source = fs.readFileSync(file === screenFile && process.env.PLATINUM_READER_SOURCE ? process.env.PLATINUM_READER_SOURCE : absolute, 'utf8');
    const requireModule = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      const key = path.relative(root, path.resolve(path.dirname(absolute), name)).replace(/\\/g, '/');
      if (Object.hasOwn(mocks, key)) return mocks[key];
      if (key.startsWith('shared/')) return load(`${key}.ts`);
      if (key.startsWith('src/components/')) return { __esModule: true, default: path.basename(key) };
      throw Error(`Unhandled import ${name} in ${file}`);
    };
    vm.runInNewContext(ts.transpileModule(source, { fileName: absolute, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText,
      { module, exports: module.exports, require: requireModule, console, Promise, Date, Set, Map, URL, AbortController, setTimeout, clearTimeout,
        setInterval: fn => ({ fn }), clearInterval() {}, requestAnimationFrame: fn => fn() }, { filename: file });
    cache.set(file, module.exports); return module.exports;
  }
  const Component = load(screenFile).default;
  function render() {
    let turns = 0;
    while (dirty && mounted) {
      assert.ok(++turns < 40, 'component effects must settle without a feedback loop');
      dirty = false; cursor = 0; tree = Component(props);
      const pending = effects.splice(0);
      pending.forEach(effect => effect.previous?.cleanup?.());
      pending.forEach(effect => { slots[effect.i].cleanup = effect.fn(); });
    }
  }
  async function flush() { for (let i = 0; i < 5; i++) { render(); await turn(); } render(); }
  const h = {
    books, reactions, toggles, media, soundtrackSaves, session, flush,
    visible(label) { return nodes(tree).some(node => node.props?.accessibilityLabel === label || node.type === 'Text' && words(node) === label); },
    loading() { return nodes(tree).some(node => node.type === 'ActivityIndicator'); },
    text() { return nodes(tree).filter(node => node.type === 'Text').map(words).join(' '); },
    button(label) {
      const node = nodes(tree).find(node => node.type === 'TouchableOpacity' && (node.props.accessibilityLabel === label || words(node) === label));
      assert.ok(node, `visible button ${label}`); return node;
    },
    press(label) { const node = h.button(label); assert.ok(!node.props.disabled, `enabled button ${label}`); return node.props.onPress(); },
    async authorize(value = book(), index = books.length - 1) { await flush(); assert.ok(books[index], `book request ${index}`); books[index].resolve({ data: value, error: null }); await flush(); },
    async open() { h.press('Open book'); await flush(); },
    async page(index) { const page = nodes(tree).find(node => node.type === 'MemoryPageTurn'); assert.ok(page); page.props.onCommit(index); await flush(); },
    async removeSoundtrack() {
      h.press('Book soundtrack'); await flush();
      const picker = nodes(tree).find(node => node.type === 'SoundtrackPicker'); assert.ok(picker?.props.visible);
      picker.props.onChange(null); await flush(); assert.equal(soundtrackSaves.length, 1);
      soundtrackSaves[0].resolve({ data: null, error: null }); await flush();
      assert.ok(books.at(-1).headers?.Authorization, 'actual soundtrack hook verifies the saved book with its captured bearer');
      books.at(-1).resolve({ data: book(props.route.params.albumId), error: null }); await flush();
      picker.props.onClose(); await flush();
    },
    route(id, routeOwner = OWNER) { props.route = { params: { ownerId: routeOwner, albumId: id } }; dirty = true; },
    account(next) { owner = next; for (const listener of [...authListeners]) listener(next ? 'SIGNED_IN' : 'SIGNED_OUT', next ? { user: { id: next } } : null); },
    refresh() { for (const listener of [...appListeners]) listener('active'); },
    dispose() { if (mounted) { mounted = false; slots.forEach(slot => slot?.cleanup?.()); } },
    get postUnmountWrites() { return postUnmountWrites; },
  };
  render(); return h;
}

test('held optional reactions do not block the actual authorized reader', async () => {
  const h = harness();
  try { await h.flush(); await h.authorize(); assert.equal(h.reactions.length, 1); assert.equal(h.loading(), false); assert.ok(h.visible('Edit memory book')); assert.ok(h.visible('Open book')); }
  finally { h.dispose(); }
});

test('unknown initial reaction state cannot expose an actionable Like guess', async () => {
  const h = harness();
  try {
    await h.flush(); await h.authorize(); await h.open();
    assert.equal(h.button('Loading reaction status').props.disabled, true);
    h.button('Loading reaction status').props.onPress(); await h.flush(); assert.equal(h.toggles.length, 0);
    h.reactions[0].resolve({ data: [{ story_id: book().pages[0].story_id }], error: null }); await h.flush();
    assert.ok(h.visible('Liked')); assert.ok(!h.button('Liked').props.disabled);
  } finally { h.dispose(); }
});

for (const failure of ['reject', 'error-result']) {
  test(`optional reaction ${failure} cannot discard the authorized book`, async () => {
    const h = harness();
    try {
      await h.flush(); await h.authorize();
      if (failure === 'reject') h.reactions[0].reject(Error('optional read unavailable'));
      else h.reactions[0].resolve({ data: null, error: Error('optional read denied') });
      await h.flush(); assert.equal(h.loading(), false); assert.ok(h.visible('Edit memory book')); assert.ok(!h.text().includes('album could not load'));
      await h.open(); assert.equal(h.button('Reaction status unavailable').props.disabled, true);
      h.button('Reaction status unavailable').props.onPress(); await h.flush(); assert.equal(h.toggles.length, 0);
    } finally { h.dispose(); }
  });
}

test('pending auth cannot dispatch required book or optional reaction reads', async () => {
  const h = harness({ heldAuth: true });
  try { await h.flush(); assert.equal(h.books.length, 0); assert.equal(h.reactions.length, 0); assert.ok(h.loading()); assert.ok(!h.visible('Edit memory book')); }
  finally { h.dispose(); }
});

test('pending required book authorization keeps the reader gated', async () => {
  const h = harness();
  try { await h.flush(); assert.equal(h.books.length, 1); assert.equal(h.reactions.length, 0); assert.ok(h.loading()); assert.ok(!h.visible('Edit memory book')); }
  finally { h.dispose(); }
});

for (const failure of ['book', 'media']) {
  test(`required ${failure} rejection still clears the reader and offers retry`, async () => {
    const h = harness({ heldMedia: failure === 'media' });
    try {
      await h.flush();
      if (failure === 'book') h.books[0].reject(Error('book denied'));
      else { await h.authorize(); assert.ok(h.loading()); assert.equal(h.reactions.length, 0); h.media[0].reject(Error('media revoked')); }
      await h.flush(); assert.ok(!h.visible('Edit memory book')); assert.ok(h.visible('Retry')); assert.match(h.text(), /album could not load/i); assert.equal(h.reactions.length, 0);
    } finally { h.dispose(); }
  });
}

test('held required media hydration cannot publish a book or start optional reads', async () => {
  const h = harness({ heldMedia: true });
  try { await h.flush(); await h.authorize(); assert.equal(h.media.length, 1); assert.equal(h.reactions.length, 0); assert.ok(h.loading()); assert.ok(!h.visible('Edit memory book')); }
  finally { h.dispose(); }
});

test('old optional read cannot affect a replacement route that shares a story ID', async () => {
  const h = harness();
  try {
    await h.flush(); await h.authorize(); const old = h.reactions[0];
    h.route('book-b'); await h.flush(); await h.authorize(book('book-b'));
    h.reactions[1].resolve({ data: [], error: null }); await h.flush(); await h.open();
    old.resolve({ data: [{ story_id: book().pages[0].story_id }], error: null }); await h.flush();
    assert.ok(h.visible('Like')); assert.ok(!h.visible('Liked'));
  } finally { h.dispose(); }
});

test('account ABA invalidates old optional reads before a replacement viewer commit', async () => {
  const h = harness();
  try {
    await h.flush(); await h.authorize(); const old = h.reactions[0];
    h.account('other'); h.account(OWNER);
    old.resolve({ data: [{ story_id: book().pages[0].story_id }], error: null }); await h.flush();
    h.refresh(); await h.flush(); await h.authorize(); h.reactions.at(-1).resolve({ data: [], error: null }); await h.flush(); await h.open();
    assert.ok(h.visible('Like')); assert.ok(!h.visible('Liked'));
  } finally { h.dispose(); }
});

test('unmount invalidates a pending optional reaction result', async () => {
  const h = harness(); await h.flush(); await h.authorize(); const pending = h.reactions[0]; h.dispose();
  pending.resolve({ data: [{ story_id: book().pages[0].story_id }], error: null }); await h.flush(); assert.equal(h.postUnmountWrites, 0);
});

test('a newer load result wins over the previous optional reaction read', async () => {
  const h = harness();
  try {
    await h.flush(); await h.authorize(); const old = h.reactions[0]; h.refresh(); await h.flush(); await h.authorize();
    h.reactions[1].resolve({ data: [{ story_id: book().pages[0].story_id }], error: null }); await h.flush(); await h.open(); assert.ok(h.visible('Liked'));
    old.resolve({ data: [], error: null }); await h.flush(); assert.ok(h.visible('Liked'));
  } finally { h.dispose(); }
});

test('an older reaction read preserves a newer successful toggle and other page results', async () => {
  const h = harness();
  try {
    await h.flush(); await h.authorize(); h.reactions[0].resolve({ data: [], error: null }); await h.flush(); await h.open();
    h.refresh(); await h.flush(); await h.authorize(); const toggling = h.press('Like'); await h.flush();
    h.toggles[0].resolve({ data: { reacted: true }, error: null }); await toggling; await h.flush(); assert.ok(h.visible('Liked'));
    h.reactions[1].resolve({ data: [{ story_id: book().pages[1].story_id }], error: null }); await h.flush(); assert.ok(h.visible('Liked'));
    await h.page(1); assert.ok(h.visible('Liked'), 'unchanged other-page state still comes from the read');
  } finally { h.dispose(); }
});

test('a newer successful unreact removes the stale read membership', async () => {
  const h = harness();
  try {
    await h.flush(); await h.authorize(); h.reactions[0].resolve({ data: [{ story_id: book().pages[0].story_id }], error: null }); await h.flush(); await h.open();
    h.refresh(); await h.flush(); await h.authorize(); const toggling = h.press('Liked'); await h.flush();
    h.toggles[0].resolve({ data: { reacted: false }, error: null }); await toggling; await h.flush();
    h.reactions[1].resolve({ data: [{ story_id: book().pages[0].story_id }], error: null }); await h.flush(); assert.ok(h.visible('Like')); assert.ok(!h.visible('Liked'));
  } finally { h.dispose(); }
});

test('failed toggle leaves the optional authoritative reaction result usable', async () => {
  const h = harness();
  try {
    await h.flush(); await h.authorize(); h.reactions[0].resolve({ data: [], error: null }); await h.flush(); await h.open();
    h.refresh(); await h.flush(); await h.authorize(); const toggling = h.press('Like'); await h.flush();
    h.toggles[0].resolve({ data: null, error: Error('write rejected') }); await toggling; await h.flush();
    h.reactions[1].resolve({ data: [{ story_id: book().pages[0].story_id }], error: null }); await h.flush(); assert.ok(h.visible('Liked')); assert.match(h.text(), /reaction could not save/);
  } finally { h.dispose(); }
});

test('fresh book identity cannot display old confirmed likes while its optional read is held', async () => {
  const h = harness();
  try {
    await h.flush(); await h.authorize(); h.reactions[0].resolve({ data: [{ story_id: book().pages[0].story_id }], error: null }); await h.flush(); await h.open(); assert.ok(h.visible('Liked'));
    h.route('book-b'); await h.flush(); await h.authorize(book('book-b')); await h.open(); assert.equal(h.button('Loading reaction status').props.disabled, true); assert.ok(!h.visible('Liked'));
  } finally { h.dispose(); }
});

for (const emptyPages of [[], [{ id: 'no-story', media_type: 'text', caption: 'A page without a source story' }]]) {
  test(`${emptyPages.length ? 'no-story' : 'empty'} refreshed book removes old likes before a source returns`, async () => {
    const h = harness();
    try {
      await h.flush(); await h.authorize(); h.reactions[0].resolve({ data: [{ story_id: book().pages[0].story_id }], error: null }); await h.flush(); await h.open(); assert.ok(h.visible('Liked'));
      h.refresh(); await h.flush(); await h.authorize(book('book-a', emptyPages)); assert.equal(h.reactions.length, 1);
      h.refresh(); await h.flush(); await h.authorize(); assert.equal(h.reactions.length, 2); assert.equal(h.button('Loading reaction status').props.disabled, true); assert.ok(!h.visible('Liked'));
    } finally { h.dispose(); }
  });
}

test('a successful old-route toggle cannot leak into a replacement book', async () => {
  const h = harness();
  try {
    await h.flush(); await h.authorize(); h.reactions[0].resolve({ data: [], error: null }); await h.flush(); await h.open(); const toggling = h.press('Like'); await h.flush();
    h.route('book-b'); await h.flush(); await h.authorize(book('book-b')); h.reactions[1].resolve({ data: [], error: null }); await h.flush(); await h.open();
    h.toggles[0].resolve({ data: { reacted: true }, error: null }); await toggling; await h.flush(); assert.ok(h.visible('Like')); assert.ok(!h.visible('Liked'));
  } finally { h.dispose(); }
});

for (const failure of ['reject', 'error-result']) {
  test(`optional background ${failure} retains confirmed known reaction state`, async () => {
    const h = harness();
    try {
      await h.flush(); await h.authorize(); h.reactions[0].resolve({ data: [{ story_id: book().pages[0].story_id }], error: null }); await h.flush(); await h.open();
      h.refresh(); await h.flush(); await h.authorize();
      if (failure === 'reject') h.reactions[1].reject(Error('unavailable'));
      else h.reactions[1].resolve({ data: null, error: Error('denied') });
      await h.flush(); assert.ok(h.visible('Liked')); assert.ok(!h.button('Liked').props.disabled);
    } finally { h.dispose(); }
  });
}

test('an old-account mutation cannot apply after ABA before React rerenders', async () => {
  const h = harness();
  try {
    await h.flush(); await h.authorize(); h.reactions[0].resolve({ data: [], error: null }); await h.flush(); await h.open(); const toggling = h.press('Like'); await h.flush();
    h.account('other'); h.account(OWNER);
    h.toggles[0].resolve({ data: { reacted: true }, error: null }); await toggling;
    await h.flush(); h.refresh(); await h.flush(); await h.authorize();
    assert.ok(!h.visible('Liked')); assert.equal(h.button('Loading reaction status').props.disabled, true);
  } finally { h.dispose(); }
});

for (const outcome of ['confirmed', 'rejected']) {
  test(`unmounted ${outcome} reaction completion cannot publish state or errors`, async () => {
    const h = harness();
    await h.flush(); await h.authorize(); h.reactions[0].resolve({ data: [], error: null }); await h.flush(); await h.open(); const toggling = h.press('Like'); await h.flush(); h.dispose();
    if (outcome === 'confirmed') h.toggles[0].resolve({ data: { reacted: true }, error: null });
    else h.toggles[0].reject(Error('late failure'));
    await toggling; await h.flush(); assert.equal(h.postUnmountWrites, 0);
  });
}

test('soundtrack confirmation does not discard a held optional reaction response', async () => {
  const h = harness();
  try {
    await h.flush(); await h.authorize(); await h.removeSoundtrack();
    h.reactions[0].resolve({ data: [{ story_id: book().pages[0].story_id }], error: null }); await h.flush(); await h.open();
    assert.ok(h.visible('Liked')); assert.ok(!h.button('Liked').props.disabled);
  } finally { h.dispose(); }
});

test('soundtrack confirmation invalidating a held refresh cannot strand unknown reactions as loading', async () => {
  const h = harness();
  try {
    await h.flush(); await h.authorize(); const initialReactions = h.reactions[0];
    h.refresh(); await h.flush(); const refreshing = h.books[1]; await h.removeSoundtrack();
    refreshing.resolve({ data: book(), error: null }); initialReactions.resolve({ data: [{ story_id: book().pages[0].story_id }], error: null }); await h.flush(); await h.open();
    assert.equal(h.reactions.length, 1, 'invalidated required response must not start an optional replacement query');
    assert.ok(!h.visible('Loading reaction status')); assert.equal(h.button('Reaction status unavailable').props.disabled, true);
  } finally { h.dispose(); }
});
