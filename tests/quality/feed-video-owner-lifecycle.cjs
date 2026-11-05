const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const flushPromises = () => new Promise(setImmediate);

function harness({ adaptiveEnabled = false, adaptiveOverrides } = {}) {
  let context, cursor = 0, dirty = true, effects = [], scopeChange, appChange, timerId = 0;
  const mounted = [], players = [], timers = new Map();
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useRef(value) { const i = cursor++; return context.hooks[i] ??= { current: value }; },
    useEffect(effect, deps) { const i = cursor++, old = context.hooks[i], owner = context; if (!same(old?.deps, deps)) { owner.hooks[i] = { deps }; effects.push(() => { old?.cleanup?.(); owner.hooks[i].cleanup = effect(); }); } },
  };
  const app = { currentState: 'active', addEventListener(_name, fn) { appChange = fn; return { remove() {} }; } };
  function createStore(initializer) {
    let state;
    const set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; dirty = true; };
    state = initializer(set);
    const useStore = () => state;
    useStore.getState = () => state;
    return useStore;
  }
  function player() {
    const listeners = new Map(); let resolveSource;
    const p = {
      status: 'idle', currentTime: 0, released: false, pauses: 0, sources: [],
      replaceAsync(source) { p.sources.push(source); p.status = 'loading'; return new Promise(resolve => { resolveSource = resolve; }); },
      pause() { p.pauses++; }, release() { p.released = true; },
      addListener(name, callback) { const events = listeners.get(name) || new Set(); events.add(callback); listeners.set(name, events); return { remove() { events.delete(callback); } }; },
      ready() { p.status = 'readyToPlay'; for (const fn of [...listeners.get('statusChange') || []]) fn({ status: p.status }); resolveSource?.(); },
      fail() { p.status = 'error'; for (const fn of [...listeners.get('statusChange') || []]) fn({ status: p.status }); },
    };
    const native = {};
    for (const property of ['preservesPitch', 'playbackRate']) Object.defineProperty(p, property, {
      get() { if (p.released) throw Error('Native shared object has been released'); return native[property]; },
      set(value) { if (p.released) throw Error('Native shared object has been released'); native[property] = value; },
    });
    players.push(p); return p;
  }
  function load(file, imports) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { exports, process: { env: { EXPO_PUBLIC_ADAPTIVE_MEDIA: String(adaptiveEnabled) } }, URL, AbortController, TextDecoder, require(name) { if (!(name in imports)) throw Error(name); return imports[name]; }, Date, Math, setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } });
    return exports;
  }
  const pool = load('shared/videoReadiness.ts', {});
  const adaptive = adaptiveOverrides || load('shared/adaptiveMedia.ts', {});
  const engine = load('src/lib/videoEngine.ts', { react, 'react-native': { AppState: app }, 'expo-video': { createVideoPlayer: player }, zustand: { create: createStore }, '../../shared/videoReadiness': pool, '../../shared/adaptiveMedia': adaptive, './navigationCache': { subscribeNavigationScope(fn) { scopeChange = fn; } } });
  function render(deferEffects = false) {
    for (let pass = 0; dirty; pass++) {
      if (pass >= 30) throw Error('Video ownership render loop');
      dirty = false;
      for (const item of mounted) { context = item; cursor = 0; item.output = engine.useSharedVideo(item.config); }
      if (deferEffects) break;
      const pending = effects; effects = []; pending.forEach(fn => fn());
    }
  }
  return { engine, players, render,
    renderDeferred() { dirty = true; render(true); },
    flushEffects() { const pending = effects; effects = []; pending.forEach(fn => fn()); },
    mount(uri, active = true) { const item = { config: { uri, visible: active, screenActive: true }, hooks: [] }; mounted.push(item); dirty = true; render(); return item; },
    update(item, patch) { item.config = { ...item.config, ...patch }; dirty = true; render(); },
    async flush() { await flushPromises(); render(); },
    app(state) { app.currentState = state; appChange(state); render(); },
    scope() { scopeChange(); render(); },
    dispose() { mounted.forEach(item => item.hooks.forEach(hook => hook?.cleanup?.())); engine.clearVideoEngine(); },
  };
}

test('adaptive discovery cannot delay the two native lookahead buffers or replace their pixels', async () => {
  const pending = [], probed = [];
  const h = harness({ adaptiveEnabled: true, adaptiveOverrides: {
    knownAdaptiveMedia: () => null, clearAdaptiveMedia() {},
    resolveAdaptiveMedia: source => { probed.push(source); return new Promise(resolve => pending.push(resolve)); },
  } });
  h.engine.prefetchFeedVideos([{ uri: 'https://media/one.mp4' }, { uri: 'https://media/two.mp4' }],
    [{ uri: 'https://media/three.mp4' }, { uri: 'https://media/four.mp4' }, { uri: 'https://media/excess.mp4' }]);
  assert.equal(h.players.length, 2);
  assert.deepEqual(probed, ['https://media/one.mp4', 'https://media/two.mp4', 'https://media/three.mp4', 'https://media/four.mp4']);
  await h.flush();
  assert.deepEqual(h.players.map(p => p.sources[0].uri), ['https://media/one.mp4', 'https://media/two.mp4']);
  h.players.forEach(p => p.ready());
  pending.forEach(resolve => resolve({ hlsUrl: 'https://media/ready.m3u8' }));
  await h.flush();
  assert.ok(h.players.every(p => p.sources.length === 1));
  h.dispose();
});

test('the actual feed owner hook keeps late source events out of the next visible card', async () => {
  const h = harness(), first = h.mount('https://media/first.mp4'); await h.flush();
  const old = h.players[0];
  const next = h.mount('https://media/next.mp4', false);
  h.update(first, { visible: false }); h.update(next, { visible: true }); await h.flush();
  const current = h.players[1];
  old.ready(); await h.flush();
  assert.equal(next.output.player, current); assert.equal(next.output.sourceReady, false);
  assert.equal(first.output.owns, false); assert.equal(first.output.player, null);
  current.ready(); await h.flush();
  assert.equal(next.output.sourceReady, true); assert.equal(current.sources[0].uri, 'https://media/next.mp4');
  assert.equal(old.sources.length, 1); assert.equal(current.sources.length, 1); h.dispose();
});
test('backgrounding releases native players and foregrounding reacquires the visible source', async () => {
  const h = harness(), card = h.mount('https://media/clip.mp4'); await h.flush();
  h.players[0].ready(); await h.flush(); const first = card.output.player;
  h.app('background'); assert.equal(first.released, true); assert.equal(card.output.player, null); assert.equal(card.output.owns, false);
  h.app('active'); await h.flush();
  const replacement = h.players[1]; assert.notEqual(replacement, first); assert.equal(card.output.player, replacement);
  replacement.ready(); await h.flush(); assert.equal(card.output.sourceReady, true); h.dispose();
});
test('evicting a held inactive source clears its rendered player before release', async () => {
  const h = harness(), card = h.mount('https://media/held.mp4'); await h.flush(); h.players[0].ready(); await h.flush();
  const held = card.output.player; h.update(card, { visible: false }); assert.equal(card.output.canHold, true);
  h.engine.prefetchFeedVideos([{ uri: 'https://media/one.mp4' }, { uri: 'https://media/two.mp4' }]);
  h.engine.prefetchFeedVideos([{ uri: 'https://media/three.mp4' }]); await h.flush();
  assert.equal(held.released, true); assert.equal(card.output.player, null); assert.equal(card.output.sourceReady, false); h.dispose();
});
test('only the last owner can hold a paused surface when two cards use the same video URL', async () => {
  const h = harness(), first = h.mount('https://media/shared.mp4'); await h.flush();
  h.players[0].ready(); await h.flush();
  const duplicate = h.mount('https://media/shared.mp4', false);
  h.update(first, { visible: false });
  assert.equal(first.output.canHold, true);
  assert.equal(duplicate.output.canHold, false, 'The duplicate must not attach the same native player');
  h.update(duplicate, { visible: true });
  assert.equal(duplicate.output.owns, true); assert.equal(first.output.canHold, false);
  h.update(duplicate, { visible: false });
  assert.equal(first.output.canHold, false); assert.equal(duplicate.output.canHold, true);
  assert.equal(h.players.length, 1, 'Visibility changes keep the buffered source'); h.dispose();
});
test('a native error after source attachment becomes a recoverable active-card error', async () => {
  const h = harness(), card = h.mount('https://media/clip.mp4'); await h.flush(); h.players[0].ready(); await h.flush();
  h.players[0].fail(); h.render();
  assert.equal(card.output.failed, true); assert.equal(card.output.sourceReady, false); h.dispose();
});

test('a retired card retry cannot replace the player of a newer owner', async () => {
  const h = harness(), first = h.mount('https://media/first.mp4'); await h.flush();
  h.players[0].ready(); await h.flush();
  const retiredRetry = first.output.retry;
  const next = h.mount('https://media/next.mp4', false);
  h.update(first, { visible: false }); h.update(next, { visible: true }); await h.flush();
  const current = h.players[1]; current.ready(); await h.flush();
  const before = h.engine.useVideoEngine.getState();
  retiredRetry(); await h.flush();
  const after = h.engine.useVideoEngine.getState();
  assert.equal(h.players.length, 2, 'No player is created for a retired retry handler');
  assert.equal(after.owner, before.owner); assert.equal(after.uri, before.uri);
  assert.equal(after.player, current); assert.equal(after.version, before.version);
  assert.equal(next.output.player, current); assert.equal(next.output.sourceReady, true);
  assert.equal(current.released, false); h.dispose();
});

test('a ready hook effect queued before invalidation cannot configure a released player', async () => {
  const h = harness(), card = h.mount('https://media/clip.mp4'); await h.flush();
  const player = h.players[0]; player.ready(); h.renderDeferred();
  h.engine.clearVideoEngine(); assert.equal(player.released, true);
  assert.doesNotThrow(() => h.flushEffects());
  h.render(); assert.equal(card.output.player, null); h.dispose();
});
