const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function load(code, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, AbortController, setTimeout, clearTimeout, ...globals });
  return module.exports;
}
const { createNavigationCache } = load(compile('../shared/navigationCache.ts'));
const { readAsyncBlockHeight, rememberAsyncBlockSize, forgetAsyncBlockSize } = load(compile('lib/asyncBlockGeometry.ts'));

test('geometry is bounded in one session-cache entry without evicting route data', () => {
  const cache = createNavigationCache({ maxEntries: 3 }); cache.setScope('session-a');
  cache.save('session-a', 'home:personal', { marker: 'home' }); cache.save('session-a', 'messages', { marker: 'messages' });
  for (let index = 0; index < 200; index++) rememberAsyncBlockSize(cache, 'session-a', 'poll:' + index, 600, index + 20);
  assert.equal(cache.read('session-a', 'home:personal').marker, 'home');
  assert.equal(cache.read('session-a', 'messages').marker, 'messages');
  assert.equal(readAsyncBlockHeight(cache, 'session-a', 'poll:0', 600), null);
  assert.equal(readAsyncBlockHeight(cache, 'session-a', 'poll:199', 600), 219);
  const memory = cache.read('session-a', 'layout:async-blocks:v1');
  assert.equal(memory.length, 128);
  for (const [id, size] of memory) {
    assert.match(id, /^poll:/); assert.deepEqual(Object.keys(size).sort(), ['height', 'width']);
    assert.equal(typeof size.width, 'number'); assert.equal(typeof size.height, 'number');
  }
});

test('width changes, invalid sizes, account changes and old-scope callbacks cannot reuse geometry', () => {
  const cache = createNavigationCache(); cache.setScope('session-a');
  rememberAsyncBlockSize(cache, 'session-a', 'quote:post', 600, 72);
  assert.equal(readAsyncBlockHeight(cache, 'session-a', 'quote:post', 600), 72);
  assert.equal(readAsyncBlockHeight(cache, 'session-a', 'quote:post', 599), null);
  for (const invalid of [0, -1, NaN, Infinity]) {
    rememberAsyncBlockSize(cache, 'session-a', 'quote:post', 600, invalid);
    assert.equal(readAsyncBlockHeight(cache, 'session-a', 'quote:post', invalid), null);
  }
  cache.setScope('session-b'); rememberAsyncBlockSize(cache, 'session-a', 'quote:post', 600, 999);
  assert.equal(readAsyncBlockHeight(cache, 'session-b', 'quote:post', 600), null);
  cache.setScope('session-a'); assert.equal(readAsyncBlockHeight(cache, 'session-a', 'quote:post', 600), null);
});

test('new content replaces old measurements and empty/error results forget only their own block', () => {
  const cache = createNavigationCache(); cache.setScope('session-a');
  rememberAsyncBlockSize(cache, 'session-a', 'poll:post', 600, 153);
  rememberAsyncBlockSize(cache, 'session-a', 'quote:post', 600, 72);
  rememberAsyncBlockSize(cache, 'session-a', 'poll:post', 600, 84);
  assert.equal(readAsyncBlockHeight(cache, 'session-a', 'poll:post', 600), 84);
  forgetAsyncBlockSize(cache, 'session-a', 'poll:post');
  assert.equal(readAsyncBlockHeight(cache, 'session-a', 'poll:post', 600), null);
  assert.equal(readAsyncBlockHeight(cache, 'session-a', 'quote:post', 600), 72);
});

test('narrow detail measurements do not replace the same post\'s wider Home footprint', () => {
  const cache = createNavigationCache(); cache.setScope('session-a');
  rememberAsyncBlockSize(cache, 'session-a', 'quote:post', 600, 72);
  rememberAsyncBlockSize(cache, 'session-a', 'quote:post', 400, 96);
  assert.equal(readAsyncBlockHeight(cache, 'session-a', 'quote:post', 600), 72);
  assert.equal(readAsyncBlockHeight(cache, 'session-a', 'quote:post', 400), 96);
  rememberAsyncBlockSize(cache, 'session-a', 'quote:post', 400, 120);
  assert.equal(readAsyncBlockHeight(cache, 'session-a', 'quote:post', 600), 72);
  assert.equal(readAsyncBlockHeight(cache, 'session-a', 'quote:post', 400), 120);
  forgetAsyncBlockSize(cache, 'session-a', 'quote:post');
  assert.equal(readAsyncBlockHeight(cache, 'session-a', 'quote:post', 600), null);
  assert.equal(readAsyncBlockHeight(cache, 'session-a', 'quote:post', 400), null);
});

function componentHarness() {
  const cache = createNavigationCache(), listeners = new Set(); cache.setScope('session-a');
  let snapshot = { scope: 'session-a' }, hooks;
  const store = { cache, getSnapshot: () => snapshot, getServerSnapshot: () => ({ scope: null }), subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
  const observers = new Set();
  const ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  };
  const Component = load(compile('components/StableAsyncBlock.tsx'), {
    ResizeObserver,
    require(id) {
      if (id === 'react') return new Proxy({}, { get: (_, key) => (...args) => hooks[key](...args) });
      if (id === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
      if (id === '@/lib/navigationCache') return { getNavigationStore: () => store };
      if (id === '@/lib/asyncBlockGeometry') return { readAsyncBlockHeight, rememberAsyncBlockSize, forgetAsyncBlockSize };
      throw new Error('Unexpected dependency: ' + id);
    },
  }).StableAsyncBlock;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  function mount(initial, width = 600, naturalHeight = 153) {
    const slots = []; let props = initial, cursor = 0, dirty = true, pending = [], tree;
    const node = { getBoundingClientRect: () => ({ width, height: tree?.props.style.height ?? (props.children ? naturalHeight : 0) }) };
    const h = {
      useState(initialValue) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
        return [slots[index], next => { const value = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; } }]; },
      useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
      useSyncExternalStore(subscribe, read) { const index = cursor++; if (!slots[index]) slots[index] = { cleanup: subscribe(() => { dirty = true; }) }; return read(); },
      useLayoutEffect(fn, deps) { const index = cursor++, previous = slots[index]; if (!previous || !same(previous.deps, deps)) { slots[index] = { deps }; pending.push(() => { previous?.cleanup?.(); slots[index].cleanup = fn(); }); } },
    };
    const app = {
      get tree() { return tree; }, get height() { return tree.props.style.height; },
      flush() { let count = 0; while (dirty) { assert.ok(count++ < 20, 'layout effects settle'); dirty = false; cursor = 0; hooks = h; tree = Component(props); tree.props.ref.current = node; const work = pending; pending = []; work.forEach(fn => fn()); } return app; },
      update(next, nextHeight = naturalHeight) { props = { ...props, ...next }; naturalHeight = nextHeight; dirty = true; return app.flush(); },
      resize(nextWidth, nextHeight = naturalHeight) { width = nextWidth; naturalHeight = nextHeight; for (const observer of [...observers]) observer.callback(); return app.flush(); },
      unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    };
    return app.flush();
  }
  return { cache, mount, changeScope(scope) { cache.setScope(scope); snapshot = { scope }; listeners.forEach(fn => fn()); } };
}

test('warm pending blocks reserve prior full footprint before paint and release it on resolved edits', () => {
  const h = componentHarness();
  const original = h.mount({ blockKey: 'poll:post', state: 'ready', children: 'Freshly authorized poll' });
  assert.equal(original.tree.props.style.display, 'flow-root'); assert.equal(original.height, undefined); original.unmount();
  const warm = h.mount({ blockKey: 'poll:post', state: 'pending' });
  assert.equal(warm.height, 153); assert.equal(warm.tree.props.children.props['aria-hidden'], true);
  warm.resize(500); assert.equal(warm.height, undefined, 'a different width cannot reuse the old height');
  warm.resize(600); assert.equal(warm.height, 153);
  warm.update({ state: 'ready', children: 'New shorter poll' }, 84); assert.equal(warm.height, undefined, 'ready content has no forced height');
  warm.update({ state: 'pending', children: null }); assert.equal(warm.height, 84);
  warm.update({ state: 'empty', children: 'Poll unavailable' }, 24); assert.equal(warm.height, undefined);
  warm.update({ state: 'pending', children: null }); assert.equal(warm.height, undefined, 'error/absence discarded the old reservation');
  warm.unmount();
});

test('a pending reservation disappears immediately when the session changes', () => {
  const h = componentHarness();
  const ready = h.mount({ blockKey: 'quote:post', state: 'ready', children: 'Authorized quote' }, 600, 72); ready.unmount();
  const pending = h.mount({ blockKey: 'quote:post', state: 'pending' }); assert.equal(pending.height, 72);
  h.changeScope('session-b'); pending.flush(); assert.equal(pending.height, undefined);
  h.changeScope('session-a'); pending.flush(); assert.equal(pending.height, undefined);
  pending.unmount();
});
