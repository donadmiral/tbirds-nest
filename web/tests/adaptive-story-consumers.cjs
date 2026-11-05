const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '../..');
const source = 'https://fixture.supabase.co/functions/v1/media-content/story-media/author/video.mp4?token=' + 'a'.repeat(64);
const hls = 'https://media.fixture.test/playback/story-media/author/video.mp4/master.m3u8?token=' + 'a'.repeat(64);
const tick = () => new Promise(resolve => setImmediate(resolve));
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: name => { if (name in imports) return imports[name]; throw Error(name); },
    process: { env: { NEXT_PUBLIC_ADAPTIVE_MEDIA: 'true' } }, URL, Map, Set, AbortController, Promise, setTimeout, clearTimeout, fetch: async () => { throw Error('Unexpected network request'); }, ...globals });
  return exports;
}
function events() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, fn, options) { const values = listeners.get(name) || new Map(); values.set(fn, options); listeners.set(name, values); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name) { for (const [fn, options] of [...listeners.get(name) || []]) { if (options?.once) listeners.get(name).delete(fn); fn(); } },
  };
}
function consumer(file, name) {
  let cursor = 0, pending = [], node, tree;
  const slots = [], document = { ...events(), hidden: false, documentElement: { dataset: {} } };
  const video = { ...events(), src: '', currentSrc: '', paused: true, currentTime: 0, duration: 30, videoWidth: 720, videoHeight: 1280, loads: [],
    canPlayType: () => true, getAttribute(key) { return this[key]; }, removeAttribute(key) { this[key] = ''; },
    load() { this.loads.push(this.src); this.currentTime = 0; this.currentSrc = this.src; this.paused = true; },
    play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; },
  };
  const hooks = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; slots[i] ??= { value }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useMemo(fn) { cursor++; return fn(); },
    useEffect(fn, deps) { const i = cursor++; const previous = slots[i]; if (!previous || deps.some((item, n) => item !== previous.deps[n])) { const next = { deps }; slots[i] = next; pending.push(() => { previous?.cleanup?.(); next.cleanup = fn(); }); } },
  };
  const media = load('shared/adaptiveMedia.ts');
  media.acceptAdaptiveMedia([{ source, hlsUrl: hls, sourceVersion: 'v1', expiresAt: Date.now() + 120000 }]);
  const adaptive = load('web/lib/adaptiveVideo.ts', { '../../shared/adaptiveMedia': media });
  const component = load(file, {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '@/lib/adaptiveVideo': adaptive,
    'lucide-react': { ArrowUpRight: 'arrow', Layers: 'layers', Volume2: 'volume', VolumeX: 'muted' },
    '../../shared/postVoiceEffects': load('shared/postVoiceEffects.ts'),
    '../../shared/postMediaEditing': load('shared/postMediaEditing.ts'),
    '../../shared/storyPresentation': load('shared/storyPresentation.ts'),
    './StoryPixelGrade': { StoryPixelGrade: 'grade' },
  }, { document, ResizeObserver: class { observe() {} disconnect() {} } })[name];
  const walk = value => { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) return value.forEach(walk); if (value.type === 'video') { node = value; node.props.ref.current = video; } walk(value.props?.children); };
  return {
    video, document, media,
    render(props) { cursor = 0; tree = component(props); walk(tree); const effects = pending; pending = []; effects.forEach(fn => fn()); return node; },
    emit(event) { if (event === 'loadedmetadata') node.props.onLoadedMetadata?.({ currentTarget: video }); video.emit(event); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const sticker = { postId: 'post', postMediaUrl: source, postMediaType: 'video', postMediaWidth: 720, postMediaHeight: 1280, nx: .5, ny: .5, postMediaPlayback: { trimStart: 2, trimEnd: 25 } };

test('shared-post video selects prepared HLS, keeps its source on pause and resumes the original at the trim position after error', async () => {
  const h = consumer('web/components/SharedPostStory.tsx', 'SharedPostStory');
  const node = h.render({ sticker, paused: false });
  assert.equal(node.props.src, undefined, 'JSX cannot start an original request before adaptive selection');
  assert.equal(h.video.src, hls); assert.equal(h.video.loads.length, 1);
  h.emit('loadedmetadata'); assert.equal(h.video.currentTime, 2);
  h.video.currentTime = 12;
  h.render({ sticker, paused: true }); assert.equal(h.video.loads.length, 1); assert.equal(h.video.paused, true);
  h.render({ sticker, paused: false }); h.emit('error'); assert.equal(h.video.src, source);
  h.emit('loadedmetadata'); await tick(); assert.equal(h.video.currentTime, 12); assert.equal(h.video.paused, false);
  h.unmount(); assert.equal(h.video.src, ''); assert.equal(h.video.paused, true);
});

test('shared-post source changes release the old player and hidden or paused stories cannot restart on canplay', () => {
  const h = consumer('web/components/SharedPostStory.tsx', 'SharedPostStory');
  h.render({ sticker, paused: false }); h.document.hidden = true; h.emit('canplay'); assert.equal(h.video.paused, true);
  h.document.hidden = false; h.render({ sticker, paused: true }); h.emit('canplay'); assert.equal(h.video.paused, true);
  const next = { ...sticker, postMediaUrl: 'blob:local-preview' }; h.render({ sticker: next, paused: false });
  assert.equal(h.video.src, next.postMediaUrl); assert.deepEqual(h.video.loads, [hls, '', next.postMediaUrl]);
  h.unmount(); assert.equal(h.video.listeners.get('canplay').size, 0); assert.equal(h.video.listeners.get('error').size, 0);
});

test('archive playback retains controls, never preloads the original over prepared HLS and preserves a user pause on fallback', async () => {
  const h = consumer('web/components/ArchivedStoryVideo.tsx', 'ArchivedStoryVideo');
  const node = h.render({ source }); assert.equal(node.props.controls, true); assert.equal(node.props.autoPlay, true); assert.equal(node.props.src, undefined);
  assert.equal(h.video.src, hls); h.video.currentTime = 9; h.video.paused = true;
  h.emit('error'); h.emit('loadedmetadata'); await tick(); assert.equal(h.video.currentTime, 9); assert.equal(h.video.paused, true);
  h.video.paused = false; h.document.hidden = true; h.document.emit('visibilitychange'); assert.equal(h.video.paused, true);
  h.unmount(); assert.equal(h.video.src, ''); assert.equal(h.document.listeners.get('visibilitychange').size, 0);
});
