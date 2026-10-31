const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Only unrelated visual children and browser primitives are doubled. These
// tests execute PostCard, MediaGallery, their shared hook/store, write helper,
// and confirmed comment-count publisher together through their real handlers.
const sources = new Map();
sources.set('../../shared/collaborationPeople', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../shared/collaborationPeople.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText);
for (const file of ['components/PostCard.tsx', 'components/MediaGallery.tsx', 'lib/usePostInteractions.ts',
  'lib/postInteractionState.ts', 'lib/interactions.ts', 'lib/commentCounts.ts', 'lib/profileLookup.ts', 'lib/useBrowserMediaQuery.ts']) {
  sources.set('@/' + file.replace(/\.tsx?$/, ''), ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText);
}
// Parsing the soundtrack is application logic, not a decorative child. Load
// the real shared parser so the integration harness matches the current gallery.
sources.set('../../shared/soundtrack', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../shared/soundtrack.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText);
sources.set('../../shared/postMediaEditing', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../shared/postMediaEditing.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText);
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(text).join('') : text(node?.props?.children ?? '');
const nodes = tree => {
  const found = [];
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    found.push(node); walk(node.props?.children);
  };
  walk(tree); return found;
};
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const clickEvent = () => ({ preventDefault() {}, stopPropagation() {} });

function scenario() {
  let currentHooks, writeOverride = null, readFailure = false;
  const screens = [], modules = new Map(), listeners = new Map(), records = new Map();
  const writes = [], reads = [];
  const server = id => {
    if (!records.has(id)) records.set(id, { liked: false, bookmarked: false, likesCount: 4, bookmarksCount: 2, commentsCount: 1 });
    return records.get(id);
  };
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  const add = (type, listener) => { const set = listeners.get(type) || new Set(); set.add(listener); listeners.set(type, set); };
  const remove = (type, listener) => listeners.get(type)?.delete(listener);
  const document = { body: { style: {} }, documentElement: { clientWidth: 1200 }, activeElement: null, fullscreenElement: null };
  const window = { innerWidth: 1200, innerHeight: 900, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener: add, removeEventListener: remove,
    dispatchEvent: event => [...(listeners.get(event.type) || [])].forEach(listener => listener(event)), scrollTo() {} };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'qa' } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from(table) {
      const filters = {}; let operation = 'select', input, selection = '';
      const execute = async () => {
        if (operation !== 'select') {
          const call = { table, operation, input, filters: { ...filters } }; writes.push(call);
          const commit = () => {
            const row = server(input?.post_id || filters.post_id);
            const field = table === 'post_likes' ? 'liked' : 'bookmarked';
            const count = table === 'post_likes' ? 'likesCount' : 'bookmarksCount';
            const on = operation === 'insert';
            if (row[field] !== on) row[count] += on ? 1 : -1;
            row[field] = on; return { error: null };
          };
          return writeOverride ? writeOverride(call, commit) : commit();
        }
        if (!['posts', 'post_likes', 'post_bookmarks'].includes(table)) return { data: [], error: null };
        reads.push({ table, filters: { ...filters }, selection });
        if (readFailure) return { data: null, error: { message: 'read unavailable' } };
        const row = server(filters.id || filters.post_id);
        if (table === 'posts') return { data: selection === 'comments_count' ? { comments_count: row.commentsCount }
          : { likes_count: row.likesCount, bookmarks_count: row.bookmarksCount }, error: null };
        const found = table === 'post_likes' ? row.liked : row.bookmarked;
        return { data: found ? { post_id: filters.post_id } : null, error: null };
      };
      const chain = {
        select(value) { selection = value; return chain; }, eq(key, value) { filters[key] = value; return chain; },
        in() { return chain; }, order() { return chain; }, maybeSingle() { return chain; },
        insert(value) { operation = 'insert'; input = value; return chain; }, delete() { operation = 'delete'; return chain; },
        then(ok, bad) { return Promise.resolve().then(execute).then(ok, bad); },
      };
      return chain;
    },
  };
  const runtime = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }), Fragment: 'Fragment' };
  const load = id => {
    if (modules.has(id)) return modules.get(id).exports;
    if (id === 'react') return new Proxy({}, { get: (_, key) => (...args) => currentHooks[key](...args) });
    if (id === 'react/jsx-runtime') return runtime;
    if (id === '@/lib/supabase/client') return { createClient: () => client };
    if (id === '@/lib/pollCheck') return { usePollFlag: () => false };
    if (id === '@/lib/mediaPrefs') return { dataSaverEnabled: () => false };
    if (id === '@/lib/feed') return { timeAgo: () => 'now' };
    if (id === '@/lib/media') return { displayImageUrl: value => value, srcSetFor: () => ({}) };
    if (id === 'next/navigation') return { useRouter: () => ({ push() {} }) };
    if (id === 'next/link') return { __esModule: true, default: 'Link' };
    if (!sources.has(id)) return new Proxy({}, { get: (_, key) => key === 'getTierColor' ? () => null : String(key) });
    const module = { exports: {} }; modules.set(id, module);
    vm.runInNewContext(sources.get(id), { module, exports: module.exports, require: load, window, document, CustomEvent,
      ResizeObserver: class { observe() {} disconnect() {} }, setTimeout, clearTimeout, queueMicrotask });
    return module.exports;
  };
  const card = load('@/components/PostCard').PostCard, gallery = load('@/components/MediaGallery').MediaGallery;
  function mount(kind, initialProps) {
    let props = initialProps, cursor = 0, effects = [], tree, rootKey;
    const slots = [];
    const dom = { isConnected: true, getBoundingClientRect: () => ({ width: 600 }),
      addEventListener: add, removeEventListener: remove, contains: () => true, querySelectorAll: () => [], querySelector: () => null,
      focus() { document.activeElement = this; } };
    const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
    const screen = { dirty: true };
    const hooks = {
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
        return [slots[i], next => { const value = typeof next === 'function' ? next(slots[i]) : next;
          if (!Object.is(value, slots[i])) { slots[i] = value; screen.dirty = true; } }]; },
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn, deps }; return slots[i].value; },
      useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) {
        const previous = slots[i]; slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
      useLayoutEffect(fn, deps) { return hooks.useEffect(fn, deps); },
      useMemo(fn, deps) { return hooks.useCallback(fn, deps)(); },
      useSyncExternalStore(subscribe, snapshot) {
        const i = cursor++;
        if (!slots[i] || slots[i].subscribe !== subscribe) {
          const previous = slots[i]; slots[i] = { subscribe };
          effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = subscribe(() => { screen.dirty = true; }); });
        }
        return snapshot();
      },
    };
    Object.assign(screen, {
      render() {
        screen.dirty = false; currentHooks = hooks; cursor = 0;
        tree = (kind === 'card' ? card : gallery)(props);
        if (typeof tree?.type === 'function') {
          if (rootKey !== tree.key) {
            slots.forEach(value => value?.cleanup?.()); slots.length = 0; effects = []; cursor = 0; rootKey = tree.key;
          }
          while (typeof tree?.type === 'function') tree = tree.type(tree.props);
        }
        for (const node of nodes(tree)) if (node.props?.ref) node.props.ref.current = dom;
        const pending = effects; effects = []; pending.forEach(effect => effect());
      },
      find: predicate => nodes(tree).find(predicate),
      label: label => nodes(tree).find(node => node.props?.['aria-label'] === label),
      click(label) {
        const button = this.label(label) || this.find(node => node.type === 'button' && text(node).trim() === label);
        assert.ok(button, 'Missing button: ' + label); assert.notEqual(button.props.disabled, true, 'Disabled button: ' + label);
        button.props.onClick(clickEvent()); renderAll();
      },
      open() { const player = this.find(node => node.type === 'VideoPlayer'); assert.ok(player); player.props.onExpand(); screen.dirty = true; renderAll(); },
      update(next) { props = next; screen.dirty = true; renderAll(); },
    });
    Object.defineProperties(screen, {
      text: { get: () => text(tree) },
      likeTotal: { get: () => text(kind === 'card' ? screen.find(node => node.props?.title === 'See who liked this') : screen.label('Unlike') || screen.label('Like')).trim() },
      commentTotal: { get: () => text(screen.find(node => node.type === 'Link' && nodes(node.props.children).some(child => child.type === 'MessageCircle'))).trim() },
    });
    screens.push(screen); renderAll(); return screen;
  }
  function renderAll() {
    for (let round = 0; round < 20 && screens.some(screen => screen.dirty); round++) {
      screens.filter(screen => screen.dirty).forEach(screen => screen.render());
    }
    assert.ok(!screens.some(screen => screen.dirty), 'effects settled without a render loop');
  }
  const post = (id = 'post', overrides = {}) => ({ post_id: id, content: 'Controlled post', author_id: 'author', author_name: 'Author',
    author_username: 'author', author_avatar: null, created_at: '2026-10-20T00:00:00Z', likes_count: 4, bookmarks_count: 2,
    comments_count: 1, reposts_count: 0, viewer_liked: false, viewer_bookmarked: false, viewer_reposted: false,
    media: [{ id: 'synthetic-media', url: 'test.mp4', media_type: 'video', width: 640, height: 360 }], ...overrides });
  return { post, mount, server, writes, reads, client, helper: load('@/lib/commentCounts'), gallery,
    galleryProps: post => ({ postId: post.post_id, post, media: post.media }),
    setWrite(fn) { writeOverride = fn; }, setReadFailure(value) { readFailure = value; },
    async flush() { for (let i = 0; i < 3; i++) { await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setImmediate(resolve)); renderAll(); } },
    event(detail) { window.dispatchEvent(new CustomEvent('pc-comment-count-updated', { detail })); renderAll(); },
  };
}

test('real card like and viewer save handlers update both surfaces with confirmed totals', async () => {
  const app = scenario(), post = app.post(), card = app.mount('card', { post });
  const mediaProps = card.find(node => node.type === app.gallery).props;
  const viewer = app.mount('gallery', mediaProps); viewer.open(); await app.flush();
  app.server('post').likesCount = 9; card.click('Like'); await app.flush();
  assert.equal(card.label('Unlike').props['aria-pressed'], true);
  assert.equal(viewer.label('Unlike').props['aria-pressed'], true);
  assert.equal(card.likeTotal, '10'); assert.equal(viewer.likeTotal, '10');
  app.server('post').bookmarksCount = 7; viewer.click('Save post'); await app.flush();
  assert.equal(card.label('Unsave post').props['aria-pressed'], true);
  assert.equal(viewer.label('Unsave post').props['aria-pressed'], true);
  assert.equal(text(card.label('Unsave post')).trim(), '8');
  assert.equal(app.writes.length, 2);
  assert.equal(app.writes[0].input.user_id, 'qa');
});

test('card and independent pinned viewer share disabled, busy and status feedback while saving', async () => {
  const app = scenario(), post = app.post(), gate = defer();
  const card = app.mount('card', { post, hideMedia: true });
  const viewer = app.mount('gallery', app.galleryProps(post)); viewer.open(); await app.flush();
  app.setWrite((_call, commit) => gate.promise.then(commit)); viewer.click('Save post'); await app.flush();
  for (const screen of [card, viewer]) {
    const save = screen.label('Unsave post');
    assert.equal(save.props.disabled, true); assert.equal(save.props['aria-busy'], true);
    assert.ok(screen.find(node => node.props?.role === 'status'));
    assert.equal(screen.label('Like').props.disabled, true);
  }
  assert.equal(app.writes.length, 1); gate.resolve(); await app.flush();
  for (const screen of [card, viewer]) {
    assert.equal(screen.label('Unsave post').props.disabled, false);
    assert.equal(screen.label('Unsave post').props['aria-busy'], false);
    assert.equal(screen.find(node => node.props?.role === 'status'), undefined);
  }
});

test('a failed viewer write restores both surfaces and exposes the same accessible error', async () => {
  const app = scenario(), post = app.post(), card = app.mount('card', { post });
  const viewer = app.mount('gallery', app.galleryProps(post)); viewer.open(); await app.flush();
  app.setWrite(() => ({ error: { message: 'denied' } })); viewer.click('Like'); await app.flush();
  for (const screen of [card, viewer]) {
    assert.equal(screen.label('Like').props['aria-pressed'], false);
    assert.equal(screen.label('Like').props.disabled, false);
    assert.match(text(screen.find(node => node.props?.role === 'alert')), /could not update/i);
    assert.equal(screen.likeTotal, '4');
  }
});

test('Check status resolves an ambiguous saved result without sending another write', async () => {
  const app = scenario(), post = app.post(), card = app.mount('card', { post });
  const viewer = app.mount('gallery', app.galleryProps(post)); viewer.open(); await app.flush();
  app.setWrite((_call, commit) => { commit(); throw new Error('response lost'); }); app.setReadFailure(true);
  viewer.click('Save post'); await app.flush();
  for (const screen of [card, viewer]) {
    assert.equal(screen.label('Save post').props.disabled, true);
    assert.match(text(screen.find(node => node.props?.role === 'alert')), /could not confirm/i);
  }
  app.setReadFailure(false); viewer.click('Check status'); await app.flush();
  assert.equal(app.writes.length, 1);
  for (const screen of [card, viewer]) {
    assert.equal(screen.label('Unsave post').props['aria-pressed'], true);
    assert.equal(screen.label('Unsave post').props.disabled, false);
    assert.equal(screen.find(node => node.props?.role === 'alert'), undefined);
  }
});

test('confirmed comment publisher updates pinned desktop and mobile counts without touching another post', async () => {
  const app = scenario(), post = app.post(), card = app.mount('card', { post, hideMedia: true });
  const viewer = app.mount('gallery', app.galleryProps(post)); viewer.open();
  const other = app.mount('gallery', app.galleryProps(app.post('other', { comments_count: 3 }))); other.open(); await app.flush();
  app.server('post').commentsCount = 7;
  await app.helper.refreshCommentCount(app.client, 'post'); await app.flush();
  assert.equal(text(card.label('Show comments')).trim(), '7');
  assert.equal(viewer.commentTotal, '7');
  assert.equal(text(viewer.label('Show comments')).trim(), '7');
  assert.equal(other.commentTotal, '3');
  app.event({ postId: 'post', count: -1 }); app.event({ postId: 'post', count: '99' });
  assert.equal(viewer.commentTotal, '7');
});

test('changing the pinned post ignores an old count event and binds interactions to the new post', async () => {
  const app = scenario(), old = app.post(), viewer = app.mount('gallery', app.galleryProps(old)); viewer.open(); await app.flush();
  const next = app.post('next', { comments_count: 5, likes_count: 11 }); app.server('next').likesCount = 11;
  viewer.update(app.galleryProps(next)); viewer.open(); await app.flush();
  app.event({ postId: 'post', count: 77 });
  assert.equal(viewer.commentTotal, '5');
  viewer.click('Like'); await app.flush();
  assert.equal(app.writes.length, 1); assert.equal(app.writes[0].input.post_id, 'next');
  assert.equal(viewer.likeTotal, '12');
});
