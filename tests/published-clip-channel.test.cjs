const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.join(__dirname, '..'), id = n => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = 'https://fixture.supabase.co', key = 'live-clips/' + [1, 2, 3, 4].map(id).join('/') + '/vertical.mp4', token = 'a'.repeat(64);
const source = `${base}/functions/v1/media-content/${key}?token=${token}`, hls = `https://media.fixture.test/playback/${key}/master.m3u8?token=${token}`;
const ordinary = `${base}/storage/v1/object/sign/channel-media/channel/owner/ordinary.mp4?token=storage.signature`;
const expiry = () => Date.now() + 120000;
function compile(source, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
    { exports, require: name => { if (name in dependencies) return dependencies[name]; throw Error(name); }, URL, AbortController, TextDecoder, Uint8Array, Request, Response, Headers, setTimeout, clearTimeout, fetch: async () => { throw Error('Unexpected network'); }, process: { env: { EXPO_PUBLIC_ADAPTIVE_MEDIA: 'true', NEXT_PUBLIC_ADAPTIVE_MEDIA: 'true' } }, ...globals });
  return exports;
}
const load = (file, dependencies, globals) => compile(fs.readFileSync(path.join(root, file), 'utf8'), dependencies, globals);
function hooks() {
  let cursor = 0, effects = []; const state = [];
  const same = (a, b) => a && a.length === b.length && a.every((value, i) => value === b[i]);
  const api = {
    useRef(value) { const i = cursor++; return state[i] ??= { current: value }; },
    useMemo(fn, deps) { const i = cursor++; if (!state[i] || !same(state[i].deps, deps)) state[i] = { deps, value: fn() }; return state[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!state[i] || !same(state[i].deps, deps)) { const before = state[i]; const next = state[i] = { deps }; effects.push(() => { before?.cleanup?.(); next.cleanup = fn(); }); } },
  };
  return { api, render(fn) { cursor = 0; const tree = fn(); const pending = effects; effects = []; return { tree, flush: () => pending.forEach(effect => effect()) }; }, unmount() { state.forEach(value => value?.cleanup?.()); } };
}
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
function events() { const callbacks = new Map(); return { callbacks, addEventListener(name, fn) { const set = callbacks.get(name) || new Set(); set.add(fn); callbacks.set(name, set); }, removeEventListener(name, fn) { callbacks.get(name)?.delete(fn); }, emit(name, value) { for (const fn of callbacks.get(name) || []) fn(value); } }; }
function client() {
  return { auth: { getSession: async () => ({ data: { session: { user: { id: id(1) }, access_token: 'session' } }, error: null }), getUser: async () => ({ data: { user: { id: id(1) } }, error: null }) },
    functions: { invoke: async () => ({ data: { urls: [{ key, url: source, sourceVersion: 'clip-v1', playback: { hlsUrl: hls, sourceVersion: 'clip-v1', expiresAt: expiry() } }], expiresAt: expiry() }, error: null }) },
    storage: { from: bucket => { assert.equal(bucket, 'channel-media'); return { createSignedUrl: async () => ({ data: { signedUrl: ordinary }, error: null }) }; } } };
}
const rows = () => [{ id: id(10), media_url: `${base}/storage/v1/object/public/${key}` }, { id: id(11), media_url: `${base}/storage/v1/object/public/channel-media/channel/owner/ordinary.mp4` }];

test('web channel hydration seeds exact authorized clip readiness before returning URLs and keeps ordinary signing', async () => {
  const adaptive = load('shared/adaptiveMedia.ts');
  const content = load('shared/contentMedia.ts');
  const channel = load('web/lib/liveChannelMedia.ts', { '../../shared/adaptiveMedia': adaptive, '../../shared/contentMedia': content, '../../shared/channelMedia': load('shared/channelMedia.ts'), './withTimeout': { withTimeout: work => work } }, { window: {} });
  const result = await channel.channelAttachmentUrls(client(), base, rows());
  assert.equal(result[id(10)], source); assert.equal(result[id(11)], ordinary);
  assert.equal(adaptive.knownAdaptiveMedia(source).hlsUrl, hls); assert.equal(adaptive.knownAdaptiveMedia(ordinary), null);
});

test('native channel hydration seeds current scope only and never signs clip bytes through ordinary Storage', async () => {
  const file = fs.readFileSync(path.join(root, 'src/screens/channels/ChannelScreen.tsx'), 'utf8');
  const ast = ts.createSourceFile('ChannelScreen.tsx', file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let expression;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'signMedia') expression = node.initializer.getText(ast); ts.forEachChild(node, visit); }; visit(ast);
  for (const current of [true, false]) {
    const adaptive = load('shared/adaptiveMedia.ts'), content = load('shared/contentMedia.ts'); let result;
    const { sign } = compile('exports.sign = ' + expression, {}, { useCallback: fn => fn, uid: id(1), channelId: id(12), SUPABASE_URL: base, supabase: client(), deadline: work => work,
      valid: () => current, setMediaUrls: fn => { result = fn({}); }, ...content, channelMediaObject: load('shared/channelMedia.ts').channelMediaObject, acceptAdaptiveMedia: adaptive.acceptAdaptiveMedia });
    await sign(rows(), 1);
    if (current) { assert.equal(result[id(10)], source); assert.equal(result[id(11)], ordinary); assert.equal(adaptive.knownAdaptiveMedia(source).hlsUrl, hls); }
    else { assert.equal(result, undefined); assert.equal(adaptive.knownAdaptiveMedia(source), null); }
  }
});

test('web channel player retains controls, falls back before renewing and uses the current renewal callback', async () => {
  const state = hooks(), media = load('shared/adaptiveMedia.ts'); media.acceptAdaptiveMedia([{ source, hlsUrl: hls, sourceVersion: 'clip-v1', expiresAt: expiry() }]);
  const document = { ...events(), hidden: false };
  const video = { ...events(), src: '', currentSrc: '', paused: true, currentTime: 0, duration: 30, loads: 0, canPlayType: () => true, getAttribute(name) { return this[name]; }, removeAttribute(name) { this[name] = ''; }, load() { this.loads++; this.currentSrc = this.src; }, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
  const helper = load('web/lib/adaptiveVideo.ts', { '../../shared/adaptiveMedia': media });
  const { ChannelVideo } = load('web/components/ChannelVideo.tsx', { react: state.api, 'react/jsx-runtime': jsx, '@/lib/adaptiveVideo': helper }, { document });
  let first = 0, latest = 0;
  const render = (url, onError) => { const { tree, flush } = state.render(() => ChannelVideo({ source: url, onError })); tree.props.ref.current = video; flush(); return tree; };
  const tree = render(source, () => first++); assert.equal(tree.props.src, undefined); assert.equal(tree.props.controls, true); assert.equal(video.src, hls);
  render(source, () => latest++); assert.equal(video.loads, 1);
  video.currentTime = 7; video.paused = false; video.emit('error'); assert.equal(video.src, source); assert.equal(latest, 0);
  video.emit('loadedmetadata'); await Promise.resolve(); assert.equal(video.currentTime, 7);
  video.emit('error'); assert.equal(first, 0); assert.equal(latest, 1);
  render(ordinary, () => latest++); assert.equal(video.src, ordinary); video.emit('error'); assert.equal(latest, 2);
  state.unmount(); assert.equal(video.src, ''); assert.equal(video.paused, true);
});

test('native channel player selects prepared HLS with manual controls and pauses hidden or background playback', () => {
  const state = hooks(), media = load('shared/adaptiveMedia.ts'); media.acceptAdaptiveMedia([{ source, hlsUrl: hls, sourceVersion: 'clip-v1', expiresAt: expiry() }]);
  const listeners = new Map(), background = events(); let selected;
  const player = { paused: true, currentTime: 0, playing: false, pause() { this.paused = true; this.playing = false; }, play() { this.paused = false; this.playing = true; }, addListener(name, fn) { const values = listeners.get(name) || new Set(); values.add(fn); listeners.set(name, values); return { remove: () => values.delete(fn) }; } };
  const expo = { VideoView: 'VideoView', useVideoPlayer: value => { selected = value; return player; } };
  const native = { AppState: { currentState: 'active', addEventListener(name, fn) { background.addEventListener(name, fn); return { remove: () => background.removeEventListener(name, fn) }; } } };
  const hook = load('src/lib/useAdaptiveVideoPlayer.ts', { react: state.api, 'expo-video': expo, '../../shared/adaptiveMedia': media });
  const { ChannelVideo } = load('src/components/channels/ChannelVideo.tsx', { react: state.api, 'react/jsx-runtime': jsx, 'react-native': native, 'expo-video': expo, '../../lib/useAdaptiveVideoPlayer': hook });
  const render = active => { const { tree, flush } = state.render(() => ChannelVideo({ source, active, style: { height: 220 } })); flush(); return tree; };
  const tree = render(true); assert.equal(selected.uri, hls); assert.equal(tree.props.nativeControls, true); assert.equal(tree.props.contentFit, 'contain'); assert.equal(player.paused, true);
  player.play(); background.emit('change', 'background'); assert.equal(player.paused, true);
  render(false); player.play(); for (const fn of listeners.get('playingChange')) fn({ isPlaying: true }); assert.equal(player.paused, true);
  state.unmount(); assert.equal(background.callbacks.get('change').size, 0); assert.equal(listeners.get('playingChange').size, 0);
});
