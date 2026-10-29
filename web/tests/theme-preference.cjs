const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the real provider with the same deterministic effect harness used by
// the calling/story tests. Browser appearance and storage events remain real
// inputs; no implementation-specific state slots are asserted.
const source = fs.readFileSync(path.join(__dirname, '../components/ThemeProvider.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
function scenario({ saved = null, systemDark = false, unavailable = false } = {}) {
  const slots = [], listeners = new Map(), mediaListeners = new Set(), applied = [];
  let cursor = 0, dirty = true, effects = [], tree, lightsOut = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    createContext: () => ({ Provider: 'ThemeContext' }),
    useSyncExternalStore(subscribe, snapshot) { const i = cursor++; if (!slots[i]) slots[i] = { cleanup: subscribe(() => { dirty = true; }) }; return snapshot(); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const media = { get matches() { return systemDark; }, addEventListener: (_, fn) => mediaListeners.add(fn), removeEventListener: (_, fn) => mediaListeners.delete(fn) };
  const storage = { getItem() { if (unavailable) throw Error('Storage blocked'); return saved; }, setItem(_, value) { if (unavailable) throw Error('Storage blocked'); saved = value; } };
  const browser = { localStorage: storage, matchMedia: () => media, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const document = { documentElement: { classList: { toggle(name, value) { if(name==='dark') applied.push(value); else if(name==='lights-out') lightsOut=value; else assert.fail('Unknown theme class'); } } } };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, window: browser, document,
    require: name => name === 'react' ? hooks : { jsx: (type, props) => ({ type, props }) } });
  function render() { let turns = 0; while (dirty) { if (++turns > 20) throw Error('Render loop'); dirty = false; cursor = 0; tree = module.exports.ThemeProvider({ children: 'page' }); const pending = effects; effects = []; pending.forEach(fn => fn()); } }
  render();
  return {
    get dark() { return applied.at(-1); }, get lightsOut() { return lightsOut; }, get saved() { return saved; }, get applied() { return applied; }, get theme() { return tree.props.value.theme; },
    choose(value) { tree.props.value.choose(value); render(); },
    system(value) { systemDark = value; [...mediaListeners].forEach(fn => fn()); render(); },
    storage(key, value) { saved = value; listeners.get('storage')?.({ key, newValue: value }); render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); assert.equal(listeners.size, 0); assert.equal(mediaListeners.size, 0); },
  };
}

test('fresh appearance follows device changes on ordinary routes', () => {
  const h = scenario({ systemDark: true });
  assert.equal(h.theme, 'system'); assert.equal(h.dark, true);
  h.system(false); assert.equal(h.dark, false);
  h.unmount();
});
test('saved explicit appearance never briefly applies a different system setting', () => {
  const h = scenario({ saved: 'light', systemDark: true });
  assert.deepEqual(h.applied, [false]);
  h.system(false); h.system(true); assert.equal(h.dark, false);
  h.choose('dark'); assert.equal(h.saved, 'dark'); assert.equal(h.dark, true);
  h.unmount();
});
test('blocked storage supports device theme and an in-session explicit choice', () => {
  const h = scenario({ unavailable: true, systemDark: true });
  assert.equal(h.dark, true); h.choose('light'); assert.equal(h.dark, false);
  h.system(false); h.system(true); assert.equal(h.dark, false);
  h.unmount();
});
test('appearance synchronizes other tabs, clearing preferences and invalid stored values', () => {
  const h = scenario({ saved: 'invalid', systemDark: true });
  assert.equal(h.theme, 'system'); h.storage('pc:theme', 'light'); assert.equal(h.dark, false);
  h.storage('other-key', 'dark'); assert.equal(h.theme, 'light');
  h.storage(null, null); assert.equal(h.theme, 'system'); assert.equal(h.dark, true);
  h.unmount();
});

const layout = ts.createSourceFile('layout.tsx', fs.readFileSync(path.join(__dirname, '../app/layout.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let bootstrap;
function visit(node) { if (ts.isPropertyAssignment(node) && node.name.getText(layout) === '__html' && ts.isStringLiteral(node.initializer)) bootstrap = node.initializer.text; ts.forEachChild(node, visit); }
visit(layout);
test('before-paint script matches provider defaults, saved choices and blocked storage', () => {
  assert.ok(bootstrap);
  for (const [saved, systemDark, blocked, expected] of [[null, true, false, true], ['light', true, false, false], ['dark', false, false, true], ['lightsOut',false,false,true], ['invalid', false, false, false], [null, true, true, true]]) {
    let applied;
    vm.runInNewContext(bootstrap, { localStorage: { getItem() { if (blocked) throw Error('Storage blocked'); return saved; } }, matchMedia: () => ({ matches: systemDark }), document: { documentElement: { classList: { toggle: (name, value) => { if(name==='dark') applied = value; } } } } });
    assert.equal(applied, expected);
  }
});


test('lights out persists separately from dim and follows cross-tab updates', () => {
  const h = scenario({saved:'lightsOut',systemDark:false});
  assert.equal(h.theme,'lightsOut'); assert.equal(h.dark,true); assert.equal(h.lightsOut,true);
  h.choose('dark'); assert.equal(h.dark,true); assert.equal(h.lightsOut,false);
  h.choose('lightsOut'); assert.equal(h.saved,'lightsOut'); assert.equal(h.lightsOut,true);
  h.choose('system'); assert.equal(h.dark,false); assert.equal(h.lightsOut,false);
  h.storage('pc:theme','lightsOut'); assert.equal(h.lightsOut,true); h.unmount();
});
