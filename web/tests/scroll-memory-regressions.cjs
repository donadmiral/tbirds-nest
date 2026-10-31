const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function compile(relative) {
  return ts.transpileModule(fs.readFileSync(path.join(__dirname, relative), 'utf8'), {
    fileName: relative,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}
const source = compile('../components/ScrollMemory.tsx');
const cacheSource = compile('../../shared/navigationCache.ts');

function scenario(saved = 800, { height = 1000, route = '/musa', owner = 'a' } = {}) {
  const listeners = new Map(), frames = new Map(), scrolls = [];
  let pathname, search, effect, cleanup, nextId = 0, now = 0, storageCalls = 0;
  let session = { owner, scope: owner ? '1:' + owner : null, revision: 1, initialized: true, changed: false };
  const cacheExports = {};
  vm.runInNewContext(cacheSource, { exports: cacheExports, AbortController, setTimeout, clearTimeout });
  const cache = cacheExports.createNavigationCache({ clock: () => now });
  cache.setScope(session.scope);
  const store = { cache, subscribe() { return () => {}; }, getSnapshot: () => session, getServerSnapshot: () => session };
  const dispatch = name => [...(listeners.get(name) || [])].forEach(fn => fn({}));
  const document = { documentElement: { scrollHeight: height } };
  const window = {
    innerHeight: 800, scrollX: 0, scrollY: 0, location: { pathname: '', search: '' },
    // Route memory must work even when browser persistence is unavailable. It
    // now intentionally uses only the account/session-scoped in-memory cache.
    sessionStorage: {
      getItem() { storageCalls++; throw Error('Storage blocked'); },
      setItem() { storageCalls++; throw Error('Storage blocked'); },
    },
    addEventListener(name, callback) { const set = listeners.get(name) || new Set(); set.add(callback); listeners.set(name, set); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    scrollTo({ left, top }) { scrolls.push([left, top]); this.scrollY = top; dispatch('scroll'); },
  };
  const key = next => { const url = new URL(next, 'https://fixture.invalid'); return 'scroll:' + url.pathname + '?' + url.searchParams.toString(); };
  cache.save(session.scope, key(route), saved);
  const exports = {};
  vm.runInNewContext(source, {
    exports, document, window, URLSearchParams, performance: { now: () => now },
    require(name) {
      if (name === 'react') return {
        useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
        useLayoutEffect: callback => { effect = callback; },
      };
      if (name === 'next/navigation') return { usePathname: () => pathname, useSearchParams: () => new URLSearchParams(search) };
      if (name === '@/lib/navigationCache') return { getNavigationStore: () => store };
      throw Error('Unexpected module ' + name);
    },
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  const render = next => {
    const url = new URL(next, 'https://fixture.invalid');
    pathname = window.location.pathname = url.pathname;
    search = window.location.search = url.search;
    cleanup?.(); exports.ScrollMemory(); cleanup = effect();
  };
  render(route);
  return {
    window, document, scrolls, frames, listeners, dispatch,
    navigate: render,
    read: next => cache.read(session.scope, key(next)),
    save: (next, value) => cache.save(session.scope, key(next), value),
    frame(ms = 16) { now += ms; for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } },
    switchOwner(next) {
      session = { owner: next, scope: next ? `${session.revision + 1}:${next}` : null, revision: session.revision + 1, initialized: true, changed: true };
      cache.setScope(session.scope);
    },
    unmount() { cleanup?.(); cleanup = undefined; },
    storageCalls: () => storageCalls,
    listenerCount: () => [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0),
  };
}

test('a profile restore cannot scroll a later route, even if its cancelled callback was already queued', () => {
  const h = scenario(), stale = [...h.frames.values()][0];
  assert.ok(stale);
  h.navigate('/home');
  assert.equal(h.frames.size, 0);
  h.document.documentElement.scrollHeight = 2400;
  stale();
  assert.deepEqual(h.scrolls, []);
  assert.equal(h.frames.size, 0);
  h.unmount();
  assert.equal(h.listenerCount(), 0);
});

test('touch, pointer, wheel and key input cancel delayed restoration without disabling scroll memory', () => {
  for (const intent of ['pointerdown', 'touchstart', 'wheel', 'keydown']) {
    const h = scenario(), stale = [...h.frames.values()][0];
    h.dispatch(intent);
    assert.equal(h.frames.size, 0, intent);
    h.document.documentElement.scrollHeight = 2400;
    stale();
    assert.deepEqual(h.scrolls, [], intent);
    h.window.scrollY = 300; h.dispatch('scroll');
    assert.equal(h.read('/musa'), 300, intent);
    h.unmount();
  }
});

test('without intervening input, delayed content restores once and later scrolls persist before unmount', () => {
  const h = scenario();
  h.frame();
  assert.deepEqual(h.scrolls, []);
  assert.equal(h.frames.size, 1);
  h.document.documentElement.scrollHeight = 2400;
  h.frame();
  assert.deepEqual(h.scrolls, [[0, 800]]);
  assert.equal(h.frames.size, 0);
  const staleScroll = [...h.listeners.get('scroll')][0];
  h.window.scrollY = 950; h.dispatch('scroll');
  assert.equal(h.read('/musa'), 950);
  h.unmount(); h.window.scrollY = 1200; staleScroll();
  assert.equal(h.read('/musa'), 950);
  assert.equal(h.frames.size, 0);
  assert.equal(h.listenerCount(), 0);
});

test('malformed offsets never interrupt navigation or schedule a restore', () => {
  for (const saved of [NaN, Infinity, -5, '800', null]) {
    const h = scenario(saved);
    assert.equal(h.frames.size, 0);
    assert.deepEqual(h.scrolls, []);
    h.unmount();
    assert.equal(h.read('/musa'), 0);
  }
});

test('resolved content restores before paint without reading or writing browser persistence', () => {
  const h = scenario(800, { height: 2400 });
  assert.deepEqual(h.scrolls, [[0, 800]]);
  assert.equal(h.frames.size, 0);
  h.window.scrollY = 900; h.dispatch('scroll'); h.unmount();
  assert.equal(h.read('/musa'), 900);
  assert.equal(h.storageCalls(), 0);
});

test('shorter content has a bounded restoration deadline and clamps to the available height', () => {
  const h = scenario();
  h.frame(2001);
  assert.deepEqual(h.scrolls, [[0, 200]]);
  assert.equal(h.frames.size, 0);
  h.unmount();
  assert.equal(h.read('/musa'), 200);
});

test('sign-out and an account roundtrip invalidate queued restoration and old scroll writers', () => {
  for (const roundtrip of [false, true]) {
    const h = scenario(), stale = [...h.frames.values()][0], staleScroll = [...h.listeners.get('scroll')][0];
    h.switchOwner(roundtrip ? 'b' : null);
    if (roundtrip) h.switchOwner('a');
    h.document.documentElement.scrollHeight = 2400;
    stale(); h.window.scrollY = 900; staleScroll(); h.unmount();
    assert.deepEqual(h.scrolls, []);
    assert.equal(h.read('/musa'), null);
    assert.equal(h.frames.size, 0);
  }
});

test('different query destinations retain separate positions within the same session', () => {
  const h = scenario(800, { height: 2400, route: '/search?q=coast' });
  h.save('/search?q=city', 300);
  h.navigate('/search?q=city');
  assert.deepEqual(h.scrolls, [[0, 800], [0, 300]]);
  assert.equal(h.read('/search?q=coast'), 800);
  h.window.scrollY = 450; h.dispatch('scroll');
  assert.equal(h.read('/search?q=city'), 450);
  h.navigate('/search?q=coast');
  assert.deepEqual(h.scrolls, [[0, 800], [0, 300], [0, 800]]);
  h.unmount();
});
