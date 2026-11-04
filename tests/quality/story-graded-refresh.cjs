const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/components/stories/StoryPixelImage.tsx'), 'utf8');
const ast = ts.createSourceFile('StoryPixelImage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const graded = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'GradedPhoto');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const bitmap = id => ({ id, disposed: 0, dispose() { this.disposed++; } });
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];

function harness() {
  const slots = [], effects = [], downloads = new Map();
  let cursor = 0, dirty = true, tree, props;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { const value = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useMemo(create, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: create() }; return slots[index].value; },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const Component = vm.runInNewContext(ts.transpileModule(`(${graded.getText(ast)})`, {
    fileName: 'GradedPhoto.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports: {},
    ...hooks, useLayoutEffect: hooks.useEffect,
    View: 'View', Text: 'Text', Canvas: 'Canvas', SkiaImage: 'Pixels', ColorMatrix: 'Grade', Image: 'RawImage',
    StyleSheet: { absoluteFill: {} }, styles: { error: {}, errorText: {} }, storyPhotoColorMatrix: () => [],
    Skia: { Data: { fromURI(uri) { const pending = deferred(); downloads.set(uri, pending); return pending.promise; } }, Image: { MakeImageFromEncoded: value => value } },
    require(name) { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx }; },
  });
  return {
    downloads,
    render(next = props) {
      if (next !== props) { props = next; dirty = true; }
      let count = 0;
      while (dirty) { assert.ok(++count < 20); dirty = false; cursor = 0; tree = Component(props); effects.splice(0).forEach(effect => effect()); }
      return tree;
    },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('renewed edited photos keep graded pixels until the replacement commits and dispose every bitmap once', async () => {
  const h = harness(), first = bitmap('first'), second = bitmap('second');
  let errors = 0; const onError = () => errors++;
  let tree = h.render({ uri: 'grant-1', onError });
  assert.equal(nodes(tree).some(node => node.type === 'RawImage'), false, 'An edited photo never flashes the raw ungraded image');
  tree.props.onLayout({ nativeEvent: { layout: { width: 200, height: 300 } } }); h.render();
  h.downloads.get('grant-1').resolve(first); await tick(); tree = h.render();
  assert.equal(nodes(tree).find(node => node.type === 'Pixels').props.image, first);
  tree = h.render({ uri: 'grant-2', onError });
  assert.equal(nodes(tree).find(node => node.type === 'Pixels').props.image, first);
  assert.equal(first.disposed, 0);
  h.downloads.get('grant-2').resolve(second); await tick();
  assert.equal(first.disposed, 0, 'Do not dispose pixels before their replacement commits');
  tree = h.render(); assert.equal(nodes(tree).find(node => node.type === 'Pixels').props.image, second);
  assert.equal(first.disposed, 1);
  h.render({ uri: 'denied-grant', onError });
  h.downloads.get('denied-grant').reject(new Error('Forbidden')); await tick(); tree = h.render();
  assert.equal(nodes(tree).some(node => node.type === 'Pixels'), false); assert.equal(second.disposed, 1); assert.equal(errors, 1);
  h.dispose(); assert.equal(first.disposed, 1); assert.equal(second.disposed, 1);
});

test('obsolete and unmounted photo downloads cannot replace current pixels or leak decoded images', async () => {
  const h = harness(), late = bitmap('late'), current = bitmap('current'), unmounted = bitmap('unmounted');
  h.render({ uri: 'old' }); h.render({ uri: 'current' });
  h.downloads.get('current').resolve(current); await tick(); h.render();
  h.downloads.get('old').resolve(late); await tick(); h.render();
  assert.equal(late.disposed, 1); assert.equal(current.disposed, 0);
  h.render({ uri: 'pending' }); h.dispose(); assert.equal(current.disposed, 1);
  h.downloads.get('pending').resolve(unmounted); await tick(); assert.equal(unmounted.disposed, 1);
});
