const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the production component. The host defers React state updaters and
// makes native properties throw after release, matching Expo's SharedObject
// lifetime contract. This is JS consumer coverage, not a native runtime test.
const source = fs.readFileSync(path.join(__dirname, '../../src/components/PostCarousel.tsx'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText + '\nexports.__CarouselVideo = CarouselVideo;';
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

function harness(extraProps = {}) {
  let cursor = 0, timerId = 0, released = false, reads = 0, releasedAccesses = 0;
  const slots = [], effects = [], updates = [], timers = new Map(), listeners = new Map();
  const native = { status: 'readyToPlay', playing: false, currentTime: 2, duration: 12, muted: true, volume: 1 };
  const calls = { play: 0, pause: 0 };
  const access = () => {
    reads++;
    if (released) { releasedAccesses++; throw new Error('Native shared object has been released'); }
  };
  const player = {
    play() { access(); calls.play++; native.playing = true; },
    pause() { access(); calls.pause++; native.playing = false; },
    addListener(name, callback) {
      access(); const events = listeners.get(name) || new Set(); events.add(callback); listeners.set(name, events);
      return { remove() { events.delete(callback); } };
    },
  };
  for (const key of Object.keys(native)) Object.defineProperty(player, key, {
    get() { access(); return native[key]; }, set(value) { access(); native[key] = value; },
  });
  let state = { owner: 'visible-card', uri: 'https://media/clip.mp4', player, ready: true };
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, action => updates.push({ i, action })];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn, deps };
      return slots[i].value;
    },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps };
      return slots[i].value;
    },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (!same(old?.deps, deps)) {
        const slot = { deps }; slots[i] = slot;
        effects.push(() => { old?.cleanup?.(); slot.cleanup = fn(); });
      }
    },
  };
  const engine = {
    useVideoEngine: { getState: () => state },
    useSharedVideo: () => ({
      player: state.player, ownerId: 'visible-card', owns: state.owner === 'visible-card',
      sourceReady: state.ready, failed: false, canHold: state.owner === null && state.player === player, version: 1, retry() {},
    }),
  };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', FlatList: 'FlatList', TouchableOpacity: 'TouchableOpacity', ActivityIndicator: 'Spinner',
      Animated: { Value: function Value() {}, View: 'AnimatedView', timing: () => ({ start: callback => callback?.() }) } },
    'expo-image': { Image: 'Image' }, 'expo-video': { VideoView: 'VideoView' }, '@expo/vector-icons': { Feather: 'Icon' },
    '@react-navigation/native': { useIsFocused: () => true },
    '../lib/videoEngine': engine,
    '../theme/useTheme': { themedSheet: () => ({}), useTheme() {} },
    '../stores/settingsStore': { useSettingsStore: select => select({ autoplayVideos: true }) },
    '../../shared/mediaDelivery': { privateImageCachePolicy: () => 'none' },
    '../lib/imageDisplayIdentity': { imageDisplayIdentity: uri => uri },
    '../hooks/useFeedStartupPreview': { useFeedStartupPreview: () => null },
    '../lib/offlinePlaybackSelection': { selectOfflinePlayback: (_previous, identity, remote, local) => ({ identity, uri: local || remote }) },
    '../hooks/useOfflineFeedMedia': { useOfflineFeedMedia: () => null },
    '../../shared/contentMedia': {},
    '../lib/usePostVideoRepresentation': require('./unmarked-post-video-fixture.cjs'),
    '../lib/navigationCache': {}, '../services/supabase': {},
    '../../shared/postVoiceEffects': { postPlaybackSettings: () => ({ rate: 1, preservesPitch: true }) },
    '../../shared/postMediaEditing': {}, '../../shared/carouselNavigation': {}, '../../shared/soundtrack': {},
    './PostCaption': { default: 'PostCaption' }, './PostSoundtrack': { default: 'PostSoundtrack' }, './VideoThumb': { default: 'VideoThumb' },
    './MediaRenderer': {}, './stories/StoryFilters': {}, './stories/storyPanels': {},
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, require(name) { if (!(name in imports)) throw new Error(`Unexpected import: ${name}`); return imports[name]; },
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout(id) { timers.delete(id); }, console,
  });
  const props = { uri: state.uri, width: 320, height: 400, isVisible: true, isScreenActive: true, edit: { trimStart: 2, trimEnd: 6 }, ...extraProps };
  return {
    player, calls, native,
    render() { cursor = 0; return exports.__CarouselVideo(props); },
    flushEffects() { while (effects.length) effects.shift()(); },
    flushUpdates() {
      while (updates.length) {
        const { i, action } = updates.shift();
        slots[i].value = typeof action === 'function' ? action(slots[i].value) : action;
      }
    },
    emit(name, event) { for (const fn of [...listeners.get(name) || []]) fn(event); },
    deadline() { return [...timers.values()].find(timer => timer.delay === 12000)?.fn; },
    transfer() { state = { ...state, owner: 'next-card' }; },
    hold() { state = { ...state, owner: null }; },
    reclaim() { state = { ...state, owner: 'visible-card', player, ready: true }; },
    ready(value) { state = { ...state, ready: value }; },
    release() { state = { owner: null, uri: null, player: null, ready: false }; released = true; },
    reads: () => reads, releasedAccesses: () => releasedAccesses, queued: () => updates.length,
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('queued playback updates contain no native reads after player release', () => {
  const h = harness(); h.render(); h.flushEffects(); h.flushUpdates();
  h.emit('playingChange', { isPlaying: true }); h.emit('statusChange', { status: 'readyToPlay' });
  assert.equal(h.queued(), 2);
  h.release(); const before = h.reads();
  assert.doesNotThrow(() => h.flushUpdates());
  assert.equal(h.reads(), before, 'React updaters use captured booleans only');
  assert.equal(h.releasedAccesses(), 0);
  h.render(); h.flushEffects(); h.flushUpdates();
  const soundtrack = walk(h.render()).find(node => node.type === 'PostSoundtrack');
  assert.equal(soundtrack.props.clock.playing, false); h.dispose();
});

test('retired event callbacks and first-frame timer do not drive a newer owner of the same player', () => {
  const h = harness(); h.render(); h.flushEffects(); h.flushUpdates();
  const deadline = h.deadline(); assert.equal(typeof deadline, 'function');
  h.transfer(); const before = h.reads(), pauses = h.calls.pause;
  h.emit('timeUpdate', { currentTime: 9 });
  h.emit('playingChange', { isPlaying: true }); h.emit('statusChange', { status: 'readyToPlay' });
  deadline();
  assert.equal(h.reads(), before); assert.equal(h.calls.pause, pauses); assert.equal(h.queued(), 0);
  h.release();
  assert.doesNotThrow(() => { h.emit('timeUpdate', { currentTime: 9 }); deadline(); });
  assert.equal(h.releasedAccesses(), 0); h.dispose();
});

test('effects prepared before invalidation never touch a released native object', () => {
  const h = harness(); h.render(); h.release();
  assert.doesNotThrow(() => h.flushEffects());
  assert.equal(h.releasedAccesses(), 0); assert.equal(h.calls.play, 0);
  h.flushUpdates(); h.dispose();
});

test('live playback events still seek the saved trim and update the soundtrack clock', () => {
  const h = harness(); h.render(); h.flushEffects(); h.flushUpdates();
  h.native.currentTime = 9;
  h.emit('timeUpdate', { currentTime: 9 }); h.flushUpdates();
  assert.equal(h.native.currentTime, 2);
  let clock = walk(h.render()).find(node => node.type === 'PostSoundtrack').props.clock;
  assert.deepEqual({ ...clock }, { time: 0, playing: true, rate: 1 });
  h.native.playing = false; h.emit('playingChange', { isPlaying: false }); h.flushUpdates();
  clock = walk(h.render()).find(node => node.type === 'PostSoundtrack').props.clock;
  assert.equal(clock.playing, false); assert.equal(h.releasedAccesses(), 0); h.dispose();
});

test('a partially visible paused card keeps its painted surface through scroll and refresh renders', () => {
  const h = harness();
  const initial = walk(h.render()).find(node => node.type === 'VideoView');
  initial.props.onFirstFrameRender(); h.flushEffects(); h.flushUpdates();
  assert.equal(walk(h.render()).some(node => node.type === 'VideoThumb'), false);
  h.hold();
  let tree = walk(h.render()); h.flushEffects(); h.flushUpdates();
  assert.equal(tree.find(node => node.type === 'VideoView').props.player, h.player);
  assert.equal(tree.some(node => node.type === 'VideoThumb'), false, 'Crossing the autoplay threshold does not flash the poster');
  h.reclaim(); tree = walk(h.render()); h.flushEffects(); h.flushUpdates();
  assert.equal(tree.find(node => node.type === 'VideoView').props.player, h.player);
  assert.equal(tree.some(node => node.type === 'VideoThumb'), false, 'An unchanged source refresh keeps its painted frame');
  h.ready(false); tree = walk(h.render());
  assert.equal(tree.find(node => node.type === 'VideoView').props.player, h.player, 'Buffering does not destroy the surface');
  assert.equal(tree.some(node => node.type === 'VideoThumb'), false);
  h.dispose();
});

test('returning to a detached pooled player waits for a new frame and ignores the retired surface callback', () => {
  const h = harness();
  const first = walk(h.render()).find(node => node.type === 'VideoView');
  first.props.onFirstFrameRender(); h.flushEffects(); h.flushUpdates();
  assert.equal(walk(h.render()).some(node => node.type === 'VideoThumb'), false);
  h.transfer();
  assert.equal(walk(h.render()).some(node => node.type === 'VideoView'), false);
  h.flushEffects(); h.flushUpdates(); h.reclaim();
  let tree = walk(h.render());
  assert.equal(tree.some(node => node.type === 'VideoThumb'), true, 'The new surface starts covered even when its player is buffered');
  first.props.onFirstFrameRender(); h.flushEffects(); h.flushUpdates();
  tree = walk(h.render());
  assert.equal(tree.some(node => node.type === 'VideoThumb'), true, 'A late callback cannot expose an unpainted surface');
  tree.find(node => node.type === 'VideoView').props.onFirstFrameRender(); h.flushUpdates();
  assert.equal(walk(h.render()).some(node => node.type === 'VideoThumb'), false);
  h.dispose();
});
