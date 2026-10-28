const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '../..');
const compile = source => ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
function walk(node, out = []) { if (Array.isArray(node)) node.forEach(n => walk(n, out)); else if (node && typeof node === 'object') { out.push(node); walk(node.props?.children, out); } return out; }
const flat = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
const ticks = async () => { await Promise.resolve(); await Promise.resolve(); };
function load(file, { width = 320, height = 568, thumbnail = async () => ({ uri: 'frame.jpg' }), transform } = {}) {
  let cursor = 0, timerId = 0;
  const state = [], effects = [], dependencies = [], cleanups = [], timers = new Map();
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in state)) state[i] = typeof value === 'function' ? value() : value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    useRef(value) { const i = cursor++; return state[i] ??= { current: value }; },
    useMemo(fn) { cursor++; return fn(); }, useCallback(fn) { cursor++; return fn; },
    useEffect(fn, deps) { const i = cursor++; const prev = dependencies[i]; if (!prev || !deps || deps.some((v, j) => v !== prev[j])) { dependencies[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  hooks.default = hooks;
  const native = Object.fromEntries(['View', 'Text', 'TouchableOpacity', 'ScrollView', 'Modal', 'TextInput', 'Pressable', 'Image', 'FlatList', 'KeyboardAvoidingView'].map(name => [name, name]));
  Object.assign(native, { StyleSheet: { create: x => x, hairlineWidth: 1, absoluteFill: { position: 'absolute' } }, Platform: { OS: 'ios' }, useWindowDimensions: () => ({ height, width }), Dimensions: { get: () => ({ height, width }) }, PanResponder: { create: handlers => ({ panHandlers: handlers }) }, Animated: { Value: class { constructor(v) { this.value = v; } } } });
  const module = { exports: {} };
  let source = fs.readFileSync(path.join(root, file), 'utf8'); if (transform) source = transform(source);
  vm.runInNewContext(compile(source), { module, exports: module.exports,
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return runtime;
      if (name === 'react-native') return native;
      if (name === '@expo/vector-icons') return { Feather: 'Feather' };
      if (name.endsWith('/useTheme')) return { themedSheet: fn => fn({ ink: { inverse: '#000', primary: '#FFF' } }) };
      if (name.endsWith('/SafeArea')) return { useSafeAreaInsets: () => ({ top: 20, bottom: 0 }) };
      if (name.endsWith('/StoryFilters')) return { FilterLayer: 'FilterLayer', FilterPickerSheet: 'FilterPickerSheet' };
      if (name.endsWith('/storyPanels')) return { AdjustLayer: 'AdjustLayer', AdjustPanel: 'AdjustPanel' };
      if (name === 'expo-video-thumbnails') return { getThumbnailAsync: thumbnail };
      if (name === 'expo-video') return { VideoView: 'VideoView', useVideoPlayer: () => ({ play() {}, pause() {} }) };
      if (name.endsWith('/supabase')) return { supabase: {} };
      return { __esModule: true, default: name, ...Object.fromEntries(['Heart', 'MessageCircle', 'Repeat2', 'Bookmark', 'VolumeX', 'BadgeCheck'].map(n => [n,n])) };
    }, setTimeout(fn) { const id = ++timerId; timers.set(id, () => { timers.delete(id); return fn(); }); return id; }, clearTimeout(id) { timers.delete(id); },
    TIER_COLORS: {}, Heart: 'Heart', MessageCircle: 'MessageCircle', Repeat2: 'Repeat2', Bookmark: 'Bookmark', VolumeX: 'VolumeX', BadgeCheck: 'BadgeCheck',
  });
  return { timers, render(props, name = 'default') { cursor = 0; const tree = module.exports[name](props); while (effects.length) effects.shift()(); return tree; }, unmount() { cleanups.forEach(fn => fn?.()); } };
}
const editorFile = 'src/components/PostMediaEditSheet.tsx';
test('video cover dragging uses the current trim window, width and callback after a rerender', () => {
  const old = [], current = [], view = load(editorFile);
  view.render({ uri: 'a.mp4', durationSec: 20, start: 0, end: 10, at: 0, width: 350, onChange: v => old.push(v) }, 'CoverStrip');
  const tree = view.render({ uri: 'a.mp4', durationSec: 20, start: 4, end: 8, at: 4, width: 250, onChange: v => current.push(v) }, 'CoverStrip');
  const track = walk(tree).find(n => n.props.accessibilityLabel === 'Video cover frame');
  track.props.onPanResponderGrant(); track.props.onPanResponderMove({}, { dx: 204 }); track.props.onPanResponderRelease();
  assert.deepEqual(old, []); assert.equal(current.at(-1), 7.95);
  track.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
  assert.ok(current.at(-1) >= 4 && current.at(-1) < 8);
  view.unmount();
});
test('selected covers clamp into the trimmed clip and never request the exact end-of-file frame', () => {
  const changed = [], view = load(editorFile);
  view.render({ uri: 'a.mp4', durationSec: 10, start: 7, end: 10, at: 10, width: 40, onChange: v => changed.push(v) }, 'CoverStrip');
  assert.deepEqual(changed, [9.95]);
  const tree = view.render({ uri: 'a.mp4', durationSec: 10, start: 7, end: 10, at: 9.95, width: 40, onChange() {} }, 'CoverStrip');
  const track = walk(tree).find(n => n.props.accessibilityLabel === 'Video cover frame');
  track.props.onPanResponderGrant(); track.props.onPanResponderMove({}, { dx: 10 });
  assert.ok(Number.isFinite(track.props.accessibilityValue.now));
  view.unmount();
});
test('a late thumbnail from the previous media cannot replace the current cover', async () => {
  const pending = [];
  const view = load(editorFile, { thumbnail: (uri, options) => options.quality === 0.3 ? Promise.resolve({ uri: 'strip-' + uri }) : new Promise(resolve => pending.push({ uri, resolve })) });
  const props = { durationSec: 10, start: 0, end: 10, at: 3, width: 320, onChange() {} };
  view.render({ ...props, uri: 'old.mp4' }, 'CoverStrip');
  const oldPromise = [...view.timers.values()][0]();
  view.render({ ...props, uri: 'new.mp4' }, 'CoverStrip');
  const newPromise = [...view.timers.values()][0]();
  pending.find(x => x.uri === 'new.mp4').resolve({ uri: 'new-cover.jpg' }); await newPromise; await ticks();
  pending.find(x => x.uri === 'old.mp4').resolve({ uri: 'old-cover.jpg' }); await oldPromise; await ticks();
  const images = walk(view.render({ ...props, uri: 'new.mp4' }, 'CoverStrip')).filter(n => n.type === 'Image').map(n => n.props.source?.uri);
  assert.ok(images.includes('new-cover.jpg')); assert.ok(!images.includes('old-cover.jpg'));
  view.unmount();
});
test('short iPhones keep post editor actions pinned and all media tools horizontally reachable', () => {
  const view = load(editorFile), saved = [], props = { visible: true, uri: 'clip.mp4', mediaType: 'video', width: 1080, height: 1920, durationSec: 10, onCancel() {}, onDone: edit => saved.push(edit) };
  let tree = view.render(props);
  const nodes = walk(tree), tools = nodes.find(n => n.type === 'ScrollView' && n.props.horizontal), content = nodes.find(n => n.type === 'ScrollView' && !n.props.horizontal);
  assert.ok(content && tools);
  const toolButtons = walk(tools).filter(n => n.type === 'TouchableOpacity');
  assert.equal(toolButtons.length, 8);
  assert.ok(!walk(content).some(n => n.props.accessibilityLabel === 'Apply media edits'));
  const canvas = walk(content).find(n => n.props?.localUri === 'clip.mp4');
  const frame = walk(content).find(n => n.type === 'View' && n.props?.children?.[0] === canvas);
  assert.ok(frame); assert.ok(flat(frame.props.style).height <= 234);
  toolButtons.find(n => n.props.accessibilityLabel === 'Rotate').props.onPress();
  tree = view.render(props); walk(tree).find(n => n.props.accessibilityLabel === 'Apply media edits').props.onPress();
  assert.equal(saved[0].rotation, 90);
  walk(tree).find(n => typeof n.props?.at === 'number' && typeof n.props?.onChange === 'function').props.onChange(9.95);
  tree = view.render(props); walk(tree).find(n => n.props.accessibilityLabel === 'Apply media edits').props.onPress();
  assert.equal(saved[1].coverAt, 9.95);
  const doneText = walk(tree).find(n => n.type === 'Text' && n.props.children === 'Done');
  assert.equal(flat(doneText.props.style).color, '#0B1E3D');
  view.unmount();
});
test('native shared-post stories show caption then full image, blur, creator, carousel and working post link', () => {
  const view = load('src/components/stories/PostStoryCard.tsx'), opened = [];
  const tree = view.render({ sticker: { postId: 'post', postText: 'Caption above', postMediaUrl: 'photo.jpg', postMediaType: 'image', postMediaCount: 4, postAuthorName: 'Creator', postUsername: 'creator' }, interactive: true, onOpenPost: () => opened.push('post') });
  const nodes = walk(tree), caption = nodes.findIndex(n => n.props.children === 'Caption above'), image = nodes.findIndex(n => n.type === 'Image' && n.props.resizeMode === 'contain'), author = nodes.findIndex(n => n.props.children === 'Creator');
  assert.ok(caption < image && image < author);
  assert.ok(nodes.some(n => n.type === 'Image' && n.props.blurRadius > 0));
  assert.ok(nodes.some(n => n.props.children?.[0] === '1/' && n.props.children?.[1] === 4));
  const footer = nodes.find(n => n.type === 'TouchableOpacity' && walk(n).some(c => c.props.children === 'View post'));
  footer.props.onPress(); assert.deepEqual(opened, ['post']);
});
test('web shared-post stories use the same caption-first uncropped card and preserve post navigation', () => {
  const view = load('web/components/StoryViewer.tsx', { transform(source) {
    const ast = ts.createSourceFile('viewer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'StickerLayer');
    return fn.getText(ast).replace('function StickerLayer', 'export default function StickerLayer');
  } });
  const tree = view.render({ stickers: [{ id: 'share', nx: .5, ny: .5, kind: 'post', postId: 'post-id', postText: 'Caption above', postMediaType: 'image', postMediaUrl: 'photo.jpg', postMediaCount: 3, postAuthorName: 'Creator' }], storyId: 'story', isOwn: false, paused: false });
  const nodes = walk(tree), caption = nodes.findIndex(n => n.props.children === 'Caption above'), image = nodes.findIndex(n => n.type === 'img' && n.props.alt === 'Shared post'), creator = nodes.findIndex(n => n.props.children === 'Creator');
  assert.ok(caption < image && image < creator);
  assert.match(nodes[image].props.className, /object-contain/);
  assert.ok(nodes.some(n => n.type === 'img' && n.props.className.includes('blur-xl')));
  assert.equal(nodes.find(n => n.type === 'a').props.href, '/post/post-id');
});
