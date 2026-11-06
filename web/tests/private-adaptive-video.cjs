const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const origin = 'https://private.fixture.test';
const endpoint = origin + '/functions/v1/private-hls';
const uri = asset => endpoint + '?' + new URLSearchParams({ messageId: id(1), requestId: id(2), sourceVersion: 'version_1', leaseId: id(3), asset });
const env = { NEXT_PUBLIC_PRIVATE_HLS: 'true', NEXT_PUBLIC_SUPABASE_URL: origin, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'api-key' };
function load(file, deps = {}, globals = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => { if (name in deps) return deps[name]; throw Error(name); }, URL, URLSearchParams, Request, Response, Headers, AbortController, Date, Promise, setTimeout, clearTimeout, process: { env }, ...globals });
  return module.exports;
}
function events() { const listeners = new Map(); return { addEventListener(name, fn) { const set = listeners.get(name) || new Set(); set.add(fn); listeners.set(name, set); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); }, emit(name, event) { for (const fn of [...(listeners.get(name) || [])]) fn(event); } }; }
function video() { return { ...events(), src: '', paused: true, currentTime: 0, duration: 30, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; }, removeAttribute(key) { this[key] = ''; }, load() {} }; }
function utility(options = {}) {
  const requests = [], players = []; let active = true;
  class FakeHls {
    static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest' };
    static isSupported() { return options.supported !== false; }
    constructor(config) { this.config = config; this.events = {}; players.push(this); }
    on(name, fn) { this.events[name] = fn; }
    loadSource(source) { this.source = source; }
    attachMedia(media) { this.media = media; media.src = 'blob:mse-only'; }
    destroy() { this.destroyed = true; }
    emit(name, data) { this.events[name]?.(name, data); }
  }
  class FakeFetchLoader {}
  const fetch = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    if (JSON.parse(init.body).action === 'close') return new Response('{}');
    return new Response(JSON.stringify({ ready: options.ready !== false, hlsUrl: uri('master.m3u8'), sourceVersion: 'version_1', expiresAt: new Date(Date.now() + (options.expiresIn ?? 60000)).toISOString() }));
  };
  const shared = load('shared/privateAdaptiveMedia.ts', {}, { fetch });
  const api = load('web/lib/privateAdaptiveVideo.ts', { '../../shared/privateAdaptiveMedia': shared, 'hls.js': { __esModule: true, default: FakeHls, FetchLoader: FakeFetchLoader } }, { process: { env: { ...env, ...(options.env || {}) } } });
  return { requests, players, FakeFetchLoader, inactive() { active = false; }, open: () => api.openPrivateAdaptiveVideo({ token: 'synthetic-bearer', messageId: id(1), requestId: id(2), current: () => active }) };
}

test('private HLS is default-off and never requests grants without MSE', async () => {
  for (const options of [{ env: { NEXT_PUBLIC_PRIVATE_HLS: undefined } }, { supported: false }]) {
    const scenario = utility(options); assert.equal(await scenario.open(), null); assert.equal(scenario.requests.length, 0);
  }
});
test('every private HLS child request validates exact grant and keeps bearer out of URLs', async () => {
  const scenario = utility(), prepared = await scenario.open(), element = video();
  prepared.attach(element, { onFallback() { assert.fail('unexpected fallback'); }, onExpired() {} });
  const player = scenario.players[0]; assert.equal(player.config.loader, scenario.FakeFetchLoader);
  assert.equal(player.source, uri('master.m3u8')); assert.equal(element.src, 'blob:mse-only');
  for (const asset of ['master.m3u8', 'r0/index.m3u8', 'r0/seg00001.ts']) {
    const abort = new AbortController();
    const request = await player.config.fetchSetup({ url: uri(asset) }, { headers: new Headers({ Range: 'bytes=0-199' }), signal: abort.signal });
    assert.equal(request.headers.get('Authorization'), 'Bearer synthetic-bearer');
    assert.equal(request.headers.get('Range'), 'bytes=0-199');
    assert.equal(request.cache, 'no-store'); assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error'); assert.equal(request.referrerPolicy, 'no-referrer');
    assert.equal(request.url.includes('synthetic-bearer'), false); abort.abort(); assert.equal(request.signal.aborted, true);
  }
  for (const bad of [uri('r0/seg00001.ts').replace(origin, 'https://attacker.test'), uri('r0/seg00001.ts').replace('version_1', 'version_2'), uri('secret.mp4'), uri('master.m3u8') + '&token=forged']) await assert.rejects(player.config.fetchSetup({ url: bad }, {}));
  prepared.close(); assert.equal(player.destroyed, true); assert.equal(element.src, ''); assert.equal(element.paused, true);
  await assert.rejects(player.config.fetchSetup({ url: uri('master.m3u8') }, {}));
  assert.equal(scenario.requests.filter(r => r.body.action === 'close').length, 1);
});
test('React effect replay on the same element keeps one decoder and one live grant', async () => {
  const scenario = utility(), prepared = await scenario.open(), element = video();
  const callbacks = { onFallback() {}, onExpired() {} };
  prepared.attach(element, callbacks); prepared.attach(element, callbacks);
  assert.equal(scenario.players.length, 1); assert.equal(scenario.players[0].destroyed, undefined);
  assert.equal(scenario.requests.filter(row => row.body.action === 'close').length, 0);
  prepared.close(); assert.equal(scenario.players[0].destroyed, true);
});
test('HLS failure preserves paused position for original fallback and refuses authorization-loss fallback', async () => {
  for (const code of [500, 403]) {
    const scenario = utility(), prepared = await scenario.open(), element = video(); let fallback, expired = 0;
    prepared.attach(element, { onFallback: value => { fallback = value; }, onExpired: () => expired++ });
    element.currentTime = 7; element.paused = true;
    scenario.players[0].emit('error', { fatal: true, response: { code } });
    assert.equal(element.src, ''); assert.equal(scenario.players[0].destroyed, true);
    if (code === 500) { assert.equal(fallback.time, 7); assert.equal(fallback.playing, false); assert.equal(expired, 0); }
    else { assert.equal(fallback, undefined); assert.equal(expired, 1); }
    scenario.players[0].emit('error', { fatal: true, response: { code } });
    assert.equal(scenario.requests.filter(r => r.body.action === 'close').length, 1);
  }
});
test('expiry clears buffered playback and closes the transport', async () => {
  const scenario = utility({ expiresIn: 25 }), prepared = await scenario.open(), element = video(); let expired = 0;
  prepared.attach(element, { onFallback() { assert.fail('expiry is terminal'); }, onExpired() { expired++; } });
  await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(expired, 1); assert.equal(element.src, ''); assert.equal(scenario.players[0].destroyed, true);
});

test('expiry before React attachment cannot leave a closed transport on screen', async () => {
  const scenario = utility({ expiresIn: 15 }), prepared = await scenario.open(); let expired = 0;
  await new Promise(resolve => setTimeout(resolve, 35));
  prepared.attach(video(), { onFallback() { assert.fail('expired transport must not fallback'); }, onExpired() { expired++; } });
  assert.equal(expired, 1); assert.equal(scenario.players.length, 0);
});
test('the installed hls.js FetchLoader carries validated headers and aborts an in-flight segment on destroy', async () => {
  const { pathToFileURL } = require('node:url');
  const { FetchLoader } = await import(pathToFileURL(path.join(root, 'web/node_modules/hls.js/dist/hls.mjs')).href);
  const scenario = utility(), prepared = await scenario.open(); prepared.attach(video(), { onFallback() {}, onExpired() {} });
  const previous = global.self; let request;
  global.self = { AbortController, ReadableStream, Request, Headers, performance, setTimeout, clearTimeout,
    fetch: value => { request = value; return new Promise((_resolve, reject) => value.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))); } };
  // The transpiled module runs in a VM. Bridge only its Promise realm because
  // hls.js tests then instanceof Function; browsers run both in one realm.
  const config = scenario.players[0].config;
  const loader = new FetchLoader({ ...config, fetchSetup: async (...args) => await config.fetchSetup(...args) });
  try {
    loader.load({ url: uri('r0/seg00001.ts'), responseType: 'arraybuffer', type: 'media-fragment' },
      { loadPolicy: { ...scenario.players[0].config.fragLoadPolicy.default, timeoutRetry: null, errorRetry: null }, timeout: 1000, maxRetry: 0, retryDelay: 0, maxRetryDelay: 0 },
      { onSuccess() { assert.fail('pending segment must not finish'); }, onError() {}, onTimeout() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(request.headers.get('Authorization'), 'Bearer synthetic-bearer'); assert.equal(request.cache, 'no-store');
    loader.destroy(); assert.equal(request.signal.aborted, true);
    await new Promise(resolve => setImmediate(resolve));
  } finally { loader.destroy(); prepared.close(); global.self = previous; }
});

const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
function treeNodes(node, output = []) { if (Array.isArray(node)) node.forEach(n => treeNodes(n, output)); else if (node && typeof node === 'object') { output.push(node); treeNodes(node.props?.children, output); } return output; }
function text(node) { return typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : text(node?.props?.children || ''); }
function renderer(Component, props, globals) {
  let cursor = 0, dirty = true, tree, effects = []; const slots = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; dirty = true; }]; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, fn }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) { const prev = slots[i]; const value = slots[i] = { deps }; effects.push(() => { prev?.cleanup?.(); value.cleanup = fn(); }); } },
  }; hooks.useLayoutEffect = hooks.useEffect;
  const api = { hooks, get tree() { return tree; }, nodes() { return treeNodes(tree); }, async flush() { for (let i = 0; i < 20; i++) { if (dirty) { dirty = false; cursor = 0; tree = Component(props); for (const node of treeNodes(tree)) if (node.props?.ref) node.props.ref.current = node.type === 'video' ? globals.video : globals.root; const pending = effects; effects = []; pending.forEach(effect => effect()); } await new Promise(resolve => setImmediate(resolve)); } }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
  return api;
}
function componentScenario({ limited = true, delayed = false, protocol = 'legacy' } = {}) {
  const order = [], originalRequests = [], doc = { ...events(), visibilityState: 'visible', body: { style: {} }, activeElement: null }, win = events(), element = video();
  const dom = { focus() {}, querySelector: () => ({ hidden: false, querySelector: () => element }), querySelectorAll: () => [] };
  let app, auth, adaptiveOptions, resolveAdaptive;
  const player = { closed: 0, close() { this.closed++; }, attach() {} };
  const deps = { 'react/jsx-runtime': jsx, react: new Proxy({}, { get: (_, key) => app.hooks[key] }), 'next/image': { __esModule: true, default: 'img' }, './PrivateCameraGuard': { PrivateCameraGuard: 'PrivateCameraGuard' },
    '@/lib/supabase/client': { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: id(8) }, access_token: 'bearer' } }, error: null }), onAuthStateChange(fn) { auth = fn; return { data: { subscription: { unsubscribe() {} } } }; } } }) },
    '../../shared/privateMedia': { createPrivateViewSession: viewSession('private') },
    '../../shared/legacyLimitedMedia': { createLegacyLimitedViewSession: viewSession('legacy') },
    '@/lib/privateAdaptiveVideo': { async openPrivateAdaptiveVideo(options) { adaptiveOptions = options; order.push({ kind: 'hls-open', requestId: options.requestId }); if (delayed) return new Promise(resolve => { resolveAdaptive = resolve; }); return player; } },
  };
  function viewSession(selected) { return options => { order.push({ kind: 'view-constructed', requestId: options.requestId, protocol: selected, endpoint: options.endpoint }); return { headers: { Authorization: 'Bearer bearer' }, mediaUrl: 'https://private.fixture.test/original', async open() { order.push({ kind: 'view-open', requestId: options.requestId }); return { requestId: options.requestId, mediaType: 'video', expiresAt: new Date(Date.now() + 60000).toISOString(), remaining: 0, watermark: 'private' }; }, async close() { order.push({ kind: 'view-close' }); options.hide(); } }; }; }
  const globals = { process: { env: { ...env, NEXT_PUBLIC_PRIVATE_MEDIA_SESSIONS_ENABLED: protocol === 'private' ? 'true' : 'false' } }, document: doc, window: win, crypto: { randomUUID: () => id(2) }, fetch: async (url, init) => { originalRequests.push({ url, init }); return { ok: true, blob: async () => new Blob(['original']) }; }, Blob, URL: class extends URL { static createObjectURL() { return 'blob:original'; } static revokeObjectURL() {} } };
  const file = limited ? 'web/components/PrivateMediaViewer.tsx' : 'web/components/ChatVideo.tsx';
  const module = load(file, deps, globals);
  const props = limited ? { messageId: id(1), userId: id(8), onClose() {} } : { messageId: id(1), userId: id(8), source: 'https://private.fixture.test/original', onError() {} };
  const component = (limited ? module.PrivateMediaViewer(props) : module.ChatVideo(props)).type;
  app = renderer(component, props, { video: element, root: dom });
  return { app, order, player, originalRequests, doc, win, element, get options() { return adaptiveOptions; }, resolve() { resolveAdaptive(player); }, changeUser() { auth('SIGNED_OUT', null); } };
}
test('limited viewer consumes once before HLS and reuses that grant for exact original fallback', async () => {
  const s = componentScenario(); await s.app.flush();
  s.app.nodes().find(n => n.type === 'button' && text(n) === 'Open attachment').props.onClick(); await s.app.flush();
  assert.deepEqual(s.order.map(row => row.kind), ['view-constructed', 'view-open', 'hls-open']);
  assert.equal(s.order[0].protocol, 'legacy');
  assert.equal(s.order[0].endpoint, origin + '/functions/v1/chat-media-sign');
  assert.equal(s.order[1].requestId, s.order[2].requestId); assert.equal(s.originalRequests.length, 0);
  const viewer = s.app.nodes().find(n => typeof n.type === 'function' && n.type.name === 'PrivateVideo');
  viewer.props.onFallback({ time: 6, playing: false }); await s.app.flush();
  assert.equal(s.originalRequests.length, 1); assert.equal(s.originalRequests[0].init.cache, 'no-store'); assert.equal(s.originalRequests[0].init.headers.Authorization, 'Bearer bearer');
  const fallback = s.app.nodes().find(n => typeof n.type === 'function' && n.type.name === 'PrivateVideo');
  assert.equal(fallback.props.url, 'blob:original'); assert.equal(fallback.props.resume.time, 6); assert.equal(fallback.props.resume.playing, false);
  assert.equal(s.order.filter(row => row.kind === 'view-open').length, 1); s.app.unmount();
});
test('the new private protocol is selected only by its explicit backend flag', async () => {
  const s = componentScenario({ protocol: 'private' }); await s.app.flush();
  s.app.nodes().find(n => n.type === 'button' && text(n) === 'Open attachment').props.onClick(); await s.app.flush();
  assert.equal(s.order[0].protocol, 'private');
  assert.equal(s.order[0].endpoint, origin + '/functions/v1/private-media-session');
  assert.equal(s.order.filter(row => row.kind === 'view-open').length, 1);
  s.app.unmount();
});
test('late HLS grant cannot reopen a closed limited viewer', async () => {
  const s = componentScenario({ delayed: true }); await s.app.flush();
  s.app.nodes().find(n => n.type === 'button' && text(n) === 'Open attachment').props.onClick(); await s.app.flush();
  s.app.nodes().find(n => n.type === 'button' && text(n) === 'Close').props.onClick(); s.resolve(); await s.app.flush();
  assert.equal(s.options.current(), false); assert.ok(s.player.closed >= 1); assert.equal(s.originalRequests.length, 0); assert.ok(text(s.app.tree).includes('View closed')); s.app.unmount();
});
test('ordinary chat performs no HLS work before play and closes on background or account change', async () => {
  for (const event of ['background', 'account']) {
    const s = componentScenario({ limited: false }); await s.app.flush(); assert.equal(s.order.length, 0);
    assert.equal(s.app.nodes().find(n => n.type === 'video').props.src, undefined);
    s.app.nodes().find(n => n.type === 'button').props.onClick(); await s.app.flush(); assert.equal(s.order[0].kind, 'hls-open');
    if (event === 'background') { s.doc.visibilityState = 'hidden'; s.doc.emit('visibilitychange'); } else s.changeUser();
    await s.app.flush(); assert.equal(s.options.current(), false); assert.ok(s.player.closed >= 1); assert.equal(s.element.src, ''); s.app.unmount();
  }
});
