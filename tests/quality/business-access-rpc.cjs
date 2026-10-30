const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function compile(source, requireMock) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: requireMock });
  return module.exports;
}
function deferred() { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; }
const settle = async () => { for (let i = 0; i < 14; i++) await Promise.resolve(); };
function words(value) {
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return Array.isArray(value) ? value.map(words).join(' ') : words(value.props?.children);
}
function harness({ role = 'owner', members = [], rpc: customRpc, session: customSession } = {}) {
  let owner = 'business', cursor = 0, tree, effects = [], networkError = false;
  const slots = [], alerts = [], calls = [], routes = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  const hooks = {
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const auth = selector => selector(auth.getState()); auth.getState = () => ({ session: { user: { id: owner } }, profile: { id: owner, full_name: owner, account_type: 'business' } });
  const info = () => ({ profile: { id: owner }, role, members, devices: [], signins: [] });
  const theme = compile(read('src/constants/tokens/light.ts')).light;
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (networkError) return { data: null, error: Error('offline') };
    const response = customRpc?.(name, args, info());
    if (response !== undefined) return response;
    return { data: name === 'studio_get_business' ? info() : 'SYNTHETIC-ACCESS-CODE', error: null };
  };
  let resource;
  function requireMock(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
    if (name === 'react-native') return new Proxy({ Alert: { alert: (...args) => alerts.push(args) } }, { get: (value, key) => value[key] || String(key) });
    if (name === '@react-navigation/native') return { useNavigation: () => ({ navigate: (...args) => routes.push(args), canGoBack: () => false, goBack() {} }) };
    if (name === '@expo/vector-icons') return { Feather: 'Feather' };
    if (name.endsWith('/authStore')) return { useAuthStore: auth };
    if (name.endsWith('/supabase')) return { supabase: { rpc, from() { throw new Error('Raw business table access is forbidden'); }, auth: { getSession: customSession || (async () => ({ data: { session: { user: { id: owner } } }, error: null })) } } };
    if (name.endsWith('/useTheme')) return { themedSheet: fn => fn(theme), useTheme: () => ({ t: theme, isDark: false }) };
    if (name.endsWith('/SafeArea')) return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 20 }) };
    if (name.endsWith('/StudioLoadError')) return { StudioLoadError: 'StudioLoadError' };
    if (name.endsWith('/useStudioResource')) return resource ?? (resource = compile(read('src/hooks/useStudioResource.ts'), requireMock));
    throw new Error(`Unhandled import ${name}`);
  }
  const Component = compile(read('src/screens/profile/BusinessAccessScreen.tsx'), requireMock).default;
  function render() { cursor = 0; tree = Component(); const jobs = effects; effects = []; jobs.forEach(fn => fn()); }
  function nodes() { const all = []; const walk = value => { if (Array.isArray(value)) return value.forEach(walk); if (!value || typeof value !== 'object') return; all.push(value); walk(value.props?.children); }; walk(tree); return all; }
  const button = label => nodes().find(n => n.type === 'TouchableOpacity' && (n.props.accessibilityLabel === label || words(n).trim() === label));
  const h = { calls, alerts, routes, nodes, button, render, words: () => words(tree), owner(next) { owner = next; render(); }, offline(value) { networkError = value; },
    typeName(value) { nodes().find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Member name').props.onChangeText(value); render(); },
    press(label) { const node = button(label); assert.ok(node, label); assert.equal(!!node.props.disabled, false, `${label} is enabled`); const result = node.props.onPress(); render(); return result; },
    async flush() { for (let i = 0; i < 4; i++) { await settle(); render(); } },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  }; render(); return h;
}

test('business access loads through the protected RPC and shows retry rather than an empty team on failure', async () => {
  const h = harness(); h.offline(true); await h.flush();
  // Retry once with the network unavailable: an existing response must not be
  // mistaken for a successful empty team that allows a first-owner bootstrap.
  const resourceLoad = h.calls.find(c => c.name === 'studio_get_business'); assert.ok(resourceLoad);
  h.owner('new-business'); await h.flush();
  assert.ok(h.nodes().some(n => n.type === 'StudioLoadError' && n.props.message));
  assert.equal(h.button('Create access code'), undefined);
  h.offline(false); await h.nodes().find(n => n.type === 'StudioLoadError').props.onRetry(); await h.flush();
  assert.match(h.words(), /Create your owner code/); assert.ok(h.button('Create access code'));
  assert.ok(h.calls.every(c => c.name === 'studio_get_business')); h.dispose();
});
test('business access rejects another account response and provides an exit into Studio', async () => {
  const h = harness({ rpc: name => name === 'studio_get_business' ? { data: { profile: { id: 'different' }, role: 'owner', members: [], devices: [], signins: [] }, error: null } : undefined });
  await h.flush(); assert.equal(h.button('Create access code'), undefined);
  assert.ok(h.nodes().find(n => n.type === 'StudioLoadError').props.message);
  h.press('Open Studio'); assert.equal(h.routes[0][0], 'Main'); assert.equal(h.routes[0][1].screen, 'Studio'); h.dispose();
});
test('owner bootstrap and later code creation use explicit minimal roles and expected account', async () => {
  for (const members of [[], [{ id: 'owner', role: 'owner', display_name: 'Owner', active: true }]]) {
    const h = harness({ members }); await h.flush(); h.typeName('Teammate'); await h.press('Create access code'); await h.flush();
    const call = h.calls.find(c => c.name === 'studio_create_member');
    assert.equal(call.args.p_expected_user, 'business'); assert.equal(call.args.p_role, members.length ? 'editor' : 'owner');
    assert.match(h.words(), /SYNTHETIC-ACCESS-CODE/); h.press('Dismiss access code'); assert.doesNotMatch(h.words(), /SYNTHETIC-ACCESS-CODE/); h.dispose();
  }
});
test('business code creation serializes double taps and cannot reveal a previous account code', async () => {
  const wait = deferred(); const h = harness({ rpc: name => name === 'studio_create_member' ? wait.promise : undefined });
  await h.flush(); h.typeName('Teammate'); const action = h.button('Create access code').props.onPress; const pending = action(); await action(); await settle();
  assert.equal(h.calls.filter(c => c.name === 'studio_create_member').length, 1);
  h.owner('another-business'); await h.flush(); wait.resolve({ data: 'PREVIOUS-ACCOUNT-SECRET', error: null }); await pending; await h.flush();
  assert.doesNotMatch(h.words(), /PREVIOUS-ACCOUNT-SECRET/); assert.equal(h.alerts.length, 0); h.dispose();
});
test('an Auth switch during the pre-mutation check prevents any business command', async () => {
  const h = harness({ session: async () => ({ data: { session: { user: { id: 'other-business' } } }, error: null }) });
  await h.flush(); h.typeName('Teammate'); await h.press('Create access code'); await h.flush();
  assert.equal(h.calls.some(c => c.name === 'studio_create_member'), false); assert.match(h.alerts[0][1], /account changed/); h.dispose();
});
test('support and admin views cannot issue codes and the last-owner controls are disabled', async () => {
  for (const role of ['support', 'admin']) { const h = harness({ role }); await h.flush(); assert.equal(h.button('Create access code'), undefined); h.dispose(); }
  const h = harness({ members: [{ id: 'owner', role: 'owner', display_name: 'Owner', active: true }] }); await h.flush();
  assert.equal(h.button('Change role').props.disabled, true); assert.equal(h.button('Revoke access').props.disabled, true); h.dispose();
});
