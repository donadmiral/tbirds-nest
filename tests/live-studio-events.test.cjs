const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
function load(file, imports) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require(name) { if (name in imports) return imports[name]; throw Error(name); } });
  return module.exports;
}
function studioHarness() {
  let reference, dependencies, cleanup, callback, subscriptions = 0, removals = 0;
  const react = {
    useRef(value) { reference ??= { current: value }; return reference; },
    useEffect(fn, next) { if (dependencies && dependencies.every((x, i) => x === next[i])) return; cleanup?.(); dependencies = next; cleanup = fn(); },
  };
  const { useLiveStudioEvents } = load('src/hooks/useLiveStudioEvents.ts', { react, '../services/liveControlEvents': {
    subscribeLiveControl(id, owner, listener) { subscriptions++; callback = listener; return () => { removals++; }; },
  } });
  return { render: useLiveStudioEvents, emit: type => callback?.(type, {}), unmount: () => cleanup?.(), counts: () => ({ subscriptions, removals }), callback: () => callback };
}
test('studio receives confirmed lifecycle and access changes without opening Chat', () => {
  const h = studioHarness(); let changes = 0;
  h.render('session', 'owner', () => changes++);
  h.emit('session'); h.emit('access_changed'); h.emit('warning');
  assert.equal(changes, 2); assert.deepEqual(h.counts(), { subscriptions: 1, removals: 0 });
});
test('studio uses the newest refresh callback without resubscribing on render', () => {
  const h = studioHarness(); let old = 0, current = 0;
  h.render('session', 'owner', () => old++);
  h.render('session', 'owner', () => current++); h.emit('session');
  assert.equal(old, 0); assert.equal(current, 1); assert.equal(h.counts().subscriptions, 1);
});
test('changing account or leaving studio releases the subscription and rejects stale events', () => {
  const h = studioHarness(); let changes = 0;
  h.render('session', 'owner', () => changes++); const stale = h.callback();
  h.render('session', 'other-owner', () => changes++); stale('session', {});
  assert.equal(changes, 0); h.emit('session'); assert.equal(changes, 1);
  h.unmount(); h.emit('access_changed'); assert.equal(changes, 1);
  assert.deepEqual(h.counts(), { subscriptions: 2, removals: 2 });
});
test('signed-out studio opens no event subscription', () => {
  const h = studioHarness(); h.render('session', null, () => {}); assert.equal(h.counts().subscriptions, 0);
});
const media = load('src/components/RemoteCallMedia.tsx', { react: {}, 'react-native': { StyleSheet: { create: x => x } }, '@daily-co/react-native-daily-js': {} });
test('preview renders local video but never loops local microphone or screen audio', () => {
  const track = {}, p = { local: true, tracks: { video: { state: 'playable', track }, audio: { state: 'playable', track }, screenAudio: { state: 'playable', track } } };
  assert.equal(media.playableCallTrack(p, 'video'), track);
  assert.equal(media.audibleCallTrack(p, 'audio'), null);
  assert.equal(media.audibleCallTrack(p, 'screenAudio'), null);
});
test('remote playable audio remains audible and blocked audio remains suppressed', () => {
  const track = {}, p = { local: false, tracks: { audio: { state: 'playable', track }, screenAudio: { state: 'blocked', persistentTrack: track } } };
  assert.equal(media.audibleCallTrack(p, 'audio'), track);
  assert.equal(media.audibleCallTrack(p, 'screenAudio'), null);
});
