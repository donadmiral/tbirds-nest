const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const walk = node => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
const words = node => Array.isArray(node) ? node.map(words).join(' ') : typeof node === 'string' ? node : node && typeof node === 'object' ? words(node.props?.children) : '';
const first = { id: '11111111-1111-4111-8111-111111111111', title: 'Morning', source: 'original', duration_sec: 40, max_excerpt_sec: 5, url: 'https://fixture.invalid/first' };
const second = { id: '22222222-2222-4222-8222-222222222222', title: 'Evening', source: 'library', duration_sec: 60, max_excerpt_sec: 20, url: 'https://fixture.invalid/second' };

function hooks() {
  let cursor = 0, dirty = true, tree, renderFn, mounted = true;
  const slots = [], effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!same(old?.deps, deps)) { slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  function render(force = false) {
    if (!mounted) return tree;
    if (force) dirty = true;
    let n = 0;
    while (dirty) { assert.ok(++n < 50, 'component render settles'); dirty = false; cursor = 0; tree = renderFn(); while (effects.length) effects.shift()(); }
    return tree;
  }
  return { react, mount(fn) { renderFn = fn; return render(); }, render, get nodes() { return walk(tree); },
    async flush() { for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } },
    dispose() { if (mounted) { mounted = false; slots.forEach(slot => slot?.cleanup?.()); } },
  };
}

function picker(options = {}) {
  const h = hooks(), listeners = new Set(), authListeners = new Set(), intervals = new Map();
  const reads = [], writes = [], checks = [], audioEvents = [], loads = [], recordings = [], selected = [], deleted = [];
  let intervalId = 0, availabilityReads = 0, favoritesReads = 0, permissionReads = 0, closed = 0, callState = 'idle';
  let serverSaved = options.saved || [], denied = false;
  let auth = { session: { user: { id: 'owner' }, access_token: 'fixture-owner' }, profile: { id: 'owner' } };
  const props = { visible: true, userId: 'owner', current: null, onClose() { closed++; }, onSelect(value) { selected.push(value); }, onRemove() {}, ...options.props };
  const makeSound = name => ({
    name, status: null,
    setOnPlaybackStatusUpdate(fn) { this.status = fn; },
    async playAsync() { audioEvents.push(['play', name]); await options.play?.(this); },
    async unloadAsync() { audioEvents.push(['unload', name]); await options.unload?.(this); },
  });
  const makeRecording = (name = 'voice-' + (recordings.length + 1)) => {
    const recording = { name, uri: 'file:///cache/' + name + '.m4a', status: null, stops: 0,
      setProgressUpdateInterval() {}, setOnRecordingStatusUpdate(fn) { this.status = fn; }, getURI() { return this.uri; },
      async stopAndUnloadAsync() { this.stops++; audioEvents.push(['stop-recording', name]); return await options.stop?.(this) || { durationMillis: 2500 }; },
    };
    recordings.push(recording); return recording;
  };
  const native = { View: 'View', Text: 'Text', TouchableOpacity: 'Button', Modal: 'Modal', ActivityIndicator: 'Spinner', TextInput: 'Input', ScrollView: 'ScrollView', StyleSheet: { create: value => value }, Platform: { OS: 'ios' }, useWindowDimensions: () => ({ width: 390, height: 844 }), Keyboard: { dismiss() {}, addListener() { return { remove() {} }; } }, AppState: { currentState: 'active', addEventListener(_name, fn) { listeners.add(fn); return { remove() { listeners.delete(fn); } }; } } };
  const mods = {
    react: h.react, 'react/jsx-runtime': { jsx: (type, props) => typeof type === 'function' ? type(props) : { type, props }, jsxs: (type, props) => typeof type === 'function' ? type(props) : { type, props }, Fragment: 'Fragment' },
    'react-native': native, '@expo/vector-icons': { Feather: 'Icon' }, '../../../shared/musicAvailability': { ORIGINAL_AUDIO_ENABLED: true }, '../../../shared/originalAudioAvailability': { ORIGINAL_AUDIO_PREPARING: 'Preparing original audio' },
    '../../../shared/soundtrackPicker': { soundtrackRead: options.boundedRead || (work => work) },
    '../../contexts/CallContext': { useCallContext: () => ({ callState }) }, '../../stores/authStore': { useAuthStore: { getState: () => auth, subscribe(fn) { authListeners.add(fn); return () => authListeners.delete(fn); } } },
    '../AppleMusicSheet': { AppleMusicPicker: 'AppleMusicPicker' }, '../SafeArea': { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) }, './storyPanels': { MiniSlider: 'Slider' }, '../OriginalAudioUpload': { OriginalAudioUpload: 'OriginalAudioUpload' },
    'expo-file-system/legacy': { async deleteAsync(uri) { deleted.push(uri); } },
    '../../services/originalAudioService': {
      async originalAudioReady() { availabilityReads++; return options.ready ? options.ready(availabilityReads) : true; },
      async soundFavorites(owner) { assert.equal(owner, props.userId); favoritesReads++; return options.favorites ? options.favorites(favoritesReads) : [...serverSaved]; },
      async saveSoundFavorite(id, value, owner) { writes.push({ id, value, owner }); if (options.write) await options.write(id, value, owner); serverSaved = value ? [...serverSaved.filter(item => item !== id), id] : serverSaved.filter(item => item !== id); },
    },
    '../../services/storiesService': { storiesService: {
      async listStorySounds(source) { reads.push(source); return (options.rows || [first, second]).filter(row => row.source === source); },
      async getStorySound(id) { checks.push(id); if (denied) throw new Error('This sound is no longer available.'); return options.check ? options.check(id, checks.length) : { ...(id === first.id ? first : second) }; },
    } },
    'expo-av': { Audio: {
      async setAudioModeAsync(mode) { audioEvents.push(['mode', mode]); await options.mode?.(mode); },
      async requestPermissionsAsync() { permissionReads++; return options.permission ? options.permission() : { granted: true }; },
      RecordingOptionsPresets: { HIGH_QUALITY: {} }, Recording: { async createAsync() { audioEvents.push(['create-recording']); return { recording: options.createRecording ? await options.createRecording(makeRecording) : makeRecording() }; } },
      Sound: { async createAsync(source, opts) { const load = { source, opts }; loads.push(load); return { sound: options.load ? await options.load(load, makeSound) : makeSound(source.uri) }; } },
    } },
  };
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/components/stories/MusicSheet.tsx'), 'utf8')), { exports, Error, Date: options.clock ? { now: options.clock } : Date, require(name) { assert.ok(name in mods, name); return mods[name]; }, setInterval(fn, milliseconds) { intervals.set(++intervalId, { fn, milliseconds }); return intervalId; }, clearInterval(id) { intervals.delete(id); } });
  h.mount(() => exports.default(props));
  const button = label => { const found = h.nodes.find(node => node.type === 'Button' && (node.props.accessibilityLabel === label || words(node).trim() === label)); assert.ok(found, 'button ' + label); return found; };
  return { ...h, get nodes() { return h.nodes; }, props, button, reads, writes, checks, audioEvents, loads, recordings, selected, deleted, intervals, makeSound, makeRecording,
    press(label) { const target = button(label); assert.ok(!target.props.disabled, label + ' is enabled'); target.props.onPress(); h.render(); },
    slider(label, value) { const slider = h.nodes.find(node => node.type === 'Slider' && node.props.label === label); assert.ok(slider, label); slider.props.onChange(value); h.render(); },
    checkRights() { for (const task of [...intervals.values()]) task.fn(); },
    deny() { denied = true; }, setSaved(value) { serverSaved = value; },
    update(next) { Object.assign(props, next); h.render(true); },
    account(id) { auth = { session: id ? { user: { id }, access_token: 'fixture-' + id } : null, profile: id ? { id } : null }; for (const listener of authListeners) listener(auth); h.render(); },
    background(state) { native.AppState.currentState = state; for (const listener of listeners) listener(state); h.render(); },
    call(state) { callState = state; h.render(true); },
    get availabilityReads() { return availabilityReads; }, get favoritesReads() { return favoritesReads; }, get permissionReads() { return permissionReads; }, get closed() { return closed; },
  };
}

test('native voiceover capability failure has a real retry without requesting a microphone early', async () => {
  const h = picker({ ready: count => { if (count === 1) throw new Error('Audio service is offline. Retry.'); return true; } });
  await h.flush(); h.press('Record original audio');
  assert.equal(h.button('Record voiceover').props.disabled, true); assert.equal(h.permissionReads, 0);
  h.press('Retry audio availability'); await h.flush();
  assert.equal(h.availabilityReads, 2); assert.equal(h.permissionReads, 0);
  h.press('Record voiceover'); await h.flush(); assert.equal(h.recordings.length, 1);
  h.dispose(); await h.flush(); assert.equal(h.recordings[0].stops, 1); assert.ok(h.deleted.includes(h.recordings[0].uri));
});

test('native bookmarks wait for the confirmed baseline and serialize rapid taps on each sound', async () => {
  const read = deferred(), write = deferred(), h = picker({ favorites: () => read.promise, write: () => write.promise });
  await h.flush(); const initial = h.button('Save Morning'); assert.equal(initial.props.disabled, true); initial.props.onPress(); assert.equal(h.writes.length, 0);
  read.resolve([]); await h.flush(); const press = h.button('Save Morning').props.onPress;
  press(); press(); await h.flush(); assert.equal(h.writes.length, 1); assert.equal(h.writes[0].owner, 'owner');
  assert.equal(h.button('Save Morning').props.disabled, true);
  write.resolve(); await h.flush(); assert.equal(h.button('Unsave Morning').props.disabled, false); h.dispose();
});

test('lost bookmark responses require a status read and the next action uses the recovered value', async () => {
  let failed = false;
  const h = picker({ write: async () => { if (!failed) { failed = true; h.setSaved([first.id]); throw new Error('lost response'); } } });
  await h.flush(); h.press('Save Morning'); await h.flush(); assert.equal(h.writes.length, 1);
  assert.equal(h.button('Save Morning').props.disabled, true); h.press('Retry saved sounds'); await h.flush();
  assert.equal(h.favoritesReads, 2); h.press('Unsave Morning'); await h.flush(); assert.equal(h.writes[1].value, false); assert.equal(h.button('Save Morning').props.disabled, false); h.dispose();
});

test('two independent bookmark completions preserve both values in either order', async () => {
  const one = deferred(), two = deferred(), h = picker({ write: id => (id === first.id ? one : two).promise });
  await h.flush(); h.press('Save Morning'); h.press('Save Evening'); two.resolve(); await h.flush(); one.resolve(); await h.flush();
  assert.equal(h.writes.length, 2); assert.ok(h.button('Unsave Morning')); assert.ok(h.button('Unsave Evening')); h.dispose();
});

test('foreground recovery waits for earlier bookmark writes before reading server status', async () => {
  const write = deferred(), h = picker({ write: () => write.promise });
  await h.flush(); h.press('Save Morning'); h.background('background'); h.background('active'); await h.flush();
  assert.equal(h.favoritesReads, 1, 'an unfinished mutation cannot be overtaken by the recovery read');
  write.resolve(); await h.flush(); assert.equal(h.favoritesReads, 2); assert.ok(h.button('Unsave Morning')); h.dispose();
});

test('Saved reauthorizes bookmarked IDs even when absent from the first browse page', async () => {
  const h = picker({ rows: [], saved: [first.id] }); await h.flush(); h.press('Saved'); await h.flush();
  assert.ok(h.checks.includes(first.id)); assert.ok(h.button('Use Morning'));
  h.deny(); h.press('For you'); await h.flush(); h.press('Saved'); await h.flush();
  assert.ok(h.nodes.some(node => node.props?.accessibilityRole === 'alert' && words(node).includes('could not be checked'))); assert.ok(h.button('Retry')); h.dispose();
});

test('partial Saved failures retain checked rows, expose retry and preserve the attached selection', async () => {
  const gate = deferred(); let recovering = false;
  const attached = { kind: 'sound', soundId: first.id, title: first.title, startSec: 2, durationSec: 3 };
  const h = picker({ saved: [first.id, second.id], props: { current: attached }, check: id => {
    if (id === first.id) return first;
    if (!recovering) throw new Error('temporarily unavailable');
    return gate.promise;
  } });
  await h.flush(); h.press('Saved'); await h.flush();
  assert.ok(h.button('Use Morning')); assert.ok(h.nodes.some(node => node.props?.accessibilityRole === 'alert' && words(node).includes('Some saved sounds')));
  assert.equal(h.nodes.some(node => node.props?.accessibilityLabel === 'Use Evening'), false);
  recovering = true; h.press('Retry sound list'); await h.flush(); assert.ok(h.button('Use Morning'), 'checked rows remain available during retry');
  gate.resolve(second); await h.flush(); assert.ok(h.button('Use Evening'));
  assert.equal(h.selected.length, 0); assert.equal(h.props.current, attached); h.dispose();
});

test('Saved checks at most four rows concurrently and stops scheduling after the picker closes', async () => {
  const ids = Array.from({ length: 12 }, (_, index) => 'sound-' + index), gates = ids.map(() => deferred());
  const h = picker({ saved: ids, check: id => gates[ids.indexOf(id)].promise }); await h.flush(); h.press('Saved'); await h.flush();
  assert.equal(h.checks.length, 4);
  for (let i = 0; i < 4; i++) gates[i].resolve({ ...first, id: ids[i] });
  await h.flush(); assert.equal(h.checks.length, 8);
  h.press('Close sound picker');
  for (let i = 4; i < 8; i++) gates[i].resolve({ ...first, id: ids[i] });
  await h.flush(); assert.equal(h.checks.length, 8); h.dispose();
});

test('one Saved deadline prevents 200 stalled favorites from starting repeated timeout batches', async () => {
  let now = 1000; const waits = [];
  const h = picker({ saved: Array.from({ length: 200 }, (_, index) => 'sound-' + index), clock: () => now,
    check: () => new Promise(() => {}), boundedRead: (_work, milliseconds) => { const gate = deferred(); waits.push({ ...gate, milliseconds }); return gate.promise; },
  });
  await h.flush(); h.press('Saved'); await h.flush(); assert.equal(h.checks.length, 4);
  assert.ok(waits.every(wait => wait.milliseconds > 0 && wait.milliseconds <= 20000));
  now += 20000; waits.forEach(wait => wait.reject(new Error('Music took too long to load. Please retry.'))); await h.flush();
  assert.equal(h.checks.length, 4); assert.equal(h.button('Retry sound list').props.disabled, false); h.dispose();
});

test('a previously rendered Saved control cannot play a sound whose current authorization is denied', async () => {
  const h = picker({ saved: [first.id, second.id] }); await h.flush(); h.press('Saved'); await h.flush();
  const stalePreview = h.button('Preview Morning').props.onPress;
  h.deny(); stalePreview(); await h.flush();
  assert.equal(h.loads.length, 0); assert.ok(h.nodes.some(node => node.props?.accessibilityRole === 'alert' && words(node).includes('no longer available'))); h.dispose();
});

test('only the newest preview can start, including native loads completing out of order', async () => {
  const one = deferred(), two = deferred(), h = picker({ load: load => (load.source.uri === first.url ? one : two).promise });
  await h.flush(); h.press('Preview Morning'); await h.flush(); h.press('Preview Evening'); await h.flush();
  const firstSound = h.makeSound('old'), secondSound = h.makeSound('current');
  one.resolve(firstSound); two.resolve(secondSound); await h.flush();
  assert.deepEqual(h.audioEvents.filter(event => event[0] === 'play'), [['play', 'current']]);
  assert.ok(h.audioEvents.some(event => event[0] === 'unload' && event[1] === 'old')); h.dispose();
});

test('same-frame preview taps retain one request and a second tap cancels a pending preview', async () => {
  const load = deferred(), h = picker({ load: () => load.promise }); await h.flush();
  const firstPress = h.button('Preview Morning').props.onPress, secondPress = h.button('Preview Evening').props.onPress;
  firstPress(); secondPress(); await h.flush(); assert.equal(h.loads.length, 1); assert.equal(h.loads[0].source.uri, second.url);
  h.press('Preview Evening'); load.resolve(h.makeSound('cancelled')); await h.flush();
  assert.equal(h.audioEvents.some(event => event[0] === 'play'), false); h.dispose();
});

test('old native status callbacks and revoked old checks cannot stop a newer preview', async () => {
  const gate = deferred(), sounds = []; let checking = false;
  const h = picker({ check: id => checking && id === first.id ? gate.promise : id === first.id ? first : second,
    load: (load, makeSound) => { const sound = makeSound(load.source.uri); sounds.push(sound); return sound; },
  });
  await h.flush(); h.press('Preview Morning'); await h.flush();
  const oldStatus = sounds[0].status;
  checking = true; h.checkRights(); await h.flush();
  h.press('Preview Evening'); await h.flush(); oldStatus({ isLoaded: true, didJustFinish: true, positionMillis: 5000 }); gate.reject(new Error('old right revoked')); await h.flush();
  assert.equal(h.audioEvents.filter(event => event[0] === 'unload' && event[1] === second.url).length, 0); h.dispose();
});

test('native previews obey current excerpt limits and use the chosen offset', async () => {
  const sounds = [], h = picker({ load: (load, makeSound) => { const sound = makeSound(load.source.uri); sounds.push(sound); return sound; } });
  await h.flush(); h.press('Preview Morning'); await h.flush();
  assert.equal(h.loads[0].opts.isLooping, false); sounds[0].status({ isLoaded: true, positionMillis: 5000 }); await h.flush();
  assert.ok(h.audioEvents.some(event => event[0] === 'unload'));
  h.press('Use Morning'); await h.flush(); h.slider('Music excerpt start', 120); h.press('Preview excerpt'); await h.flush();
  assert.equal(h.loads.at(-1).opts.positionMillis, 12000); h.press('Use excerpt'); await h.flush();
  assert.equal(h.selected[0].startSec, 12); assert.equal(h.selected[0].durationSec, 5); assert.equal(h.selected[0].url, undefined); h.dispose();
});

test('shrunk excerpt rights and warmed-cache revocation prevent playback and attachment', async () => {
  let limit = 5;
  const h = picker({ check: () => ({ ...first, max_excerpt_sec: limit }) }); await h.flush(); h.press('Use Morning'); await h.flush(); limit = 2;
  h.press('Preview excerpt'); await h.flush(); assert.equal(h.loads.length, 0);
  h.press('Use excerpt'); await h.flush(); assert.equal(h.selected.length, 0);
  h.press('Cancel'); h.press('Preview Morning'); await h.flush(); h.deny(); h.checkRights(); await h.flush();
  assert.ok(h.audioEvents.some(event => event[0] === 'unload')); assert.equal(h.intervals.size, 0); h.dispose();
});

test('backgrounding cancels pending microphone permission even after foreground return', async () => {
  const permission = deferred(), h = picker({ permission: () => permission.promise }); await h.flush(); h.press('Record original audio'); h.press('Record voiceover'); await h.flush();
  h.background('inactive'); h.background('background'); h.background('active'); await h.flush();
  assert.equal(h.button('Record voiceover').props.disabled, true, 'pending native permission retains its lock');
  permission.resolve({ granted: true }); await h.flush(); assert.equal(h.recordings.length, 0); assert.equal(h.button('Record voiceover').props.disabled, false); h.dispose();
});

test('a call cancels a late native recorder and prevents a replacement until it is released', async () => {
  const creation = deferred(), h = picker({ createRecording: () => creation.promise }); await h.flush(); h.press('Record original audio'); h.press('Record voiceover'); await h.flush();
  h.call('ringing'); h.call('idle'); await h.flush(); assert.equal(h.button('Record voiceover').props.disabled, true);
  const recording = h.makeRecording('interrupted'); creation.resolve(recording); await h.flush();
  assert.equal(recording.stops, 1); assert.ok(h.deleted.includes(recording.uri)); assert.equal(h.button('Record voiceover').props.disabled, false); h.dispose();
});

test('preview and microphone mode changes are serialized and call interruption keeps the call audio session', async () => {
  const gate = deferred(); let block = true;
  const h = picker({ mode: mode => { if (block && mode.allowsRecordingIOS === false) { block = false; return gate.promise; } } });
  await h.flush(); h.press('Preview Morning'); await h.flush(); h.press('Record original audio'); h.press('Record voiceover'); await h.flush();
  assert.equal(h.permissionReads, 1); assert.equal(h.recordings.length, 0, 'record mode waits for the earlier preview mode');
  gate.resolve(); await h.flush(); assert.equal(h.recordings.length, 1);
  const before = h.audioEvents.length; h.call('connected'); await h.flush();
  assert.equal(h.audioEvents.slice(before).some(event => event[0] === 'mode'), false, 'music cleanup does not replace the live call category');
  h.dispose(); await h.flush();
});

test('inactive followed by background preserves a completed voiceover without autoplay', async () => {
  const stop = deferred(), h = picker({ stop: () => stop.promise }); await h.flush(); h.press('Record original audio'); h.press('Record voiceover'); await h.flush();
  h.background('inactive'); h.background('background'); stop.resolve({ durationMillis: 2200 }); await h.flush(); h.background('active'); await h.flush();
  assert.ok(h.nodes.some(node => words(node) === 'Voiceover ready · 0:02')); assert.equal(h.recordings[0].stops, 1);
  assert.equal(h.audioEvents.some(event => event[0] === 'play'), false);
  assert.equal(h.button('Use voiceover').props.disabled, true);
  h.press('I own this recording and have permission from everyone featured to publish it.'); h.press('Use voiceover'); await h.flush();
  assert.equal(h.selected.length, 1); assert.equal(h.selected[0].rightsAttested, true); h.dispose(); await h.flush();
  assert.equal(h.deleted.includes(h.recordings[0].uri), false, 'the composer owns the selected recording');
});

test('account changes invalidate late selections and previews even when the original account returns', async () => {
  const gate = deferred(), h = picker({ check: () => gate.promise }); await h.flush(); h.press('Use Morning'); await h.flush();
  h.account('other'); h.account('owner'); gate.resolve(first); await h.flush();
  assert.equal(h.closed, 1); assert.equal(h.selected.length, 0); assert.equal(h.nodes.some(node => words(node) === 'Choose your excerpt'), false); h.dispose();
});

test('disabling the sheet stops playback and closes the pending operation immediately', async () => {
  const h = picker(); await h.flush(); h.press('Preview Morning'); await h.flush(); h.update({ disabled: true }); await h.flush();
  assert.ok(h.audioEvents.some(event => event[0] === 'unload')); assert.equal(h.intervals.size, 0);
  h.update({ disabled: false }); await h.flush(); h.press('Preview Morning'); await h.flush(); h.press('Close sound picker'); await h.flush();
  assert.equal(h.closed, 1); assert.equal(h.intervals.size, 0); h.dispose();
});

test('pending stop cannot reset the audio session after a newer recording starts', async () => {
  const stop = deferred(); let pending = true;
  const h = picker({ stop: () => pending ? stop.promise : { durationMillis: 2300 } });
  await h.flush(); h.press('Record original audio'); h.press('Record voiceover'); await h.flush(); h.press('Stop recording');
  h.call('ringing'); h.call('idle'); await h.flush(); assert.equal(h.button('Record voiceover').props.disabled, true);
  pending = false; stop.resolve({ durationMillis: 2300 }); await h.flush(); h.press('Record voiceover'); await h.flush();
  const lastCreate = h.audioEvents.findLastIndex(event => event[0] === 'create-recording');
  assert.equal(h.audioEvents.slice(lastCreate + 1).some(event => event[0] === 'mode' && event[1].allowsRecordingIOS === false), false);
  h.dispose(); await h.flush();
});

test('native saved-sound reads and mutations pin the initiating session and reject a mismatched owner', async () => {
  const calls = [], session = { user: { id: 'owner' }, access_token: 'fixture-owner-token' };
  const supabase = { auth: { getSession: async () => ({ data: { session }, error: null }) }, rpc(name, args) { const call = { name, args }; calls.push(call); return { setHeader(key, value) { call.header = [key, value]; return Promise.resolve({ data: [first.id], error: null }); } }; } };
  const mods = { '../../shared/soundtrackPicker': { soundtrackRead: promise => promise }, '../../shared/originalAudioAvailability': {}, 'expo-file-system/legacy': {}, 'expo-crypto': {}, 'base64-arraybuffer': {}, './supabase': { supabase }, '../../shared/musicUpload': {}, '../../shared/originalAudio': {}, './soundtrackService': {} };
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/services/originalAudioService.ts'), 'utf8')), { exports, require(name) { assert.ok(name in mods, name); return mods[name]; } });
  await exports.saveSoundFavorite(first.id, true, 'owner'); assert.equal(calls.length, 1); assert.deepEqual(Array.from(calls[0].header), ['Authorization', 'Bearer fixture-owner-token']);
  await assert.rejects(exports.saveSoundFavorite(first.id, false, 'other'), /account/); assert.equal(calls.length, 1);
  const ids = await exports.soundFavorites('owner'); assert.deepEqual(Array.from(ids), [first.id]);
  assert.equal(calls[1].name, 'list_sound_favorites'); assert.deepEqual(Array.from(calls[1].header), ['Authorization', 'Bearer fixture-owner-token']);
  await assert.rejects(exports.soundFavorites('other'), /account/); assert.equal(calls.length, 2);
});
