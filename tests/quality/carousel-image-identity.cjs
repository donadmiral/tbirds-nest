const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const base = 'https://images.supabase.co';
const signed = (name = 'photo.jpg', token = 'a') => `${base}/functions/v1/media-content/post-media/owner/${name}?token=${token.repeat(64)}`;
const jsx = (type, props, key) => ({ type, props, key });
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
function load(file, imports = {}, suffix = '') {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText + suffix;
  vm.runInNewContext(code, { module, exports: module.exports, URL, require(name) {
    if (!(name in imports)) throw Error(`Unexpected import: ${name}`);
    return imports[name];
  } });
  return module.exports;
}
const content = load('shared/contentMedia.ts');
const delivery = load('shared/mediaDelivery.ts');
const sharedIdentities = load('shared/imageDisplayIdentity.ts', { './contentMedia': content });
const identities = load('src/lib/imageDisplayIdentity.ts', { '../../shared/imageDisplayIdentity': sharedIdentities });
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

// Run the actual components with deterministic hooks. Native drawable reuse is
// represented by the real Expo key/recyclingKey contract, not a fake image load.
function harness() {
  const slots = []; let cursor = 0, scope = 'viewer-a:1', preview = null;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() };
      return slots[i].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
    useEffect() { cursor++; },
  };
  const component = load('src/components/PostCarousel.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', TouchableOpacity: 'Button', ActivityIndicator: 'Spinner', FlatList: 'FlatList' },
    'expo-image': { Image: 'Image' }, 'expo-video': {}, '@expo/vector-icons': {}, '@react-navigation/native': {},
    '../theme/useTheme': { themedSheet: () => ({}), useTheme() {} },
    '../lib/navigationCache': { navigationScope: () => scope, subscribeNavigationScope() { return () => {}; } },
    '../services/supabase': { SUPABASE_URL: base },
    '../lib/imageDisplayIdentity': identities, '../../shared/mediaDelivery': delivery,
    '../../shared/contentMedia': content,
    '../hooks/useFeedStartupPreview': { useFeedStartupPreview: (post, media) => preview?.postId === post && preview?.mediaId === media ? preview : null },
    '../lib/videoEngine': {}, '../stores/settingsStore': {}, '../../shared/postVoiceEffects': {},
    '../../shared/postMediaEditing': { postAspectRatio: () => 4 / 5 },
    '../../shared/carouselNavigation': { carouselIndex: (index, length) => Math.max(0, Math.min(index, length - 1)) },
    '../../shared/soundtrack': { readSoundtrack: () => null },
    './MediaRenderer': { useMediaTags: () => ({}), TagLayer: 'Tags', PinchInspect: 'PinchInspect' },
    './PostCaption': {}, './PostSoundtrack': {}, './VideoThumb': {}, './stories/StoryFilters': {}, './stories/storyPanels': {},
  }, '\nexports.__CarouselImage = CarouselImage; exports.__CarouselVideo = CarouselVideo;');
  const render = fn => { cursor = 0; return fn(); };
  return {
    ...component,
    image(props = {}) { return walk(render(() => component.__CarouselImage({ uri: signed(), width: 320, height: 400, postId: 'post-a', mediaId: 'media-a', ...props }))); },
    carousel(media, props = {}) { return walk(render(() => component.default({ media, containerWidth: 320, postId: 'post-a', ...props }))); },
    changeScope(next) { scope = next; },
    preview(next) { preview = next; },
  };
}
const image = nodes => nodes.find(node => node.type === 'Image');
const loading = nodes => nodes.some(node => node.type === 'Spinner');

test('same-object grant renewal retains the loaded image surface while requesting the current capability', () => {
  const h = harness(), first = image(h.image());
  assert.equal(loading(h.image()), true);
  assert.equal(first.props.onLoad, undefined, 'Downloaded bytes do not imply a painted drawable');
  first.props.onDisplay();
  const painted = h.image();
  assert.equal(loading(painted), false);
  assert.equal(image(painted).props.source, first.props.source, 'A metadata-only render does not start a new source request');
  const renewedUri = signed('photo.jpg', 'b');
  const renewed = h.image({ uri: renewedUri }), next = image(renewed);
  assert.equal(next.key, first.key);
  assert.equal(next.props.recyclingKey, first.props.recyclingKey, 'Expo does not clear an already painted drawable');
  assert.equal(next.props.source.uri, renewedUri, 'No expired token substitutes for the actual new request');
  assert.equal(next.props.cachePolicy, 'none');
  assert.equal(loading(renewed), false, 'The opaque loading cover must not blank the current frame');
  first.props.onError();
  assert.ok(image(h.image({ uri: renewedUri })), 'A superseded request cannot blank the current frame');
});

test('a current image failure clears the drawable and a renewed request must load again', () => {
  const h = harness(), first = image(h.image()); first.props.onDisplay();
  const renewedUri = signed('photo.jpg', 'b'), next = image(h.image({ uri: renewedUri }));
  next.props.onError();
  next.props.onDisplay();
  assert.equal(image(h.image({ uri: renewedUri })), undefined);
  const retryUri = signed('photo.jpg', 'c');
  assert.equal(loading(h.image({ uri: retryUri })), true);
  next.props.onDisplay();
  assert.equal(loading(h.image({ uri: retryUri })), true, 'A late load from the failed request cannot paint its replacement');
  image(h.image({ uri: retryUri })).props.onDisplay();
  assert.equal(loading(h.image({ uri: retryUri })), false);
});

test('another post, object or transform gets a fresh surface and cannot inherit loaded state', () => {
  for (const replacement of [{ postId: 'post-b' }, { uri: signed('other.jpg') }, { uri: `${signed()}&width=128` }]) {
    const h = harness(), first = image(h.image()); first.props.onDisplay();
    const changed = h.image(replacement);
    assert.notEqual(image(changed).key, first.key);
    assert.equal(loading(changed), true);
    first.props.onDisplay(); first.props.onError();
    const afterStaleEvents = h.image(replacement);
    assert.ok(image(afterStaleEvents));
    assert.equal(loading(afterStaleEvents), true);
  }
});

test('private images disappear on account change or grant removal before parent data catches up', () => {
  const h = harness(), first = image(h.image()); first.props.onDisplay();
  h.changeScope('viewer-b:2');
  assert.equal(image(h.image()), undefined);
  h.changeScope('viewer-a:3');
  assert.equal(image(h.image()), undefined, 'Returning to an account cannot revive its previous grant');
  const current = h.image({ uri: signed('photo.jpg', 'd') });
  assert.notEqual(image(current).key, first.key);
  assert.equal(loading(current), true);
  assert.equal(image(h.image({ uri: '' })), undefined);
  h.changeScope(null);
  assert.equal(image(h.image({ uri: signed('photo.jpg', 'e') })), undefined, 'No private drawable is mounted when signed out');
});

test('single and album parent keys preserve image renewal but retain full video source identity', () => {
  const media = { id: 'attachment', media_type: 'image', sort_order: 0, url: signed() };
  const renewed = { ...media, url: signed('photo.jpg', 'b') };
  const h = harness();
  const single = h.carousel([media]).find(node => node.type === h.__CarouselImage);
  const singleRenewed = h.carousel([renewed]).find(node => node.type === h.__CarouselImage);
  assert.equal(single.key, singleRenewed.key);
  assert.equal(singleRenewed.props.uri, renewed.url);
  assert.equal(singleRenewed.props.postId, 'post-a');
  const video = { ...media, id: 'video', media_type: 'video', url: signed('clip.mp4') };
  const album = h.carousel([media, video]).find(node => node.type === 'FlatList');
  assert.equal(album.props.keyExtractor(media), album.props.keyExtractor(renewed));
  const cell = item => walk(album.props.renderItem({ item, index: 0 })).find(node => node.type === h.__CarouselImage);
  assert.equal(cell(media).key, cell(renewed).key);
  assert.equal(cell(renewed).props.postId, 'post-a');
  const changedVideo = { ...video, url: signed('clip.mp4', 'b') };
  assert.notEqual(album.props.keyExtractor(video), album.props.keyExtractor(changedVideo));
  const singleVideo = item => h.carousel([item]).find(node => node.type === h.__CarouselVideo);
  assert.notEqual(singleVideo(video).key, singleVideo(changedVideo).key);
});

test('encrypted preview stays painted beneath the real source until its onDisplay, without using disk-cached native placeholders', () => {
  const h = harness(), previewUri = 'data:image/jpeg;base64,/9j/abcd';
  h.preview({ uri: previewUri, postId: 'post-a', mediaId: 'media-a', objectKey: 'post-media/owner/photo.jpg', kind: 'image' });
  const initial = h.image({ uri: previewUri });
  assert.equal(initial.filter(node => node.type === 'Image').length, 1);
  const preview = image(initial);
  assert.equal(preview.props.cachePolicy, 'none');
  assert.equal(loading(initial), false);
  const swapping = h.image(), layers = swapping.filter(node => node.type === 'Image');
  assert.equal(layers.length, 2); assert.equal(layers[0].key, preview.key);
  assert.equal(layers[0].props.source.uri, previewUri); assert.equal(layers[1].props.source.uri, signed());
  assert.equal(layers[1].props.placeholder, undefined, 'native placeholder path can persist plaintext pixels');
  assert.equal(layers[1].props.onLoad, undefined); assert.equal(loading(swapping), false);
  layers[1].props.onDisplay();
  const displayed = h.image().filter(node => node.type === 'Image');
  assert.equal(displayed.length, 1); assert.equal(displayed[0].props.source.uri, signed());
});

test('preview expiry, account change and object replacement cannot retain stale placeholder pixels', () => {
  const h = harness(), uri = 'data:image/jpeg;base64,/9j/abcd';
  h.preview({ uri, postId: 'post-a', mediaId: 'media-a', objectKey: 'post-media/owner/photo.jpg', kind: 'image' });
  assert.equal(h.image().filter(node => node.type === 'Image').length, 2);
  assert.equal(h.image({ uri: signed('other.jpg') }).filter(node => node.type === 'Image').length, 1);
  h.preview(null);
  assert.equal(h.image().filter(node => node.type === 'Image').length, 1);
  assert.equal(loading(h.image()), true);
  assert.equal(image(h.image({ uri })), undefined, 'expired data URI cannot become an ordinary uncached source');
  h.image();
  h.changeScope('viewer-b:2');
  assert.equal(image(h.image()), undefined);
});

test('the preview hook reads one shared entry and subscribes to expiry and account ownership', () => {
  let owner = 'a', expired = false, subscribed;
  const preview = { postId: 'post-a', mediaId: 'media-a', uri: 'data:image/jpeg;base64,/9j/abcd' };
  const subscribe = () => () => {};
  const hook = load('src/hooks/useFeedStartupPreview.ts', {
    react: { useCallback: fn => fn, useSyncExternalStore: (listen, read) => { subscribed = listen; return read(); } },
    '../stores/authStore': { useAuthStore: select => select({ session: owner ? { user: { id: owner } } : null }) },
    '../services/feedStartupPreviews': { feedStartupPreviews: { subscribe, peek: id => id === 'a' && !expired ? [preview] : null } },
  });
  assert.equal(hook.useFeedStartupPreview('post-a', 'media-a'), preview);
  assert.equal(subscribed, subscribe);
  assert.equal(hook.useFeedStartupPreview('other', 'media-a'), null);
  expired = true; assert.equal(hook.useFeedStartupPreview('post-a', 'media-a'), null);
  expired = false; owner = 'b'; assert.equal(hook.useFeedStartupPreview('post-a', 'media-a'), null);
  owner = null; assert.equal(hook.useFeedStartupPreview('post-a', 'media-a'), null);
});

test('the parent image component keeps its media identity across preview-to-capability replacement', () => {
  const h = harness(), media = { id: 'media-a', media_type: 'image', sort_order: 0, url: 'data:image/jpeg;base64,/9j/abcd' };
  const preview = h.carousel([media]).find(node => node.type === h.__CarouselImage);
  const full = h.carousel([{ ...media, url: signed() }]).find(node => node.type === h.__CarouselImage);
  assert.equal(preview.key, full.key); assert.equal(full.props.mediaId, 'media-a');
});

test('a reserved empty frame paints a late same-ID preview without changing layout or showing an error', () => {
  const h = harness(), props = { uri: '', startupPlaceholder: true, width: 320, height: 568 };
  const initial = h.image(props);
  assert.equal(image(initial), undefined); assert.equal(loading(initial), true);
  assert.equal(initial.some(node => node.type === 'Text' && node.props.children === 'Image could not load'), false);
  const frame = initial.find(node => node.type === 'View').props.style;
  h.preview({ uri: 'data:image/jpeg;base64,/9j/abcd', postId: 'post-a', mediaId: 'media-a', objectKey: 'post-media/owner/photo.jpg', kind: 'image' });
  const painted = h.image(props);
  assert.deepEqual(painted.find(node => node.type === 'View').props.style, frame);
  assert.equal(image(painted).props.cachePolicy, 'none'); assert.equal(loading(painted), false);
  assert.equal(image(h.image({ ...props, mediaId: 'other' })), undefined);
  h.preview(null); assert.equal(image(h.image(props)), undefined);
});
