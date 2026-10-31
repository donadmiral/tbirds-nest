const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '../..');
const compile = source => ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const runtime = { jsx: (type, props) => typeof type === 'function' ? type(props) : { type, props }, jsxs: (type, props) => typeof type === 'function' ? type(props) : { type, props }, Fragment: 'Fragment' };
function walk(node, out = []) { if (Array.isArray(node)) node.forEach(n => walk(n, out)); else if (node && typeof node === 'object') { out.push(node); walk(node.props?.children, out); } return out; }
const flat = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
function load(file, { ios = true, height = 812 } = {}) {
  let cursor = 0, mounting = true, timerId = 0;
  const state = [], effects = [], cleanups = [], timers = new Map(), keyboard = {}, soundSources = [];
  let microphoneRequests = 0;
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in state)) state[i] = typeof value === 'function' ? value() : value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    useRef(value) { const i = cursor++; return state[i] ??= { current: value }; },
    useMemo(fn) { return fn(); },
    useCallback(fn) { return fn; },
    useEffect(fn) { if (mounting) effects.push(fn); },
  };
  const native = Object.fromEntries(['View', 'Text', 'TouchableOpacity', 'ScrollView', 'Modal', 'TextInput', 'Pressable'].map(name => [name, name]));
  Object.assign(native, { AppState: { currentState: 'active', addEventListener() { return { remove() {} }; } }, StyleSheet: { create: x => x, hairlineWidth: 1, absoluteFill: { position: 'absolute' } }, Platform: { OS: ios ? 'ios' : 'android' }, useWindowDimensions: () => ({ height, width: 320 }), Keyboard: { dismiss() {}, addListener(name, fn) { keyboard[name] = fn; return { remove() { delete keyboard[name]; } }; } } });
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, file), 'utf8')), { module, exports: module.exports,
    require(name) { if (name.endsWith('/soundtrackPicker')) return { soundtrackRead: work => work }; if (name === 'expo-file-system/legacy') return { deleteAsync: async () => {} }; if (name.endsWith('/authStore')) return { useAuthStore: { getState: () => ({ session: { user: { id: 'owner' } }, profile: { id: 'owner' } }), subscribe: () => () => {} } }; if (name.endsWith('/musicAvailability')) { const exported = {}; vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'shared/musicAvailability.ts'), 'utf8')), { exports: exported }); return exported; } if (name.endsWith('/originalAudioAvailability')) return { ORIGINAL_AUDIO_PREPARING: 'Preparing original audio' }; if (name.endsWith('/originalAudioService')) return { originalAudioReady: async () => true, soundFavorites: async () => [], saveSoundFavorite: async () => {} }; if (name === './storyPanels') return { MiniSlider: 'MiniSlider' }; if (name === '../OriginalAudioUpload') return { OriginalAudioUpload: 'OriginalAudioUpload' }; if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return runtime; if (name === 'react-native') return native; if (name === '@expo/vector-icons') return { Feather: 'Feather' }; if (name === './StickerIcons') return { default: 'StickerIcon' }; if (name === './StickerGalleryPreview') return { default: 'StickerGalleryPreview' }; if (name.endsWith('/SafeArea')) return { useSafeAreaInsets: () => ({ top: 20, bottom: 0 }) }; if (name.endsWith('/CallContext')) return { useCallContext: () => ({ callState: 'idle' }) }; if (name === 'expo-av') return { Audio: { setAudioModeAsync: async () => {}, requestPermissionsAsync: async () => { microphoneRequests++; return { granted: true }; } } }; if (name.endsWith('/storiesService')) return { storiesService: { listStorySounds: async source => { soundSources.push(source); return []; } } }; if (name.endsWith('/AppleMusicSheet')) return { AppleMusicPicker: 'AppleMusicPicker' }; throw Error(name); },
    setTimeout(fn) { const id = ++timerId; timers.set(id, () => { timers.delete(id); fn(); }); return id; }, clearTimeout(id) { timers.delete(id); },
  });
  return { ...module.exports, keyboard, timers, soundSources, get microphoneRequests() { return microphoneRequests; }, render(props) { cursor = 0; const tree = module.exports.default(props); mounting = false; while (effects.length) { const cleanup = effects.shift()(); if (cleanup) cleanups.push(cleanup); } return tree; }, unmount() { cleanups.forEach(fn => fn()); } };
}
const sheetFile = 'src/components/stories/StudioSheet.tsx';
test('corrupt stored sticker favorites cannot replace lists with objects or invalid entries', () => {
  const { parseStudioIds } = load(sheetFile);
  for (const value of ['null', '{}', 'false', '123', '{bad', null]) assert.deepEqual(Array.from(parseStudioIds(value)), []);
  assert.deepEqual(Array.from(parseStudioIds('["poll", null, 2, "", "poll", "question"]')), ['poll', 'question']);
  assert.equal(parseStudioIds(JSON.stringify(Array.from({ length: 100 }, (_, i) => String(i)))).length, 64);
});
test('iPhone keyboard lifts a bounded sticker sheet; Android uses its resized window only once', () => {
  const sheet = load(sheetFile, { height: 812 });
  const props = { visible: true, onClose() {}, tiles: [], bottomInset: 34 };
  sheet.render(props);
  sheet.keyboard.keyboardWillShow({ endCoordinates: { height: 336 } });
  const tree = sheet.render(props), container = walk(tree).find(n => n.props.accessibilityViewIsModal);
  assert.equal(flat(container.props.style).maxHeight, 428);
  assert.equal(flat(container.props.style).marginBottom, 336);
  assert.equal(flat(container.props.style).paddingBottom, 12);
  assert.equal(walk(tree).find(n => n.type === 'ScrollView').props.keyboardShouldPersistTaps, 'handled');
  const android = load(sheetFile, { ios: false, height: 476 }); android.render(props); android.keyboard.keyboardDidShow({ endCoordinates: { height: 336 } });
  const androidStyle = flat(walk(android.render(props)).find(n => n.props.accessibilityViewIsModal).props.style);
  assert.equal(androidStyle.maxHeight, 428); assert.equal(androidStyle.marginBottom, 0);
});
test('iPhone waits for native dismissal before opening the chosen editor and cancels on unmount', () => {
  const sheet = load(sheetFile), actions = [], props = { visible: true, bottomInset: 0, onClose() { actions.push('close'); }, tiles: ['poll', 'question'].map(id => ({ id, cat: 'interactive', label: id, icon: id, tint: '#fff', on: false, run() { actions.push(id); } })) };
  const tree = sheet.render(props), button = id => walk(tree).find(n => n.props.accessibilityLabel === id);
  button('poll').props.onPress(); button('question').props.onPress();
  assert.equal(sheet.timers.size, 0); assert.deepEqual(actions, ['close', 'close']);
  walk(tree).find(n => n.type === 'Modal').props.onDismiss();
  assert.deepEqual(actions, ['close', 'close', 'question']);
  button('poll').props.onPress(); sheet.unmount();
  walk(tree).find(n => n.type === 'Modal').props.onDismiss();
  assert.deepEqual(actions, ['close', 'close', 'question', 'close']);
  const android = load(sheetFile, { ios: false }), androidTree = android.render(props);
  walk(androidTree).find(n => n.props.accessibilityLabel === 'poll').props.onPress();
  assert.equal(android.timers.size, 1); [...android.timers.values()][0]();
  assert.equal(actions.at(-1), 'poll');
});
test('sticker search has an explicit empty result and the sheet retains a reachable close action', () => {
  const sheet = load(sheetFile), props = { visible: true, bottomInset: 0, onClose() {}, tiles: [{ id: 'poll', label: 'Poll', icon: 'poll', cat: 'interactive', on: false, tint: '#fff', run() {} }] };
  walk(sheet.render(props)).find(n => n.type === 'TextInput').props.onChangeText('unfindable');
  const tree = sheet.render(props);
  assert.ok(walk(tree).some(n => n.props.children === 'No stickers found. Try another name.'));
  const close = walk(tree).find(n => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Close sticker studio');
  assert.equal(flat(close.props.style).height, 44);
});
test('text editor keeps save and cancel outside scrolling tools and wires every editing command', () => {
  const toolbar = load('src/components/stories/StoryTextEditorToolbar.tsx'), calls = [];
  const props = { topInset: 59, alignment: 'center', background: true };
  for (const name of ['Close', 'Save', 'Align', 'Background', 'DecreaseSize', 'IncreaseSize', 'Duplicate', 'Delete']) props['on' + name] = () => calls.push(name);
  const tree = toolbar.render(props), scroll = walk(tree).find(n => n.type === 'ScrollView'), scrollButtons = walk(scroll).filter(n => n.type === 'TouchableOpacity');
  assert.equal(scroll.props.horizontal, true); assert.equal(scroll.props.keyboardShouldPersistTaps, 'always');
  assert.ok(scrollButtons.every(n => !['Save text sticker', 'Cancel text editing'].includes(n.props.accessibilityLabel)));
  const buttons = walk(tree).filter(n => n.type === 'TouchableOpacity');
  assert.equal(buttons.length, 8);
  for (const button of buttons) { const style = flat(button.props.style); assert.ok((style.height || style.minHeight) >= 44); button.props.onPress(); }
  assert.deepEqual(calls.sort(), ['Align', 'Background', 'Close', 'DecreaseSize', 'Delete', 'Duplicate', 'IncreaseSize', 'Save']);
  assert.equal(walk(toolbar.render({ ...props, onDuplicate: undefined, onDelete: undefined })).filter(n => n.type === 'TouchableOpacity').length, 6);
});
test('an interrupted viewer gesture clears the surface hold and long-press timer before resuming', () => {
  const source = fs.readFileSync(path.join(root, 'src/screens/stories/StoryViewerScreen.tsx'), 'utf8'), ast = ts.createSourceFile('viewer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler; function visit(node) { if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'onPanResponderTerminate') handler = node.initializer.getText(ast); ts.forEachChild(node, visit); } visit(ast); assert.ok(handler);
  const calls = [], timer = { current: 7 }, module = { exports: {} };
  vm.runInNewContext(compile('export const run = ' + handler), { module, exports: module.exports, endSurfaceHold() { calls.push('surface'); }, longPressTimer: timer, clearTimeout(id) { calls.push(id); }, didLongPress: { current: true }, resumeFrom(reason) { calls.push(reason); }, translateY: {}, Animated: { spring() { return { start() { calls.push('restore'); } }; } } });
  module.exports.run(); assert.equal(timer.current, null); assert.deepEqual(calls, ['surface', 7, 'longPress', 'restore']);
});

test('small-screen sticker content can scroll below the fixed close header', () => {
  const sheet = load(sheetFile, { height: 568 }), props = { visible: true, bottomInset: 0, onClose() {}, tiles: [{ id: 'poll', label: 'Poll', icon: 'poll', cat: 'interactive', on: false, tint: '#fff', run() {} }] };
  sheet.render(props); sheet.keyboard.keyboardWillShow({ endCoordinates: { height: 336 } });
  const tree = sheet.render(props), scroll = walk(tree).find(n => n.type === 'ScrollView');
  assert.ok(walk(scroll).some(n => n.type === 'TextInput'));
  assert.ok(walk(scroll).some(n => n.props.accessibilityLabel === 'Poll'));
  assert.ok(!walk(scroll).some(n => n.props.accessibilityLabel === 'Close sticker studio'));
  const tile = walk(scroll).find(n => n.props.accessibilityLabel === 'Poll');
  assert.ok(flat(tile.props.style).width * 2 + 14 <= 320 - 32);
  assert.ok(flat(tile.props.style).width >= 130, 'expressive previews use two readable columns');
});

test('short iPhone music search stays above the keyboard with a pinned close action and one native modal', () => {
  const music = load('src/components/stories/MusicSheet.tsx', { height: 568 }), props = { visible: true, current: null, userId: 'owner', onClose() {}, onSelect() {}, onRemove() {}, onShareTrack() {} };
  music.render(props); music.keyboard.keyboardWillShow({ endCoordinates: { height: 336 } });
  let tree = music.render(props), nodes = walk(tree), sheet = nodes.find(n => n.props.accessibilityViewIsModal), scroll = nodes.find(n => n.type === 'ScrollView');
  assert.equal(flat(sheet.props.style).marginBottom, 336); assert.ok(flat(sheet.props.style).maxHeight <= 568 - 336 - 20);
  assert.equal(scroll.props.keyboardShouldPersistTaps,'handled');
  const close = nodes.find(n => n.props.accessibilityLabel === 'Close sound picker' && n.props.accessibilityRole === 'button');
  assert.ok(close && !walk(scroll).includes(close)); assert.equal(flat(close.props.style).height,44);
  nodes.find(n => n.type === 'TouchableOpacity' && walk(n).some(c => c.props.children === 'Share a song link')).props.onPress();
  tree = music.render(props); nodes = walk(tree);
  assert.equal(nodes.filter(n => n.type === 'Modal').length,1); assert.ok(nodes.some(n => n.type === 'AppleMusicPicker')); assert.ok(nodes.some(n => n.props.accessibilityLabel === 'Back to music'));
  music.unmount();
});

test('shipping native sound sheet exposes original upload and recording without starting a microphone or claiming catalogue access', async () => {
 const music=load('src/components/stories/MusicSheet.tsx');
 const props={visible:true,userId:'owner',current:null,onClose(){},onSelect(){},onRemove(){}};
 music.render(props);for(let i=0;i<8;i++)await Promise.resolve();
 let nodes=walk(music.render(props));
 assert.equal(nodes.filter(n=>n.type==='Modal').length,1);
 assert.equal(nodes.find(n=>n.type==='OriginalAudioUpload').props.owner,'owner');
 assert.ok(nodes.some(n=>n.props.children==='Record original audio'));
 assert.equal(music.microphoneRequests,0);
 nodes.find(n=>n.props.accessibilityRole==='tab'&&walk(n).some(c=>c.props.children==='Browse')).props.onPress();
 nodes=walk(music.render(props));
 assert.ok(nodes.some(n=>typeof n.props.children==='string'&&n.props.children.startsWith('No licensed soundtracks are available yet.')));
 assert.equal(nodes.filter(n=>n.props.accessibilityLabel?.startsWith('Use ')).length,0);
 assert.equal(music.microphoneRequests,0);
 music.unmount();assert.equal(Object.keys(music.keyboard).length,0);
});
