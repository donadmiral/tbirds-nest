const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = id(900), uid = id(901), topic = `live:${sid}:${id(902)}`;
const message = (n, extra = {}) => ({ id: id(n), session_id: sid, body: 'message ' + n, created_at: new Date(1700000000000 + n * 1000).toISOString(), ...extra });
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
const words = value => Array.isArray(value) ? value.map(words).join('') : typeof value === 'string' ? value : value?.props ? words(value.props.children) : '';
function harness({ deferCommands = false } = {}) {
  let cursor = 0, effects = [], slots = [], currentProps = { id: sid, topic, enabled: true, canModerate: true, pinned: null, onChanged() {}, onUpdate(value) { if ('pinned_message' in value) currentProps.pinned = value.pinned_message; } };
  const pages = [], channels = [], commands = [], pendingCommands = [], scrolls = [];
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'Fragment',
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const rn = new Proxy({ StyleSheet: { create: x => x }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }, { get: (target, key) => key in target ? target[key] : key });
  const imports = {
    react, 'react-native': rn, '@react-navigation/native': { useIsFocused: () => true },
    '../theme/useTheme': { useTheme: () => ({ t: { ink: { primary: '#111', secondary: '#666', muted: '#888' }, surface: { sunken: '#eee' } } }) },
    '../stores/authStore': { useAuthStore: read => read({ profile: { id: uid } }) },
    '../../shared/liveDirectory': { isLiveUuid: value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) },
    '../services/liveControlEvents': { subscribeLiveControl: () => () => {} },
    '../services/liveService': { liveObject: object, liveRows: value => Array.isArray(value) ? value : [], liveText: value => typeof value === 'string' ? value : '', liveRequestId: () => id(999),
      liveRpc: () => { const page = deferred(); pages.push(page); return page.promise; }, liveCommand: async (...args) => { commands.push(args); if (deferCommands) { const command = deferred(); pendingCommands.push(command); return command.promise; } return { ok: true }; } },
    '../services/supabase': { supabase: { channel() { const handlers = {}; const channel = { handlers, on(_kind, filter, callback) { handlers[filter.event] = callback; return channel; }, subscribe(callback) { channel.status = callback; return channel; } }; channels.push(channel); return channel; }, removeChannel: async () => {} } },
  };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src/components/LiveChat.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => { if (!(name in imports)) throw Error(name); return imports[name]; }, console, Date, Map, Set, Promise });
  const render = () => { cursor = 0; const tree = module.exports.LiveChat(currentProps); const list = nodes(tree).find(node => node.type === 'FlatList'); list.props.ref.current = { scrollToEnd: options => scrolls.push(options) }; return tree; };
  const settle = async () => { const pending = effects; effects = []; pending.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); };
  const list = () => nodes(render()).find(node => node.type === 'FlatList');
  const button = label => nodes(render()).find(node => node.type === 'TouchableOpacity' && words(node) === label);
  return { render, settle, pages, channels, commands, pendingCommands, scrolls, list, button, props: currentProps, input: () => nodes(render()).find(node => node.type === 'TextInput'), emit(event, payload) { channels.at(-1).handlers[event]({ payload }); }, async start() { render(); await settle(); channels.at(-1).status('SUBSCRIBED'); } };
}

test('native history cannot erase realtime arrivals or resurrect a removed message', async () => {
  const app = harness(); await app.start();
  app.emit('message', message(2)); app.emit('message_removed', { id: id(1) });
  app.pages[0].resolve({ items: [message(1)], next_cursor: null }); await app.settle();
  const rows = app.list().props.data;
  assert.deepEqual(Array.from(rows, row => row.id), [id(1), id(2)]);
  assert.equal(rows[0].removed, true); assert.equal(rows[0].body, ''); assert.equal(rows[1].body, 'message 2');
});

test('native removal stays final after delayed duplicate messages and stale pins', async () => {
  const app = harness(); await app.start(); app.pages[0].resolve({ items: [], next_cursor: null }); await app.settle();
  app.emit('message', message(1)); app.emit('message_removed', { id: id(1) }); app.emit('message', message(1));
  app.emit('pin', { message: message(1) });
  assert.equal(app.list().props.data.length, 1); assert.equal(app.list().props.data[0].removed, true); assert.equal(app.list().props.data[0].body, '');
  assert.equal(app.props.pinned, null);
});

test('native historical removal overrides a previously visible body', async () => {
  const app = harness(); await app.start(); app.emit('message', message(1));
  app.pages[0].resolve({ items: [message(1, { removed: true, body: 'must disappear' })], next_cursor: null }); await app.settle();
  assert.equal(app.list().props.data[0].removed, true); assert.equal(app.list().props.data[0].body, '');
  app.emit('message', message(1)); assert.equal(app.list().props.data[0].body, '');
});

test('native moderation removes the body immediately after server acknowledgement', async () => {
  const app = harness(); await app.start(); app.emit('message', message(1));
  const row = app.list().props.renderItem({ item: app.list().props.data[0] });
  nodes(row).find(node => node.type === 'TouchableOpacity' && words(node) === 'Remove').props.onPress(); await app.settle();
  assert.equal(app.commands[0][0], 'remove_message'); assert.equal(app.list().props.data[0].body, '');
  app.emit('message', message(1)); assert.equal(app.list().props.data[0].removed, true);
});

test('native replay is ordered, bounded and cannot enter another session', async () => {
  const app = harness(); await app.start();
  for (let n = 200; n >= 1; n--) app.emit('message', message(n));
  app.emit('message', message(400, { session_id: id(950) })); app.emit('message', message(500, { id: 'invalid' }));
  const rows = app.list().props.data;
  assert.equal(rows.length, 150); assert.equal(rows[0].id, id(51)); assert.equal(rows.at(-1).id, id(200));
});

test('native chat follows new rows only while reading the latest messages', async () => {
  const app = harness(); await app.start(); app.list().props.onContentSizeChange(); assert.equal(app.scrolls.length, 1);
  app.list().props.onScroll({ nativeEvent: { contentSize: { height: 1000 }, contentOffset: { y: 100 }, layoutMeasurement: { height: 340 } } });
  app.emit('message', message(1)); app.list().props.onContentSizeChange(); assert.equal(app.scrolls.length, 1);
  assert.ok(app.button('Latest messages')); app.button('Latest messages').props.onPress(); assert.equal(app.scrolls.length, 2);
  assert.equal(app.button('Latest messages'), undefined); app.list().props.onContentSizeChange(); assert.equal(app.scrolls.length, 3);
});

test('native earlier messages preserve the reader position instead of jumping to the latest', async () => {
  const app = harness(); await app.start(); app.pages[0].resolve({ items: [message(2)], next_cursor: { id: id(2), created_at: message(2).created_at } }); await app.settle();
  app.button('Earlier messages').props.onPress(); app.pages[1].resolve({ items: [message(1)], next_cursor: null }); await app.settle();
  app.list().props.onContentSizeChange(); assert.equal(app.scrolls.length, 0); assert.ok(app.button('Latest messages'));
  assert.deepEqual(Array.from(app.list().props.data, row => row.id), [id(1), id(2)]);
});

test('native reconnect retains deletion receipts and ignores the removed channel', async () => {
  const app = harness(); await app.start(); app.emit('message_removed', { id: id(1) });
  const old = app.channels[0]; app.button('Refresh').props.onPress(); app.render(); await app.settle();
  old.handlers.message({ payload: message(2) }); assert.equal(app.list().props.data.length, 0);
  app.channels.at(-1).status('SUBSCRIBED'); app.pages.at(-1).resolve({ items: [message(1)], next_cursor: null }); await app.settle();
  assert.equal(app.list().props.data[0].removed, true); assert.equal(app.list().props.data[0].body, '');
});

for (const failure of [false, true]) test('old native command ' + (failure ? 'failure' : 'success') + ' cannot alter the next session draft or unlock its pending send', async () => {
  const app = harness({ deferCommands: true }); await app.start();
  app.input().props.onChangeText('Old room'); app.button('Send').props.onPress();
  app.props.id = id(950); app.props.topic = `live:${id(950)}:${id(951)}`; app.render(); await app.settle();
  app.input().props.onChangeText('New room draft'); app.button('Send').props.onPress();
  assert.equal(app.commands.length, 2); assert.equal(app.button('Send').props.disabled, true);
  if (failure) app.pendingCommands[0].reject(new Error('Old room failure')); else app.pendingCommands[0].resolve({ ok: true });
  await app.settle();
  assert.equal(app.input().props.value, 'New room draft'); assert.equal(app.button('Send').props.disabled, true);
  assert.doesNotMatch(words(app.render()), /Old room failure/);
  app.button('Send').props.onPress(); assert.equal(app.commands.length, 2);
  app.pendingCommands[1].resolve({ ok: true }); await app.settle(); assert.equal(app.input().props.value, '');
});
