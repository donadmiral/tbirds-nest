const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../src/components/VideoThumb.tsx'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function walk(n) { return !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk) : [n, ...walk(n.props?.children)]; }
function harness() {
  let cursor = 0; const slots = [], effects = [], requests = [];
  const react = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((d, j) => !Object.is(d, slots[i].deps[j]))) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const module = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { View: 'View', Text: 'Text', ActivityIndicator: 'Spinner' };
    if (name === 'expo-image') return { Image: 'Image' };
    if (name === 'expo-video-thumbnails') return { getThumbnailAsync: (uri, options) => new Promise((resolve, reject) => requests.push({ uri, options, resolve, reject })) };
    throw Error(name);
  }});
  return { requests, render(uri, posterUri) { cursor = 0; return module.exports.default({ uri, posterUri }); }, flush() { while (effects.length) effects.shift()(); }, dispose() { slots.forEach(s => s?.cleanup?.()); } };
}
test('reused video tiles immediately hide the old frame and ignore late results', async () => {
  const h = harness(); h.render('a'); h.flush(); h.requests[0].resolve({ uri: 'file:a' }); await tick();
  assert.equal(walk(h.render('a')).find(n => n.type === 'Image').props.source.uri, 'file:a');
  assert.equal(walk(h.render('b')).some(n => n.type === 'Image'), false); h.flush();
  h.render('c'); h.flush(); h.requests[1].resolve({ uri: 'file:b' }); await tick();
  assert.equal(walk(h.render('c')).some(n => n.type === 'Image'), false);
  h.requests[2].resolve({ uri: 'file:c' }); await tick();
  assert.equal(walk(h.render('c')).find(n => n.type === 'Image').props.source.uri, 'file:c');
});
test('short videos retry their first frame and failures expose a readable state', async () => {
  const h = harness(); h.render('short'); h.flush(); h.requests[0].reject(Error('No frame at 800')); await tick();
  assert.equal(h.requests[1].options.time, 0); h.requests[1].reject(Error('Unavailable')); await tick();
  const tree = h.render('short'); assert.match(tree.props.accessibilityLabel, /unavailable/);
  assert.equal(walk(tree).some(n => n.type === 'Spinner'), false); assert.equal(tree.props.pointerEvents, 'none');
});
test('a missing cached image fails visibly and a new signed URL gets a fresh frame', async () => {
  const h = harness(); h.render('signed-one'); h.flush(); h.requests[0].resolve({ uri: 'file:gone' }); await tick();
  walk(h.render('signed-one')).find(n => n.type === 'Image').props.onError();
  assert.match(h.render('signed-one').props.accessibilityLabel, /unavailable/);
  h.render('signed-two'); h.flush(); assert.equal(h.requests[1].uri, 'signed-two');
  h.requests[1].resolve({ uri: 'file:renewed' }); await tick();
  assert.equal(walk(h.render('signed-two')).find(n => n.type === 'Image').props.source.uri, 'file:renewed');
});

test('a selected cover loads without decoding video, and a failed cover falls back to a frame', async () => {
  const h = harness();
  const selected = h.render('movie', 'signed-cover.jpg'); h.flush();
  assert.equal(walk(selected).find(n => n.type === 'Image').props.source.uri, 'signed-cover.jpg');
  assert.equal(h.requests.length, 0);
  walk(selected).find(n => n.type === 'Image').props.onError();
  assert.equal(walk(h.render('movie', 'signed-cover.jpg')).some(n => n.type === 'Image'), false); h.flush();
  assert.equal(h.requests[0].uri, 'movie');
  h.requests[0].resolve({ uri: 'file:fallback-frame' }); await tick();
  assert.equal(walk(h.render('movie', 'signed-cover.jpg')).find(n => n.type === 'Image').props.source.uri, 'file:fallback-frame');
  assert.equal(walk(h.render('other-movie', 'new-signed-cover.jpg')).find(n => n.type === 'Image').props.source.uri, 'new-signed-cover.jpg');
  h.dispose();
});
