const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/screens/stories/StoryComposerScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('composer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const sharedComposition = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'shared/storyVideoComposition.ts'), 'utf8')), {
  module: sharedComposition, exports: sharedComposition.exports, require: () => ({}),
});
function callback(name, context) {
  let body;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) body = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(body, name);
  const exports = {}; vm.runInNewContext(compile('export const run = ' + body), { exports, ...context }); return exports.run;
}
const post = () => ({ id: 'post-one', kind: 'post', text: '', postText: 'The source is all text.', postId: 'source-post', nx: .5, ny: .5, scale: 1, rotation: 0 });
const plain = value => JSON.parse(JSON.stringify(value));

test('native framing retains the latest grade, trim, speed and original sound', () => {
  let active = { id: 'draft', mediaTransform: { scale: 1, translateNX: 0, translateNY: 0, fit: 'cover', adjust: { bri: 70, sat: -40 }, trimStart: 3, trimEnd: 12, speed: 1.5, mix: { orig: 40 }, filterAmt: 55 } };
  const handler = callback('handleTransformChange', { updateActive(patch) { active = { ...active, ...(typeof patch === 'function' ? patch(active) : patch) }; } });
  handler({ scale: 2, translateNX: .15, translateNY: -.1, fit: 'contain', adjust: { bri: 0 } });
  assert.deepEqual(plain(active.mediaTransform), { scale: 2, translateNX: .15, translateNY: -.1, fit: 'contain', adjust: { bri: 70, sat: -40 }, trimStart: 3, trimEnd: 12, speed: 1.5, mix: { orig: 40 }, filterAmt: 55 });
});

test('native reference-card taps show placement actions and never enter text deletion', () => {
  let openedText = false, menu, stickers = [post()];
  const handler = callback('handleTapSticker', {
    publish: { publishing: false }, active: { stickers }, openTextEditor() { openedText = true; },
    Alert: { alert(title, message, buttons) { menu = { title, message, buttons }; } },
    bringForward() {}, sendBackward() {}, updateStickers(change) { stickers = change(stickers); },
  });
  handler('post-one'); assert.equal(openedText, false); assert.equal(stickers.length, 1);
  assert.equal(menu.title, 'Shared post'); assert.match(menu.message, /Drag to move/);
  menu.buttons.find(button => button.text === 'Remove card').onPress(); assert.equal(stickers.length, 0);
});

function nativeSave({ editing = null, text = '', current = [post()], render = current } = {}) {
  let stickers = current, closed = 0;
  const run = callback('saveSticker', { stickerText: text, editingStickerId: editing, active: { stickers: render, durationSec: 15 },
    stickerStyle: 'classic', stickerColor: '#fff', stickerBgEnabled: false, stickerFontSize: 0, stickerOpacity: 1,
    stickerTextAlign: 'center', stickerAnim: 'none', stickerStartSec: null, stickerEndSec: null,
    storyLayerWindow: () => ({ start: 0, end: 15 }), newStickerId: () => 'new-words', nextStickerNy: () => .28,
    resolveTextMentions() {}, closeTextEditor() { closed++; }, updateStickers(change) { stickers = typeof change === 'function' ? change(stickers) : change; },
  });
  run(); return { stickers, closed };
}

test('native text commits preserve shared cards and concurrent sticker changes', () => {
  const current = [post(), { id: 'photo-two', kind: 'photo', text: '', photoUri: 'photo.jpg' }];
  const added = nativeSave({ text: 'My words', current, render: [post()] });
  assert.equal(added.stickers.length, 3); assert.equal(added.stickers[0].postText, 'The source is all text.');
  assert.equal(added.stickers[1].photoUri, 'photo.jpg'); assert.equal(added.stickers[2].text, 'My words'); assert.equal(added.closed, 1);
  assert.equal(nativeSave({ editing: 'post-one', text: '' }).stickers.length, 1);
  assert.equal(nativeSave({ editing: 'post-one', text: 'replacement' }).stickers[0].postText, 'The source is all text.');
  const cleared = nativeSave({ editing: 'words', current: [post(), { id: 'words', text: 'erase me' }] });
  assert.equal(cleared.stickers.length, 1); assert.equal(cleared.stickers[0].postId, 'source-post');
});

test('native text editor rejects an attempted reference-card edit before changing editor ownership', () => {
  const calls = [];
  callback('openTextEditor', { active: { stickers: [post()] }, setTextPanel() {}, setEditingStickerId() { calls.push('selected'); }, setTextEditorOpen() { calls.push('open'); } })('post-one');
  assert.deepEqual(calls, []);
});

function slider() {
  const slots = []; let cursor = 0, current = 0, tree;
  const hooks = { useRef(v) { const i = cursor++; return slots[i] ??= { current: v }; }, useState(v) { const i = cursor++; if (!(i in slots)) slots[i] = v; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; }, useEffect() {}, useMemo(fn) { return fn(); } };
  const native = { Dimensions: { get: () => ({ width: 390 }) }, View: 'View', Text: 'Text', StyleSheet: { create: s => s, absoluteFill: { position: 'absolute' } }, PanResponder: { create: handlers => ({ panHandlers: handlers }) } };
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/components/stories/storyPanels.tsx'), 'utf8')), { exports, Date, require(name) { if (name === 'react') return hooks; if (name === 'react-native') return native; if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }; return {}; } });
  const values = [], props = { value: 0, min: -100, max: 100, width: 200, onChange(value) { current = value; values.push(value); } };
  const render = () => { cursor = 0; tree = exports.MiniSlider(props); return tree; };
  return { values, render, current: () => current };
}

test('native adjustment taps and full-width drags change the rendered value and finish at both endpoints', () => {
  const h = slider(); let tree = h.render();
  tree.props.onPanResponderGrant({ nativeEvent: { locationX: 150 } }); assert.equal(h.current(), 50);
  tree.props.onPanResponderMove({}, { dx: 50 }); tree.props.onPanResponderRelease(); assert.equal(h.current(), 100);
  tree = h.render(); tree.props.onPanResponderGrant({ nativeEvent: { locationX: 0 } }); tree.props.onPanResponderRelease(); assert.equal(h.current(), -100);
  const children = h.render().props.children.flat().filter(Boolean);
  assert.ok(children.every(child => child.props.pointerEvents === 'none'));
});

function snapshot({ mediaType = 'text', readiness = [], available = true, platform = 'ios', compose, saveToLibrary, audio, prepareAudio, permissions = async () => ({ granted: true }) } = {}) {
  const calls = [], ref = { current: { artworkOnly: true } }, lock = { current: false }, owner = { current: 'owner' };
  const context = {
    active: { id: 'draft', mediaType, localUri: mediaType === 'text' ? null : 'file:///source.mp4', uploadState: 'idle', audio }, snapshotBusy: lock, storySnapshotRef: ref,
    useAuthStore: { getState: () => ({ session: { user: { id: owner.current } }, profile: { id: owner.current } }) },
    ownerRef: owner, activeDraftRef: { current: 'draft' }, mountedRef: { current: true }, photoReadiness: { current: new Map(readiness.map((state, i) => [String(i), state])) }, previewSize: { w: 390, h: 693.3333 },
    setCapturing: value => calls.push(['capturing', value]), requestAnimationFrame: fn => fn(),
    AbortController, exportAbort: { current: null }, exportCommitting: { current: false }, exportArtworkRef: ref,
    setExportArtwork: value => calls.push(['artwork', value]), setExportStatus: value => calls.push(['status', value]),
    storyVideoCompositionAvailable: available, storyAudioCompositionAvailable: available, storyVideoExportLimit: () => null,
    storyNativeEditingUnavailable: sharedComposition.exports.storyNativeEditingUnavailable, Platform: { OS: platform },
    storyVideoRecipe: () => ({ width: 1080, height: 1920, trimStart: 0 }), storyVideoLayerWindows: () => [{ clock: 2, start: 0, end: 4 }],
    vidPlayer: { duration: 4, pause() {} }, FileSystem: { cacheDirectory: 'file:///cache/', deleteAsync: async uri => calls.push(['delete', uri]) },
    composeStoryVideo: async (request, signal) => { calls.push(['compose', request]); return compose ? compose(request, signal) : { uri: request.outputUri }; },
    prepareStoryExportAudio: async (...args) => { calls.push(['prepare-audio']); return prepareAudio ? prepareAudio(...args) : { layer: { uri: 'file:///private-audio.wav', start: 1, duration: 2, volume: 1, loop: true }, assertRights: async () => calls.push(['rights']), release: async () => calls.push(['release-audio']) }; },
    MediaLibrary: { requestPermissionsAsync: permissions, saveToLibraryAsync: async uri => { calls.push(['save', uri]); return saveToLibrary?.(uri); } },
    captureRef: async (target, options) => { assert.equal(target, ref); calls.push(['capture', options]); return 'file:///rendered.png'; }, releaseCapture: uri => calls.push(['release', uri]),
    Haptics: { notificationAsync: async () => {}, NotificationFeedbackType: { Success: 1 } }, Alert: { alert: (...args) => calls.push(['alert', ...args]) },
  };
  return { context, calls, run: callback('saveMediaToDevice', context) };
}
test('native Save renders a text/shared-card composition rather than requiring an original photo URI', async () => {
  const h = snapshot(); await h.run();
  const options = h.calls.find(c => c[0] === 'capture')[1];
  assert.equal(options.format, 'png'); assert.equal(options.width, 1080); assert.equal(options.height, 1920);
  assert.ok(h.calls.findIndex(c => c[0] === 'capturing' && c[1]) < h.calls.findIndex(c => c[0] === 'capture'));
  assert.deepEqual(h.calls.find(c => c[0] === 'save'), ['save', 'file:///rendered.png']);
  assert.deepEqual(h.calls.find(c => c[0] === 'release'), ['release', 'file:///rendered.png']); assert.equal(h.context.snapshotBusy.current, false);
});
test('native image export refuses missing/loading photos instead of saving a broken image', async () => {
  for (const state of ['loading', 'error']) {
    const h = snapshot({ readiness: [state] }); await h.run();
    assert.equal(h.calls.some(c => c[0] === 'capture' || c[0] === 'save'), false); assert.equal(h.context.snapshotBusy.current, false);
    assert.equal(h.calls.find(c => c[0] === 'alert')[1], 'Could not save');
  }
});
test('native Save double taps and permission completion after an account change cannot save another draft', async () => {
  let grant, requests = 0;
  const h = snapshot({ permissions: () => { requests++; return new Promise(resolve => { grant = resolve; }); } });
  const first = h.run(); await h.run(); assert.equal(requests, 1); h.context.ownerRef.current = 'another-owner'; grant({ granted: true }); await first;
  assert.equal(h.calls.some(c => c[0] === 'save' || c[0] === 'capture' || c[0] === 'alert'), false); assert.equal(h.context.snapshotBusy.current, false);
});
test('native video Save composes actual artwork and saves only the verified edited output', async () => {
  const h = snapshot({ mediaType: 'video' }); await h.run();
  assert.equal(h.calls.filter(c => c[0] === 'capture').length, 2);
  const request = h.calls.find(c => c[0] === 'compose')[1];
  assert.equal(request.inputUri, 'file:///source.mp4'); assert.equal(request.layers.length, 1);
  assert.deepEqual(h.calls.find(c => c[0] === 'save'), ['save', request.outputUri]);
  assert.equal(h.calls.find(c => c[0] === 'alert')[1], 'Edited video saved');
  assert.ok(h.calls.some(c => c[0] === 'delete' && c[1] === request.outputUri));
});
test('native video export keeps older builds and account changes from saving an unedited or stale file', async () => {
  const old = snapshot({ mediaType: 'video', available: false }); await old.run();
  assert.equal(old.calls.some(c => c[0] === 'save' || c[0] === 'compose'), false); assert.match(old.calls.find(c => c[0] === 'alert')[2], /new iPhone build/);
  const h = snapshot({ mediaType: 'video', compose: async request => { h.context.ownerRef.current = 'other'; return { uri: request.outputUri }; } }); await h.run();
  assert.equal(h.calls.some(c => c[0] === 'save' || c[0] === 'alert'), false); assert.equal(h.context.snapshotBusy.current, false);
  assert.ok(h.calls.some(c => c[0] === 'delete'));
});
test('Android Save explains its unsupported composer before permissions or native work', async () => {
  let permissions = 0;
  const h = snapshot({ mediaType: 'video', platform: 'android', available: false,
    permissions: async () => { permissions++; return { granted: true }; } });
  await h.run();
  assert.equal(permissions, 0);
  assert.equal(h.calls.some(c => c[0] === 'save' || c[0] === 'compose' || c[0] === 'capture'), false);
  assert.match(h.calls.find(c => c[0] === 'alert')[2], /not available on Android yet/);
  assert.equal(h.context.snapshotBusy.current, false);
});

function activeExportModal(context) {
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'StoryComposerScreen');
  // Use the actual active-draft return, not the separate no-drafts branch. The
  // original misplaced modal cannot pass merely because its JSX exists.
  const activeReturn = component.body.statements.find(ts.isReturnStatement);
  let modal;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'Modal' && node.openingElement.attributes.getText(ast).includes('exportStatus')) modal = node;
    ts.forEachChild(node, visit);
  }
  visit(activeReturn); assert.ok(modal, 'the active draft must render export progress and cancellation');
  const exports = {};
  vm.runInNewContext(compile('export const render = () => (' + modal.getText(ast) + ');'), {
    exports, ...context, Modal: 'Modal', View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator', TouchableOpacity: 'TouchableOpacity',
    require(name) { assert.equal(name, 'react/jsx-runtime'); return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }; },
  });
  return exports.render();
}
const descendants = node => !node ? [] : Array.isArray(node) ? node.flatMap(descendants) : typeof node === 'object' ? [node, ...descendants(node.props?.children)] : [];
test('the active native draft renders export progress and its Cancel/Back stops pending output before Photos', async () => {
  for (const cancelWith of ['button', 'back']) {
    let complete;
    const h = snapshot({ mediaType: 'video', compose: request => new Promise(resolve => { complete = () => resolve({ uri: request.outputUri }); }) });
    const work = h.run();
    for (let i = 0; i < 20 && !complete; i++) await new Promise(resolve => setImmediate(resolve));
    assert.ok(complete, 'the composed export is pending');
    const exportStatus = h.calls.filter(call => call[0] === 'status').at(-1)[1];
    const modal = activeExportModal({ exportStatus, exportAbort: h.context.exportAbort, exportCommitting: h.context.exportCommitting });
    assert.equal(modal.props.visible, true);
    assert.ok(descendants(modal).some(node => node.type === 'Text' && node.props.children === 'Rendering edited video…'));
    if (cancelWith === 'button') descendants(modal).find(node => node.props?.accessibilityLabel === 'Cancel export').props.onPress();
    else modal.props.onRequestClose();
    assert.equal(h.context.exportAbort.current.signal.aborted, true);
    complete(); await work;
    assert.equal(h.calls.some(call => call[0] === 'save' || call[0] === 'alert'), false);
    assert.ok(h.calls.some(call => call[0] === 'delete'));
    assert.equal(h.context.snapshotBusy.current, false);
  }
  assert.equal(activeExportModal({ exportStatus: null, exportAbort: { current: null }, exportCommitting: { current: false } }).props.visible, false);
});
test('native export stops offering cancellation once Photos has accepted the final save', async () => {
  let completeComposition, completeSave;
  const h = snapshot({ mediaType: 'video', compose: request => new Promise(resolve => { completeComposition = () => resolve({ uri: request.outputUri }); }), saveToLibrary: () => new Promise(resolve => { completeSave = resolve; }) });
  const work = h.run();
  for (let i = 0; i < 20 && !completeComposition; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(completeComposition);
  const previous = activeExportModal({ exportStatus: 'Rendering edited video…', exportAbort: h.context.exportAbort, exportCommitting: h.context.exportCommitting });
  completeComposition();
  for (let i = 0; i < 20 && !completeSave; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(completeSave); assert.equal(h.context.exportCommitting.current, true);
  const saving = activeExportModal({ exportStatus: h.calls.filter(call => call[0] === 'status').at(-1)[1], exportAbort: h.context.exportAbort, exportCommitting: h.context.exportCommitting });
  assert.equal(descendants(saving).some(node => node.props?.accessibilityLabel === 'Cancel export'), false);
  assert.ok(descendants(saving).some(node => node.type === 'Text' && /Finishing the save to Photos/.test(String(node.props.children))));
  // Even a previously rendered Cancel/Back callback must respect the synchronous
  // commit fence before React presents the final saving state.
  descendants(previous).find(node => node.props?.accessibilityLabel === 'Cancel export').props.onPress();
  previous.props.onRequestClose(); saving.props.onRequestClose();
  assert.equal(h.context.exportAbort.current.signal.aborted, false);
  completeSave(); await work;
  assert.equal(h.calls.filter(call => call[0] === 'save').length, 1);
  assert.equal(h.calls.find(call => call[0] === 'alert')[1], 'Edited video saved');
  assert.equal(h.context.exportCommitting.current, false); assert.equal(h.context.snapshotBusy.current, false);
});

test('native photo and text stories with audio export movies with a final rights check and cleanup', async () => {
  for (const mediaType of ['text', 'image', 'video']) {
    const h = snapshot({ mediaType, audio: { kind: 'sound', soundId: 'owned-sound', durationSec: 4 } });
    await h.run();
    const composed = h.calls.find(call => call[0] === 'compose')[1];
    assert.equal(composed.inputKind, mediaType === 'video' ? 'video' : 'image');
    assert.equal(composed.audio.uri, 'file:///private-audio.wav');
    assert.ok(h.calls.findIndex(call => call[0] === 'rights') < h.calls.findIndex(call => call[0] === 'save'));
    assert.equal(h.calls.filter(call => call[0] === 'release-audio').length, 1);
    assert.ok(h.calls.some(call => call[0] === 'delete'));
  }
});
test('native revocation during video composition prevents a Photos save and releases audio', async () => {
  let released = false;
  const h = snapshot({ mediaType: 'video', audio: { kind: 'sound', soundId: 'owned-sound' }, prepareAudio: async () => ({
    layer: { uri: 'file:///private-audio.wav' }, assertRights: async () => { throw Error('Audio revoked'); }, release: async () => { released = true; },
  }) });
  await h.run();
  assert.equal(h.calls.some(call => call[0] === 'save'), false); assert.equal(released, true);
  assert.ok(h.calls.some(call => call[0] === 'delete')); assert.equal(h.context.snapshotBusy.current, false);
});
