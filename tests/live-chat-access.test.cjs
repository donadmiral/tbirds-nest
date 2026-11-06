const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
function hooks() {
  let cursor = 0, pending = [], layouts = [], slots = [];
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const jsx = (type, props) => ({ type, props: props || {} });
  const react = {
    Fragment: 'Fragment',
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn, deps) { const i = cursor++, previous = slots[i]; if (!same(previous?.deps, deps)) { slots[i] = { deps }; pending.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
    useLayoutEffect(fn, deps) { const i = cursor++; if (!same(slots[i], deps)) { slots[i] = deps; layouts.push(fn); } },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
  };
  return { react, runtime: { jsx, jsxs: jsx, Fragment: 'Fragment' },
    render(component, props) { cursor = 0; return component(props); },
    async settle() { const work = [...layouts, ...pending]; layouts = []; pending = []; work.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); },
  };
}
function load(file, imports, runtime = {}, context = {}) {
  const module = { exports: {} };
  let requestSequence = 0;
  const built = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, reportDiagnostics: true,
  });
  assert.equal((built.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, file);
  vm.runInNewContext(built.outputText, { module, exports: module.exports, console, URL, Date, Promise, Error, setTimeout, clearTimeout,
    crypto: { randomUUID: () => 'request-' + (++requestSequence) }, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }, ...context,
    require(name) { if (name === 'react/jsx-runtime') return runtime; if (name in imports) return imports[name]; throw Error('Unexpected import ' + name + ' in ' + file); },
  });
  return module.exports;
}
function nodes(value) { if (!value || typeof value !== 'object') return []; if (Array.isArray(value)) return value.flatMap(nodes); return [value, ...nodes(value.props?.children)]; }
const textContent = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(textContent).join('') : textContent(value?.props?.children ?? '');
const find = (tree, key, value) => nodes(tree).find(node => node.props?.[key] === value);
const directory = load('shared/liveDirectory.ts', {});
const sid = '11111111-1111-4111-8111-111111111111', uid = '22222222-2222-4222-8222-222222222222';
function detail({ role = 'viewer', mode = 'open', state = 'live', capability = true, topic = '' } = {}) {
  const session = directory.parseLiveSession({ id: sid, state, title: 'QA conversation', chat_mode: mode, audience: 'public', host: { id: uid, full_name: 'Host' } });
  assert.ok(session);
  return { session, role, capabilities: { chat: capability }, chat_topic: topic, pinned_message: null };
}
function web(options = {}) {
  const h = hooks(), calls = [], channels = [], events = [], pendingCommands = [];
  let current = detail(options), owner = uid, reject = false;
  const listeners = new Map(), document = { visibilityState: 'visible', addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); } };
  const client = { channel() { const channel = { handlers: {}, on(_type, filter, callback) { channel.handlers[filter.event] = callback; return channel; }, subscribe(callback) { channel.status = callback; return channel; } }; channels.push(channel); return channel; }, removeChannel: async () => {} };
  const callbacks = { onRefresh() { events.push('refresh'); }, onPatch() { events.push('patch'); }, onInteraction() { events.push('interaction'); }, onInteractionCounts() { events.push('counts'); } };
  const api = {
    getLiveMessages: async () => ({ items: [], cursor: null }), mergeLiveMessages: (before, after) => [...before, ...after], parseLiveMessage: value => value || null, record: object,
    liveError: error => error.message,
    liveCommand: async (...args) => { calls.push(args); if (reject) throw Error('Temporary request failure'); if (options.deferCommands) return new Promise(resolve => pendingCommands.push(resolve)); return { ok: true }; },
  };
  const component = load('web/components/LiveChat.tsx', {
    react: h.react, 'lucide-react': { Heart: 'Heart', Flag: 'Flag', Pin: 'Pin', Send: 'Send', Trash2: 'Trash2' }, '@/lib/liveApi': api,
  }, h.runtime, { document }).LiveChat;
  const render = () => h.render(component, { client, detail: current, ownerId: owner, ...callbacks });
  return { h, calls, channels, events, pendingCommands, render, update: options => { current = detail(options); }, owner: value => { owner = value; }, visibility: value => { document.visibilityState = value; listeners.get('visibilitychange')?.(); }, reject: value => { reject = value; } };
}
function native(options = {}) {
  const h = hooks(), childHooks = hooks(), current = detail(options), reads = [], channels = [];
  const raw = { role: current.role, capabilities: current.capabilities, chat_topic: options.actualChat ? `live:${sid}:${uid}` : '', pinned_message: options.pinned || null };
  const theme = { ink: { primary: '#111', secondary: '#666', muted: '#888' }, surface: { raised: '#fff', sunken: '#eee' } };
  const rn = new Proxy({ StyleSheet: { create: value => value, absoluteFill: {} }, Keyboard: { isVisible:()=>false,addListener:()=>({remove(){}}),dismiss(){} }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }, { get: (target, key) => key in target ? target[key] : key });
  const nativeChat = options.actualChat ? load('src/components/LiveChat.tsx', {
    react: childHooks.react, 'react-native': rn, '@react-navigation/native': { useIsFocused: () => true },
    '../theme/useTheme': { useTheme: () => ({ t: theme }) }, '../stores/authStore': { useAuthStore: read => read({ profile: { id: uid } }) },
    '../../shared/liveDirectory': directory, '../utils/profileRead':{profileRead:x=>x},'../services/liveControlEvents': { subscribeLiveControl: () => () => {} },
    '../services/liveService': { liveObject: object, liveText: value => typeof value === 'string' ? value : '', liveRows: value => Array.isArray(value) ? value : [], liveRpc: async () => ({ items: [], next_cursor: null }) },
    '../services/supabase': { supabase: { channel() { const channel = { handlers: {}, on(_type, filter, callback) { channel.handlers[filter.event] = callback; return channel; }, subscribe(callback) { channel.status = callback; return channel; } }; channels.push(channel); return channel; }, removeChannel: async () => {} } },
  }, childHooks.runtime).LiveChat : 'NativeLiveChat';
  const component = load('src/screens/feed/LiveSessionScreen.tsx', {
    react: h.react, 'react-native': rn, '@react-navigation/native': { useFocusEffect() {} }, 'expo-video': { VideoView: 'VideoView' }, 'expo-linear-gradient': {LinearGradient:'LinearGradient'}, '@expo/vector-icons': { Feather: 'Feather' },
    '../../components/SafeArea': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets:()=>({top:44,bottom:34,left:0,right:0}) }, '../../theme/useTheme': { useTheme: () => ({ t: theme }) }, '../../stores/authStore': { useAuthStore: read => read({ profile: { id: uid } }) },
    '../../contexts/LivePlaybackContext': { useLivePlayback: () => ({ session: null, open:async()=>{}, close(){}, expand(){}, minimize(){} }) }, '../../components/LiveHostFollow':{LiveHostFollow:'LiveHostFollow'}, '../../components/LiveStudio': { LiveStudio: 'LiveStudio' }, '../../components/LiveUi': { LiveIcon: 'LiveIcon' },
    '../../components/LiveChat': { LiveChat: nativeChat }, '../../components/LiveInteractions': { LiveInteractions: 'LiveInteractions', LiveAnalytics: 'LiveAnalytics' },
    '../../services/liveService': { liveObject: object, liveText: value => typeof value === 'string' ? value : '', liveRows: value => Array.isArray(value) ? value : [], loadLiveSession: () => options.deferDetails ? new Promise(resolve => reads.push({ resolve })) : Promise.resolve({ session: current.session, raw }) },
    '../../../shared/liveDirectory': directory, '../../services/supabase': {}, '../../utils/profileRead': {},
  }, h.runtime).default;
  const render = () => h.render(component, { route: { params: { sessionId: sid } }, navigation: { goBack() {}, navigate() {} } });
  const chat = () => nodes(render()).find(node => node.type === nativeChat);
  const renderChild = () => childHooks.render(nativeChat, chat().props);
  return { h, render, reads, chat, renderChild,
    async startChild() { renderChild(); await childHooks.settle(); channels.at(-1).status('SUBSCRIBED'); await childHooks.settle(); },
    childStatus(value) { channels.at(-1).status(value); }, emitChild(event, payload) { channels.at(-1).handlers[event]({ payload }); },
    async resolveDetail(index, pin, patch = {}) { reads[index].resolve({ session: current.session, raw: { ...raw, pinned_message: pin, ...patch } }); await h.settle(); },
  };
}

test('web closed chat blocks a viewer submit and preserves the draft and failed request for reopening', async () => {
  const app = web(); app.render(); await app.h.settle();
  find(app.render(), 'aria-label', 'Message the live chat').props.onChange({ target: { value: 'Keep this draft' } });
  app.reject(true);
  await nodes(app.render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(app.calls.length, 1);
  app.update({ mode: 'closed' });
  let tree = app.render();
  assert.equal(find(tree, 'aria-label', 'Message the live chat').props.disabled, true);
  assert.equal(find(tree, 'aria-label', 'Message the live chat').props.placeholder, 'Chat is closed');
  assert.equal(find(tree, 'aria-label', 'Message the live chat').props.value, 'Keep this draft');
  assert.equal(find(tree, 'aria-label', 'Send chat message').props.disabled, true);
  await nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(app.calls.length, 1, 'closed UI does not issue another command');
  app.update({ mode: 'open' }); app.reject(false); tree = app.render();
  assert.equal(find(tree, 'aria-label', 'Message the live chat').props.disabled, false);
  assert.equal(find(tree, 'aria-label', 'Send chat message').props.disabled, false);
  await nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[1][2], 'chat'); assert.equal(app.calls[1][3].body, 'Keep this draft');
  assert.equal(app.calls[1][4], app.calls[0][4], 'reopening preserves the original failed request identity');
  assert.equal(find(app.render(), 'aria-label', 'Message the live chat').props.value, '');
});

for (const options of [
  { role: 'host', mode: 'closed', allowed: true }, { role: 'producer', mode: 'closed', allowed: true }, { role: 'moderator', mode: 'closed', allowed: true },
  { role: 'viewer', mode: 'closed', allowed: false }, { role: 'guest', mode: 'closed', allowed: false }, { role: 'camera', mode: 'closed', allowed: false },
  { role: 'host', mode: 'closed', capability: false, allowed: false }, { role: 'host', state: 'ended', allowed: false }, { role: 'viewer', state: 'scheduled', allowed: false },
  { role: 'viewer', mode: 'open', allowed: true }, { role: 'viewer', state: 'reconnecting', allowed: true },
]) {
  test('web and native honor existing chat access: ' + JSON.stringify(options), async () => {
    const browser = web(options);
    assert.equal(find(browser.render(), 'aria-label', 'Message the live chat').props.disabled, !options.allowed);
    const app = native(options); app.render(); await app.h.settle();
    assert.equal(app.chat().props.enabled, options.allowed);
  });
}

test('native chat follows realtime close and reopen without changing moderation authority', async () => {
  const app = native(); app.render(); await app.h.settle();
  assert.equal(app.chat().props.enabled, true); assert.equal(app.chat().props.canModerate, false);
  app.chat().props.onUpdate({ session: { chat_mode: 'closed' } });
  assert.equal(app.chat().props.enabled, false);
  app.chat().props.onUpdate({ session: { chat_mode: 'open' } });
  assert.equal(app.chat().props.enabled, true); assert.equal(app.chat().props.canModerate, false);
});

const nativePin = value => ({ id: '33333333-3333-4333-8333-' + String(['old pin', 'replacement', 'canonical pin', 'current pin'].indexOf(value) + 1).padStart(12, '0'), body: value, session_id: sid });
for (const incoming of [nativePin('replacement'), null]) test('native canonical detail cannot overwrite a newer realtime ' + (incoming ? 'pin' : 'unpin'), async () => {
  const app = native({ deferDetails: true }); app.render(); await app.h.settle();
  await app.resolveDetail(0, nativePin('old pin'));
  app.chat().props.onChanged();
  app.chat().props.onUpdate({ pinned_message: incoming });
  assert.equal(app.chat().props.pinned, incoming);
  await app.resolveDetail(1, nativePin('old pin'), { capabilities: { chat: false } });
  assert.equal(app.chat().props.pinned, incoming, 'The response must preserve pin events received after this read started');
  assert.equal(app.chat().props.enabled, false, 'Other canonical detail fields still apply');
});

for (const canonical of [nativePin('replacement'), null]) test('native canonical detail still applies a missed ' + (canonical ? 'pin' : 'unpin') + ' when no newer pin event arrived', async () => {
  const app = native({ deferDetails: true }); app.render(); await app.h.settle();
  await app.resolveDetail(0, nativePin('old pin'));
  app.chat().props.onChanged(); await app.resolveDetail(1, canonical);
  assert.equal(app.chat().props.pinned, canonical);
});

test('native non-pin patches do not suppress canonical pin reconciliation', async () => {
  const app = native({ deferDetails: true }); app.render(); await app.h.settle();
  await app.resolveDetail(0, nativePin('old pin'));
  app.chat().props.onChanged(); app.chat().props.onUpdate({ session: { chat_mode: 'closed' } });
  const canonical = nativePin('canonical pin'); await app.resolveDetail(1, canonical);
  assert.equal(app.chat().props.pinned, canonical);
});

test('native a later detail read reconciles pins after an earlier realtime update', async () => {
  const app = native({ deferDetails: true }); app.render(); await app.h.settle();
  await app.resolveDetail(0, nativePin('old pin'));
  app.chat().props.onUpdate({ pinned_message: nativePin('current pin') });
  app.chat().props.onChanged(); await app.resolveDetail(1, null);
  assert.equal(app.chat().props.pinned, null);
});

for (const removedTarget of ['old pin', 'replacement']) test('native reconnect applies a missed pin while respecting removal of ' + removedTarget, async () => {
  const app = native({ deferDetails: true, actualChat: true }); app.render(); await app.h.settle();
  await app.resolveDetail(0, nativePin('old pin')); await app.startChild();
  app.childStatus('CHANNEL_ERROR'); app.childStatus('SUBSCRIBED'); assert.equal(app.reads.length, 2);
  app.emitChild('message_removed', { id: nativePin(removedTarget).id });
  const canonical = nativePin('replacement'); await app.resolveDetail(1, canonical);
  const expected = removedTarget === 'replacement' ? null : canonical;
  assert.equal(app.chat().props.pinned, expected, 'A removal only invalidates that message, not a different missed pin');
  assert.equal(nodes(app.renderChild()).some(node => node.type === 'Text' && textContent(node).includes(canonical.body)), expected !== null);
});

test('retired web chat and control callbacks cannot update a replacement subscription', async () => {
  const app = web({ topic: `live:${sid}:${uid}` }); app.render(); await app.h.settle();
  const oldChat = app.channels[0], oldControl = app.channels[1];
  app.visibility('hidden'); app.visibility('visible');
  assert.equal(app.channels.length, 4);
  const count = app.events.length;
  oldChat.handlers.interaction({ payload: {} }); oldChat.handlers.session({ payload: {} });
  oldControl.handlers.session({ payload: {} }); oldControl.handlers.access_changed({ payload: { user_id: uid } });
  oldChat.handlers.warning({ payload: { reason: 'Retired connection warning' } }); oldChat.status('CHANNEL_ERROR');
  assert.equal(app.events.length, count);
  assert.equal(find(app.render(), 'role', 'alert'), undefined);
  app.channels[2].handlers.interaction({ payload: {} }); assert.equal(app.events.at(-1), 'interaction');
});

test('web owner reset releases busy state and an old send cannot clear the new owner draft', async () => {
  const app = web({ deferCommands: true }); app.render(); await app.h.settle();
  find(app.render(), 'aria-label', 'Message the live chat').props.onChange({ target: { value: 'Old draft' } });
  const old = nodes(app.render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  app.owner('33333333-3333-4333-8333-333333333333'); app.render(); await app.h.settle();
  find(app.render(), 'aria-label', 'Message the live chat').props.onChange({ target: { value: 'New owner draft' } });
  assert.equal(find(app.render(), 'aria-label', 'Send chat message').props.disabled, false);
  const next = nodes(app.render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  app.pendingCommands[0]({ ok: true }); await old;
  assert.equal(find(app.render(), 'aria-label', 'Message the live chat').props.value, 'New owner draft');
  assert.equal(find(app.render(), 'aria-label', 'Send chat message').props.disabled, true);
  app.pendingCommands[1]({ ok: true }); await next;
  assert.equal(find(app.render(), 'aria-label', 'Message the live chat').props.value, '');
});
