const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/screens/auth/SetupProfileScreen.tsx'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(ok => { resolve = ok; }); return { promise, resolve }; }
function words(value) {
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return Array.isArray(value) ? value.map(words).join(' ') : words(value.props?.children);
}

function harness({ rpc: customRpc = async () => ({ data: true, error: null }), update: customUpdate = async () => {} } = {}) {
  let owner = 'first-account', cursor = 0, tree, effects = [], nextTimer = 0, disposed = false, lateStateUpdates = 0, refreshes = 0;
  const slots = [], timers = new Map(), calls = [], messages = [], updates = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  const hooks = {
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { if (disposed) lateStateUpdates++; slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const auth = () => ({ session: { user: { id: owner, email: `${owner}@example.invalid`, user_metadata: {} } }, refreshProfile: async () => { refreshes++; } });
  auth.getState = auth;
  function requireMock(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
    if (name === 'react-native') return new Proxy({ Dimensions: { get: () => ({ height: 900 }) }, Platform: { OS: 'ios' } }, { get: (value, key) => value[key] || String(key) });
    if (name === '@expo/vector-icons') return { Feather: 'Feather' };
    if (name === 'react-native-flash-message') return { showMessage: message => messages.push(message) };
    if (name.endsWith('/authStore')) return { useAuthStore: auth };
    if (name.endsWith('/supabase')) return { supabase: { rpc: (name, args) => { calls.push({ name, args }); return customRpc(name, args); }, from() { throw new Error('Username availability must use the reserved-name RPC'); } } };
    if (name.endsWith('/authService')) return { authService: { updateProfile: (...args) => { updates.push(args); return customUpdate(...args); } } };
    if (name.endsWith('/useTheme')) return { themedSheet: fn => fn({ surface: { hairline: '#ddd' } }) };
    if (name.endsWith('/SafeArea')) return { useSafeAreaInsets: () => ({ top: 0 }) };
    throw new Error(`Unhandled import ${name}`);
  }
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: requireMock, setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) });
  const Component = module.exports.default;
  function render() { cursor = 0; tree = Component(); const jobs = effects; effects = []; jobs.forEach(fn => fn()); }
  function nodes() { const all = []; const walk = value => { if (Array.isArray(value)) return value.forEach(walk); if (!value || typeof value !== 'object') return; all.push(value); walk(value.props?.children); }; walk(tree); return all; }
  const button = label => nodes().find(n => n.type === 'TouchableOpacity' && words(n).trim() === label);
  const h = {
    calls, messages, updates, button, render, words: () => words(tree),
    type(placeholder, value, rerender = true) { const input = nodes().find(n => n.type === 'TextInput' && n.props.placeholder === placeholder); assert.ok(input, placeholder); input.props.onChangeText(value); if (rerender) render(); },
    press(label) { const node = button(label); assert.ok(node, label); const result = node.props.onPress(); render(); return result; },
    owner(next, rerender = true) { owner = next; if (rerender) render(); },
    async flush() { for (let i = 0; i < 3; i++) { await settle(); if (!disposed) render(); } },
    async tick() { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(fn => { void fn(); }); await h.flush(); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); disposed = true; },
    get lateStateUpdates() { return lateStateUpdates; }, get refreshes() { return refreshes; },
  };
  render(); return h;
}

test('reserved usernames use the server availability contract and cannot advance onboarding', async () => {
  const h = harness({ rpc: async () => ({ data: false, error: null }) });
  h.type('username', 'ab'); await h.tick(); h.press('Continue');
  assert.equal(h.calls.length, 0); assert.doesNotMatch(h.words(), /Step 2 of 2/);
  h.type('username', 'WATCH'); await h.tick(); h.press('Continue');
  assert.equal(h.calls[0].name, 'is_username_available'); assert.equal(h.calls[0].args.p_username, 'watch');
  assert.match(h.words(), /username is unavailable/); assert.doesNotMatch(h.words(), /Step 2 of 2/); h.dispose();
});

test('availability failure is explicit, blocks Continue, and can retry successfully', async () => {
  let attempts = 0;
  const h = harness({ rpc: async () => ++attempts === 1 ? { data: null, error: Error('offline') } : { data: true, error: null } });
  h.type('username', 'new_creator'); await h.tick(); h.press('Continue');
  assert.match(h.words(), /Availability could not be checked/); assert.doesNotMatch(h.words(), /Step 2 of 2/);
  h.press('Check again'); await h.tick(); assert.equal(h.calls.length, 2); assert.match(h.words(), /Available/);
  h.press('Continue'); assert.match(h.words(), /Step 2 of 2/); h.dispose();
});

test('an older available result cannot override a newer reserved username', async () => {
  const old = deferred();
  const h = harness({ rpc: async (_name, args) => args.p_username === 'first_name' ? old.promise : { data: false, error: null } });
  h.type('username', 'first_name'); await h.tick();
  h.type('username', 'watch'); await h.tick(); old.resolve({ data: true, error: null }); await h.flush();
  assert.match(h.words(), /username is unavailable/); assert.doesNotMatch(h.words(), /Available/);
  h.press('Continue'); assert.doesNotMatch(h.words(), /Step 2 of 2/); h.dispose();
});

test('editing the name immediately invalidates its confirmation before the next effect', async () => {
  const h = harness(); h.type('username', 'new_creator'); await h.tick();
  const previousContinue = h.button('Continue').props.onPress;
  h.type('username', 'watch', false); previousContinue(); h.render(); await h.flush();
  assert.doesNotMatch(h.words(), /Step 2 of 2/); h.dispose();
});

test('account changes and unmounting discard late username results', async () => {
  for (const unmount of [false, true]) {
    const pending = deferred(); const h = harness({ rpc: () => pending.promise });
    h.type('username', 'new_creator'); await h.tick();
    if (unmount) h.dispose(); else h.owner('another-account');
    pending.resolve({ data: true, error: null }); await h.flush();
    if (!unmount) { assert.doesNotMatch(h.words(), /Available/); h.press('Continue'); assert.doesNotMatch(h.words(), /Step 2 of 2/); h.dispose(); }
    assert.equal(h.lateStateUpdates, 0);
  }
});

test('a profile save completing after an account switch cannot refresh or announce success in the new account', async () => {
  const pending = deferred(); const h = harness({ update: () => pending.promise });
  h.type('username', 'new_creator'); await h.tick(); h.press('Continue');
  h.type('First name', 'QA'); h.type('Last name', 'Creator');
  const save = h.press('Join PlatinumCircles'); assert.equal(h.updates[0][0], 'first-account');
  h.owner('another-account'); pending.resolve(); await save; await h.flush();
  assert.equal(h.refreshes, 0); assert.equal(h.messages.some(m => m.type === 'success'), false); h.dispose();
});
