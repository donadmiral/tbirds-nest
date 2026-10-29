const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../components/SettingsNavigation.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function render(pathname) {
  const module = { exports: {} }, jsx = (type, props) => ({ type, props });
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'next/navigation') return { usePathname: () => pathname };
    if (name === 'next/link') return { default: 'Link' };
    if (name === 'lucide-react') return { ArrowLeft: 'Arrow', X: 'Close' };
    throw Error(name);
  } });
  return module.exports.SettingsNavigation();
}
test('settings screens use predictable parent links and replace entries instead of creating Back loops', () => {
  for (const [pathname, parent] of [['/settings', '/home'], ['/settings/username', '/settings'], ['/settings/support/123', '/settings/support']]) {
    const tree = render(pathname), back = tree.props.children[0];
    assert.equal(back.props.href, parent);
    assert.equal(back.props.replace, true);
    if (pathname !== '/settings') {
      const exit = tree.props.children[1];
      assert.equal(exit.props.href, '/home');
      assert.equal(exit.props.replace, true);
      assert.equal(exit.props['aria-label'], 'Exit settings to Home');
    }
  }
});
