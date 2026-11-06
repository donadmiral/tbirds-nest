const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function compile(file) {
  const built = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, reportDiagnostics: true });
  assert.equal((built.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, file);
  return built.outputText;
}
const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
const text = value => Array.isArray(value) ? value.map(text).join('') : typeof value === 'string' ? value : value?.props ? text(value.props.children) : '';

function harness({ live = true, tokens = true, mse = true } = {}) {
  let cursor = 0, dirty = false, now = 1000000, serial = 0, view, presence, grants = 0, denial = null, rendered;
  const slots = [], effects = [], timers = new Map(), fetches = [], engines = [], loads = [], listeners = new Map(), windowListeners = new Map(), docListeners = new Map();
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const react = {
    createContext: () => ({ Provider: 'Provider' }), useContext: () => null, Fragment: 'Fragment',
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) { const cleanup = slots[i]?.cleanup; slots[i] = { deps }; effects.push(() => { cleanup?.(); slots[i].cleanup = fn(); }); } },
    useSyncExternalStore(_subscribe, snapshot) { cursor++; return snapshot(); },
  };
  const identity = { owner: 'viewer', scope: 'viewer:1', initialized: true };
  const navigation = { subscribe: () => () => {}, getSnapshot: () => identity, getServerSnapshot: () => identity };
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'token-1' } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
  const grantUrl = () => tokens ? `https://cdn.live.test/_live/cap-${grants}/session-1/master.m3u8` : 'https://cdn.live.test/public/session-1/master.m3u8';
  const liveApi = { liveError: e => String(e?.message || e), getLivePlayback: async () => { if (denial) throw Error(denial); grants++; return { url: grantUrl(), expires_at: new Date(now + 120000).toISOString(), format: 'hls', live, poster_url: null, tracks: [] }; } };
  class BaseLoader { constructor(config) { this.config = config; } load(context) { loads.push(context.url); } }
  class FakeHls {
    static isSupported() { return mse; }
    static get DefaultConfig() { return { loader: BaseLoader }; }
    static Events = { ERROR: 'hlsError' };
    constructor(config) { this.config = config; this.destroyed = false; engines.push(this); }
    on() {} loadSource(url) { this.source = url; } attachMedia() {} destroy() { this.destroyed = true; } stopLoad() {}
  }
  const element = { paused: true, currentTime: 0, duration: NaN, readyState: 0, dataset: {}, src: '', playCalls:0, loads:0, playRejects: false,
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); },
    async play() { element.playCalls++; if (element.playRejects) throw Error('NotAllowedError'); element.paused = false; }, pause() { element.paused = true; }, canPlayType: () => mse ? '' : 'maybe', load() {element.loads++;} };
  const document = { visibilityState: 'visible', pictureInPictureElement: null, pictureInPictureEnabled: false, documentElement: {}, addEventListener(name, fn) { docListeners.set(name, fn); }, removeEventListener(name) { docListeners.delete(name); } };
  const window = { innerHeight: 800, addEventListener(name, fn) { windowListeners.set(name, fn); }, removeEventListener(name) { windowListeners.delete(name); } };
  class Clock extends Date { static now() { return now; } }
  const presenceRef = { current: null };
  const context = { Date: Clock, setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    document, window, navigator: { onLine: true }, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, ResizeObserver: class { observe() {} disconnect() {} },
    crypto: { randomUUID: () => 'playback-' + (++serial) }, fetch: (url, init) => { fetches.push({ url, init }); return Promise.resolve({ ok: true }); },
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://db.test/', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' } }, console, Promise, Error, URL, Math, JSON };
  const load = (file, imports) => { const module = { exports: {} }; vm.runInNewContext(compile(file), { module, exports: module.exports, ...context, require(name) { assert.ok(name in imports, 'Unexpected import ' + name); return imports[name]; } }); return module.exports; };
  const renewal = load('web/lib/livePlaybackRenewal.ts', {}), leave = load('web/lib/liveViewerLeave.ts', {});
  const component = load('web/components/LivePlaybackProvider.tsx', { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'next/link': 'Link', 'next/navigation': { useRouter: () => ({ push() {} }) },
    'lucide-react': { Maximize2: 'Maximize2', Minimize2: 'Minimize2', PictureInPicture2: 'PictureInPicture2', X: 'X' }, '@/lib/supabase/client': { createClient: () => client }, '@/lib/navigationCache': { getNavigationStore: () => navigation },
    '@/lib/liveApi': liveApi, '@/lib/livePlaybackRenewal': renewal, '@/lib/liveViewerLeave': leave, 'hls.js': { __esModule: true, default: FakeHls },
    '../../shared/useLiveViewerPresence': { createLiveViewerPresenceHook: () => input => { presence = input; presenceRef.current = input.sessionId ? { sessionId: input.sessionId, playbackId: 'player-one' } : null; return presenceRef; } } }).LivePlaybackProvider;
  function render() { cursor = 0; dirty = false; rendered = component({ children: null }); view = rendered.props.value; const video = nodes(rendered).find(n => n.type === 'video'); if (video) video.props.ref.current = element; }
  async function settle() { for (let pass = 0; pass < 30; pass++) { if (dirty || !view) render(); while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)); if (!dirty && !effects.length) return; } throw Error('Provider did not settle'); }
  const video = () => nodes(rendered).find(n => n.type === 'video');
  const overlay = () => { const status = nodes(rendered).find(n => n.type === 'p' && (n.props.role === 'status' || n.props.role === 'alert')); return status ? text(status) : null; };
  return { element, engines, loads, timers, fetches, renewal, leave, settle, get view() { return view; }, get presence() { return presence; }, get grants() { return grants; },
    async open() { await settle(); view.open({ id: 'session-1', title: 'Live', state: live ? 'live' : 'ended', host: {} }); await settle(); },
    async metadata() { listeners.get('loadedmetadata')(); await settle(); await new Promise(resolve => setImmediate(resolve)); await settle(); },
    async playing() { video().props.onPlaying({currentTarget:element}); await settle(); }, async waiting() { video().props.onWaiting(); await settle(); }, async pause() { element.paused = true; video().props.onPause({currentTarget:element}); await settle(); },
    async manualPlay(){element.paused=false;video().props.onPlay({currentTarget:element});await settle();},
    async nativeError(){listeners.get('error')();await settle();},
    async hidden(value){document.visibilityState=value?'hidden':'visible';docListeners.get('visibilitychange')?.();await settle();},
    async close(){view.close();await settle();},
    savedMetadata(){return listeners.get('loadedmetadata');},
    hasDomAutoplay(){return !!video().props.autoPlay;},
    deny(message) { denial = message; }, allow() { denial = null; },
    timer(min, max) { return [...timers].find(([, t]) => t.delay >= min && t.delay <= max) || null; },
    async fire(entry) { assert.ok(entry, 'Expected a scheduled timer'); timers.delete(entry[0]); now = Math.max(now, entry[1].at); entry[1].fn(); await settle(); },
    advance(ms) { now += ms; }, overlay, button: label => nodes(rendered).find(n => n.type === 'button' && text(n) === label),
    pagehide() { windowListeners.get('pagehide')(); },
  };
}

test('capability renewal helpers swap only the token and recognise the same stream', () => {
  const app = harness();
  assert.equal(app.renewal.livePlaybackToken('https://cdn.test/_live/abc/s/master.m3u8'), 'abc');
  assert.equal(app.renewal.livePlaybackToken('https://cdn.test/public/s/master.m3u8'), null);
  assert.equal(app.renewal.renewLivePlaybackUrl('https://cdn.test/_live/abc/s/r0/seg-1.ts?x=1', 'def'), 'https://cdn.test/_live/def/s/r0/seg-1.ts?x=1');
  assert.equal(app.renewal.renewLivePlaybackUrl('https://cdn.test/public/s/master.m3u8', 'def'), 'https://cdn.test/public/s/master.m3u8');
  assert.equal(app.renewal.renewLivePlaybackUrl('https://cdn.test/_live/abc/s/master.m3u8', null), 'https://cdn.test/_live/abc/s/master.m3u8');
  assert.equal(app.renewal.sameLiveStream('https://cdn.test/_live/abc/s/master.m3u8', 'https://cdn.test/_live/def/s/master.m3u8'), true);
  assert.equal(app.renewal.sameLiveStream('https://cdn.test/_live/abc/s/master.m3u8', 'https://cdn.test/_live/def/other/master.m3u8'), false);
  assert.equal(app.renewal.sameLiveStream('https://cdn.test/public/s/master.m3u8', 'https://cdn.test/public/s/master.m3u8'), true);
  const request = app.leave.liveViewerLeaveRequest('https://db.test/', 'anon', 'jwt', 'session-1', 'player-one');
  assert.equal(request.url, 'https://db.test/rest/v1/rpc/live_viewer_heartbeat'); assert.equal(request.init.keepalive, true);
  assert.equal(request.init.headers.Authorization, 'Bearer jwt'); assert.deepEqual(JSON.parse(request.init.body), { p_session_id: 'session-1', p_playback_id: 'player-one', p_active: false });
});

test('a rebuffer or a grant renewal keeps the viewer counted and the engine running; the viewer\'s own pause releases the lease', async () => {
  const app = harness(); await app.open();
  assert.equal(app.engines.length, 1); assert.equal(app.presence.active, false); assert.equal(app.overlay(), 'Starting the stream…');
  await app.metadata(); await app.playing();
  assert.equal(app.presence.active, true); assert.equal(app.overlay(), null);
  await app.waiting(); assert.equal(app.presence.active, true, 'Buffering is not leaving');
  const renewal = app.timer(60000, 95000); assert.ok(renewal);
  await app.fire(renewal);
  assert.equal(app.grants, 2); assert.equal(app.engines.length, 1, 'The running engine is kept'); assert.equal(app.engines[0].destroyed, false);
  new app.engines[0].config.pLoader({}).load({ url: 'https://cdn.live.test/_live/cap-1/session-1/r0/seg-9.ts' }, {}, {});
  assert.equal(app.loads.at(-1), 'https://cdn.live.test/_live/cap-2/session-1/r0/seg-9.ts', 'Requests carry the renewed capability');
  assert.equal(app.presence.active, true);
  await app.pause(); assert.equal(app.presence.active, false);
  await app.fire(app.timer(60000, 95000)); assert.equal(app.engines.length, 1, 'A healthy paused MSE engine keeps its buffer'); assert.equal(app.element.paused,true);
});

test('a failed renewal keeps the stream playing while its grant is valid, retries, and only fails once the grant is gone', async () => {
  const app = harness(); await app.open(); await app.metadata(); await app.playing();
  app.deny('TIMEOUT');
  await app.fire(app.timer(60000, 95000));
  assert.equal(app.view.error, null); assert.equal(app.view.status, 'playing'); assert.equal(app.presence.active, true);
  const retry = app.timer(1000, 21000); assert.ok(retry, 'A retry is scheduled before the grant runs out');
  app.advance(40000); await app.fire(retry);
  assert.match(app.view.error, /TIMEOUT/); assert.equal(app.presence.active, false); assert.equal(app.element.paused, true);
});

test('closing the tab sends a keepalive leave for a counted viewer only', async () => {
  const app = harness(); await app.open(); await app.metadata();
  app.pagehide(); assert.equal(app.fetches.length, 0, 'No frames yet, nothing to release');
  await app.playing(); app.pagehide();
  assert.equal(app.fetches.length, 1); assert.equal(app.fetches[0].url, 'https://db.test/rest/v1/rpc/live_viewer_heartbeat');
  assert.equal(app.fetches[0].init.keepalive, true); assert.equal(app.fetches[0].init.headers.Authorization, 'Bearer token-1');
  assert.deepEqual(JSON.parse(app.fetches[0].init.body), { p_session_id: 'session-1', p_playback_id: 'player-one', p_active: false });
});

test('a refused autoplay offers a play control instead of a silent black box', async () => {
  const app = harness(); await app.open(); app.element.playRejects = true;
  await app.metadata();
  assert.equal(app.view.status, 'ready'); assert.equal(app.overlay(), 'Press play to start the stream.'); assert.ok(app.button('Play'));
  app.element.playRejects = false; app.button('Play').props.onClick(); await app.settle(); app.element.paused = false; await app.playing();
  assert.equal(app.overlay(), null); assert.equal(app.presence.active, true);
});

test('an unsigned public grant renews without rebuilding, while a native engine takes the renewed URL', async () => {
  const open = harness({ tokens: false }); await open.open(); await open.metadata(); await open.playing();
  await open.fire(open.timer(60000, 95000)); assert.equal(open.engines.length, 1); assert.equal(open.presence.active, true);
  const native = harness({ mse: false }); await native.open(); await native.metadata(); await native.playing();
  assert.equal(native.element.dataset.livePlaybackEngine, 'native'); assert.match(native.element.src, /cap-1/);
  await native.fire(native.timer(60000, 95000)); assert.match(native.element.src, /cap-2/, 'Safari reloads from the renewed URL');
  assert.equal(native.presence.active, true, 'The reload is the renewal, not the viewer leaving');
  native.element.paused = true; await native.metadata(); await native.playing();
  assert.equal(native.presence.active, true);
  await native.pause(); assert.equal(native.presence.active, false);
});

test('pausing a native stream at time zero survives token renewal and late metadata',async()=>{
  const app=harness({mse:false});await app.open();assert.equal(app.hasDomAutoplay(),false);
  await app.metadata();await app.playing();await app.pause();const plays=app.element.playCalls;
  assert.equal(app.element.currentTime,0);await app.fire(app.timer(60000,95000));await app.metadata();
  assert.match(app.element.src,/cap-2/);assert.equal(app.element.playCalls,plays);assert.equal(app.element.paused,true);assert.equal(app.presence.active,false);
});
test('pausing, hiding or closing before native startup retry or metadata cannot start playback',async()=>{
  for(const action of ['pause','hide','close']){
    const app=harness({mse:false});await app.open();await app.nativeError();
    const retry=app.timer(1000,1600),late=app.savedMetadata();assert.ok(retry);
    if(action==='pause')await app.pause();else if(action==='hide')await app.hidden(true);else await app.close();
    await app.fire(retry);late();await app.settle();
    assert.equal(app.element.playCalls,0,action);assert.equal(app.presence.active,false,action);
  }
});
test('metadata delivered after grant expiry cannot start a stale stream',async()=>{
  const app=harness();await app.open();app.advance(121000);await app.metadata();
  assert.equal(app.element.playCalls,0);assert.equal(app.presence.active,false);
});

test('only the one programmatic native swap pause is ignored; a later control pause wins before metadata',async()=>{
  const app=harness({mse:false});await app.open();await app.metadata();await app.playing();
  await app.fire(app.timer(60000,95000));await app.pause();assert.equal(app.presence.active,true);
  await app.manualPlay();await app.pause();assert.equal(app.presence.active,false);
  const starts=app.element.playCalls;await app.metadata();assert.equal(app.element.playCalls,starts);
  assert.equal(app.element.paused,true);
});
