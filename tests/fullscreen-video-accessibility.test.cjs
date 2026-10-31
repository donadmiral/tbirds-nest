const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const sourceRoot = process.env.NATIVE_VIDEO_SOURCE_ROOT || path.join(__dirname, '..');
const compiled = ts.transpileModule(fs.readFileSync(path.join(sourceRoot, 'src/components/FullscreenVideo.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const walk = root => { const result = []; function visit(n) { if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) return n.forEach(visit); result.push(n); visit(n.props?.children); } visit(root); return result; };
function mount() {
  let slots = [], cursor = 0, effects = [], tree, nextTimer = 1, initialReaderResolve, changedReader, initialized = false, disposed = false, writesAfterDispose = 0;
  const timers = new Map(), listeners = new Map();
  const player = { currentTime: 0, duration: 90, muted: false, play() {}, pause() {}, addListener(name, fn) { listeners.set(name, fn); return { remove: () => listeners.delete(name) }; } };
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], next => { if (disposed) writesAfterDispose++; slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) { const prev = slots[i]; slots[i] = { deps }; effects.push(() => { prev?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
  function gesture() { return new Proxy({}, { get: (_, name) => () => name === 'onEnd' ? gesture() : gesture() }); }
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports,
    setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return runtime;
      if (name === 'react-native') return { View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: styles => styles, absoluteFill: {}, absoluteFillObject: {} },
        useWindowDimensions: () => ({ width: 400, height: 800 }), Dimensions: { get: () => ({ width: 400, height: 800 }) }, PanResponder: { create: value => ({ panHandlers: value }) },
        AccessibilityInfo: { isScreenReaderEnabled: () => new Promise(resolve => { initialReaderResolve = resolve; }), addEventListener: (_name, fn) => { changedReader = fn; return { remove: () => { changedReader = null; } }; } } };
      if (name === 'expo-video') return { VideoView: 'VideoView', useVideoPlayer: (_uri, init) => { if (!initialized) { initialized = true; init(player); } return player; } };
      if (name === '@expo/vector-icons') return { Feather: 'Feather' };
      if (name === './SafeArea') return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
      if (name === 'react-native-gesture-handler') return { GestureDetector: 'GestureDetector', Gesture: { Pinch: gesture, Tap: gesture, Exclusive: gesture, Simultaneous: gesture } };
      if (name === 'react-native-reanimated') return { __esModule: true, default: { View: 'AnimatedView' }, useAnimatedStyle: fn => fn(), useSharedValue: value => ({ value }), withSpring: value => value, withTiming: value => value, runOnJS: value => value };
      if (name === '../theme/useTheme') return { themedSheet: fn => fn({ ink: { inverse: '#fff' }, surface: { canvas: '#fff' } }) };
      throw new Error('Unexpected import: ' + name);
    },
  });
  const screen = { player, render() { cursor = 0; tree = module.exports.default({ uri: 'synthetic.mp4', onClose() {} }); const pending = effects; effects = []; pending.forEach(fn => fn()); },
    find(label) { return walk(tree).find(n => n.props?.accessibilityLabel === label); },
    click(label) { const node = this.find(label); assert.ok(node, 'Missing control: ' + label); node.props.onPress(); this.render(); },
    emitTime(time) { player.currentTime = time; listeners.get('timeUpdate')?.({ currentTime: time }); this.render(); },
    reader(value) { assert.ok(changedReader, 'Screen reader subscription missing'); changedReader(value); this.render(); },
    resolveReader(value) { assert.ok(initialReaderResolve, 'Initial screen reader query missing'); initialReaderResolve(value); },
    runTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); this.render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); disposed = true; },
    get timerCount() { return timers.size; }, get writesAfterDispose() { return writesAfterDispose; },
  };
  screen.render(); return screen;
}

test('native fullscreen controls expose clear action names and a seekable timeline', () => {
  const screen = mount(); screen.emitTime(40);
  for (const name of ['Close video', 'Back 10 seconds', 'Forward 10 seconds', 'Pause video', 'Mute video']) assert.equal(screen.find(name)?.props.accessibilityRole, 'button');
  const slider = screen.find('Video position'); assert.equal(slider?.props.accessibilityRole, 'adjustable');
  slider.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }); screen.render();
  assert.equal(screen.player.currentTime, 50); assert.equal(screen.find('Video position').props.accessibilityValue.text, '0:50 of 1:30');
  screen.find('Video position').props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }); assert.equal(screen.player.currentTime, 40);
});
test('native accessible seeking clamps to the recording boundaries', () => {
  const screen = mount(); screen.emitTime(88);
  screen.find('Video position').props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }); assert.equal(screen.player.currentTime, 90);
  screen.emitTime(2); screen.find('Video position').props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }); assert.equal(screen.player.currentTime, 0);
});
test('screen reader users retain playback controls instead of losing focus to auto-hide', async () => {
  const screen = mount(); screen.resolveReader(true); await Promise.resolve(); screen.render();
  screen.runTimers(); assert.ok(screen.find('Close video'));
  screen.click('Forward 10 seconds'); screen.runTimers(); assert.ok(screen.find('Close video'));
});
test('late initial accessibility query cannot undo a newer screen-reader setting', async () => {
  const screen = mount(); screen.reader(true); screen.resolveReader(false); await Promise.resolve(); screen.render();
  screen.click('Forward 10 seconds'); screen.runTimers(); assert.ok(screen.find('Close video'));
});
test('closing the player clears timers and ignores an outstanding accessibility query', async () => {
  const screen = mount(); screen.click('Forward 10 seconds'); assert.ok(screen.timerCount > 0); screen.unmount();
  assert.equal(screen.timerCount, 0); screen.resolveReader(true); await Promise.resolve(); assert.equal(screen.writesAfterDispose, 0);
});
