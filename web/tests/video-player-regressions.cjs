const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = process.env.VIDEO_SOURCE_ROOT || path.join(__dirname, '..');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const playerCode = compile('components/VideoPlayer.tsx');
const galleryCode = compile('components/MediaGallery.tsx');
const helperCode = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/videoPlayback.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const helperModule = { exports: {} };
vm.runInNewContext(helperCode, { module: helperModule, exports: helperModule.exports });
const helper = helperModule.exports;
const allNodes = tree => {
  const found = [];
  const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return;
    found.push(node); walk(node.props?.children); };
  walk(tree); return found;
};
const nodeText = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(nodeText).join('') : nodeText(node?.props?.children ?? '');
const flush = async screen => { await new Promise(resolve => setImmediate(resolve)); screen.render(); };
const event = (key, selector = '') => ({ key, defaultPrevented: false, target: { closest: q => selector && q.includes(selector) ? {} : null },
  preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } });

function scenario({ prefs = {}, saver = false, autoplay = true, pip = false, duration = 100 } = {}) {
  let currentHooks, ioCallback;
  const listeners = new Map();
  const add = (type, callback) => { const set = listeners.get(type) || new Set(); set.add(callback); listeners.set(type, set); };
  const remove = (type, callback) => listeners.get(type)?.delete(callback);
  const document = { hidden: false, pictureInPictureEnabled: pip, pictureInPictureElement: null, fullscreenElement: null,
    addEventListener: add, removeEventListener: remove, body: { style: {} }, documentElement: { clientWidth: 1200 }, activeElement: { focus() {} },
    exitPictureInPicture: async () => { document.pictureInPictureElement = null; }, exitFullscreen: async () => { document.fullscreenElement = null; } };
  document.body.focus = () => { document.activeElement = document.body; };
  const storage = new Map([['pc:video-prefs', JSON.stringify(prefs)]]);
  const window = { document, innerWidth: 1200, innerHeight: 900, matchMedia: () => ({ matches: false }), addEventListener: add, removeEventListener: remove,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
  const client = { auth: { getSession: async () => ({ data: { session: null } }) }, from: () => ({ select() { return this; }, in() { return this; }, then: fn => Promise.resolve(fn({ data: [] })) }) };
  const runtime = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }), Fragment: 'Fragment' };
  const requireModule = name => {
    if (name === 'react') return new Proxy({}, { get: (_, key) => (...args) => currentHooks[key](...args) });
    if (name === 'react/jsx-runtime') return runtime;
    if (name === '@/lib/videoPlayback') return helper;
    if (name === '@/lib/mediaPrefs') return { dataSaverEnabled: () => saver, autoplayEnabled: () => autoplay };
    if (name === '@/lib/usePostInteractions') return { usePostInteractions: (_id, seed) => ({ ...seed, pending: false, error: null, uncertain: false }) };
    if (name === '@/lib/supabase/client') return { createClient: () => client };
    if (name === '@/components/VideoPlayer') return { VideoPlayer: 'NestedVideoPlayer' };
    if (name === '@/lib/media') return { displayImageUrl: value => value, srcSetFor: () => ({}) };
    return new Proxy({}, { get: (_, key) => key === 'getTierColor' ? () => null : String(key) });
  };
  function moduleFor(code) {
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, require: requireModule, window, document, crypto: { randomUUID: () => 'test-session' },
      IntersectionObserver: class { constructor(callback) { ioCallback = callback; } observe() {} disconnect() {} },
      ResizeObserver: class { observe() {} disconnect() {} }, setTimeout, clearTimeout });
    return module.exports;
  }
  const module = moduleFor(playerCode), gallery = moduleFor(galleryCode);
  function mount(extra = {}, kind = 'player') {
    let slots = [], cursor = 0, effects = [], tree, props = { src: 'synthetic.mp4', postId: 'test-post', ...extra };
    const element = { duration, currentTime: 0, videoWidth: 1920, videoHeight: 1080, paused: true, ended: false, muted: true, playbackRate: 1,
      playCalls: 0, pauseCalls: 0, loadCalls: 0, pipCalls: 0, playResult: null,
      play() { this.playCalls++; this.paused = false; return this.playResult || Promise.resolve(); },
      pause() { this.pauseCalls++; this.paused = true; }, load() { this.loadCalls++; },
      requestPictureInPicture() { this.pipCalls++; document.pictureInPictureElement = this; return Promise.resolve(); },
      addEventListener: add, removeEventListener: remove };
    const focusNode = () => ({ isConnected: true, tabIndex: 0, hasAttribute: () => false, getClientRects: () => [{}],
      focusCalls: 0, focus(options) { this.focusCalls++; this.focusOptions = options; document.activeElement = this; } });
    const disconnect = node => { node.isConnected = false; if (document.activeElement === node) document.activeElement = document.body; };
    let inlineOpener = null;
    const navigation = new Map();
    const modal = { ...focusNode(), contains: target => target === modal || target === closeButton || [...navigation.values()].includes(target),
      querySelectorAll: () => [closeButton, ...navigation.values()] };
    const closeButton = focusNode();
    const wrapper = { ...focusNode(), contains: target => target === inlineOpener || modal.contains(target),
      getBoundingClientRect: () => ({ width: 600 }), querySelectorAll: () => [], querySelector: () => inlineOpener,
      requestFullscreen: async () => { document.fullscreenElement = wrapper; } };
    const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
    const hooks = {
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
        return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn, deps }; return slots[i].value; },
      useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) {
        const previous = slots[i]; slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
    };
    const screen = { element, wrapper, modal, closeButton, navigation, get inlineOpener() { return inlineOpener; },
      render() {
        currentHooks = hooks; cursor = 0;
        if (kind === 'gallery') tree = gallery.MediaGallery(props);
        else { const outer = module.VideoPlayer(props); tree = typeof outer.type === 'function' ? outer.type(outer.props) : outer; }
        const nodes = allNodes(tree);
        if (kind === 'gallery') {
          const hasInline = nodes.some(node => (node.type === 'NestedVideoPlayer' && !node.props.immersive) || (node.type === 'img' && node.props.role === 'button'));
          if (!hasInline && inlineOpener) {
            disconnect(inlineOpener);
            inlineOpener = null;
          } else if (hasInline && !inlineOpener) inlineOpener = focusNode();
          const dialog = nodes.find(node => node.props?.role === 'dialog');
          const dialogNodes = allNodes(dialog);
          for (const label of ['Previous media', 'Next media']) {
            if (dialogNodes.some(node => node.props?.['aria-label'] === label)) {
              if (!navigation.has(label)) navigation.set(label, focusNode());
            } else if (navigation.has(label)) { disconnect(navigation.get(label)); navigation.delete(label); }
          }
          modal.isConnected = !!dialog;
          closeButton.isConnected = modal.isConnected;
        }
        for (const node of nodes) if (node.props?.ref) node.props.ref.current = node.type === 'video' ? element
          : node.props.role === 'dialog' ? modal : node.props['aria-label'] === 'Close viewer' ? closeButton : wrapper;
        const video = allNodes(tree).find(node => node.type === 'video'); if (video?.props.muted !== undefined) element.muted = video.props.muted;
        const pending = effects; effects = []; pending.forEach(fn => fn());
      },
      find(predicate) { return allNodes(tree).find(predicate); },
      label(label) { return this.find(node => node.props?.['aria-label'] === label); },
      click(label) { const node = this.label(label) || this.find(n => n.type === 'button' && nodeText(n) === label); assert.ok(node, 'Missing control: ' + label); const result = node.props.onClick({ stopPropagation() {} }); this.render(); return result; },
      videoEvent(name) { this.find(node => node.type === 'video').props[name]?.(); this.render(); },
      key(value, selector = '') { const e = event(value, selector); this.find(node => node.props?.onKeyDown).props.onKeyDown(e); this.render(); return e; },
      unmount() {
        for (const node of [wrapper, modal, closeButton, inlineOpener, ...navigation.values()]) if (node) disconnect(node);
        slots.forEach(slot => slot?.cleanup?.());
      },
      update(value) { props = { ...props, ...value }; this.render(); },
      get text() { return nodeText(tree); },
    };
    screen.render(); return screen;
  }
  return { mount, document, storage,
    visibility(value) { document.hidden = value; [...(listeners.get('visibilitychange') || [])].forEach(fn => fn()); },
    intersect(ratio) { ioCallback?.([{ intersectionRatio: ratio }]); },
    dispatch(e) { [...(listeners.get('keydown') || [])].forEach(fn => fn(e)); },
  };
}

test('expanded videos show the complete frame before the user opts into crop', () => {
  const screen = scenario().mount({ immersive: true });
  assert.match(screen.find(n => n.type === 'video').props.className, /object-contain/);
  screen.click('Fill the screen');
  assert.match(screen.find(n => n.type === 'video').props.className, /object-cover/);
  screen.click('Show the whole frame');
  assert.match(screen.find(n => n.type === 'video').props.className, /object-contain/);
});
test('remembered valid playback speed is applied to the actual media element', () => {
  const screen = scenario({ prefs: { speed: 1.75 } }).mount(); screen.videoEvent('onLoadedMetadata');
  assert.equal(screen.element.playbackRate, 1.75);
  screen.key('<'); assert.equal(screen.element.playbackRate, 1.5);
});
test('malformed playback preferences fall back to muted, normal speed', () => {
  const screen = scenario({ prefs: { speed: -3, muted: 'false' } }).mount(); screen.videoEvent('onLoadedMetadata');
  assert.equal(screen.element.playbackRate, 1); assert.equal(screen.element.muted, true);
});
test('timeline is keyboard accessible and uses the edited clip duration', () => {
  const screen = scenario().mount({ edit: { trimStart: 20, trimEnd: 50 } }); screen.videoEvent('onLoadedMetadata');
  const slider = screen.label('Video position'); assert.equal(slider.type, 'input'); assert.equal(slider.props.type, 'range'); assert.equal(slider.props.max, 30);
  slider.props.onChange({ target: { value: '12' } }); screen.render();
  assert.equal(screen.element.currentTime, 32); assert.equal(screen.label('Video position').props['aria-valuetext'], '0:12 of 0:30');
  screen.key('0'); assert.equal(screen.element.currentTime, 20);
  screen.key('9'); assert.equal(screen.element.currentTime, 47);
  screen.click('Forward 10 seconds'); assert.equal(screen.element.currentTime, 50);
  screen.key('Home'); screen.click('Back 10 seconds'); assert.equal(screen.element.currentTime, 20);
});
test('media shortcuts do not steal input, select, button activation, or browser shortcuts', () => {
  const screen = scenario().mount(); screen.videoEvent('onLoadedMetadata');
  for (const selector of ['input', 'select', 'textarea', "[contenteditable='true']"]) {
    assert.equal(screen.key('ArrowRight', selector).defaultPrevented, false);
  }
  assert.equal(screen.key(' ', 'button').defaultPrevented, false);
  assert.equal(screen.element.currentTime, 0);
  const e = screen.key('ArrowRight'); assert.equal(e.defaultPrevented, true); assert.equal(e.stopped, true); assert.equal(screen.element.currentTime, 5);
  screen.key('l'); assert.equal(screen.element.currentTime, 15);
});
test('theater is a reachable viewing action and has a keyboard shortcut', () => {
  let opened = 0; const screen = scenario().mount({ onExpand: () => opened++ });
  screen.click('Open theater view'); screen.key('t'); assert.equal(opened, 2);
});
test('data saver disables preloading and feed autoplay but allows explicit playback', () => {
  const s = scenario({ saver: true }), screen = s.mount();
  assert.equal(screen.find(n => n.type === 'video').props.preload, 'none');
  s.intersect(1); assert.equal(screen.element.playCalls, 0);
  screen.click('Play video'); assert.equal(screen.element.playCalls, 1);
});
test('autoplay off leaves feed paused', () => {
  const s = scenario({ autoplay: false }), screen = s.mount(); s.intersect(1); assert.equal(screen.element.playCalls, 0);
});
test('unrevealed sensitive videos do not preload or play even through a direct handler', () => {
  const screen = scenario().mount({ allowPlayback: false, immersive: true });
  assert.equal(screen.find(n => n.type === 'video').props.preload, 'none'); assert.equal(screen.element.playCalls, 0);
  screen.key('k'); assert.equal(screen.element.playCalls, 0);
});
test('PiP control only appears after usable metadata and supported browser capability', () => {
  const no = scenario().mount(); no.videoEvent('onLoadedMetadata'); assert.equal(no.label('Picture in picture'), undefined);
  const s = scenario({ pip: true }), screen = s.mount(); assert.equal(screen.label('Picture in picture'), undefined);
  screen.videoEvent('onLoadedMetadata'); assert.ok(screen.label('Picture in picture'));
});
test('PiP remains playing when page is hidden or the original player scrolls away', async () => {
  const s = scenario({ pip: true }), screen = s.mount(); screen.videoEvent('onLoadedMetadata'); screen.click('Play video');
  await screen.click('Picture in picture'); screen.element.pauseCalls = 0;
  s.intersect(0); s.visibility(true); assert.equal(screen.element.pauseCalls, 0);
});
test('ordinary offscreen video pauses and late play events cannot restart it', () => {
  const s = scenario(), screen = s.mount(); screen.click('Play video'); s.visibility(true);
  assert.equal(screen.element.paused, true); screen.element.paused = false; screen.videoEvent('onPlay'); assert.equal(screen.element.paused, true);
});
test('play rejection and load errors display truthful recovery actions', async () => {
  const screen = scenario().mount(); screen.element.playResult = Promise.reject(new Error('blocked'));
  screen.element.playResult.catch(() => {}); // Baseline may fail before reaching the play handler.
  screen.click('Play video'); await flush(screen); assert.match(screen.text, /Playback could not start/);
  screen.element.playResult = null; screen.videoEvent('onError');
  assert.match(screen.text, /could not load/); assert.doesNotMatch(screen.text, /still being prepared|plays in the Platinum/);
  screen.click('Retry video'); assert.equal(screen.element.loadCalls, 1);
});
test('creator-muted video cannot be unmuted with a keyboard shortcut', () => {
  const screen = scenario({ prefs: { muted: false } }).mount({ edit: { muted: true } });
  screen.key('m'); assert.equal(screen.element.muted, true); assert.equal(screen.label('Unmute video'), undefined);
});
test('gallery exposes the video theater action and keeps trim recipe in expanded playback', () => {
  const media = [{ id: 'one', url: 'one.mp4', media_type: 'video', edit: { trimStart: 10, trimEnd: 40, muted: true } }];
  const screen = scenario().mount({ media }, 'gallery');
  screen.find(n => n.type === 'NestedVideoPlayer').props.onExpand(); screen.render();
  const expanded = screen.find(n => n.type === 'NestedVideoPlayer' && n.props.immersive);
  assert.ok(expanded); assert.equal(expanded.props.edit, media[0].edit);
});
test('gallery arrows leave text editing and handled player shortcuts alone', () => {
  const media = [{ id: 'one', url: 'one.mp4', media_type: 'video' }, { id: 'two', url: 'two.mp4', media_type: 'video' }];
  const s = scenario(), screen = s.mount({ media }, 'gallery');
  screen.find(n => n.type === 'NestedVideoPlayer').props.onExpand(); screen.render();
  s.dispatch(event('ArrowRight', 'textarea')); screen.render(); assert.ok(screen.text.includes('1 / 2'));
  const handled = event('ArrowRight'); handled.defaultPrevented = true; s.dispatch(handled); screen.render(); assert.ok(screen.text.includes('1 / 2'));
  s.dispatch(event('ArrowRight')); screen.render(); assert.ok(screen.text.includes('2 / 2'));
});
test('gallery carries sensitive content permission into both inline and expanded video', () => {
  const media = [{ id: 'one', url: 'one.mp4', media_type: 'video', is_sensitive: true }];
  const screen = scenario().mount({ media }, 'gallery');
  assert.equal(screen.find(n => n.type === 'NestedVideoPlayer').props.allowPlayback, false);
  screen.find(n => n.type === 'NestedVideoPlayer').props.onExpand(); screen.render();
  assert.equal(screen.find(n => n.type === 'NestedVideoPlayer').props.allowPlayback, false); assert.match(screen.text, /Sensitive content/);
});
test('time helpers reject nonfinite duration and format long recordings', () => {
  assert.equal(helper.playbackWindow(Infinity, 0, 60).duration, 0);
  assert.equal(helper.playbackWindow(30, 90, 100).duration, 0);
  assert.equal(helper.formatVideoTime(3661), '1:01:01'); assert.equal(helper.formatVideoTime(NaN), '0:00');
});
test('only one player owns playback and a stopped pending play cannot steal it back', async () => {
  const s = scenario(), first = s.mount({ src: 'first.mp4' }), second = s.mount({ src: 'second.mp4' });
  let resolve;
  first.element.playResult = new Promise(done => { resolve = done; });
  first.click('Play video'); second.click('Play video');
  first.element.paused = false; first.videoEvent('onPlay'); resolve(); await flush(first);
  assert.equal(first.element.paused, true);
  second.videoEvent('onPlay'); assert.ok(second.label('Pause video'));
});
test('browser denial of PiP produces a visible fallback message', async () => {
  const screen = scenario({ pip: true }).mount(); screen.videoEvent('onLoadedMetadata');
  screen.element.requestPictureInPicture = () => Promise.reject(new Error('not allowed'));
  screen.click('Picture in picture'); await flush(screen); assert.match(screen.text, /could not open.*fullscreen instead/);
});
test('Escape exits native fullscreen without closing the underlying gallery', () => {
  const s = scenario(), media = [{ id: 'one', url: 'one.mp4', media_type: 'video' }];
  const screen = s.mount({ media }, 'gallery'); screen.find(n => n.type === 'NestedVideoPlayer').props.onExpand(); screen.render();
  s.document.fullscreenElement = {}; s.dispatch(event('Escape')); screen.render(); assert.ok(screen.label('Media viewer'));
});
test('late-loading edit recipes constrain ongoing playback to the saved trim start', () => {
  const screen = scenario().mount(); screen.videoEvent('onLoadedMetadata');
  screen.element.currentTime = 3;
  screen.update({ edit: { trimStart: 20, trimEnd: 50 } });
  screen.videoEvent('onTimeUpdate');
  assert.equal(screen.element.currentTime, 20);
});
test('closing video theater restores focus to the remounted inline opener', () => {
  const s = scenario(), screen = s.mount({ media: [{ id: 'one', url: 'one.mp4', media_type: 'video' }] }, 'gallery');
  const original = screen.inlineOpener;
  original.focus();
  screen.find(n => n.type === 'NestedVideoPlayer').props.onExpand(); screen.render();
  assert.equal(original.isConnected, false);
  assert.equal(s.document.activeElement, screen.closeButton);
  screen.click('Close viewer');
  assert.notEqual(screen.inlineOpener, original);
  assert.equal(s.document.activeElement, screen.inlineOpener);
  assert.equal(screen.inlineOpener.focusOptions.preventScroll, true);
  assert.equal(original.focusCalls, 1);
});
test('an image opened with a pointer restores its replacement opener on Escape', () => {
  const s = scenario(), screen = s.mount({ media: [{ id: 'one', url: 'one.jpg', media_type: 'image' }] }, 'gallery');
  const original = screen.inlineOpener;
  s.document.activeElement = s.document.body;
  screen.find(n => n.type === 'img' && n.props.role === 'button').props.onClick({ currentTarget: original, preventDefault() {}, stopPropagation() {} });
  screen.render();
  assert.equal(original.isConnected, false);
  s.dispatch(event('Escape')); screen.render();
  assert.equal(s.document.activeElement, screen.inlineOpener);
  assert.notEqual(screen.inlineOpener, original);
});
test('changing viewer media preserves immersive mode and the focused live control', () => {
  const media = [{ id: 'one', url: 'one.mp4', media_type: 'video' }, { id: 'two', url: 'two.mp4', media_type: 'video' }];
  const s = scenario(), screen = s.mount({ media, post: { post_id: 'post' } }, 'gallery');
  screen.inlineOpener.focus();
  screen.find(n => n.type === 'NestedVideoPlayer').props.onExpand(); screen.render();
  screen.click('Fit to screen');
  const focusCalls = screen.closeButton.focusCalls;
  s.dispatch(event('ArrowRight')); screen.render(); screen.render();
  assert.ok(screen.text.includes('2 / 2'));
  assert.ok(screen.label('Show comments'));
  assert.equal(screen.label('Fit to screen'), undefined);
  assert.equal(screen.closeButton.focusCalls, focusCalls);
  assert.equal(s.document.body.style.overflow, 'hidden');
});
test('removed media navigation control returns focus inside the open viewer', () => {
  const media = [{ id: 'one', url: 'one.mp4', media_type: 'video' }, { id: 'two', url: 'two.mp4', media_type: 'video' }];
  const s = scenario(), screen = s.mount({ media }, 'gallery');
  screen.find(n => n.type === 'NestedVideoPlayer').props.onExpand(); screen.render();
  const next = screen.navigation.get('Next media');
  next.focus();
  const dialog = screen.find(n => n.props?.role === 'dialog');
  allNodes(dialog).find(n => n.props?.['aria-label'] === 'Next media').props.onClick({ stopPropagation() {} });
  screen.render();
  assert.equal(next.isConnected, false);
  assert.equal(screen.navigation.has('Next media'), false);
  assert.equal(s.document.activeElement, screen.closeButton);
  const shiftTab = event('Tab'); shiftTab.shiftKey = true; s.dispatch(shiftTab);
  assert.equal(shiftTab.defaultPrevented, true);
  assert.equal(s.document.activeElement, screen.navigation.get('Previous media'));
  const tab = event('Tab'); s.dispatch(tab);
  assert.equal(tab.defaultPrevented, true);
  assert.equal(s.document.activeElement, screen.closeButton);
});
test('closing viewer falls back to its focusable media wrapper when no opener remains', () => {
  const s = scenario(), screen = s.mount({ media: [{ id: 'one', url: 'one.mp4', media_type: 'video' }] }, 'gallery');
  screen.find(n => n.type === 'NestedVideoPlayer').props.onExpand(); screen.render();
  screen.wrapper.querySelector = () => null;
  screen.click('Close viewer');
  assert.equal(s.document.activeElement, screen.wrapper);
  assert.equal(screen.find(n => n.props?.ref?.current === screen.wrapper).props.tabIndex, -1);
  assert.equal(screen.find(n => n.props?.ref?.current === screen.wrapper).props['aria-label'], 'Post media');
});
test('unmounting an open viewer releases the page without focusing disconnected media', () => {
  const s = scenario(), screen = s.mount({ media: [{ id: 'one', url: 'one.mp4', media_type: 'video' }] }, 'gallery');
  s.document.body.style.overflow = 'auto';
  s.document.body.style.paddingRight = '4px';
  screen.inlineOpener.focus();
  screen.find(n => n.type === 'NestedVideoPlayer').props.onExpand(); screen.render();
  const destination = { focus() { s.document.activeElement = this; } };
  destination.focus();
  screen.unmount();
  assert.equal(s.document.activeElement, destination);
  assert.equal(screen.wrapper.focusCalls, 0);
  assert.equal(s.document.body.style.overflow, 'auto');
  assert.equal(s.document.body.style.paddingRight, '4px');
  const tab = event('Tab'); s.dispatch(tab);
  assert.equal(tab.defaultPrevented, false);
});
