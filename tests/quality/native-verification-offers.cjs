// Execute shipping native components with controlled Auth/offer responses. These
// tests exercise lifecycle, review and cancellation; they do not emulate a device.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const session = (id = 'a', email = id + '@example.invalid', confirmed = true) => ({ access_token: 'synthetic-' + id, refresh_token: 'synthetic-refresh-' + id, user: { id, email, email_confirmed_at: confirmed ? '2026-10-30T12:00:00Z' : null } });
function hooks() {
  const slots = []; let cursor = 0, effects = [], dirty = true, unmounted = false, writesAfterUnmount = 0, component, output;
  const changed = (before, after) => !before || !after || before.length !== after.length || before.some((v, i) => v !== after[i]);
  const react = {
    useState(initial) {
      const key = cursor++; if (!slots[key]) slots[key] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[key].value, value => {
        if (unmounted) { writesAfterUnmount++; return; }
        const next = typeof value === 'function' ? value(slots[key].value) : value;
        if (!Object.is(next, slots[key].value)) { slots[key].value = next; dirty = true; }
      }];
    },
    useRef(value) { const key = cursor++; if (!slots[key]) slots[key] = { current: value }; return slots[key]; },
    useCallback(fn, deps) { const key = cursor++; if (!slots[key] || changed(slots[key].deps, deps)) slots[key] = { value: fn, deps }; return slots[key].value; },
    useEffect(effect, deps) {
      const key = cursor++;
      if (!slots[key] || changed(slots[key].deps, deps)) {
        const cleanup = slots[key]?.cleanup;
        slots[key] = { deps, cleanup };
        effects.push(() => { cleanup?.(); slots[key].cleanup = effect(); });
      }
    },
  };
  const render = () => {
    if (unmounted) return output;
    for (let pass = 0; dirty; pass++) {
      assert.ok(pass < 50, 'component settled without a render loop');
      dirty = false; cursor = 0; output = component();
      const pending = effects; effects = []; pending.forEach(effect => effect());
    }
    return output;
  };
  return { react, mount(fn) { component = fn; return render(); }, render, invalidate() { dirty = true; }, unmount() { unmounted = true; slots.forEach(slot => slot?.cleanup?.()); }, get writesAfterUnmount() { return writesAfterUnmount; } };
}
const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
function load(file, imports, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require(name) { assert.ok(name in imports, 'Unexpected import ' + name); return imports[name]; }, console: { log() {} }, URLSearchParams, ...globals });
  return module.exports;
}
const nativeElements = Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'Modal', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map(name => [name, name]));
function nodes(tree, result = []) {
  if (!tree || typeof tree !== 'object') return result;
  if (Array.isArray(tree)) { tree.forEach(child => nodes(child, result)); return result; }
  result.push(tree); nodes(tree.props?.children, result); return result;
}
function words(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return Array.isArray(tree) ? tree.map(words).join('') : words(tree.props?.children);
}
function button(tree, label) {
  const found = nodes(tree).find(node => node.type === 'TouchableOpacity' && words(node) === label);
  assert.ok(found, 'button exists: ' + label); return found;
}
function authStore(hook, initial = null) {
  const writes = [], listeners = new Set();
  const state = { session: initial, profile: null, refreshes: 0,
    setSession(value) { writes.push(value); replace(value); },
    async refreshProfile() { state.refreshes++; },
  };
  function replace(value) { const previous = { ...state }; state.session = value; listeners.forEach(listener => listener(state, previous)); hook.invalidate(); }
  const useAuthStore = selector => selector(state);
  useAuthStore.getState = () => state;
  useAuthStore.subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  return { useAuthStore, state, writes, replace, listeners };
}
function verifyHarness(options = {}) {
  const hook = hooks(), store = authStore(hook, options.storeSession ?? null), calls = [], persisted = [], messages = [], navigation = [], timers = new Map();
  let foreground, link, timerId = 0, email = options.email || 'a@example.invalid';
  const candidate = options.candidate ?? session();
  const auth = {
    async getSession() { calls.push('getSession'); return options.getSession ? options.getSession() : { data: { session: candidate }, error: null }; },
    async getUser(token) { calls.push(['getUser', token]); return options.getUser ? options.getUser(token) : { data: { user: candidate.user }, error: null }; },
    async setSession(tokens) { calls.push(['setSession', tokens]); return { data: { session: candidate }, error: null }; },
    async verifyOtp(tokens) { calls.push(['verifyOtp', tokens]); return { data: { session: candidate }, error: null }; },
  };
  const animation = () => ({ start: done => done?.(), stop() {} });
  const native = { ...nativeElements, Animated: { Value: class { constructor(value) { this.value = value; } }, View: 'AnimatedView', loop: animation, sequence: animation, spring: animation, timing: animation }, Easing: { inOut: value => value, ease: 'ease' }, AppState: { addEventListener(_, listener) { foreground = listener; return { remove() { foreground = null; } }; } } };
  const Screen = load('src/screens/auth/VerifyEmailScreen.tsx', {
    react: hook.react, 'react/jsx-runtime': runtime, 'react-native': native,
    '../../theme/useTheme': { themedSheet: () => ({}) }, '../../components/SafeArea': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'expo-linking': { getInitialURL: async () => options.initialUrl || null, createURL: value => value, addEventListener(_, listener) { link = listener; return { remove() { link = null; } }; } },
    '@react-native-async-storage/async-storage': { getItem: async () => null, setItem: async (...value) => persisted.push(value), removeItem: async () => {} },
    '@expo/vector-icons': { Feather: 'Feather' }, 'react-native-flash-message': { showMessage: value => messages.push(value) },
    '../../services/authService': { authService: { resendVerification: async () => {} } }, '../../services/supabase': { supabase: { auth } },
    '../../stores/authStore': store, '../../components/brand/PearlMark': { default: 'PearlMark' },
  }, { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } }).default;
  hook.mount(() => Screen({ route: { params: { email } }, navigation: { reset: value => navigation.push(value), navigate: value => navigation.push(value) } }));
  return { hook, store, calls, persisted, messages, navigation, timers, view: hook.render, foreground: () => foreground?.('active'), warm: url => link?.({ url }), changeEmail(value) { email = value; hook.invalidate(); hook.render(); } };
}

test('late verification session cannot overwrite a newly signed-in account', async () => {
  const wait = deferred(); const h = verifyHarness({ getSession: () => wait.promise });
  h.store.replace(session('b')); wait.resolve({ data: { session: session() }, error: null }); await flush();
  assert.equal(h.store.state.session.user.id, 'b'); assert.equal(h.store.writes.length, 0); assert.equal(h.persisted.length, 0);
  assert.equal(h.calls.filter(call => Array.isArray(call) && call[0] === 'getUser').length, 0); h.hook.unmount();
});

test('verification pending Auth validation is discarded on unmount or sign-out', async () => {
  for (const reason of ['unmount', 'signout']) {
    const wait = deferred(); const h = verifyHarness({ storeSession: session(), getUser: () => wait.promise }); await flush();
    if (reason === 'unmount') h.hook.unmount(); else h.store.replace(null);
    wait.resolve({ data: { user: session().user }, error: null }); await flush();
    assert.equal(h.store.writes.length, 0); assert.equal(h.persisted.length, 0); assert.equal(h.hook.writesAfterUnmount, 0);
    if (reason !== 'unmount') h.hook.unmount();
  }
});

test('matching confirmed email keeps the normal verified profile-setup flow', async () => {
  const h = verifyHarness({ email: ' A@EXAMPLE.INVALID ' }); await flush();
  assert.equal(h.store.writes.length, 1); assert.equal(h.store.state.refreshes, 1);
  assert.equal(h.persisted.length, 1); assert.match(words(h.view()), /Welcome to PlatinumCircles/);
  await button(h.view(), 'Set Up Your Profile').props.onPress();
  assert.equal(h.navigation[0].routes[0].name, 'SetupProfile'); h.hook.unmount();
});

test('wrong email and unconfirmed Auth records cannot show verification success', async () => {
  for (const candidate of [session('b'), session('a', 'a@example.invalid', false)]) {
    const h = verifyHarness({ candidate }); await flush();
    assert.equal(h.store.writes.length, 0); assert.equal(h.persisted.length, 0); assert.doesNotMatch(words(h.view()), /Welcome to PlatinumCircles/);
    h.hook.unmount(); assert.equal(h.timers.size, 0);
  }
});

test('foreground polling is single-flight and changing the email invalidates its old result', async () => {
  const wait = deferred(); const h = verifyHarness({ getSession: () => wait.promise });
  h.foreground(); h.foreground(); button(h.view(), 'I already verified').props.onPress();
  assert.equal(h.calls.filter(call => call === 'getSession').length, 1);
  h.changeEmail('b@example.invalid'); wait.resolve({ data: { session: session() }, error: null }); await flush();
  assert.equal(h.store.writes.length, 0); assert.equal(h.persisted.length, 0); h.hook.unmount(); assert.equal(h.timers.size, 0);
});

test('bearer verification for a different email never replaces the Auth session', async () => {
  const pending = deferred(); const h = verifyHarness({ getSession: () => pending.promise, getUser: async () => ({ data: { user: session('b').user }, error: null }) });
  h.warm('platinumcircles://auth/callback#access_token=other-access&refresh_token=other-refresh'); await flush();
  assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'setSession'), false);
  h.hook.unmount(); pending.resolve({ data: { session: null }, error: null }); await flush(); assert.equal(h.hook.writesAfterUnmount, 0);
});

const offer = extra => ({ id: 'offer-1', status: 'pending', buyer_id: 'b', seller_id: 'a', proposer_id: 'b', amount: '24.00', currency: 'USD', ...extra });
function offerHarness(options = {}) {
  const hook = hooks(), store = authStore(hook, session()), calls = [], resolved = [], closed = [];
  let row = offer(options.row), selectCount = 0;
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'offer_response_capabilities') return options.capability ?? { data: { version: 1, serialized: true, fractionDigits: 2, maxAmount: '9999999999.99' }, error: null };
      return options.respond ? options.respond(args) : { error: null };
    },
    from(table) {
      assert.equal(table, 'listing_offers');
      return { select() { return this; }, eq(key, value) { assert.equal(key, 'id'); assert.equal(value, 'offer-1'); return this; }, async maybeSingle() { selectCount++; return options.read ? options.read(selectCount, row) : { data: { ...row }, error: null }; } };
    },
  };
  const Component = load('src/components/messages/CounterOfferDialog.tsx', {
    react: hook.react, 'react/jsx-runtime': runtime, 'react-native': { ...nativeElements, Platform: { OS: options.platform || 'android' } },
    '../../../shared/commerceMoney': load('shared/commerceMoney.ts', {}),
    '../../services/supabase': { supabase: client }, '../../stores/authStore': store,
    '../../theme/useTheme': { themedSheet: () => ({}), useTheme: () => ({ t: { ink: { muted: '#666' }, brand: { base: '#123' } } }) },
  }).CounterOfferDialog;
  hook.mount(() => Component({ offerId: 'offer-1', ownerId: 'a', actorId: options.actorId || 'a', onClose() { closed.push(true); hook.unmount(); }, onResolved(value) { resolved.push(value); hook.unmount(); } }));
  return { hook, store, calls, resolved, closed, view: hook.render, setRow(value) { row = value; }, get selectCount() { return selectCount; }, input(value) { nodes(hook.render()).find(node => node.type === 'TextInput').props.onChangeText(value); hook.render(); } };
}
const mutations = h => h.calls.filter(call => call.name === 'respond_offer');

test('Android and iOS Counter both require amount review and Cancel never declines', async () => {
  for (const platform of ['android', 'ios']) {
    const h = offerHarness({ platform }); await flush();
    h.input('19.5'); button(h.view(), 'Review counter-offer').props.onPress();
    assert.match(words(h.view()), /USD 19.50/); assert.equal(mutations(h).length, 0);
    button(h.view(), 'Cancel').props.onPress(); assert.equal(h.closed.length, 1); assert.equal(mutations(h).length, 0);
    const other = offerHarness({ platform }); await flush(); nodes(other.view()).find(node => node.type === 'Modal').props.onRequestClose();
    assert.equal(other.closed.length, 1); assert.equal(mutations(other).length, 0);
  }
});

test('invalid monetary input stays editable and never reaches the offer endpoint', async () => {
  const h = offerHarness(); await flush();
  for (const amount of ['', '0', '-1', '0.001', '1e3', 'Infinity', 'NaN', '1,00', '10000000000']) {
    h.input(amount); button(h.view(), 'Review counter-offer').props.onPress();
    assert.match(words(h.view()), /Enter an amount/); assert.equal(mutations(h).length, 0);
    assert.ok(nodes(h.view()).some(node => node.type === 'TextInput'));
  }
  h.hook.unmount();
});

test('double-tap submits exactly one reviewed counter with the current backend signature', async () => {
  const wait = deferred(); const h = offerHarness({ respond: () => wait.promise }); await flush();
  h.input('23.45'); button(h.view(), 'Review counter-offer').props.onPress();
  const send = button(h.view(), 'Send counter-offer').props.onPress;
  const first = send(); const second = send(); await flush();
  assert.equal(mutations(h).length, 1); assert.equal(h.selectCount, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(mutations(h)[0].args)), { p_offer_id: 'offer-1', p_action: 'countered', p_counter_amount: '23.45' });
  wait.resolve({ error: null }); await Promise.all([first, second]);
  assert.equal(h.resolved.length, 1); assert.equal(h.resolved[0].status, 'countered'); assert.equal(h.hook.writesAfterUnmount, 0);
});

test('missing hardened capability and wrong offer ownership fail closed', async () => {
  for (const options of [{ capability: { data: null, error: { code: 'PGRST202' } } }, { row: { proposer_id: 'a' } }, { row: { buyer_id: 'b', seller_id: 'c' } }, { actorId: 'business' }]) {
    const h = offerHarness(options); await flush();
    assert.equal(nodes(h.view()).some(node => node.type === 'TextInput'), false); assert.equal(mutations(h).length, 0);
    assert.match(words(h.view()), /not available|Only the other participant/); h.hook.unmount();
  }
});

test('changed offer and account change during revalidation prevent a counter', async () => {
  const h = offerHarness(); await flush(); h.input('15'); button(h.view(), 'Review counter-offer').props.onPress();
  h.setRow(offer({ status: 'accepted' })); await button(h.view(), 'Send counter-offer').props.onPress();
  assert.equal(mutations(h).length, 0); assert.match(words(h.view()), /already been accepted/); h.hook.unmount();
  const wait = deferred(); const switching = offerHarness({ read: count => count === 1 ? { data: offer(), error: null } : wait.promise }); await flush();
  switching.input('15'); button(switching.view(), 'Review counter-offer').props.onPress();
  const sending = button(switching.view(), 'Send counter-offer').props.onPress(); switching.store.replace(session('b'));
  wait.resolve({ data: offer(), error: null }); await sending;
  assert.equal(mutations(switching).length, 0); assert.equal(switching.view(), null); switching.hook.unmount();
});

test('uncertain response checks status without replay and closing ignores a late result', async () => {
  const h = offerHarness({ respond: async () => { throw new Error('Network lost'); } }); await flush();
  h.input('20'); button(h.view(), 'Review counter-offer').props.onPress(); await button(h.view(), 'Send counter-offer').props.onPress();
  assert.match(words(h.view()), /not confirmed/); assert.equal(mutations(h).length, 1);
  h.setRow(offer({ status: 'countered' })); await button(h.view(), 'Check status').props.onPress();
  assert.match(words(h.view()), /already been countered/); assert.equal(mutations(h).length, 1); h.hook.unmount();
  const wait = deferred(); const closing = offerHarness({ respond: () => wait.promise }); await flush();
  closing.input('20'); button(closing.view(), 'Review counter-offer').props.onPress();
  const sending = button(closing.view(), 'Send counter-offer').props.onPress(); await flush();
  button(closing.view(), 'Close').props.onPress(); wait.resolve({ error: null }); await sending;
  assert.equal(closing.resolved.length, 0); assert.equal(closing.hook.writesAfterUnmount, 0);
});

test('the shipping chat Counter action opens the scoped dialog without any offer mutation', () => {
  const file = fs.readFileSync(path.join(root, 'src/screens/messages/ChatScreen.tsx'), 'utf8');
  const ast = ts.createSourceFile('ChatScreen.tsx', file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let renderSource;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'renderMsg') renderSource = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(renderSource);
  const module = { exports: {} }, opened = [], responses = [];
  const context = {
    module, exports: module.exports,
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'Fragment' },
    ...nativeElements, Pressable: 'Pressable', Feather: 'Feather', Ionicons: 'Ionicons', MentionText: 'MentionText',
    currentUserId: 'a', session: session(), attachmentScope: 'a:a:conversation-1', setCounterOffer: value => opened.push(value),
    respondOffer: (...args) => responses.push(args), offersMap: { 'offer-1': offer() },
    groupEnds: {}, groupStarts: {}, isGroup: false, membersById: {}, otherUser: {}, otherInits: 'B', getStatus: () => null,
    memberReads: [], showTimestamp: null, starredIds: new Set(), messages: [], sharedPostsMap: {}, viewedOutIds: new Set(),
    s: new Proxy({}, { get: () => ({}) }), t: { ink: { primary: '#123', secondary: '#456' }, surface: { hairline: '#eee', raised: '#fff' }, status: { warning: '#c80' } },
    parseChatAttachmentCard: () => null, setSelectedMsg() {}, setShowTimestamp() {},
    ...load('shared/storyMessageReference.ts', {}),
  };
  vm.runInNewContext(ts.transpileModule('export const render = ' + renderSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  const tree = module.exports.render({ item: { type: 'msg', data: { id: 'message-1', sender_id: 'b', text: null, media_type: 'offer', media_url: JSON.stringify({ offer_id: 'offer-1', listing_title: 'Desk lamp', amount: 24, currency: 'USD' }) } } });
  button(tree, 'Counter').props.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [{ id: 'offer-1', scope: 'a:a:conversation-1', ownerId: 'a', actorId: 'a' }]);
  assert.equal(responses.length, 0);
});

test('counter monetary boundaries stay exact through input and review', async () => {
  for (const amount of ['0.01', '9999999999.99']) {
    const h = offerHarness(); await flush(); h.input(amount);
    button(h.view(), 'Review counter-offer').props.onPress();
    assert.ok(words(h.view()).includes('USD ' + amount)); await button(h.view(), 'Send counter-offer').props.onPress();
    assert.equal(mutations(h).length, 1); assert.equal(mutations(h)[0].args.p_counter_amount, amount);
  }
});
