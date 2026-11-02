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
function harness({ heldAuth = false, heldMedia = false, heldBody = false, actualMedia = false, fakeClock = false, heldAnimation = false, reducedMotion = true, platform = 'ios', paged = false } = {}) {
  const slots = [], effects = [], books = [], reactions = [], toggles = [], media = [], soundtrackSaves = [], authListeners = new Set(), appListeners = new Set();
  const animationAcknowledgements = [], sessions = [], bodies = [];
  const timers = new Map(); let clock = 0, timerId = 0;
  const schedule = fakeClock ? (fn, ms = 0) => { const id = ++timerId; timers.set(id, { fn, at: clock + ms }); return id; } : setTimeout;
  const unschedule = fakeClock ? id => timers.delete(id) : clearTimeout;
  let cursor = 0, dirty = true, mounted = true, tree, owner = OWNER, postUnmountWrites = 0, availableSession = !heldAuth;
  const session = deferred();
  const sessionResult = () => ({ data: { session: { user: { id: owner }, access_token: 'synthetic-test-token' } }, error: null });
  if (!heldAuth) session.resolve(sessionResult());
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
    Image: { prefetch: async () => true },
    AppState: appState, Alert: { alert() {} }, Platform: { OS: platform },
    StyleSheet: { create: value => value, absoluteFill: {}, hairlineWidth: 1 },
    useWindowDimensions: () => ({ width: 393, height: 852 }),
    AccessibilityInfo: { isReduceMotionEnabled: async () => reducedMotion, addEventListener: () => ({ remove() {} }) },
    Animated: { Value: AnimatedValue, View: 'AnimatedView', timing: () => ({
      start(callback) {
        if (typeof callback !== 'function') return;
        if (heldAnimation) animationAcknowledgements.push(callback);
        else callback({ finished: true });
      }, stop() {},
    }) },
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
      getSession: () => {
        const task = sessions.length ? deferred() : session;
        const resolve = task.resolve;
        task.resolve = value => { if (!value.error) availableSession = true; resolve(value); };
        if (availableSession) task.resolve(sessionResult());
        sessions.push(task); return task.promise;
      },
      onAuthStateChange(callback) { authListeners.add(callback); return { data: { subscription: { unsubscribe: () => authListeners.delete(callback) } } }; },
    },
    rpc(name, args) {
      if (name === 'get_paged_reader_capabilities') return Promise.resolve({ data: { version: 1, books: paged, inbox: false }, error: null });
      if (name === 'get_next_memory_book_v2') return Promise.resolve({ data: null, error: null });
      if (name === 'get_memory_book' || name === 'get_memory_book_page_v2') {
        if (!heldBody) return queued(books, { name, args, owner });
        // Execute the installed PostgREST parser while response.text is held.
        const { PostgrestClient } = require('@supabase/postgrest-js');
        return new PostgrestClient('https://reader.invalid/rest/v1', { fetch: async (_url, init) => {
          await queued(books, { args, owner, signal: init.signal });
          return { ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }),
            text: () => queued(bodies, {}) };
        } }).rpc(name, args);
      }
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
    'src/lib/navigationCache': { navigationScope: () => owner ? `test:${owner}` : null },
    'src/services/contentMedia': {
      hydrateMemoryAlbumMedia: rows => {
        if (actualMedia) return load('shared/contentMedia.ts').hydrateContentMedia({
          auth: { getSession: () => queued(media, { rows, phase: 'hydration-session' }), getUser: async () => { throw Error('Held hydration session must prevent verification'); } },
          functions: { invoke: async () => { throw Error('Held hydration session must prevent signing'); } },
        }, 'https://reader.invalid', rows, 'memory_album');
        return heldMedia ? queued(media, { rows }) : Promise.resolve(rows);
      },
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
    'modules/boomerang/storyVideo': { StoryVideoView: 'VideoView', prewarmStoryVideo() {}, useStoryVideoPlayer() { throw Error('Text-only loading cases must not instantiate a video player'); } },
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
      if (key === 'src/services/memoryBooks') return load(`${key}.ts`);
      if (key.startsWith('src/components/')) return { __esModule: true, default: path.basename(key) };
      throw Error(`Unhandled import ${name} in ${file}`);
    };
    vm.runInNewContext(ts.transpileModule(source, { fileName: absolute, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText,
      { module, exports: module.exports, require: requireModule, console, Promise, Date, Set, Map, URL, AbortController, setTimeout: schedule, clearTimeout: unschedule,
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
    books, reactions, toggles, media, soundtrackSaves, session, sessions, bodies, flush,
    async tick(ms) { clock += ms; for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); } await flush(); },
    get timerCount() { return timers.size; },
    commit: render,
    acknowledgeAnimations(finished = true) { animationAcknowledgements.splice(0).forEach(callback => callback({ finished })); },
    visible(label) { return nodes(tree).some(node => node.props?.accessibilityLabel === label || node.type === 'Text' && words(node) === label); },
    loading() { return nodes(tree).some(node => node.type === 'ActivityIndicator'); },
    text() { return nodes(tree).filter(node => node.type === 'Text').map(words).join(' '); },
    button(label) {
      const node = nodes(tree).find(node => node.type === 'TouchableOpacity' && (node.props.accessibilityLabel === label || words(node) === label));
      assert.ok(node, `visible button ${label}`); return node;
    },
    press(label) { const node = h.button(label); assert.ok(!node.props.disabled, `enabled button ${label}`); return node.props.onPress(); },
    async authorize(value = book(), index = books.length - 1) {
      await flush(); assert.ok(books[index], `book request ${index}`); const task = books[index];
      if (task.name === 'get_memory_book_page_v2') {
        const start = task.args.p_cursor?.after || 0, end = Math.min(value.pages.length, start + 24);
        value = { ...(start === 0 ? value : { id: value.id, can_view: value.can_view }), version: 2,
          metadata_included: start === 0, revision: '1', pages: value.pages.slice(start, end), has_more: end < value.pages.length,
          next_cursor: end < value.pages.length ? { version: 2, viewer: owner, album: value.id, revision: '1', after: end } : null };
      }
      task.resolve({ data: value, error: null }); await flush();
    },
    get nodes() { return nodes(tree); },
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
    account(next) { owner = next; availableSession = true; for (const listener of [...authListeners]) listener(next ? 'SIGNED_IN' : 'SIGNED_OUT', next ? { user: { id: next } } : null); },
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

const largeBook = () => book('book-a', Array.from({ length: 61 }, (_, i) => ({
  id: `page-${i}`, story_id: `story-${i}`, media_type: 'text', caption: `Memory ${i}`, sort_order: i,
})));
for (const action of ['film', 'settings', 'grid']) {
  test(`paged native ${action} waits for all memories while the first authorized window remains readable`, async () => {
    const h = harness({ paged: true }); const full = largeBook();
    try {
      await h.flush(); await h.authorize(full, 0);
      assert.ok(h.visible('Open book')); assert.equal(h.books.length, 2, 'one adjacent window preloads on the cover');
      if (action === 'film') h.press('Play continuous memory film with original music');
      else if (action === 'settings') h.press('Edit memory book');
      else { await h.open(); assert.ok(h.visible('Page 1 of 61')); h.press('View all pages'); }
      await h.flush();
      assert.equal(h.nodes.some(node => node.type === 'MemoryFilm'), false);
      assert.equal(h.nodes.some(node => node.type === 'MemoryCoverControls'), false);
      assert.equal(h.visible('Open memory 61'), false);
      await h.authorize(full, 1);
      assert.equal(h.books.length, 3); assert.equal(h.nodes.some(node => node.type === 'MemoryFilm'), false);
      await h.authorize(full, 2);
      if (action === 'film') assert.equal(h.nodes.find(node => node.type === 'MemoryFilm').props.pages.length, 61);
      if (action === 'settings') assert.ok(h.nodes.some(node => node.type === 'MemoryBookCover' && node.props.coverPages?.length === 61), 'the editor receives every page for cover selection');
      if (action === 'grid') assert.ok(h.visible('Open memory 61'));
      assert.ok(h.books.every(request => request.args.p_limit === 24));
    } finally { h.dispose(); }
  });
}

test('paged native continuation failure leaves the loaded book readable and cannot open a partial film', async () => {
  const h = harness({ paged: true });
  try {
    await h.flush(); await h.authorize(largeBook(), 0); h.press('Play continuous memory film with original music');
    h.books[1].reject(Error('temporary continuation failure')); await h.flush();
    assert.ok(h.visible('Open book')); assert.ok(!h.nodes.some(node => node.type === 'MemoryFilm'));
    assert.match(h.text(), /More memories could not load/);
    await h.open(); assert.ok(h.visible('Page 1 of 61'));
  } finally { h.dispose(); }
});

test('paged native account change retires the pending complete-film intent and old continuation', async () => {
  const h = harness({ paged: true });
  try {
    await h.flush(); await h.authorize(largeBook(), 0); h.press('Play continuous memory film with original music');
    const old = h.books[1]; h.account('other'); await h.flush();
    old.resolve({ data: { version: 2, id: 'book-a', can_view: true, metadata_included: false,
      revision: '1', pages: [], has_more: false, next_cursor: null }, error: null }); await h.flush();
    assert.ok(!h.nodes.some(node => node.type === 'MemoryFilm'));
    assert.ok(!h.visible('Open book'), 'the replacement account must authorize its own book');
  } finally { h.dispose(); }
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
    await h.flush(); assert.equal(h.books.length, 2, 'the changed auth scope starts its own fresh authorization'); await h.authorize();
    assert.ok(h.visible('Open book')); await h.open();
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

for (const platform of ['ios', 'android']) {
  test(`${platform} authorized reader entry does not wait for native animation completion`, async () => {
    const h = harness({ heldAnimation: true, reducedMotion: false, platform });
    try {
      await h.flush(); await h.authorize();
      h.press('Open book'); h.commit();
      assert.ok(h.visible('Page 1 of 2'), 'the first committed press renders the authorized page without an animation acknowledgement');
      assert.ok(h.visible('Close memory book')); assert.ok(!h.visible('Open book'));
    } finally { h.dispose(); }
  });
}

test('reduced-motion reader entry also needs no animation acknowledgement', async () => {
  const h = harness({ heldAnimation: true, reducedMotion: true });
  try {
    await h.flush(); await h.authorize(); h.press('Open book'); h.commit();
    assert.ok(h.visible('Page 1 of 2')); assert.ok(h.visible('Close memory book'));
  } finally { h.dispose(); }
});

test('an interrupted decorative animation cannot prevent authorized reader entry', async () => {
  const h = harness({ heldAnimation: true, reducedMotion: false });
  try {
    await h.flush(); await h.authorize(); h.press('Open book');
    h.acknowledgeAnimations(false); await h.flush();
    assert.ok(h.visible('Page 1 of 2')); assert.ok(!h.visible('Open book'));
  } finally { h.dispose(); }
});

test('explicit close returns to the cover and a later press opens the reader again', async () => {
  const h = harness({ heldAnimation: true, reducedMotion: false });
  try {
    await h.flush(); await h.authorize(); h.press('Open book'); h.acknowledgeAnimations(true); await h.flush();
    assert.ok(h.visible('Page 1 of 2'));
    h.press('Close memory book'); await h.flush();
    assert.ok(h.visible('Open book')); assert.ok(!h.visible('Page 1 of 2'));
    h.acknowledgeAnimations(true); await h.flush();
    assert.ok(h.visible('Open book'), 'late decorative acknowledgement cannot undo an explicit close');
    h.press('Open book'); h.acknowledgeAnimations(true); await h.flush();
    assert.ok(h.visible('Page 1 of 2'));
  } finally { h.dispose(); }
});

test('route replacement discards the previous reader entry and any delayed acknowledgement', async () => {
  const h = harness({ heldAnimation: true, reducedMotion: false });
  try {
    await h.flush(); await h.authorize(); h.press('Open book'); h.commit();
    h.route('book-b'); await h.flush(); assert.ok(h.loading()); assert.ok(!h.visible('Page 1 of 2'));
    await h.authorize(book('book-b'));
    h.acknowledgeAnimations(true); await h.flush();
    assert.ok(h.visible('Open book')); assert.ok(!h.visible('Page 1 of 2')); assert.match(h.text(), /Book book-b/);
  } finally { h.dispose(); }
});

test('account replacement hides the old reader until its new authorized book read', async () => {
  const h = harness({ heldAnimation: true, reducedMotion: false });
  try {
    await h.flush(); await h.authorize(); h.press('Open book'); h.commit();
    h.account('replacement-viewer'); await h.flush();
    assert.ok(h.loading()); assert.ok(!h.visible('Page 1 of 2'));
    h.acknowledgeAnimations(true); await h.flush();
    assert.ok(!h.visible('Page 1 of 2'));
    await h.authorize({ ...book(), is_owner: false });
    assert.ok(h.visible('Open book')); assert.ok(!h.visible('Page 1 of 2')); assert.ok(!h.visible('Edit memory book'));
  } finally { h.dispose(); }
});

test('unmount rejects late reader-entry animation acknowledgement without a state write', async () => {
  const h = harness({ heldAnimation: true, reducedMotion: false });
  await h.flush(); await h.authorize(); h.press('Open book'); h.dispose();
  h.acknowledgeAnimations(true); await h.flush();
  assert.equal(h.postUnmountWrites, 0);
});

test('ordinary same-book refresh preserves the already opened reader', async () => {
  const h = harness({ heldAnimation: true, reducedMotion: false });
  try {
    await h.flush(); await h.authorize(); h.press('Open book'); h.acknowledgeAnimations(true); await h.flush();
    assert.ok(h.visible('Page 1 of 2'));
    h.refresh(); await h.flush(); assert.ok(h.visible('Page 1 of 2'));
    await h.authorize({ ...book(), title: 'Updated same book' });
    assert.ok(h.visible('Page 1 of 2')); assert.match(h.text(), /Updated same book/);
  } finally { h.dispose(); }
});


// Required-read recoverability: these clocks control JS only, not UIKit stalls.
test('held initial session has a bounded reader wait and Retry starts a fresh attempt', async () => {
  const h = harness({ heldAuth: true, fakeClock: true });
  try {
    await h.flush(); await h.tick(12001);
    assert.equal(h.loading(), false); assert.ok(h.visible('Retry')); assert.equal(h.books.length, 0);
    h.press('Retry'); await h.flush(); assert.equal(h.sessions.length, 2); assert.ok(h.loading());
    h.sessions[0].resolve({ data: { session: { user: { id: OWNER } } }, error: null }); await h.flush();
    assert.equal(h.books.length, 0, 'expired attempt cannot publish a late session');
    h.sessions[1].resolve({ data: { session: { user: { id: OWNER } } }, error: null }); await h.flush(); await h.authorize();
    assert.ok(h.visible('Edit memory book')); assert.equal(h.timerCount, 0);
  } finally { h.dispose(); }
});

test('authoritative auth event retires initial read timeout and stale rejection', async () => {
  const h = harness({ heldAuth: true, fakeClock: true });
  try {
    await h.flush(); h.account(OWNER); await h.flush(); await h.authorize();
    h.session.reject(Error('obsolete session failure')); await h.tick(12001);
    assert.ok(h.visible('Edit memory book')); assert.ok(!h.visible('Retry')); assert.equal(h.timerCount, 0);
  } finally { h.dispose(); }
});

test('a later authoritative auth event can recover a timed-out reader', async () => {
  const h = harness({ heldAuth: true, fakeClock: true });
  try { await h.flush(); await h.tick(12001); assert.ok(h.visible('Retry')); h.account(OWNER); await h.flush(); await h.authorize(); assert.ok(h.visible('Edit memory book')); }
  finally { h.dispose(); }
});

test('held required book times out, aborts supported transport and retries without a late overwrite', async () => {
  const h = harness({ fakeClock: true });
  try {
    await h.flush(); const old = h.books[0]; await h.tick(15001);
    assert.equal(old.signal?.aborted, true); assert.equal(h.loading(), false); assert.ok(h.visible('Retry'));
    h.press('Retry'); await h.flush(); assert.ok(h.loading()); assert.equal(h.books.length, 2);
    old.resolve({ data: { ...book(), title: 'OLD' }, error: null }); await h.flush(); assert.ok(!h.visible('Edit memory book'));
    await h.authorize({ ...book(), title: 'CURRENT' }); assert.ok(h.visible('Edit memory book')); assert.ok(!h.text().includes('OLD'));
  } finally { h.dispose(); }
});

test('installed PostgREST response-body wait is included in the required book budget', async () => {
  const h = harness({ heldBody: true, fakeClock: true });
  try {
    await h.flush(); h.books[0].resolve(); await h.flush(); assert.equal(h.bodies.length, 1);
    await h.tick(15001); assert.ok(h.visible('Retry')); assert.equal(h.loading(), false); assert.equal(h.books[0].signal.aborted, true);
    h.bodies[0].resolve(JSON.stringify(book())); await h.flush(); assert.ok(!h.visible('Edit memory book')); assert.equal(h.reactions.length, 0);
  } finally { h.dispose(); }
});

test('actual private-media authorization keeps its existing20s stage budget and fails honestly', async () => {
  const h = harness({ actualMedia: true, fakeClock: true });
  try {
    await h.flush(); const value = book(); value.pages[0] = { ...value.pages[0], media_type: 'image', media_url: 'https://reader.invalid/storage/v1/object/public/story-media/a/photo.png' };
    await h.authorize(value); assert.equal(h.media.length, 1); await h.tick(15001); assert.ok(h.loading());
    await h.tick(5000); assert.equal(h.loading(), false); assert.ok(h.visible('Retry')); assert.ok(!h.visible('Edit memory book')); assert.equal(h.reactions.length, 0);
  } finally { h.dispose(); }
});

test('valid delayed auth and book results within their budgets still load real content', async () => {
  const h = harness({ heldAuth: true, fakeClock: true });
  try {
    await h.flush(); await h.tick(11000); assert.ok(h.loading()); h.session.resolve({ data: { session: { user: { id: OWNER } } }, error: null }); await h.flush();
    await h.tick(14000); assert.ok(h.loading()); await h.authorize(); assert.ok(h.visible('Edit memory book')); assert.equal(h.timerCount, 0);
  } finally { h.dispose(); }
});

test('route replacement cancels an old book and keeps late failure from the new reader', async () => {
  const h = harness({ fakeClock: true });
  try {
    await h.flush(); const old = h.books[0]; h.route('book-b'); await h.flush(); assert.equal(old.signal?.aborted, true);
    await h.authorize(book('book-b')); old.reject(Error('obsolete route failure')); await h.flush();
    assert.ok(h.visible('Edit memory book')); assert.ok(!h.visible('Retry')); assert.match(h.text(), /Book book-b/);
  } finally { h.dispose(); }
});

test('account ABA before commit restarts required authorization instead of stranding the spinner', async () => {
  const h = harness({ fakeClock: true });
  try {
    await h.flush(); const old = h.books[0]; h.account('other-account'); h.account(OWNER); await h.flush();
    assert.equal(old.signal?.aborted, true); assert.equal(h.books.length, 2);
    old.resolve({ data: book(), error: null }); await h.flush(); assert.ok(!h.visible('Edit memory book'));
    await h.authorize(); assert.ok(h.visible('Edit memory book'));
  } finally { h.dispose(); }
});

for (const phase of ['auth', 'book', 'media']) test(`unmount retires held ${phase} and clears reader timers`, async () => {
  const h = harness({ heldAuth: phase === 'auth', heldMedia: phase === 'media', fakeClock: true });
  await h.flush(); if (phase === 'media') await h.authorize(); h.dispose();
  assert.equal(h.timerCount, 0);
  if (phase === 'auth') h.session.resolve({ data: { session: { user: { id: OWNER } } }, error: null });
  else if (phase === 'book') { assert.equal(h.books[0].signal?.aborted, true); h.books[0].resolve({ data: book(), error: null }); }
  else h.media[0].resolve([book()]);
  await h.flush(); assert.equal(h.postUnmountWrites, 0);
});


for (const failure of ['rejection', 'error-result']) test(`initial session ${failure} exposes Retry without a book read`, async () => {
  const h = harness({ heldAuth: true, fakeClock: true });
  try {
    await h.flush();
    if (failure === 'rejection') h.session.reject(Error('session unavailable'));
    else h.session.resolve({ data: { session: null }, error: Error('session unavailable') });
    await h.flush(); assert.ok(h.visible('Retry')); assert.equal(h.loading(), false); assert.equal(h.books.length, 0); assert.equal(h.timerCount, 0);
  } finally { h.dispose(); }
});

test('ordinary same-owner auth refresh neither restarts nor cancels the active required book', async () => {
  const h = harness({ fakeClock: true });
  try {
    await h.flush(); const current = h.books[0]; h.account(OWNER); await h.flush();
    assert.equal(h.books.length, 1); assert.notEqual(current.signal?.aborted, true);
    await h.authorize(); assert.ok(h.visible('Edit memory book'));
  } finally { h.dispose(); }
});
