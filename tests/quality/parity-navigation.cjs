const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '../..');
const jsx = (type, props) => ({ type, props });

function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, console,
    require(name) {
      if (name in mocks) return mocks[name];
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name.startsWith('.')) {
        const base = path.resolve(path.dirname(filename), name);
        const found = ['.ts', '.tsx'].map(ext => base + ext).find(fs.existsSync);
        if (found) return load(path.relative(root, found), mocks);
      }
      throw Error('Unexpected dependency ' + name);
    },
  }, { filename });
  return module.exports;
}

const { carouselSwipe, carouselIndex } = load('shared/carouselNavigation.ts');
test('horizontal swipes advance in both directions, vertical reading and small movement stay put', () => {
  assert.equal(carouselSwipe({ x: 180, y: 100 }, { x: 60, y: 115 }), 1);
  assert.equal(carouselSwipe({ x: 60, y: 100 }, { x: 180, y: 115 }), -1);
  assert.equal(carouselSwipe({ x: 180, y: 100 }, { x: 120, y: 240 }), 0);
  assert.equal(carouselSwipe({ x: 180, y: 100 }, { x: 165, y: 105 }), 0);
  assert.equal(carouselSwipe(null, { x: 40, y: 0 }), 0);
  assert.equal(carouselIndex(-1, 3), 0);
  assert.equal(carouselIndex(3, 3), 2);
  assert.equal(carouselIndex(NaN, 3), 0);
});

test('settings Back follows history and direct-entry pages fall back to their parent', () => {
  const { settingsBack, exitSettings } = load('src/navigation/settingsNavigation.ts');
  const calls = [];
  const nav = { canGoBack: () => true, goBack: () => calls.push('back'), navigate: value => calls.push(value) };
  settingsBack(nav);
  nav.canGoBack = () => false;
  settingsBack(nav);
  settingsBack(nav, 'ContactSupport');
  exitSettings(nav);
  assert.deepEqual(calls, ['back', 'Settings', 'ContactSupport', 'ProfileMain']);
});

function nodes(tree, result = []) {
  if (Array.isArray(tree)) { tree.forEach(item => nodes(item, result)); return result; }
  if (!tree || typeof tree !== 'object') return result;
  result.push(tree); nodes(tree.props?.children, result); return result;
}
function rgb(color, bg) {
  if (color.startsWith('#')) return color.slice(1).match(/../g).map(v => parseInt(v, 16));
  const values = color.match(/[\d.]+/g).map(Number), alpha = values[3] ?? 1;
  return values.slice(0, 3).map((v, i) => v * alpha + bg[i] * (1 - alpha));
}
function luminance(values) { return values.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0); }

for (const mode of ['light', 'dark']) test('post paragraphs, headings, lists and links remain readable in ' + mode + ' mode', () => {
  const palette = load('src/constants/tokens/' + mode + '.ts')[mode];
  const theme = { useTheme: () => ({ t: palette, isDark: mode === 'dark' }), themedSheet: fn => fn(palette) };
  const ArticleBody = load('src/components/ArticleBody.tsx', {
    '../theme/useTheme': theme, react: {},
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { hairlineWidth: 1 }, Linking: {} },
    'expo-image': { Image: 'Image' },
  }).default;
  const tree = ArticleBody({ text: '# Heading\n\nA normal post with **bold** text, @don and #community.\n\n- A list item\n\n> A quote\n\n[Open](https://example.com)', onMention() {}, onHashtag() {} });
  const background = rgb(palette.surface.canvas), backL = luminance(background);
  const painted = nodes(tree).filter(n => n.type === 'Text' && n.props.style?.color);
  assert.ok(painted.length >= 8);
  for (const node of painted) {
    const color = node.props.style.color, frontL = luminance(rgb(color, background));
    const contrast = (Math.max(frontL, backL) + .05) / (Math.min(frontL, backL) + .05);
    assert.ok(contrast >= 4.5, `${color} has ${contrast.toFixed(2)}:1 contrast in ${mode}`);
  }
});

test('the expanded native carousel retains mixed attachment order and opens the tapped item', () => {
  const palette = load('src/constants/tokens/dark.ts').dark;
  const hooks = { useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useRef: value => ({ current: value }), useEffect() {}, useCallback: fn => fn };
  const Carousel = load('src/components/PostCarousel.tsx', {
    react: hooks, '../theme/useTheme': { themedSheet: fn => fn(palette) },
    'react-native': { View: 'View', Text: 'Text', FlatList: 'FlatList', TouchableOpacity: 'Button', ActivityIndicator: 'Spinner', Animated: {}, StyleSheet: {} },
    'expo-image': {}, 'expo-video': {}, '../lib/videoEngine': {},
    './MediaRenderer': { useMediaTags: () => ({}) }, './stories/StoryFilters': {}, './stories/storyPanels': {},
    '@react-navigation/native': {}, '../stores/settingsStore': {}, './PostCaption': {}, './PostSoundtrack': {},
    '../../shared/soundtrack': { readSoundtrack: () => null }, '@expo/vector-icons': {},
  }).default;
  const media = [
    { id: 'photo-1', url: 'https://example.com/1.jpg', media_type: 'image', width: 1080, height: 1920, sort_order: 0 },
    { id: 'video', url: 'https://example.com/2.mp4', media_type: 'video', width: 1920, height: 1080, sort_order: 1, edit: { speed: 1.5 } },
    { id: 'photo-3', url: 'https://example.com/3.jpg', media_type: 'image', width: 1080, height: 1080, sort_order: 2 },
  ];
  const tree = Carousel({ media, containerWidth: 390, initialIndex: 1, maxHeight: 650, fullFrame: true, postId: 'post' });
  const list = nodes(tree).find(n => n.type === 'FlatList');
  assert.equal(list.props.data, media);
  assert.equal(list.props.initialScrollIndex, 1);
  assert.equal(list.props.horizontal, true);
  assert.equal(list.props.pagingEnabled, true);
  const video = nodes(list.props.renderItem({ item: media[1], index: 1 })).find(n => n.props?.uri === media[1].url);
  assert.equal(video.props.edit, media[1].edit);
  assert.equal(video.props.fullFrame, true);
  assert.ok(video.props.height <= 650);
  const photo = nodes(list.props.renderItem({ item: media[2], index: 2 })).find(n => n.props?.uri === media[2].url);
  assert.equal(photo.props.uri, media[2].url);
});
