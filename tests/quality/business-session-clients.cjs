// Actual native screens + device/session service, with deferred Auth and native
// storage adapters. No provider, email, hosted account or physical device is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID, randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = (file, requireMock, environment = {}) => {
  const exports = {};
  const source = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, require: requireMock, Error, AbortController, Uint8Array, queueMicrotask, ...environment }, { filename: file });
  return exports;
};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const words = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(words).join(' ') : words(node?.props?.children || '');
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const personalId = '11111111-1111-4111-8111-111111111111';
const businessId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const device = { device_id: '44444444-4444-4444-8444-444444444444', device_key: 'ad'.repeat(32) };
const bound = { business_id: businessId, member_id: memberId, role: 'owner', session: { access_token: 'synthetic-bound-access-token-only', refresh_token: 'synthetic-bound-refresh-token-only' } };
const application = { id: '55555555-5555-4555-8555-555555555555', company_name: 'Example Studio', status: 'approved', decision_reason: null, created_at: '2026-10-30T10:00:00Z' };
const ownedBusiness = { business_id: businessId, full_name: 'Example Studio', username: 'example_studio', avatar_url: null, role: 'owner', category: 'Media', is_verified: true, member_count: 2, post_count: 3 };
const rejected = code => ({ data: null, error: { context: { json: async () => ({ code, error: 'Private provider detail must not appear' }) } } });

function harness(options = {}) {
  let viewer = options.viewer === undefined ? personalId : options.viewer, accessToken = 'synthetic-personal-access-token', callback;
  let tree, cursor = 0, mounted = true, effects = [], stateWrites = 0, timerId = 0;
  const slots = [], timers = new Map(), storage = new Map();
  const calls = { invokes: [], sessions: [], reads: [], inserts: [], checks: [], routes: [], alerts: [], storageWrites: [], randomBytes: 0, randomUUID: 0, unsubscribes: 0 };
  if (!options.emptyStorage) storage.set('pc.business-device.v2', options.savedDevice ?? JSON.stringify(device));
  const selected = () => viewer ? { user: { id: viewer }, access_token: accessToken } : null;
  let getUser = token => ({ data: { user: token ? { id: businessId } : viewer ? { id: viewer } : null }, error: null });
  let getSession = () => ({ data: { session: selected() }, error: null });
  let invoke = () => ({ data: bound, error: null });
  let install = tokens => { viewer = businessId; accessToken = tokens.access_token; const session = selected(); callback?.('SIGNED_IN', session); return { data: { user: session.user, session }, error: null }; };
  let readHistory = () => ({ data: [application], error: null });
  let insert = () => ({ error: null }), check = () => ({ data: true, error: null });
  let businesses = () => ({ data: options.businesses ?? [ownedBusiness], error: null });
  const client = {
    auth: {
      getUser: token => Promise.resolve().then(() => getUser(token)), getSession: () => Promise.resolve().then(() => getSession()),
      setSession: tokens => { calls.sessions.push(tokens); return Promise.resolve().then(() => install(tokens)); },
      verifyOtp() { throw new Error('Unbound OTP handoff is forbidden'); },
      onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() { callback = null; calls.unsubscribes++; } } } }; },
    },
    functions: { invoke(name, args) { calls.invokes.push({ name, ...args }); return Promise.resolve().then(() => invoke(name, args)); } },
    from(table) {
      assert.equal(table, 'business_applications'); const args = {};
      const chain = {
        select(columns) { args.columns = columns; return chain; }, eq(key, value) { args[key] = value; return chain; },
        order(key, value) { args.order = { key, ...value }; return chain; },
        limit(limit) { args.limit = limit; calls.reads.push({ ...args }); return Promise.resolve().then(() => readHistory(args)); },
        insert(payload) { calls.inserts.push(payload); return Promise.resolve().then(() => insert(payload)); },
      }; return chain;
    },
    rpc(name, args) { calls.checks.push({ name, args }); return Promise.resolve().then(() => name === 'get_my_businesses' ? businesses() : check(args)); },
  };
  const environment = { setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
  const storageAPI = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 9,
    async getItemAsync(key, args) { assert.equal(args.keychainAccessible, 9); return options.getStorage ? options.getStorage(key, storage) : storage.get(key) ?? null; },
    async setItemAsync(key, value, args) { assert.match(key, /^[\w.-]+$/); assert.equal(args.keychainAccessible, 9); calls.storageWrites.push({ key, value }); if (options.setStorage) return options.setStorage(key, value, storage); storage.set(key, value); },
  };
  const shared = compile('shared/businessSession.ts', () => { throw new Error('Unexpected shared dependency'); });
  const service = compile('src/services/businessSessionService.ts', name => {
    if (name === 'expo-secure-store') return storageAPI;
    if (name === 'expo-crypto') return {
      getRandomBytesAsync: async count => { calls.randomBytes++; assert.equal(count, 32); if (options.cryptoError) throw new Error('Native randomness unavailable'); return new Uint8Array(randomBytes(count)); },
      randomUUID: () => { calls.randomUUID++; return randomUUID(); },
    };
    if (name.endsWith('/businessSession')) return shared;
    throw new Error('Unexpected native service import ' + name);
  }, environment);
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(value) { const key = cursor++; if (!(key in slots)) slots[key] = typeof value === 'function' ? value() : value; return [slots[key], next => { stateWrites++; slots[key] = typeof next === 'function' ? next(slots[key]) : next; }]; },
    useRef(value) { const key = cursor++; return slots[key] ??= { current: value }; },
    useCallback(fn, deps) { const key = cursor++; if (!slots[key] || !same(slots[key].deps, deps)) slots[key] = { value: fn, deps }; return slots[key].value; },
    useEffect(fn, deps) { const key = cursor++; if (!slots[key] || !same(slots[key].deps, deps)) { const previous = slots[key]; slots[key] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[key].cleanup = fn(); }); } },
  };
  const theme = compile('src/constants/tokens/light.ts', () => { throw new Error('Unexpected theme dependency'); }).light;
  const navigation = { navigate: (...args) => calls.routes.push(args), goBack: () => calls.routes.push(['back']) };
  const jsx = (type, props) => ({ type, props: type === 'FlatList' ? { ...props, children: props.data.map(item => props.renderItem({ item })) } : props });
  const component = compile(options.screen === 'owned' ? 'src/screens/profile/BusinessesScreen.tsx' : options.screen === 'apply' ? 'src/screens/profile/BusinessApplyScreen.tsx' : 'src/screens/auth/BusinessSignInScreen.tsx', name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return new Proxy({ Platform: { OS: 'ios' }, StyleSheet: { hairlineWidth: 1 }, Alert: { alert: (...args) => calls.alerts.push(args) } }, { get: (value, key) => value[key] || String(key) });
    if (name === '@react-navigation/native') return { useNavigation: () => navigation, useFocusEffect: fn => hooks.useEffect(fn, [fn]) };
    if (name === '@expo/vector-icons') return { Feather: 'Feather' };
    if (name.endsWith('/useTheme')) return { themedSheet: fn => fn(theme), getTheme: () => theme };
    if (name.endsWith('/constants/tokens')) return { typeSize: {}, fontWeight: {}, radius: {}, space: {} };
    if (name.endsWith('/constants/layout')) return { TAB_BAR_CLEARANCE: 80 };
    if (['/EmptyState', '/TierName', '/VerifiedBadge'].some(suffix => name.endsWith(suffix))) return { __esModule: true, default: name.split('/').at(-1) };
    if (name.endsWith('/SafeArea')) return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 20 }) };
    if (name.endsWith('/KeyboardSafe')) return { __esModule: true, default: 'KeyboardSafe' };
    if (name.endsWith('/supabase')) return { supabase: client };
    if (name.endsWith('/businessSessionService')) return service;
    throw new Error('Unexpected screen dependency ' + name);
  }, environment).default;
  const render = () => { if (!mounted) return; cursor = 0; tree = component({ navigation }); const running = effects; effects = []; running.forEach(fn => fn()); };
  const find = predicate => nodes(tree).find(predicate);
  const button = label => find(n => n.type === 'TouchableOpacity' && (n.props.accessibilityLabel === label || words(n).trim() === label));
  const h = {
    calls, service, storage, client, render, button,
    get text() { return words(tree); }, get nodes() { return nodes(tree); }, get stateWrites() { return stateWrites; },
    change(label, value) { const input = find(n => n.type === 'TextInput' && n.props.accessibilityLabel === label); assert.ok(input, label); assert.notEqual(input.props.editable, false, label + ' is editable'); const result = input.props.onChangeText(value); render(); return result; },
    press(label) { const target = button(label); assert.ok(target, 'Button ' + label); assert.notEqual(target.props.disabled, true, label + ' is enabled'); const result = target.props.onPress(); render(); return result; },
    async flush() { for (let i = 0; i < 5; i++) { await new Promise(setImmediate); render(); } },
    async timeOut() { const running = [...timers.values()]; timers.clear(); running.forEach(fn => fn()); await h.flush(); },
    setAuth(fn) { getUser = fn; }, setSessionRead(fn) { getSession = fn; }, setInvoke(fn) { invoke = fn; }, setInstall(fn) { install = fn; },
    setHistory(fn) { readHistory = fn; }, setInsert(fn) { insert = fn; }, setCheck(fn) { check = fn; },
    setBusinesses(fn) { businesses = fn; },
    setViewer(next, emit = true, token = 'new-personal-access-token') { viewer = next; accessToken = token; if (emit) callback?.(next ? 'SIGNED_IN' : 'SIGNED_OUT', selected()); render(); },
    dispose() { mounted = false; slots.forEach(slot => slot?.cleanup?.()); },
  };
  render(); return h;
}
async function ready(options) { const h = harness(options); await h.flush(); return h; }
function fillSignIn(h) { h.change('Business handle', '@Example_Studio'); h.change('Personal access code', 'personal-staff-code'); }
async function fillApplication(h) { h.change('Company or business name', 'Example'); h.change('About your business', 'The business description'); h.change('Business contact email', 'owner@example.test'); await h.change('Desired business handle', 'example_studio'); await h.flush(); }

test('device registration is secure, stable and singleflight across concurrent requests', async () => {
  const h = await ready({ emptyStorage: true });
  const first = h.service.getBusinessDevice(), second = h.service.getBusinessDevice();
  assert.equal(first, second); const saved = await first;
  assert.match(saved.device_id, /^[a-f0-9-]{36}$/); assert.match(saved.device_key, /^[a-f0-9]{64}$/);
  assert.equal(h.calls.randomBytes, 1); assert.equal(h.calls.randomUUID, 1); assert.equal(h.calls.storageWrites.length, 1);
  assert.deepEqual(await h.service.getBusinessDevice(), saved); assert.equal(h.calls.randomBytes, 1); h.dispose();
});

for (const failure of ['corrupt', 'read', 'write', 'readback', 'random']) test(`device ${failure} failure never falls back or invokes business Auth`, async () => {
  const options = failure === 'corrupt' ? { savedDevice: '{broken' } : failure === 'read' ? { getStorage: () => { throw new Error('Locked'); } } :
    failure === 'write' ? { emptyStorage: true, setStorage: () => { throw new Error('Locked'); } } : failure === 'readback' ? { emptyStorage: true, setStorage: () => {} } : { emptyStorage: true, cryptoError: true };
  const h = await ready(options); fillSignIn(h); await h.press('Enter as the business'); await h.flush();
  assert.equal(h.calls.invokes.length, 0); assert.equal(h.calls.sessions.length, 0); assert.match(h.text, /securely save/); h.dispose();
});

test('team sign-in serializes double taps and installs the validated bound session once', async () => {
  const wait = deferred(), h = await ready(); h.setInvoke(() => wait.promise); fillSignIn(h);
  const onPress = h.button('Enter as the business').props.onPress; const pending = onPress(); await onPress(); await h.flush();
  assert.equal(h.calls.invokes.length, 1); const request = h.calls.invokes[0]; assert.equal(request.name, 'business-signin');
  assert.equal(request.body.handle, 'example_studio'); assert.equal(request.body.device_key, device.device_key); assert.equal(request.body.device_id, device.device_id);
  assert.equal(request.body.bootstrap_owner, undefined); assert.equal(request.body.device_label, 'ios app');
  wait.resolve({ data: bound, error: null }); await pending; await h.flush();
  assert.equal(h.calls.sessions.length, 1); assert.equal(h.calls.alerts.length, 0); assert.equal(h.calls.routes.length, 0); assert.match(h.text, /Business access confirmed/);
  assert.equal(h.nodes.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Personal access code').props.value, ''); h.dispose();
});

for (const code of ['DEVICE_APPROVAL_REQUIRED', 'DEVICE_BLOCKED', 'ACCESS_REJECTED', 'TRY_LATER', 'BUSINESS_SESSION_UNAVAILABLE']) test(`team ${code} preserves the account and releases retry`, async () => {
  const h = await ready(); fillSignIn(h); h.setInvoke(() => rejected(code)); await h.press('Enter as the business'); await h.flush();
  assert.equal(h.calls.sessions.length, 0); assert.equal(h.button('Enter as the business').props.disabled, false); assert.doesNotMatch(h.text, /Private provider/);
  h.setInvoke(() => ({ data: bound, error: null })); await h.press('Enter as the business'); assert.equal(h.calls.sessions.length, 1); h.dispose();
});

for (const stop of ['cancel', 'account', 'silent-account', 'unmount', 'back']) test(`a late team response cannot install after ${stop}`, async () => {
  const wait = deferred(), h = await ready(); h.setInvoke(() => wait.promise); fillSignIn(h); const pending = h.press('Enter as the business'); await h.flush();
  if (stop === 'cancel') h.press('Cancel sign-in');
  if (stop === 'account') h.setViewer('another-account');
  if (stop === 'silent-account') h.setViewer('another-account', false);
  if (stop === 'unmount') h.dispose();
  if (stop === 'back') h.press('Back');
  const writes = h.stateWrites;
  wait.resolve({ data: bound, error: null }); await pending; await h.flush();
  assert.equal(h.calls.sessions.length, 0); assert.equal(h.calls.alerts.length, 0);
  if (stop === 'unmount') assert.equal(h.stateWrites, writes);
  if (['cancel', 'account', 'unmount', 'back'].includes(stop)) assert.equal(h.calls.invokes[0].signal.aborted, true);
  h.dispose();
});

test('legacy unbound responses and wrong destination identities fail before session installation', async () => {
  for (const failure of ['legacy', 'destination', 'network']) {
    const h = await ready(); fillSignIn(h);
    if (failure === 'legacy') h.setInvoke(() => ({ data: { token_hash: 'legacy-capability' }, error: null }));
    if (failure === 'destination') h.setAuth(token => ({ data: { user: { id: token ? 'wrong-business' : personalId } }, error: null }));
    if (failure === 'network') h.setInvoke(() => { throw new Error('private failure details'); });
    await h.press('Enter as the business'); await h.flush(); assert.equal(h.calls.sessions.length, 0); assert.doesNotMatch(h.text, /private failure|legacy-capability/); h.dispose();
  }
});

test('stalled requests time out and preserve a retry path', async () => {
  const wait = deferred(), h = await ready(); fillSignIn(h); h.setInvoke(() => wait.promise); const pending = h.press('Enter as the business'); await h.flush();
  await h.timeOut(); await pending; assert.match(h.text, /took too long/); assert.equal(h.button('Enter as the business').props.disabled, false); assert.equal(h.calls.invokes[0].signal.aborted, true); h.dispose();
});

test('final installation cannot be cancelled and a wrong installed identity is not declared successful', async () => {
  const wait = deferred(), h = await ready(); fillSignIn(h); h.setInstall(() => wait.promise);
  const pending = h.press('Enter as the business'); const cancel = h.button('Cancel sign-in')?.props.onPress; await h.flush();
  assert.equal(h.button('Cancel sign-in'), undefined); assert.equal(h.button('Back').props.disabled, true); cancel?.();
  assert.equal(h.calls.invokes[0].signal.aborted, false);
  wait.resolve({ data: { user: { id: 'wrong' }, session: { user: { id: 'wrong' } } }, error: null }); await pending; await h.flush();
  assert.match(h.text, /could not be verified/); assert.doesNotMatch(h.text, /Business access confirmed/); h.dispose();
});

test('initial account-check failures are retryable and late initial snapshots cannot undo Auth events', async () => {
  const h = harness(); h.setSessionRead(() => ({ data: { session: null }, error: Error('offline') })); await h.flush();
  assert.equal(h.button('Enter as the business').props.disabled, true); assert.match(h.text, /could not be checked/);
  h.setSessionRead(() => ({ data: { session: null }, error: null })); h.press('Retry account check'); await h.flush(); assert.equal(h.button('Enter as the business').props.disabled, false); h.dispose();
  const initial = deferred(), other = harness(); other.setSessionRead(() => initial.promise); await other.flush(); other.setViewer('new-viewer');
  initial.resolve({ data: { session: { user: { id: personalId } } }, error: null }); await other.flush(); fillSignIn(other); await other.press('Enter as the business');
  assert.equal(other.calls.sessions.length, 1); other.dispose();
});

test('owner setup requires an explicit confirmation and sends proof on both requests', async () => {
  const h = await ready({ screen: 'apply' }); h.setInvoke(() => rejected('OWNER_BOOTSTRAP_REQUIRED')); h.press('Open Example Studio'); await h.flush();
  assert.equal(h.calls.sessions.length, 0); assert.equal(h.calls.invokes.length, 1); assert.equal(h.calls.invokes[0].body.bootstrap_owner, undefined);
  const prompt = h.calls.alerts.find(args => args[0] === 'Set up your owner access?'); assert.ok(prompt); assert.match(prompt[1], /owner seat/); assert.match(prompt[1], /device as approved/);
  h.setInvoke(() => ({ data: bound, error: null })); prompt[2].find(button => button.text === 'Set up owner access').onPress(); await h.flush();
  assert.equal(h.calls.invokes.length, 2); assert.equal(h.calls.invokes[1].body.bootstrap_owner, true); assert.equal(h.calls.invokes[1].body.device_key, device.device_key);
  assert.equal(h.calls.invokes[1].body.application_id, application.id); assert.equal(h.calls.sessions.length, 1); h.dispose();
});

for (const stop of ['account', 'unmount', 'cancel', 'dismiss']) test(`owner setup prompt cannot be reused after ${stop}`, async () => {
  const h = await ready({ screen: 'apply' }); h.setInvoke(() => rejected('OWNER_BOOTSTRAP_REQUIRED')); h.press('Open Example Studio'); await h.flush();
  const prompt = h.calls.alerts.at(-1), confirm = prompt[2].find(button => button.text === 'Set up owner access').onPress;
  if (stop === 'account') h.setViewer('another-owner');
  if (stop === 'unmount') h.dispose();
  if (stop === 'cancel') prompt[2].find(button => button.text === 'Cancel').onPress();
  if (stop === 'dismiss') prompt[3].onDismiss();
  confirm(); await h.flush(); assert.equal(h.calls.invokes.length, 1); assert.equal(h.calls.sessions.length, 0); h.dispose();
});

for (const stop of ['cancel', 'account', 'silent-account', 'unmount']) test(`late owner launch cannot install after ${stop}`, async () => {
  const wait = deferred(), h = await ready({ screen: 'apply' }); h.setInvoke(() => wait.promise);
  const press = h.button('Open Example Studio').props.onPress; press(); press(); await h.flush(); assert.equal(h.calls.invokes.length, 1);
  if (stop === 'cancel') h.press('Cancel business sign-in');
  if (stop === 'account') h.setViewer('another-owner');
  if (stop === 'silent-account') h.setViewer('another-owner', false);
  if (stop === 'unmount') h.dispose();
  const alerts = h.calls.alerts.length, writes = h.stateWrites;
  wait.resolve({ data: bound, error: null }); await h.flush(); assert.equal(h.calls.sessions.length, 0);
  if (stop !== 'silent-account') assert.equal(h.calls.alerts.length, alerts);
  if (stop === 'unmount') assert.equal(h.stateWrites, writes); h.dispose();
});

test('owner approval-required errors never bootstrap or install automatically', async () => {
  const h = await ready({ screen: 'apply' }); h.setInvoke(() => rejected('DEVICE_APPROVAL_REQUIRED')); h.press('Open Example Studio'); await h.flush();
  assert.equal(h.calls.sessions.length, 0); assert.match(h.calls.alerts[0][1], /needs approval/); assert.equal(h.calls.alerts[0][2], undefined); assert.equal(h.button('Open Example Studio').props.disabled, false); h.dispose();
});

test('application drafts and history are scoped to the confirmed account', async () => {
  const wait = deferred(), h = await ready({ screen: 'apply' }); await fillApplication(h); h.setHistory(() => wait.promise);
  h.setViewer('new-owner'); await h.flush(); assert.doesNotMatch(h.text, /Example Studio/);
  assert.equal(h.nodes.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'About your business').props.value, '');
  h.dispose(); const writes = h.stateWrites; wait.resolve({ data: [application], error: null }); await h.flush(); assert.equal(h.stateWrites, writes);
});

test('application failures retain the draft and successful duplicate taps write once', async () => {
  const h = await ready({ screen: 'apply' }); await fillApplication(h); h.setInsert(() => ({ error: Error('private database detail') })); await h.press('Send application'); await h.flush();
  assert.equal(h.nodes.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Company or business name').props.value, 'Example'); assert.doesNotMatch(h.calls.alerts.at(-1)[1], /private database/);
  const wait = deferred(); h.setInsert(() => wait.promise); const press = h.button('Send application').props.onPress; const pending = press(); await press(); await h.flush();
  assert.equal(h.calls.inserts.length, 2); assert.equal(h.calls.inserts[1].applicant_id, personalId);
  wait.resolve({ error: null }); await pending; await h.flush(); assert.equal(h.calls.alerts.at(-1)[0], 'Application sent'); h.dispose();
});

test('application mutation and handle lookups discard stale account results', async () => {
  const h = await ready({ screen: 'apply' }); await fillApplication(h); const wait = deferred(); h.setInsert(() => wait.promise); const pending = h.press('Send application'); await h.flush();
  h.setViewer('another-owner'); await h.flush(); h.change('Company or business name', 'New owner draft'); const alerts = h.calls.alerts.length;
  wait.resolve({ error: null }); await pending; await h.flush(); assert.equal(h.calls.alerts.length, alerts);
  assert.equal(h.nodes.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Company or business name').props.value, 'New owner draft');
  const lookup = deferred(); h.setCheck(() => lookup.promise); h.change('Desired business handle', 'old_value'); h.change('Desired business handle', '!');
  lookup.resolve({ data: true, error: null }); await h.flush(); assert.match(h.text, /3-30 chars/); assert.doesNotMatch(h.text, /old_value is available/); h.dispose();
});

test('a concurrent Auth event for a different session cannot complete the intended handoff', async () => {
  const wait = deferred(), h = await ready(); fillSignIn(h); h.setInstall(() => wait.promise);
  const pending = h.press('Enter as the business'); await h.flush();
  h.setViewer(businessId, true, 'another-session-for-the-same-business');
  wait.resolve({ data: { user: { id: businessId }, session: { user: { id: businessId }, access_token: bound.session.access_token } }, error: null });
  await pending; await h.flush(); assert.doesNotMatch(h.text, /Business access confirmed/); assert.match(h.text, /Your account changed/); h.dispose();
});

test('owner legacy and destination failures never replace the personal session', async () => {
  for (const mode of ['legacy', 'destination']) {
    const h = await ready({ screen: 'apply' });
    if (mode === 'legacy') h.setInvoke(() => ({ data: { token_hash: 'old-unbound-token' }, error: null }));
    else h.setAuth(token => ({ data: { user: { id: token ? 'unexpected-business' : personalId } }, error: null }));
    h.press('Open Example Studio'); await h.flush(); assert.equal(h.calls.sessions.length, 0); assert.equal(h.calls.alerts.at(-1)[0], 'Business access');
    assert.doesNotMatch(h.calls.alerts.at(-1)[1], /old-unbound-token/); h.dispose();
  }
});

test('failed application history offers retry without inventing an empty successful read', async () => {
  const h = harness({ screen: 'apply' }); h.setHistory(() => ({ data: null, error: Error('offline') })); await h.flush();
  assert.match(h.text, /Applications could not be loaded/); assert.equal(h.button('Open Example Studio'), undefined);
  h.setHistory(() => ({ data: [application], error: null })); h.press('Retry applications'); await h.flush(); assert.ok(h.button('Open Example Studio')); h.dispose();
});

test('a silent personal account switch prevents an application write', async () => {
  const h = await ready({ screen: 'apply' }); await fillApplication(h); h.setViewer('another-owner', false);
  await h.press('Send application'); await h.flush(); assert.equal(h.calls.inserts.length, 0); assert.equal(h.calls.alerts.at(-1)[0], 'Could not send'); h.dispose();
});

test('signed-out team members can install a verified business session without a personal session', async () => {
  const h = await ready({ viewer: null }); h.setAuth(token => ({ data: { user: token ? { id: businessId } : null }, error: token ? null : { name: 'AuthSessionMissingError' } }));
  fillSignIn(h); await h.press('Enter as the business'); await h.flush(); assert.equal(h.calls.sessions.length, 1); h.dispose();
});

test('current owners open a business by its verified list ID without an application', async () => {
  const h = await ready({ screen: 'owned' }); assert.ok(h.calls.checks.some(call => call.name === 'get_my_businesses'));
  const action = h.button('Open Example Studio Studio').props.onPress; action(); action(); await h.flush();
  assert.equal(h.calls.invokes.length, 1); assert.equal(h.calls.invokes[0].body.business_id, businessId); assert.equal('application_id' in h.calls.invokes[0].body, false);
  assert.equal(h.calls.sessions.length, 1); assert.equal(h.calls.alerts.length, 0); assert.match(h.text, /Business access confirmed/); h.dispose();
});

test('nonowner business cards have no owner launch capability', async () => {
  for (const role of ['admin', 'editor', 'member']) {
    const h = await ready({ screen: 'owned', businesses: [{ ...ownedBusiness, role }] }); assert.equal(h.button('Open Example Studio Studio'), undefined);
    assert.match(h.text, /personal team access code/); assert.equal(h.calls.invokes.length, 0); h.dispose();
  }
});

test('direct owner bootstrap is explicit and cannot be replayed after an account switch', async () => {
  const h = await ready({ screen: 'owned' }); h.setInvoke(() => rejected('OWNER_BOOTSTRAP_REQUIRED')); h.press('Open Example Studio Studio'); await h.flush();
  const first = h.calls.alerts.at(-1)[2].find(button => button.text === 'Set up owner access').onPress;
  assert.equal(h.calls.invokes[0].body.bootstrap_owner, undefined); h.setViewer('other-owner'); await h.flush(); first(); await h.flush(); assert.equal(h.calls.invokes.length, 1);
  h.press('Open Example Studio Studio'); await h.flush(); const second = h.calls.alerts.at(-1)[2].find(button => button.text === 'Set up owner access').onPress;
  h.setInvoke(() => ({ data: bound, error: null })); second(); await h.flush(); assert.equal(h.calls.invokes.at(-1).body.bootstrap_owner, true); assert.equal(h.calls.invokes.at(-1).body.business_id, businessId); assert.equal(h.calls.sessions.length, 1); h.dispose();
});

for (const stop of ['cancel', 'account', 'silent-account', 'unmount']) test(`owned-business launch ignores a late response after ${stop}`, async () => {
  const wait = deferred(), h = await ready({ screen: 'owned' }); h.setInvoke(() => wait.promise); h.press('Open Example Studio Studio'); await h.flush();
  if (stop === 'cancel') h.press('Cancel sign-in');
  if (stop === 'account') h.setViewer('other-owner');
  if (stop === 'silent-account') h.setViewer('other-owner', false);
  if (stop === 'unmount') h.dispose();
  const writes = h.stateWrites; wait.resolve({ data: bound, error: null }); await h.flush(); assert.equal(h.calls.sessions.length, 0);
  if (stop === 'unmount') assert.equal(h.stateWrites, writes); h.dispose();
});

test('current-owner launch rejects a valid session for a different business and revoked ownership', async () => {
  for (const mode of ['destination', 'revoked']) {
    const h = await ready({ screen: 'owned' }); h.setInvoke(() => mode === 'destination' ? { data: { ...bound, business_id: '66666666-6666-4666-8666-666666666666' }, error: null } : rejected('ACTIVE_OWNER_SESSION_REQUIRED'));
    h.press('Open Example Studio Studio'); await h.flush(); assert.equal(h.calls.sessions.length, 0); assert.equal(h.calls.alerts.at(-1)[0], 'Business access'); assert.equal(h.button('Open Example Studio Studio').props.disabled, false); h.dispose();
  }
});

test('owned-business list errors offer retry and old account results cannot repopulate the list', async () => {
  const h = harness({ screen: 'owned' }); h.setBusinesses(() => ({ data: null, error: Error('private provider detail') })); await h.flush();
  assert.match(h.text, /Could not load your businesses/); assert.doesNotMatch(h.text, /private provider/);
  const wait = deferred(); h.setBusinesses(() => wait.promise); h.press('Try again'); await h.flush(); h.setBusinesses(() => ({ data: [], error: null })); h.setViewer('another-owner'); await h.flush();
  wait.resolve({ data: [ownedBusiness], error: null }); await h.flush(); assert.equal(h.button('Open Example Studio Studio'), undefined); h.dispose();
});
