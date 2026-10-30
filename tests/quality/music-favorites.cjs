const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props?.children)] : [];
const words = node => Array.isArray(node) ? node.map(words).join(' ') : typeof node === 'string' ? node : node && typeof node === 'object' ? words(node.props?.children) : '';
function load(file, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, console, setTimeout, clearTimeout, queueMicrotask, ...globals }, { filename: file });
  return exports;
}
function hooks() {
  const slots = [], effects = []; let cursor = 0, dirty = true, tree, renderFn, commit, mounted = true, lateWrites = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { if (!mounted) lateWrites++; const value = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; return slots[index] || (slots[index] = { current: initial }); },
    useEffect(fn, deps) { const index = cursor++, old = slots[index]; if (!same(old?.deps, deps)) { slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = fn(); }); } },
    useCallback(fn, deps) { const index = cursor++, old = slots[index]; if (!same(old?.deps, deps)) slots[index] = { deps, value: fn }; return slots[index].value; },
  };
  react.useLayoutEffect = react.useEffect;
  function render(force = false) { if (!mounted) return tree; if (force) dirty = true; let turns = 0; while (dirty) { assert.ok(++turns < 40); dirty = false; cursor = 0; tree = renderFn(); commit?.(tree); while (effects.length) effects.shift()(); } return tree; }
  return { react, mount(fn, attach) { renderFn = fn; commit = attach; render(); }, render, async flush() { for (let i = 0; i < 7; i++) { await tick(); render(); } }, dispose() { slots.forEach(slot => slot?.cleanup?.()); mounted = false; }, get nodes() { return nodes(tree); }, get lateWrites() { return lateWrites; } };
}
const first = { id: '11111111-1111-4111-8111-111111111111', title: 'First recording', artist: 'Creator', source: 'original', duration_sec: 30, max_excerpt_sec: 30, url: 'https://synthetic.invalid/audio' };
const second = { ...first, id: '22222222-2222-4222-8222-222222222222', title: 'Saved outside browse' };
const ids = count => Array.from({ length: count }, (_, index) => `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
function surface(kind, options = {}) {
  const h = hooks(), timers = new Map(), authListeners = new Set(), nativeListeners = new Set();
  const changes = [], busy = [], writes = [], reads = [], checked = []; let saved = options.saved || [], closed = 0;
  const props = { visible: true, ownerId: 'owner-a', owner: 'owner-a', value: null, use: 'post', isVideo: true, disabled: false, mix: {}, onMixChange() {}, onChange: value => changes.push(value), onClose: () => { closed++; }, onBusyChange: value => busy.push(value), ...options.props };
  const account = { session: { user: { id: 'owner-a' }, access_token: 'owner-a-token' }, profile: { id: 'owner-a' } };
  const client = { auth: { onAuthStateChange(fn) { authListeners.add(fn); return { data: { subscription: { unsubscribe: () => authListeners.delete(fn) } } }; } } };
  const clock = { setTimeout(fn, ms) { const key = {}; timers.set(key, { fn, ms }); return key; }, clearTimeout(key) { timers.delete(key); } };
  const helper = load('shared/soundtrackPicker.ts', clock), soundtrack = load('shared/soundtrack.ts');
  const original = {
    async soundFavorites(owner) { reads.push(owner); return options.read ? options.read(reads.length) : [...saved]; },
    async saveSoundFavorite(id, next, owner) { writes.push({ id, next, owner }); if (options.write) await options.write(id, next, owner); saved = next ? [...saved.filter(item => item !== id), id] : saved.filter(item => item !== id); },
  };
  const get = async (id, use) => { checked.push({ id, use }); if (options.get) return options.get(id, use); return id === second.id ? second : { ...first, id }; };
  const native = { View: 'View', Text: 'Text', TextInput: 'Input', TouchableOpacity: 'button', ActivityIndicator: 'Spinner', Modal: 'Modal', ScrollView: 'ScrollView', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios' }, Keyboard: { dismiss() {} }, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 390 }) };
  const events = new Map(), document = { activeElement: null, hidden: false, visibilityState: 'visible', documentElement: { dataset: {} }, addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); } };
  const audio = { volume: 1, currentTime: 0, pause() {}, play: async () => {} };
  const modules = {
    react: h.react, 'react/jsx-runtime': jsx, 'react-native': native, '@expo/vector-icons': { Feather: 'Icon' }, 'lucide-react': new Proxy({}, { get: (_, key) => key }),
    './OriginalAudioUpload': { OriginalAudioUpload: 'Upload' }, '../services/originalAudioService': original, '@/lib/originalAudio': original,
    '../stores/authStore': { useAuthStore: { getState: () => account, subscribe(fn) { nativeListeners.add(fn); return () => nativeListeners.delete(fn); } } },
    '@/lib/supabase/client': { createClient: () => client }, './stories/storyPanels': { MiniSlider: 'Slider' }, './SafeArea': { SafeAreaView: 'SafeArea' },
    '../services/soundtrackService': { getSoundtrack: get, listSoundtracks: async () => options.rows || [first] }, '@/lib/soundtrack': { getSoundtrack: get, listSoundtracks: async () => options.rows || [first] },
    '../hooks/useSoundtrackPlayer': { useSoundtrackPlayer: () => ({ error: '', retry() {} }) }, './PostSoundtrack': { PostSoundtrack: 'Soundtrack' },
    '../../shared/soundtrack': soundtrack, '../../shared/soundtrackPicker': helper, '../../shared/musicAvailability': { ORIGINAL_AUDIO_ENABLED: true },
    '@/lib/storyAudio': { listStorySounds: async () => options.rows || [first], storyAudioPreview: async draft => options.preview ? options.preview(draft) : first.url },
    './SoundtrackPicker.module.css': { default: {}, __esModule: true }, './StoryStudio.module.css': { default: {}, __esModule: true },
  };
  const source = kind === 'native' ? 'src/components/SoundtrackPicker.tsx' : kind === 'web' ? 'web/components/SoundtrackPicker.tsx' : 'web/components/StoryAudioEditor.tsx';
  const exports = load(source, { ...clock, setInterval: clock.setTimeout, clearInterval: clock.clearTimeout, document, window: document, HTMLElement: class {}, require(name) { assert.ok(name in modules, name); return modules[name]; } });
  const Component = exports.default || exports.StoryAudioEditor;
  h.mount(() => { const node = Component(props); return typeof node?.type === 'function' ? node.type(node.props) : node; }, tree => { const node = nodes(tree).find(item => item.type === 'audio'); if (node) node.props.ref.current = audio; });
  const button = label => { const item = h.nodes.find(node => node.type === 'button' && (node.props['aria-label'] === label || node.props.accessibilityLabel === label || words(node).trim() === label)); assert.ok(item, `button ${label}`); return item; };
  const callback = label => { const node = button(label); return node.props.onPress || node.props.onClick; };
  return { ...h, get nodes() { return h.nodes; }, get lateWrites() { return h.lateWrites; }, writes, reads, checked, changes, busy, props, button, callback,
    press(label) { const node = button(label); assert.ok(!node.props.disabled, `${label} enabled`); const result = callback(label)(); h.render(); return result; },
    get closed() { return closed; }, get listeners() { return authListeners.size + nativeListeners.size; },
    setSaved(value) { saved = value; },
    account(owner) { account.session = owner ? { user: { id: owner }, access_token: `${owner}-token` } : null; account.profile = owner ? { id: owner } : null; for (const fn of nativeListeners) fn(account); for (const fn of authListeners) fn(owner ? 'SIGNED_IN' : 'SIGNED_OUT', account.session); },
    async load() { await h.flush(); for (const [id, timer] of [...timers]) if (timer.ms === 180) { timers.delete(id); timer.fn(); } await h.flush(); },
  };
}

for (const kind of ['native', 'web', 'story']) {
  test(`${kind}: rapid bookmark clicks send one owner-pinned mutation and change UI only on confirmation`, async () => {
    const gate = deferred(), h = surface(kind, { write: () => gate.promise }); await h.load();
    const click = h.callback('Save First recording'); click(); click(); h.render(); await h.flush();
    assert.equal(h.writes.length, 1); assert.equal(h.writes[0].owner, 'owner-a');
    assert.ok(h.button('Save First recording').props.disabled); assert.equal(h.nodes.some(node => node.props?.['aria-label'] === 'Unsave First recording'), false);
    gate.resolve(); await h.flush(); assert.ok(h.button('Unsave First recording')); h.dispose();
  });
  test(`${kind}: lost save response blocks replay until a read reconciles the committed status`, async () => {
    let h, firstWrite = true;
    h = surface(kind, { write: async () => { if (firstWrite) { firstWrite = false; h.setSaved([first.id]); throw Error('response lost after commit'); } } }); await h.load();
    const staleClick = h.callback('Save First recording'); await h.press('Save First recording'); await h.flush();
    staleClick(); await h.flush(); assert.equal(h.writes.length, 1); assert.ok(h.button('Save First recording').props.disabled);
    const retry = kind === 'story' ? 'Check saved status' : 'The saved selection could not be confirmed. Retry to check its status.';
    h.press(retry); await h.load(); assert.equal(h.writes.length, 1, 'status retry must not replay a mutation');
    await h.press('Unsave First recording'); await h.flush(); assert.equal(h.writes.length, 2); assert.equal(h.writes[1].next, false); h.dispose();
  });
  test(`${kind}: A-to-B-to-A before rendering fences a pending favorite completion`, async () => {
    const gate = deferred(), h = surface(kind, { write: () => gate.promise }); await h.load(); h.press('Save First recording');
    h.account('owner-b'); h.account('owner-a'); gate.resolve(); await h.flush();
    assert.equal(h.nodes.some(node => node.props?.['aria-label'] === 'Unsave First recording' || node.props?.accessibilityLabel === 'Unsave First recording'), false);
    assert.equal(h.changes.length, 0); if (kind !== 'story') assert.equal(h.closed, 1);
    h.dispose(); assert.equal(h.listeners, 0);
  });
  test(`${kind}: unmount discards late saved reads and their error callbacks`, async () => {
    const gate = deferred(), h = surface(kind, { read: () => gate.promise }); await h.flush(); h.dispose(); gate.reject(Error('offline')); await h.flush();
    assert.equal(h.lateWrites, 0); assert.equal(h.changes.length, 0); assert.equal(h.listeners, 0);
  });
  test(`${kind}: all 200 valid saved IDs remain available after adding a bookmark`, async () => {
    const existing = ids(199), h = surface(kind, { saved: existing }); await h.load(); await h.press('Save First recording'); await h.flush(); h.press('Saved'); await h.load();
    const checked = new Set(h.checked.map(row => row.id)); assert.equal(checked.size, 200); assert.ok(checked.has(existing.at(-1))); assert.ok(checked.has(first.id)); h.dispose();
  });
}

for (const kind of ['native', 'web']) test(`${kind}: choosing the same sound again rechecks availability and releases its checking state`, async () => {
  const gate = deferred(); let requests = 0;
  const h = surface(kind, { get: () => ++requests === 1 ? first : gate.promise });
  await h.load(); h.press('Choose First recording'); await h.flush();
  assert.equal(requests, 1); assert.ok(!h.button('Use track').props.disabled);
  h.press('Choose First recording'); assert.equal(requests, 2); assert.ok(h.button('Use track').props.disabled);
  gate.resolve(first); await h.flush(); assert.ok(!h.button('Use track').props.disabled);
  h.press('Use track'); h.press('Next'); h.press('Done'); assert.equal(h.changes.length, 1); h.dispose();
});

test('web story Saved resolves an authorized recording outside the browse page', async () => {
  const h = surface('story', { saved: [second.id], rows: [first] }); await h.load(); h.press('Saved'); await h.load();
  assert.ok(h.button('Preview Saved outside browse')); assert.ok(h.checked.some(row => row.id === second.id && row.use === 'story')); h.dispose();
});
test('saved ID parsing preserves all valid preferences and reauthorization runs at most four reads together', async () => {
  const helper = load('shared/soundtrackPicker.ts'), all = ids(200);
  assert.deepEqual(Array.from(helper.savedSoundtrackIds(JSON.stringify(all))), all);
  let active = 0, maximum = 0;
  const rows = await helper.loadSoundtrackChoices('story', '', 'Saved', all, async () => [], async id => {
    active++; maximum = Math.max(maximum, active); await tick(); active--; return { ...first, id };
  });
  assert.equal(rows.length, 200); assert.equal(maximum, 4);
});
test('partial saved authorization preserves usable rows and reports the unresolved count', async () => {
  const helper = load('shared/soundtrackPicker.ts'), unavailable = [];
  const rows = await helper.loadSoundtrackChoices('post', '', 'Saved', [first.id, second.id], async () => [], async id => {
    if (id === second.id) throw Error('rights or transport unavailable'); return first;
  }, count => unavailable.push(count));
  assert.equal(rows.length, 1); assert.equal(rows[0].id, first.id); assert.deepEqual(unavailable, [1]);
});
test('web story selection cannot emit onChange or release a later busy state after unmount', async () => {
  const gate = deferred(), h = surface('story', { preview: () => gate.promise }); await h.load();
  h.press('Use'); assert.deepEqual(h.busy, [true]); h.dispose(); gate.resolve(first.url); await h.flush();
  assert.deepEqual(h.changes, []); assert.deepEqual(h.busy, [true]); assert.equal(h.lateWrites, 0);
});
test('web story account invalidation rejects late preview and selection callbacks', async () => {
  const gate = deferred(), h = surface('story', { preview: () => gate.promise }); await h.load(); h.press('Use');
  h.account('owner-b'); h.account('owner-a'); gate.resolve(first.url); await h.flush();
  assert.deepEqual(h.changes, []); assert.deepEqual(h.busy, [true]); h.dispose();
});

function service(options = {}) {
  const calls = [], listeners = new Set(); let session = { user: { id: 'owner-a' }, access_token: 'captured-owner-token' };
  const client = { auth: { getSession: () => options.session ? options.session() : Promise.resolve({ data: { session }, error: null }), onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; } },
    rpc(name, args) { const call = { name, args }; calls.push(call); return { setHeader(key, value) { call.header = [key, value]; return options.rpc ? options.rpc(name, args) : Promise.resolve({ data: name === 'list_sound_favorites' ? ids(200) : args.p_saved, error: null }); } }; } };
  const helper = load('shared/soundtrackPicker.ts');
  const modules = { '../../shared/soundtrackPicker': helper, '../../shared/originalAudioAvailability': {}, './supabase/client': { createClient: () => client }, '../../shared/musicUpload': {}, '../../shared/originalAudio': {}, './soundtrack': {} };
  const exports = load('web/lib/originalAudio.ts', { require(name) { assert.ok(name in modules, name); return modules[name]; } });
  return { ...exports, client, calls, listeners, auth(owner, event = 'SIGNED_IN') { session = owner ? { user: { id: owner }, access_token: `${owner}-token` } : null; for (const fn of listeners) fn(event, session); } };
}
test('web favorite read/write pin Authorization, preserve all IDs and accept the previous client argument position', async () => {
  const h = service(); assert.equal((await h.soundFavorites(h.client)).length, 200);
  await h.saveSoundFavorite(first.id, true, h.client); await h.saveSoundFavorite(first.id, false, 'owner-a', h.client);
  assert.equal(h.calls.length, 3); assert.ok(h.calls.every(call => call.header[0] === 'Authorization' && call.header[1] === 'Bearer captured-owner-token'));
  await assert.rejects(h.saveSoundFavorite(first.id, true, 'owner-b', h.client), /account/); assert.equal(h.calls.length, 3); assert.equal(h.listeners.size, 0);
});
test('web favorite helpers reject an A-to-B-to-A change during initial session lookup before any RPC', async () => {
  for (const operation of ['read', 'write']) {
    const gate = deferred(), h = service({ session: () => gate.promise });
    const work = operation === 'read' ? h.soundFavorites('owner-a', h.client) : h.saveSoundFavorite(first.id, true, 'owner-a', h.client);
    h.auth('owner-b'); h.auth('owner-a'); gate.resolve({ data: { session: { user: { id: 'owner-a' }, access_token: 'new-token' } }, error: null });
    await assert.rejects(work, /account/); assert.equal(h.calls.length, 0); assert.equal(h.listeners.size, 0);
  }
});
test('legacy client-only favorite helpers reject a stale session and identity round trips observed during lookup', async () => {
  for (const operation of ['read', 'write']) for (const accounts of [['owner-b'], ['owner-b', 'owner-a']]) {
    const gate = deferred(), h = service({ session: () => gate.promise });
    const work = operation === 'read' ? h.soundFavorites(h.client) : h.saveSoundFavorite(first.id, true, h.client);
    accounts.forEach(owner => h.auth(owner));
    gate.resolve({ data: { session: { user: { id: 'owner-a' }, access_token: 'stale-owner-token' } }, error: null });
    await assert.rejects(work, /account/); assert.equal(h.calls.length, 0); assert.equal(h.listeners.size, 0);
  }
});
test('web favorite helpers reject stale completions and malformed or unconfirmed responses', async () => {
  const gate = deferred(), h = service({ rpc: () => gate.promise }); const work = h.saveSoundFavorite(first.id, true, 'owner-a', h.client); await tick();
  h.auth('owner-b'); h.auth('owner-a'); gate.resolve({ data: true, error: null }); await assert.rejects(work, /account/); assert.equal(h.listeners.size, 0);
  const malformed = service({ rpc: async () => ({ data: null, error: null }) });
  await assert.rejects(malformed.soundFavorites('owner-a', malformed.client), /could not load/);
  await assert.rejects(malformed.saveSoundFavorite(first.id, true, 'owner-a', malformed.client), /could not be confirmed/);
  assert.equal(malformed.listeners.size, 0);
  for (const data of [[first.id, 'invalid-id'], ids(201)]) {
    const invalid = service({ rpc: async () => ({ data, error: null }) });
    await assert.rejects(invalid.soundFavorites('owner-a', invalid.client), /could not load/);
    assert.equal(invalid.listeners.size, 0);
  }
});
