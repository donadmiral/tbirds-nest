const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/ScrollMemory.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function scenario(saved = 800, unavailableStorage = false) {
  const listeners = new Map(), timers = new Map(), frames = new Map();
  const storage = new Map([['pc:scroll:/musa', String(saved)]]), scrolls = [];
  let pathname = '/musa', effect, cleanup, nextId = 0;
  const dispatch = name => [...(listeners.get(name) || [])].forEach(fn => fn({}));
  const document = { documentElement: { scrollHeight: 1000 } };
  const window = {
    innerHeight: 800, scrollY: 0,
    sessionStorage: {
      getItem(key) { if (unavailableStorage) throw Error('Storage blocked'); return storage.get(key) || null; },
      setItem(key, value) { if (unavailableStorage) throw Error('Storage blocked'); storage.set(key, value); },
    },
    addEventListener(name, callback) { const set = listeners.get(name) || new Set(); set.add(callback); listeners.set(name, set); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    scrollTo(x, y) { scrolls.push([x, y]); this.scrollY = y; dispatch('scroll'); },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports, document, window,
    require(name) {
      if (name === 'react') return { useEffect: callback => { effect = callback; } };
      if (name === 'next/navigation') return { usePathname: () => pathname };
      throw Error('Unexpected module ' + name);
    },
    setTimeout(callback) { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  const render = next => { cleanup?.(); pathname = next; exports.ScrollMemory(); cleanup = effect(); };
  render(pathname);
  return {
    window, document, scrolls, timers, frames, storage, dispatch,
    navigate: render,
    tick() { const [id, callback] = [...timers][0] || []; assert.ok(callback, 'Expected a pending restore'); timers.delete(id); callback(); },
    frame() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } },
    unmount() { cleanup?.(); cleanup = undefined; },
    listenerCount() { return [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); },
  };
}

test('a profile restore cannot scroll a later route, even if its cancelled callback was already queued', () => {
  const h = scenario(), stale = [...h.timers.values()][0];
  assert.ok(stale);
  h.navigate('/home');
  assert.equal(h.timers.size, 0);
  h.document.documentElement.scrollHeight = 2400;
  stale();
  assert.deepEqual(h.scrolls, []);
  assert.equal(h.timers.size, 0);
  h.unmount();
  assert.equal(h.listenerCount(), 0);
});

test('touch, pointer, wheel and key input cancel delayed restoration without disabling scroll memory', () => {
  for (const intent of ['pointerdown', 'touchstart', 'wheel', 'keydown']) {
    const h = scenario(), stale = [...h.timers.values()][0];
    h.dispatch(intent);
    assert.equal(h.timers.size, 0, intent);
    h.document.documentElement.scrollHeight = 2400;
    stale();
    assert.deepEqual(h.scrolls, [], intent);
    h.window.scrollY = 300; h.dispatch('scroll'); h.frame();
    assert.equal(h.storage.get('pc:scroll:/musa'), '300', intent);
    h.unmount();
  }
});

test('without intervening input, delayed profile content still restores the saved position once', () => {
  const h = scenario();
  h.tick();
  assert.deepEqual(h.scrolls, []);
  assert.equal(h.timers.size, 1);
  h.document.documentElement.scrollHeight = 2400;
  h.tick(); h.frame();
  assert.deepEqual(h.scrolls, [[0, 800]]);
  assert.equal(h.timers.size, 0);
  assert.equal(h.storage.get('pc:scroll:/musa'), '800');
  h.window.scrollY = 950; h.dispatch('scroll');
  const staleFrame = [...h.frames.values()][0];
  h.unmount(); staleFrame();
  assert.equal(h.storage.get('pc:scroll:/musa'), '800');
  assert.equal(h.frames.size, 0);
});

test('disabled storage and malformed offsets never interrupt navigation or schedule a restore', () => {
  for (const saved of [NaN, Infinity, -5]) {
    const h = scenario(saved);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.scrolls, []);
    h.unmount();
  }
  const blocked = scenario(800, true);
  blocked.window.scrollY = 200; blocked.dispatch('scroll'); blocked.frame();
  assert.equal(blocked.timers.size, 0);
  blocked.unmount();
});
