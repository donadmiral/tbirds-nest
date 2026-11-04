const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(file, imports, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Promise, Error, Date, Math, ...globals,
    require(name) { if (name in imports) return imports[name]; throw Error('Unexpected import ' + name); } });
  return module.exports;
}

function harness({ live = true } = {}) {
  let cursor = 0, dirty = false, now = 100000, serial = 0, presence, view, appChange, control, denial;
  const slots = [], effects = [], timers = new Map(), handlers = new Map(), sources = [];
  const auth = { profile: { id: 'viewer' }, session: { user: { id: 'viewer', last_sign_in_at: 'first' } } };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createContext: () => ({ Provider: 'Provider' }), createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial; return [slots[id], value => { const next = typeof value === 'function' ? value(slots[id]) : value; if (!Object.is(next, slots[id])) { slots[id] = next; dirty = true; } }]; },
    useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useCallback(fn, deps) { const id = cursor++; if (!slots[id] || !same(slots[id].deps, deps)) slots[id] = { fn, deps }; return slots[id].fn; },
    useEffect(fn, deps) { const id = cursor++; if (!slots[id] || !same(slots[id].deps, deps)) { const cleanup = slots[id]?.cleanup; slots[id] = { deps }; effects.push(() => { cleanup?.(); slots[id].cleanup = fn(); }); } },
  };
  const player = { playing: false, status: 'idle', currentTime: 0,
    async replaceAsync(source) { sources.push(source?.uri ?? null); this.status = source ? 'loading' : 'idle'; emit('statusChange', { status: this.status }); },
    play() { this.playing = true; emit('playingChange', { isPlaying: true }); },
    pause() { this.playing = false; emit('playingChange', { isPlaying: false }); },
    addListener(name, fn) { const list = handlers.get(name) || new Set(); list.add(fn); handlers.set(name, list); return { remove: () => list.delete(fn) }; },
  };
  function emit(name, value) { handlers.get(name)?.forEach(fn => fn(value)); }
  class Clock extends Date { static now() { return now; } }
  const clock = { Date: Clock, setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
  const policy = load('src/services/livePlaybackStartup.ts', {}, clock);
  const component = load('src/contexts/LivePlaybackContext.tsx', {
    react, 'react-native': { AppState: { currentState: 'active', addEventListener(_name, fn) { appChange = fn; return { remove() {} }; } }, StyleSheet: { create: value => value } },
    'expo-video': { useVideoPlayer: () => player }, '@expo/vector-icons': {},
    '../stores/authStore': { useAuthStore: selector => selector(auth) }, '../contexts/CallContext': {}, './CallContext': { useCallContext: () => ({ callState: 'idle' }) },
    '../services/liveService': { liveRequestId: () => 'playback', liveObject: value => value && typeof value === 'object', livePlayback: async () => { if (denial) throw Error(denial); return { url: 'https://media.example/live.m3u8', expiresAt: now + 120000, live }; } },
    '../services/liveControlEvents': { subscribeLiveControl(_session, _owner, fn) { control = fn; return () => {}; } },
    '../services/livePlaybackStartup': policy, '../services/supabase': { supabase: {} },
    '../../shared/useLiveViewerPresence': { useLiveViewerPresence: value => { presence = value; } },
  }, clock).LivePlaybackProvider;
  function render() { cursor = 0; dirty = false; view = component({ children: null }).props.value; }
  async function settle() { for (let pass = 0; pass < 20; pass++) { if (dirty || !view) render(); while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)); if (!dirty && !effects.length) return; } throw Error('Provider did not settle'); }
  return { player, sources, timers, get view() { return view; }, get presence() { return presence; }, settle,
    async open() { await settle(); await view.open({ id: 'live-session', title: 'Live', state: live ? 'live' : 'ended', host: {} }); await settle(); },
    async status(status, message) { player.status = status; emit('statusChange', { status, error: message ? { message } : undefined }); await settle(); },
    async background() { appChange('background'); await settle(); },
    async advanceRetry() { const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0]; assert.ok(entry && entry[1].at < now + 15000, 'Expected one bounded startup retry'); timers.delete(entry[0]); now = entry[1].at; entry[1].fn(); await settle(); },
    async revoke() { denial = 'This stream is unavailable or your access has changed.'; control('access_changed', { user_id: 'viewer' }); await settle(); },
  };
}

test('native measured presence requires ready playback and respects background, PiP, pause and replay', async () => {
  const app = harness(); await app.open(); assert.equal(app.presence.active, false);
  await app.status('readyToPlay'); assert.equal(app.presence.active, true);
  await app.background(); assert.equal(app.presence.active, false);
  app.view.setPictureInPicture(true); await app.settle(); assert.equal(app.presence.active, true);
  app.player.pause(); await app.settle(); assert.equal(app.presence.active, false);
  app.player.play(); await app.settle(); await app.status('loading'); assert.equal(app.presence.active, false);
  const replay = harness({ live: false }); await replay.open(); await replay.status('readyToPlay'); assert.equal(replay.presence.active, false);
});

test('native initial CDN errors retry the authorized source and stop after actual playback', async () => {
  const app = harness(); await app.open(); const initial = app.sources.filter(Boolean).length;
  await app.status('error', 'HTTP 403'); assert.equal(app.view.error, null); assert.equal(app.view.loading, true);
  await app.advanceRetry(); assert.equal(app.sources.filter(Boolean).length, initial + 1);
  await app.status('readyToPlay'); assert.equal(app.view.loading, false); assert.equal(app.presence.active, true);
  await app.status('error', 'HTTP 403'); assert.match(app.view.error, /Retry/); assert.equal(app.view.loading, false);
});

test('native startup retries are cancelled immediately when access is revoked or playback closes', async () => {
  const app = harness(); await app.open(); await app.status('error', 'HTTP 404'); await app.revoke();
  assert.equal(app.sources.at(-1), null); assert.equal(app.timers.size, 0); assert.equal(app.presence.active, false); assert.match(app.view.error, /access has changed/);
  const closed = harness(); await closed.open(); await closed.status('error', 'HTTP 403'); closed.view.close(); await closed.settle();
  assert.equal(closed.timers.size, 0); assert.equal(closed.view.session, null); assert.equal(closed.presence.active, false);
});
