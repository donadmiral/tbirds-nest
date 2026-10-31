const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function compile(file, imports, globals = {}) {
  const module = { exports: {} }, jsx = (type, props) => ({ type, props });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { fileName: file, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, { module, exports: module.exports, ...globals, require(id) { if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }; if (id.endsWith('.css')) return {}; if (id in imports) return imports[id]; throw new Error(id); } });
  return module.exports.default;
}
test('actual control selects all four modes and writes the existing persistence cookie', () => {
  let theme = 'system'; const document = { documentElement: { getAttribute: () => theme, setAttribute: (_k, v) => { theme = v; } }, cookie: '' };
  const Controls = compile('components/ThemeControls.tsx', { react: { useSyncExternalStore: (_subscribe, read) => read() }, '@/components/AdminIcon': 'svg' }, { document });
  for (const mode of ['light', 'dark', 'lightsOut', 'system']) {
    const labels = { light: 'Light appearance', dark: 'Dark appearance', lightsOut: 'Lights out appearance', system: 'Use device appearance' };
    const tree = Controls(); assert.equal(tree.props.children.length, 4); tree.props.children.find(n => n.props['aria-label'] === labels[mode]).props.onClick();
    assert.equal(theme, mode); assert.match(document.cookie, new RegExp('^pc-theme=' + mode + ';'));
    const selected = Controls().props.children.filter(n => n.props['aria-pressed']); assert.equal(selected.length, 1); assert.equal(selected[0].props['aria-label'], labels[mode]);
  }
});
test('actual server layout restores Lights out cookie and rejects unknown values', async () => {
  let stored = 'lightsOut'; const font = () => ({ variable: 'font' });
  const Layout = compile('app/layout.tsx', { 'next/headers': { cookies: async () => ({ get: key => ({ value: key === 'pc-theme' ? stored : undefined }) }) }, 'next/font/google': { Geist: font, Geist_Mono: font, JetBrains_Mono: font }, '@/components/ClientDiagnostics': { ClientDiagnostics: 'Diagnostics' } });
  assert.equal((await Layout({ children: 'content' })).props['data-theme'], 'lightsOut'); stored = 'invalid'; assert.equal((await Layout({ children: 'content' })).props['data-theme'], 'system');
});
test('Lights out inherits both dark token sets and has explicit black workspace surfaces', () => {
  const css = fs.readFileSync(path.join(__dirname, '../app/globals.css'), 'utf8');
  assert.equal((css.match(/\[data-theme="dark"\], \[data-theme="lightsOut"\] \{/g) || []).length, 2);
  assert.match(css, /\[data-theme="lightsOut"\] \{\s*--bg: #000000;/);
  assert.match(css, /\[data-theme="lightsOut"\] \.pc-wordmark/);
});
