// The actual playback hook, run against deterministic React/player/animation
// adapters. These checks exercise delayed media, buffering and stale events.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(code, { exports, require(name) { if (!(name in imports)) throw Error(`Unexpected import ${name}`); return imports[name]; }, ...globals });
  return exports;
}
function player(duration = 10) {
  const listeners = new Map(), seeks = [], commands = [];
  let time = 0;
  return {
    duration, status: 'loading', seeks, commands,
    get currentTime() { return time; }, set currentTime(value) { time = value; seeks.push(value); },
    play() { commands.push('play'); }, pause() { commands.push('pause'); },
    addListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); return { remove() { listeners.get(name).delete(listener); } }; },
    emit(name, event = {}) { if (name === 'timeUpdate') time = event.currentTime; if (name === 'statusChange') this.status = event.status; for (const listener of [...listeners.get(name) || []]) listener(event); },
    callbacks(name) { return [...listeners.get(name) || []]; },
    get listenerCount() { return [...listeners.values()].reduce((sum, list) => sum + list.size, 0); },
  };
}
function harness(extra = {}) {
  let now = 0, nextTimer = 0, slot = 0, dirty = true, output, effects = [], animation = null, position = 0, completed = 0;
  const timers = new Map(), hooks = [], animationHistory = [];
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useRef(value) { const i = slot++; return hooks[i] ??= { current: value }; },
    useReducer(reducer, initial) { const i = slot++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = reducer(hooks[i], value); dirty = true; }]; },
    useMemo(fn, deps) { const i = slot++; if (!hooks[i] || !same(hooks[i].deps, deps)) hooks[i] = { value: fn(), deps }; return hooks[i].value; },
    useCallback(fn, deps) { return this.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = slot++; if (!hooks[i] || !same(hooks[i].deps, deps)) { const previous = hooks[i]; hooks[i] = { deps }; effects.push(() => { previous?.cleanup?.(); hooks[i].cleanup = fn(); }); } },
  };
  // Hook imports are plain functions, not receiver calls.
  react.useCallback = (fn, deps) => react.useMemo(() => fn, deps);
  const progress = {
    get value() { return position; },
    set value(value) { if (value?.animation) { animation = { ...value, from: position, started: now }; animationHistory.push(animation); } else { position = value; animation = null; } },
  };
  const reanimated = { cancelAnimation() { animation = null; }, Easing: { linear: value => value }, runOnJS: fn => fn, withTiming: (to, options, callback) => ({ animation: true, to, duration: options.duration, callback }) };
  const clock = {
    Date: class extends Date { static now() { return now; } },
    setInterval(fn, ms) { timers.set(++nextTimer, { fn, ms, next: now + ms }); return nextTimer; }, clearInterval(id) { timers.delete(id); },
  };
  const playback = load('shared/storyPlayback.ts', {}, { ...clock, setTimeout, clearTimeout });
  const hook = load('src/hooks/useStoryPlayback.ts', { react, 'react-native-reanimated': reanimated, '../../shared/storyPlayback': playback }, clock).useStoryPlayback;
  let input = { storyKey: 'first', mediaType: 'image', imageDurationMs: 5000, durationSec: 10, player: player(), paused: false, muted: false, progress, onComplete() { completed++; }, ...extra };
  function render() {
    let passes = 0;
    while (dirty) { if (++passes > 30) throw Error('Render loop'); dirty = false; slot = 0; output = hook(input); const pending = effects; effects = []; pending.forEach(fn => fn()); }
    return output;
  }
  function advance(ms) {
    const until = now + ms;
    while (now < until) {
      const soonestTimer = Math.min(Infinity, ...[...timers.values()].map(timer => timer.next));
      const animationEnd = animation ? animation.started + animation.duration : Infinity;
      now = Math.min(until, soonestTimer, animationEnd);
      if (animation) {
        const active = animation;
        position = active.from + (active.to - active.from) * Math.min(1, (now - active.started) / Math.max(1, active.duration));
        if (now >= animationEnd) { animation = null; active.callback(true); }
      }
      for (const [id, timer] of [...timers]) if (timer.next <= now && timers.has(id)) { timer.next += timer.ms; timer.fn(); }
      render();
    }
    return output;
  }
  render();
  return {
    render, advance, progress, animationHistory, get player() { return input.player; }, get completed() { return completed; }, get timerCount() { return timers.size; },
    change(next) { input = { ...input, ...next }; dirty = true; return render(); },
    ready() { output.onReady(); return render(); },
    report(id, status) { output.reportMedia(id, status); return render(); },
    emit(name, event) { input.player.emit(name, event); return render(); },
    unmount() { hooks.forEach(value => value?.cleanup?.()); },
  };
}

test('a delayed photo gets its full display duration after its pixels load', () => {
  const h = harness(); h.advance(1500);
  assert.equal(h.progress.value, 0); assert.equal(h.completed, 0); assert.equal(h.render().mediaReady, false);
  h.ready(); h.advance(1250); assert.equal(h.progress.value, .25);
  h.advance(3750); assert.equal(h.completed, 1); h.advance(5000); assert.equal(h.completed, 1); h.unmount();
});
test('embedded media readiness and buffering preserve the remaining image clock', () => {
  const h = harness({ mediaType: 'text' });
  h.report('shared-video', 'loading'); h.advance(2000); assert.equal(h.progress.value, 0);
  h.report('shared-video', 'ready'); h.advance(2000); assert.equal(h.progress.value, .4);
  h.report('shared-video', 'loading'); h.advance(3000); assert.equal(h.progress.value, .4);
  h.report('shared-video', 'ready'); h.advance(3000); assert.equal(h.completed, 1); h.unmount();
});
test('hold/background pause resumes the same photo instead of consuming viewing time', () => {
  const h = harness(); h.ready(); h.advance(1000); h.change({ paused: true }); h.advance(20000);
  assert.equal(h.progress.value, .2); assert.equal(h.render().mediaError, false);
  h.change({ paused: false }); h.advance(4000); assert.equal(h.completed, 1); h.unmount();
});
test('late image events and animation completion cannot affect the next story', () => {
  const h = harness(); const old = h.render(); h.ready(); const oldAnimation = h.animationHistory.at(-1);
  h.change({ storyKey: 'second' }); old.onReady(); old.onError(); old.reportMedia('old-photo', 'error'); oldAnimation.callback(true);
  assert.equal(h.render().mediaReady, false); assert.equal(h.render().mediaError, false); assert.equal(h.completed, 0); assert.equal(h.progress.value, 0);
  h.ready(); h.advance(5000); assert.equal(h.completed, 1); h.unmount();
});
test('loading has a deadline and retry starts a fresh scoped clock', () => {
  const h = harness(); const old = h.render(); h.advance(12000);
  assert.equal(h.render().mediaError, true); assert.equal(h.progress.value, 0); assert.equal(h.completed, 0);
  old.onReady(); assert.equal(h.render().mediaError, true);
  h.change({ storyKey: 'first:retry' }); h.ready(); old.onError(); h.advance(5000);
  assert.equal(h.render().mediaError, false); assert.equal(h.completed, 1); h.unmount();
});
test('video progress follows actual trim position, waits for first frame and does not restart after buffering', () => {
  const h = harness({ mediaType: 'video', mediaTransform: { trimStart: 2, trimEnd: 6, speed: 2 } });
  h.emit('statusChange', { status: 'readyToPlay' }); h.emit('timeUpdate', { currentTime: 3 });
  assert.equal(h.progress.value, 0); h.ready(); assert.equal(h.player.currentTime, 2);
  h.emit('timeUpdate', { currentTime: 3 }); assert.equal(h.progress.value, .25);
  const seeks = h.player.seeks.length;
  h.emit('statusChange', { status: 'loading' }); h.advance(3000); assert.equal(h.progress.value, .25);
  h.emit('statusChange', { status: 'readyToPlay' }); assert.equal(h.player.seeks.length, seeks);
  h.emit('timeUpdate', { currentTime: 4 }); assert.equal(h.progress.value, .5);
  h.change({ paused: true }); h.emit('timeUpdate', { currentTime: 6 }); assert.equal(h.completed, 0);
  h.change({ paused: false }); h.advance(250); h.emit('playToEnd'); h.emit('playToEnd');
  assert.equal(h.completed, 1); h.unmount();
});
test('a stalled video exposes buffering then a bounded error without auto-skipping', () => {
  const h = harness({ mediaType: 'video' }); h.emit('statusChange', { status: 'readyToPlay' }); h.ready();
  h.emit('timeUpdate', { currentTime: 2 }); h.advance(1000); assert.equal(h.render().buffering, true); assert.equal(h.progress.value, .2);
  h.advance(11000); assert.equal(h.render().mediaError, true); assert.equal(h.completed, 0); h.unmount();
});
test('a stale video end event cannot close its successor and unmount removes timers/listeners', () => {
  const h = harness({ mediaType: 'video' }); h.emit('statusChange', { status: 'readyToPlay' }); h.ready();
  const oldPlayer = h.player, oldEnd = oldPlayer.callbacks('playToEnd')[0];
  h.change({ storyKey: 'second', player: player() }); oldEnd();
  assert.equal(h.completed, 0); assert.equal(h.render().mediaReady, false); assert.equal(oldPlayer.listenerCount, 0);
  h.unmount(); assert.equal(h.timerCount, 0); assert.equal(h.player.listenerCount, 0); oldEnd(); assert.equal(h.completed, 0);
});

test('next-story prefetch includes photo cards and posters without fetching a full video as an image', () => {
  const { storyPrefetchUrls } = load('shared/storyPlayback.ts');
  const urls = storyPrefetchUrls({ media_type: 'video', media_url: 'https://media/clip.mp4', thumbnail_url: 'https://media/poster.jpg', dual_front_url: 'https://media/dual.jpg', stickers_json: [{ kind: 'post', postMediaUrl: 'https://media/photo.jpg', postMediaType: 'image' }, { kind: 'photo', photoUrl: 'https://media/photo.jpg' }] });
  assert.deepEqual(Array.from(urls), ['https://media/poster.jpg', 'https://media/dual.jpg', 'https://media/photo.jpg']);
});
test('a timed-out story read never resolves later and clears its timer', async () => {
  let timeout, cleared = 0, resolve;
  const { withStoryTimeout } = load('shared/storyPlayback.ts', {}, { setTimeout(fn) { timeout = fn; return 1; }, clearTimeout() { cleared++; } });
  const pending = withStoryTimeout(new Promise(done => { resolve = done; })); timeout();
  await assert.rejects(pending, /too long/); resolve('late story'); await Promise.resolve(); assert.equal(cleared, 1);
});
test('returning to the feed uses the real nested routes, including a viewer with no back history', () => {
  const { returnToFeed } = load('src/navigation/returnToFeed.ts');
  const calls = [], rootNav = { getState: () => ({ routes: [{ name: 'Main' }, { name: 'StoryComposer' }] }), navigate: (...args) => calls.push(args) };
  returnToFeed({ getParent: () => rootNav }, { storyRefreshKey: 123 });
  assert.equal(calls[0][0], 'Main'); assert.equal(calls[0][1].screen, 'Feed'); assert.equal(calls[0][1].params.screen, 'FeedMain');
  let reset;
  returnToFeed({ getState: () => ({ routes: [{ name: 'StoryViewer' }] }), reset: state => { reset = state; } });
  assert.equal(reset.routes[0].name, 'Main'); assert.equal(reset.routes[0].state.routes[0].name, 'Feed');
  assert.equal(reset.routes[0].state.routes[0].state.routes[0].name, 'FeedMain');
});

function renderPostCard(sticker) {
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useContext: () => null, useId: () => 'card', useEffect() {}, useRef: value => ({ current: value }), useState: value => [value, () => {}] };
  const native = { View: 'View', Text: 'Text', Image: { getSize() {} }, TouchableOpacity: 'TouchableOpacity', Pressable: 'Pressable', StyleSheet: { create: value => value, hairlineWidth: 1 }, Dimensions: { get: () => ({ width: 390 }) }, useWindowDimensions: () => ({ width: 390, height: 844 }) };
  const module = load('src/components/stories/PostStoryCard.tsx', {
    react: { ...react, default: react }, 'react-native': native, '@expo/vector-icons': { Feather: 'Icon' },
    './StoryPixelImage': { default: 'Photo', StoryPhotoReadinessContext: {} }, 'expo-video': { VideoView: 'Video', useVideoPlayer: () => player() },
    '../../../shared/postVoiceEffects': { normalizePostPlayback: () => ({}), applyPostPlayback() {} }, '../../../shared/postMediaEditing': { postTrimWindow: () => ({}) },
    '../../../shared/storyPresentation': load('shared/storyPresentation.ts'), '../../../shared/storyPlayback': load('shared/storyPlayback.ts'), '../VerifiedBadge': { default: 'VerifiedBadge' },
  });
  return module.default({ sticker, interactive: true, onOpenPost() {}, onOpenProfile() {} });
}
test('reshared image/video cards omit inherited captions while preserving attribution and tap-through', () => {
  for (const postMediaType of ['image', 'video']) {
    const tree = renderPostCard({ postMediaType, postMediaUrl: 'https://media/source', postText: 'Inherited source caption', postArticleTitle: 'Source title', postUsername: 'original', postAuthorId: 'author' });
    const text = JSON.stringify(tree);
    assert.doesNotMatch(text, /Inherited source caption|Source title/);
    assert.match(text, /@original/); assert.match(text, /Open shared post/); assert.match(text, /View post/);
  }
});
test('text-only shared posts retain their original text', () => {
  const tree = renderPostCard({ postText: 'Text-only source', postUsername: 'original' });
  assert.match(JSON.stringify(tree), /Text-only source/);
});
