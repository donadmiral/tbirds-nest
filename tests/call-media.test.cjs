const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(text).join('') : text(node?.props?.children ?? '');
function harness() {
  let slots = [], cursor = 0, tree, props;
  const jsx = (type, props, key) => ({ type, props, key });
  const react = { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
    return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useEffect() {}, useRef: value => ({ current: value }) };
  const native = new Proxy({ StyleSheet: { create: value => value, absoluteFillObject: {} } }, { get: (obj, key) => obj[key] ?? key });
  const load = (relative, mocks = {}) => {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, require: name => mocks[name] ?? ({
      react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': native,
      '@daily-co/react-native-daily-js': { DailyMediaView: 'DailyMediaView' },
    }[name]) ?? new Proxy({}, { get: (_, key) => key }) });
    return module.exports;
  };
  const media = load('src/components/RemoteCallMedia.tsx');
  const render = (participants, options = {}) => { if (participants) props = { participants, ...options }; cursor = 0; tree = media.RemoteCallMedia(props); };
  const nodes = () => { const result = []; function walk(node) {
    if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(walk);
    result.push(node); walk(node.props?.children);
  } walk(tree); return result; };
  const click = label => { const button = nodes().find(node => node.props?.accessibilityLabel === label);
    assert.ok(button, `Button exists: ${label}`); assert.ok(!button.props.disabled, `${label} is enabled`);
    button.props.onPress(); render(); };
  return { media, render, nodes, click, load,
    get videos() { return nodes().filter(node => node.type === 'DailyMediaView' && node.props.videoTrack).map(node => node.props); },
    get audio() { return nodes().filter(node => node.type === 'DailyMediaView' && node.props.audioTrack).map(node => node.props.audioTrack.id); },
    get text() { return text(tree); },
  };
}
function participant(id, share = false) {
  const track = kind => ({ state: 'playable', persistentTrack: { id: `${id}-${kind}` } });
  return { session_id: id, user_name: id, tracks: { audio: track('mic'), video: track('camera'),
    screenVideo: share ? track('screen') : { state: 'off' }, screenAudio: share ? track('sound') : { state: 'off' } } };
}

test('a screen share fills its view without cropping, mirroring or playing the camera instead', () => {
  const h = harness(); h.render([participant('Alice', true), participant('Bob')]);
  assert.equal(h.videos.length, 1); assert.equal(h.videos[0].videoTrack.id, 'Alice-screen');
  assert.equal(h.videos[0].objectFit, 'contain'); assert.equal(h.videos[0].mirror, false);
  assert.deepEqual(h.audio.sort(), ['Alice-mic', 'Alice-sound', 'Bob-mic']);
});
test('selecting another share follows its tracks and screen audio while preserving every microphone', () => {
  const h = harness(); h.render([participant('Alice', true), participant('Bob', true)]);
  h.click("View Bob's screen"); assert.equal(h.videos[0].videoTrack.id, 'Bob-screen');
  assert.deepEqual(h.audio.sort(), ['Alice-mic', 'Bob-mic', 'Bob-sound']);
  h.click('View cameras'); assert.deepEqual(h.videos.map(view => view.videoTrack.id), ['Alice-camera', 'Bob-camera']);
  assert.deepEqual(h.audio.sort(), ['Alice-mic', 'Bob-mic']);
});
test('stopped or blocked shares never render persistent stale video or screen audio', () => {
  const h = harness(), alice = participant('Alice', true);
  h.render([alice]); assert.equal(h.videos[0].videoTrack.id, 'Alice-screen');
  for (const state of ['off', 'blocked', 'interrupted', 'loading', 'sendable']) {
    const stopped = { ...alice, tracks: { ...alice.tracks, screenVideo: { ...alice.tracks.screenVideo, state } } };
    h.render([stopped]); assert.equal(h.videos[0].videoTrack.id, 'Alice-camera');
    assert.equal(h.media.hasRemoteScreenShare([stopped]), false); assert.deepEqual(h.audio, ['Alice-mic']);
  }
});
test('a departed selected sharer falls back to another current share', () => {
  const h = harness(), alice = participant('Alice', true), bob = participant('Bob', true);
  h.render([alice, bob]); h.click("View Bob's screen"); h.render([alice]);
  assert.equal(h.videos[0].videoTrack.id, 'Alice-screen');
});
test('all group participants are reachable across bounded four-camera pages', () => {
  const h = harness(), participants = Array.from({ length: 9 }, (_, i) => participant(`user${i}`));
  h.render(participants); assert.equal(h.videos.length, 4); assert.match(h.text, /1 \/ 3/);
  h.click('Next participants'); assert.equal(h.videos[0].videoTrack.id, 'user4-camera');
  h.click('Next participants'); assert.deepEqual(h.videos.map(view => view.videoTrack.id), ['user8-camera']);
  assert.match(h.text, /3 \/ 3/); assert.equal(h.audio.length, 9); assert.equal(new Set(h.audio).size, 9);
  assert.equal(h.nodes().find(node => node.props?.accessibilityLabel === 'Next participants').props.disabled, true);
  h.click('Previous participants'); assert.equal(h.videos[0].videoTrack.id, 'user4-camera');
});
test('departures clamp the page to the remaining participants instead of showing a blank grid', () => {
  const h = harness(), participants = Array.from({ length: 5 }, (_, i) => participant(`user${i}`));
  h.render(participants); h.click('Next participants'); h.render(participants.slice(0, 2));
  assert.deepEqual(h.videos.map(view => view.videoTrack.id), ['user0-camera', 'user1-camera']);
  assert.equal(h.nodes().some(node => node.props?.accessibilityLabel === 'Next participants'), false);
});
test('legacy SDK tracks remain supported only when current track state is absent', () => {
  const h = harness(), legacy = { session_id: 'legacy', user_name: 'Legacy', screenVideoTrack: { id: 'old-screen' } };
  h.render([legacy]); assert.equal(h.videos[0].videoTrack.id, 'old-screen');
  h.render([{ ...legacy, tracks: { screenVideo: { state: 'off' } } }]); assert.equal(h.videos.length, 0);
});
test('immersive camera layout fills portrait with one host, two rows, and bounded guest grids', () => {
  const h = harness(), people = Array.from({ length: 4 }, (_, i) => participant(`user${i}`));
  const tiles = () => h.nodes().filter(n => n.props?.testID?.startsWith('live-camera-')).map(n => n.props.style.at(-1));
  const geometry = () => JSON.parse(JSON.stringify(tiles()));
  h.render(people.slice(0, 1), { presentation: 'immersive' });
  assert.deepEqual(geometry(), [{ width: '100%', height: '100%' }]);
  h.render(people.slice(0, 2), { presentation: 'immersive' });
  assert.deepEqual(geometry(), [{ width: '100%', height: '50%' }, { width: '100%', height: '50%' }]);
  h.render(people.slice(0, 3), { presentation: 'immersive' });
  assert.deepEqual(geometry(), [{ width: '50%', height: '50%' }, { width: '50%', height: '50%' }, { width: '100%', height: '50%' }]);
  h.render(people, { presentation: 'immersive' });
  assert.deepEqual(geometry(), Array.from({ length: 4 }, () => ({ width: '50%', height: '50%' })));
  assert.equal(h.videos.length, 4);
});
test('portrait and landscape rotation preserves camera tracks and gives two guests the available width', () => {
  const h = harness(), people = [participant('Alice'), participant('Bob')];
  h.render(people, { presentation: 'immersive' });
  const before = h.videos.map(v => v.videoTrack);
  h.nodes().find(n => n.props?.testID === 'live-native-stage').props.onLayout({ nativeEvent: { layout: { width: 844, height: 390 } } });
  h.render();
  assert.deepEqual(h.nodes().filter(n => n.props?.testID?.startsWith('live-camera-')).map(n => n.props.style.at(-1).width), ['50%', '50%']);
  assert.deepEqual(h.videos.map(v => v.videoTrack), before);
});
test('immersive controls can reveal the whole camera without cropping or changing remote audio', () => {
  const h = harness(), alice = participant('Alice');
  h.render([alice], { presentation: 'immersive', contentInsets: { top: 90, bottom: 180 } });
  assert.equal(h.videos[0].objectFit, 'cover');
  h.click("Fit Alice's camera"); assert.equal(h.videos[0].objectFit, 'contain');
  assert.deepEqual(h.audio, ['Alice-mic']);
  h.click("Fill Alice's camera"); assert.equal(h.videos[0].objectFit, 'cover');
  assert.equal(h.nodes().some(n => Array.isArray(n.props?.style) && n.props.style.some(s => s?.bottom === 180)), true);
});
test('two, three and four cameras occupy the complete 320x700 and 390x844 viewports behind live overlays', () => {
  const people = Array.from({ length: 4 }, (_, i) => participant(`guest${i}`));
  const flatten = styles => Object.assign({}, ...[styles].flat(Infinity).filter(Boolean));
  for (const [width, height] of [[320, 700], [390, 844]]) for (const count of [2, 3, 4]) {
    const h = harness();
    h.render(people.slice(0, count), { presentation: 'immersive', contentInsets: { top: 126, bottom: 334 } });
    h.nodes().find(n => n.props?.testID === 'live-native-stage').props.onLayout({ nativeEvent: { layout: { width, height } } });
    h.render();
    const grid = h.nodes().find(n => n.props?.testID === 'live-native-camera-grid');
    const style = flatten(grid.props.style);
    assert.equal(style.flex, 1);
    for (const property of ['height', 'maxHeight', 'aspectRatio', 'paddingTop', 'paddingBottom', 'marginTop', 'marginBottom']) {
      assert.equal(style[property], undefined, `${count} cameras have no reserved ${property}`);
    }
    const tiles = grid.props.children.flat(Infinity).filter(n => n?.props?.testID?.startsWith('live-camera-'));
    let x = 0, y = 0, area = 0;
    for (const tile of tiles) {
      const box = flatten(tile.props.style), tileWidth = parseFloat(box.width) / 100 * width, tileHeight = parseFloat(box.height) / 100 * height;
      if (x + tileWidth > width) { x = 0; y += tileHeight; }
      assert.ok(x + tileWidth <= width && y + tileHeight <= height, 'tile stays within the stage');
      const badge = tile.props.children.flat(Infinity).find(n => Array.isArray(n?.props?.style) && n.props.style.some(s => typeof s?.top === 'number'));
      assert.ok(badge.props.style.at(-1).top >= 8 && badge.props.style.at(-1).top + 44 <= tileHeight, 'badge stays in its camera tile');
      if (y === 0) assert.ok(badge.props.style.at(-1).top >= 126, 'top row badge clears the live header');
      x += tileWidth; area += tileWidth * tileHeight;
    }
    assert.equal(tiles.length, count);
    assert.equal(area, width * height, 'camera surfaces cover the full viewport with no black reserved lower half');
    assert.equal(y + height / 2, height, 'last camera row reaches the bottom of the viewport');
  }
});
test('a single camera label stays visible even on a short viewport', () => {
  const h = harness();
  h.render([participant('Alice')], { presentation: 'immersive', contentInsets: { top: 110, bottom: 330 } });
  h.nodes().find(n => n.props?.testID === 'live-native-stage').props.onLayout({ nativeEvent: { layout: { width: 320, height: 400 } } });
  h.render();
  const label = h.nodes().find(n => Array.isArray(n.props?.style) && n.props.style.some(s => typeof s?.bottom === 'number'));
  assert.equal(label.props.style.at(-1).bottom, 238, 'name stays below the header even in a short viewport');
});
test('immersive screen sharing remains contained and names empty or interrupted cameras', () => {
  const h = harness(), alice = participant('Alice', true);
  h.render([alice], { presentation: 'immersive', contentInsets: { top: 110, bottom: 330 } });
  assert.equal(h.videos[0].objectFit, 'contain'); assert.equal(h.videos[0].mirror, false);
  assert.equal(h.nodes().some(n => Array.isArray(n.props?.style)
    && n.props.style.some(s => s?.paddingTop === 170 && s?.paddingBottom === 330)), true);
  h.render([], { presentation: 'immersive' }); assert.match(h.text, /Waiting for participants/); assert.equal(h.videos.length, 0);
  h.render([{ ...alice, tracks: { video: { state: 'loading' } } }], { presentation: 'immersive' });
  assert.match(h.text, /Connecting camera/); assert.match(h.text, /Alice · Muted/); assert.equal(h.videos.length, 0);
});
test('camera pages place badges below screen selectors and page controls without reducing the grid', () => {
  const h = harness(), people = Array.from({ length: 5 }, (_, i) => participant(`guest${i}`, i === 0));
  h.render(people, { presentation: 'immersive', contentInsets: { top: 110, bottom: 330 } });
  h.click('View cameras');
  assert.equal(h.nodes().find(n => n.props?.testID === 'live-native-camera-grid').props.style.paddingTop, undefined);
  assert.equal(h.nodes().some(n => Array.isArray(n.props?.style)
    && n.props.style.some(s => s?.top === 238)), true);
  assert.equal(h.videos.length, 4);
  h.click('Next participants'); assert.equal(h.videos[0].videoTrack.id, 'guest4-camera');
});
test('camera off, disabled, ended and replaced tracks cannot leave the old native video surface', () => {
  const h = harness(), alice = participant('Alice');
  h.render([alice], { presentation: 'immersive' });
  const initialKey = h.nodes().find(n => n.type === 'DailyMediaView' && n.props.videoTrack).key;
  const replacement = { ...alice, tracks: { ...alice.tracks, video: { state: 'playable', track: { id: 'replacement' } } } };
  h.render([replacement], { presentation: 'immersive' });
  assert.notEqual(h.nodes().find(n => n.type === 'DailyMediaView' && n.props.videoTrack).key, initialKey);
  for (const video of [{ state: 'off', persistentTrack: alice.tracks.video.persistentTrack },
    { state: 'playable', track: { id: 'disabled', enabled: false } },
    { state: 'playable', track: { id: 'ended', readyState: 'ended' } }]) {
    h.render([{ ...alice, tracks: { ...alice.tracks, video } }], { presentation: 'immersive' });
    assert.equal(h.videos.length, 0); assert.match(h.text, /Camera off/); assert.match(h.text, /Alice/);
  }
});
test('only local front camera is mirrored, and switching to the rear camera removes the mirror', () => {
  const h = harness(), local = { ...participant('Alice'), local: true };
  local.tracks.video.persistentTrack.getSettings = () => ({ facingMode: 'user' });
  const remote = participant('Bob'); remote.tracks.video.persistentTrack.getSettings = () => ({ facingMode: 'user' });
  h.render([local, remote], { presentation: 'immersive' });
  assert.deepEqual(h.videos.map(v => v.mirror), [true, false]);
  assert.deepEqual(h.audio, ['Bob-mic']);
  local.tracks.video.persistentTrack.getSettings = () => ({ facingMode: 'environment' });
  h.render([local, remote], { presentation: 'immersive' });
  assert.deepEqual(h.videos.map(v => v.mirror), [false, false]);
});
test('all twelve admitted stage members remain reachable without twelve simultaneous video surfaces', () => {
  const h = harness(), people = Array.from({ length: 12 }, (_, i) => participant(`guest${i}`));
  h.render(people, { presentation: 'immersive' });
  const seen = new Set(h.videos.map(v => v.videoTrack.id));
  for (let page = 1; page < 3; page++) {
    h.click('Next participants');
    assert.equal(h.videos.length, 4); assert.equal(h.audio.length, 12);
    h.videos.forEach(v => seen.add(v.videoTrack.id));
  }
  assert.equal(seen.size, 12);
  h.render(people.slice(0, 1), { presentation: 'immersive' });
  assert.equal(h.videos[0].videoTrack.id, 'guest0-camera');
});
test('voice calls enter screen viewing and return to the voice layout when sharing stops', () => {
  const h = harness(); let participants = [participant('Alice', true)];
  const ctx = { callState: 'active', connected: true, activeCall: { isVideo: false, channelId: 'session' },
    get remoteParticipants() { return participants; }, get remoteParticipant() { return participants[0]; } };
  const CallScreen = h.load('src/screens/messages/CallScreen.tsx', {
    '../../theme/useTheme': { themedSheet: () => ({}), useTheme: () => ({}) }, '../../components/RemoteCallMedia': h.media,
    '../../components/SafeArea': { useSafeAreaInsets: () => ({ top: 20, bottom: 10 }) },
    '@react-navigation/native': { useNavigation: () => ({}), useRoute: () => ({ params: { fromContext: true } }) },
    '../../stores/authStore': { useAuthStore: () => ({}) }, '../../contexts/CallContext': { useCallContext: () => ctx },
  }).default;
  const containsMedia = node => !!node && typeof node === 'object' && (Array.isArray(node)
    ? node.some(containsMedia) : node.type === h.media.RemoteCallMedia || containsMedia(node.props?.children));
  assert.equal(containsMedia(CallScreen()), true);
  participants = [participant('Alice')]; assert.equal(containsMedia(CallScreen()), false);
});
