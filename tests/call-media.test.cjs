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
  const jsx = (type, props) => ({ type, props });
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
  const render = participants => { if (participants) props = { participants }; cursor = 0; tree = media.RemoteCallMedia(props); };
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
