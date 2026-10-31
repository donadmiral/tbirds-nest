const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { PNG } = require('pngjs');
const root = path.resolve(__dirname, '../..');

function componentHarness() {
  const contexts = new Map(), modules = new Map(), slots = [], effects = [];
  let cursor = 0;
  const same = (left, right) => left && right && left.length === right.length && left.every((value, i) => Object.is(value, right[i]));
  const react = {
    createContext: value => ({ value }),
    useContext: context => contexts.has(context) ? contexts.get(context) : context.value,
    useId: () => { const index = cursor++; return slots[index] ||= 'photo-' + index; },
    useRef: value => { const index = cursor++; return slots[index] ||= { current: value }; },
    useState: initial => {
      const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useEffect: (effect, dependencies) => {
      const index = cursor++, previous = slots[index];
      if (!same(previous?.dependencies, dependencies)) effects.push(() => {
        previous?.cleanup?.(); slots[index] = { dependencies, cleanup: effect() };
      });
    },
    useMemo: (factory, dependencies) => {
      const index = cursor++, previous = slots[index];
      if (!same(previous?.dependencies, dependencies)) slots[index] = { dependencies, value: factory() };
      return slots[index].value;
    },
    useCallback: (callback, dependencies) => react.useMemo(() => callback, dependencies),
  };
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const native = { View: 'View', Image: 'NativeImage', Text: 'Text', TouchableOpacity: 'Button',
    StyleSheet: { create: value => value, absoluteFill: {} }, Animated: {}, Easing: {} };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const module = { exports: {} }; modules.set(relative, module.exports);
    const output = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(output, { module, exports: module.exports, require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'react-native') return native;
      if (name === '@shopify/react-native-skia') return { Canvas: 'Canvas', Image: 'SkiaImage', ColorMatrix: 'ColorMatrix', Skia: {} };
      if (name === 'expo-image') return { Image: 'ExpoImage' };
      if (name === '@expo/vector-icons') return { Feather: 'Feather' };
      if (name === '../TierName' || name === '../VerifiedBadge') return { __esModule: true, default: name };
      if (name === '../../utils/stickerStyles') return { stickerTextStyle() { throw Error('Photo stickers do not use text styles'); } };
      if (name.startsWith('.')) {
        const file = path.resolve(root, path.dirname(relative), name);
        return load(path.relative(root, fs.existsSync(file + '.tsx') ? file + '.tsx' : file + '.ts'));
      }
      throw Error('Unexpected component dependency: ' + name);
    } });
    modules.set(relative, module.exports); return module.exports;
  }
  const image = load('src/components/stories/StoryPixelImage.tsx');
  return { image, load, contexts,
    render(props) { cursor = 0; const tree = image.default(props); effects.splice(0).forEach(effect => effect()); return tree; },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
function walk(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[].concat(node.props?.children || []).flatMap(walk)];
}

test('actual capture photo disables the native fade while retaining readiness and errors', () => {
  const h = componentHarness(), reports = [], loaded = [], errors = [];
  h.contexts.set(h.image.StoryPhotoReadinessContext, (...event) => reports.push(event));
  const tree = h.render({ uri: 'file:///prepared/photo.png', fit: 'contain', onLoad: () => loaded.push(true), onError: () => errors.push(true) });
  const image = walk(tree).find(node => node.type === 'NativeImage');
  assert.equal(image.props.fadeDuration, 0);
  assert.equal(image.props.source.uri, 'file:///prepared/photo.png');
  assert.equal(image.props.resizeMode, 'contain');
  assert.equal(reports.at(-1)[1], 'loading');
  image.props.onLoad(); assert.equal(reports.at(-1)[1], 'ready'); assert.equal(loaded.length, 1);
  image.props.onError(); assert.equal(reports.at(-1)[1], 'error'); assert.equal(errors.length, 1);
  h.dispose(); assert.equal(reports.at(-1)[1], 'removed');
});

test('actual photo sticker uses the same nonfading capture path and keeps its independent color look', () => {
  const h = componentHarness(), reports = [];
  h.contexts.set(h.image.StoryPhotoReadinessContext, (...event) => reports.push(event));
  h.contexts.set(h.image.StoryPhotoLookContext, { filterId: 'inkwell', filterAmt: 100 });
  const { PhotoStickerView } = h.load('src/components/stories/storyExtras.tsx');
  const sticker = PhotoStickerView({ sticker: { photoUrl: 'file:///prepared/sticker.png', photoShape: 'cell', photoFw: .18, photoFh: .1 }, containerW: 320, containerH: 568 });
  assert.equal(sticker.props.style.backgroundColor, '#111');
  const child = walk(sticker).find(node => node.type === h.image.default); assert.equal(child.props.look, null);
  const image = walk(h.render(child.props)).find(node => node.type === 'NativeImage');
  assert.equal(image.props.fadeDuration, 0); assert.equal(image.props.source.uri, 'file:///prepared/sticker.png');
  image.props.onLoad(); assert.equal(reports.at(-1)[1], 'ready'); h.dispose();
});

test('ordinary photo playback keeps the native fade default and caller callbacks', () => {
  const h = componentHarness(); let loaded = 0;
  const image = walk(h.render({ uri: 'file:///playback/photo.png', onLoad: () => loaded++ })).find(node => node.type === 'NativeImage');
  assert.equal(image.props.fadeDuration, undefined);
  image.props.onLoad(); assert.equal(loaded, 1); h.dispose();
});

test('graded captures retain the existing Skia path and its readiness callbacks', () => {
  const h = componentHarness(), reports = [], look = { adjust: { bri: -20 }, filterId: 'inkwell', filterAmt: 35 };
  h.contexts.set(h.image.StoryPhotoReadinessContext, (...event) => reports.push(event));
  const tree = h.render({ uri: 'file:///prepared/graded.png', look });
  const graded = walk(tree).find(node => typeof node.type === 'function' && node.type.name === 'GradedPhoto');
  assert.ok(graded); assert.equal(graded.props.look, look); assert.equal(walk(tree).some(node => node.type === 'NativeImage'), false);
  graded.props.onLoad(); assert.equal(reports.at(-1)[1], 'ready');
  graded.props.onError(); assert.equal(reports.at(-1)[1], 'error'); h.dispose();
});

test('retained Android captures show a partial image fade while the sticker border stays opaque', () => {
  const read = file => PNG.sync.read(fs.readFileSync(path.join(root, file)));
  const pixel = (image, x, y) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
  const source = read('tests/native/assets/memory-capture-photo.png');
  const captured = read('docs/quality/native-full-app-20261031/android-6878c384/memory-capture/attempt-2-capture-02.png');
  const background = [11, 30, 61], samples = [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].map(([x, y]) => ({
    source: pixel(source, x * source.width, y * source.height), captured: pixel(captured, x * captured.width, y * captured.height),
  }));
  let numerator = 0, denominator = 0;
  for (const sample of samples) for (let c = 0; c < 3; c++) {
    numerator += (sample.source[c] - background[c]) * (sample.captured[c] - background[c]);
    denominator += (sample.source[c] - background[c]) ** 2;
  }
  const alpha = numerator / denominator; assert.ok(alpha > .20 && alpha < .23);
  for (const sample of samples) for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(Math.round(background[c] + alpha * (sample.source[c] - background[c])) - sample.captured[c]) <= 1);
  }
  const stickerSource = read('tests/native/assets/memory-capture-sticker.png');
  assert.deepEqual(pixel(stickerSource, 40, 40), [0, 255, 0, 255]);
  const sticker = read('docs/quality/native-full-app-20261031/android-6878c384/memory-capture/attempt-2-capture-04.png');
  let darkGreen = 0, fullGreen = 0, white = 0;
  for (let i = 0; i < sticker.data.length; i += 4) {
    const [r, g, b, a] = sticker.data.subarray(i, i + 4);
    if (a === 255 && r < 20 && g > 70 && g < 110 && b < 20) darkGreen++;
    if (a === 255 && r < 50 && g > 180 && b < 50) fullGreen++;
    if (r === 255 && g === 255 && b === 255 && a === 255) white++;
  }
  assert.ok(darkGreen > 10000); assert.equal(fullGreen, 0); assert.ok(white > 1000);
});
