const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '../..');
const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const TICKET = '20000000-0000-4000-8000-000000000001';
const TICKET_B = '20000000-0000-4000-8000-000000000002';
const text = node => node == null ? '' : Array.isArray(node) ? node.map(text).join(' ') : typeof node === 'object' ? text(node.props?.children) : String(node);
const walk = node => !node ? [] : Array.isArray(node) ? node.flatMap(walk) : typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];

/** Actual screens, platform write wrapper, navigation scope and installed SDK.
 * Hook/focus/native hosts, Auth, storage and provider responses are controlled;
 * this is not a native scheduler, hosted RLS or physical-device acceptance test. */
function memberSupportHarness(kind = 'reply') {
  const slots = [], effects = [], requests = [], storage = new Map(), authListeners = new Set();
  const alerts = [], pending = new Map(), cache = new Map(), sources = {};
  let cursor = 0, dirty = true, tree, focused = true, disposed = false, serial = 0;
  const state = {
    owner: OWNER, sessionId: 'login-a1', tokenRevision: 0, ticketId: TICKET, authCalls: 0,
    tickets: [{ id: TICKET, user_id: OWNER, kind: 'support', subject: 'Ticket A', body: 'Original question', status: 'solved', created_at: '2026-10-31T12:00:00Z' }],
    messages: [], listError: false, historyError: false, writeLost: false, writeError: false,
  };
  const token = () => `synthetic.${Buffer.from(JSON.stringify({ sub: state.owner, session_id: state.sessionId, exp: 4102444800 })).toString('base64url')}.${state.tokenRevision}`;
  const session = () => state.owner ? { user: { id: state.owner }, access_token: token() } : null;
  const authStore = () => ({ profile: state.owner ? { id: state.owner } : null, session: session() });
  authStore.getState = authStore;
  authStore.subscribe = listener => { authListeners.add(listener); return () => authListeners.delete(listener); };
  const defer = name => {
    assert.ok(!pending.has(name), `Gate already exists: ${name}`);
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const gate = { promise, resolve, entered: false };
    pending.set(name, gate);
    return gate;
  };
  const pause = async name => {
    const gate = pending.get(name);
    if (gate && !gate.entered) { gate.entered = true; await gate.promise; }
  };
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const fail = message => response({ code: 'AUDIT_INJECTED', message }, 400);
  const filter = (url, field) => url.searchParams.get(field)?.replace(/^eq\./, '');
  const fetch = async (input, init = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://support-test.invalid', 'Synthetic provider must never reach a real origin');
    if (init.signal?.aborted) throw new DOMException('Aborted before transport', 'AbortError');
    const headers = new Headers(init.headers), body = init.body ? JSON.parse(init.body) : null;
    const bearer = headers.get('authorization');
    const actor = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).sub;
    const request = { path: url.pathname, method: init.method || 'GET', body, bearer, signal: init.signal, search: url.search };
    requests.push(request);
    if (url.pathname.endsWith('/rpc/send_member_support_reply')) {
      await pause('write'); // Deliberately permits a server receipt after transport abort.
      if (state.writeError) return fail('Write rejected');
      const ticket = state.tickets.find(row => row.id === body.p_ticket_id && row.user_id === actor);
      if (!ticket || actor !== body.p_expected_user) return fail('SUPPORT_TICKET_UNAVAILABLE');
      let message = state.messages.find(row => row.id === body.p_request_id);
      const replayed = !!message;
      if (message && (message.sender_id !== actor || message.ticket_id !== ticket.id || message.body !== body.p_body)) return fail('SUPPORT_REQUEST_CONFLICT');
      if (!message) {
        message = { id: body.p_request_id, ticket_id: ticket.id, sender: 'member', sender_id: actor, body: body.p_body, created_at: '2026-10-31T18:00:00Z' };
        state.messages.push(message); ticket.status = 'open';
        if (state.writeLost) throw new Error('Response lost after commit');
      }
      return response({ message_id: message.id, ticket_id: ticket.id, sender_id: actor, body: message.body, created_at: message.created_at, ticket_status: ticket.status, replayed });
    }
    if (url.pathname.endsWith('/support_tickets') && request.method === 'POST') {
      await pause('write');
      if (state.writeError || actor !== body.user_id) return fail('Write rejected');
      if (state.tickets.some(row => row.id === body.id)) return response({ code: '23505', message: 'Duplicate request' }, 409);
      const ticket = { ...body, status: 'open', created_at: '2026-10-31T18:00:00Z' };
      state.tickets.unshift(ticket);
      if (state.writeLost) throw new Error('Response lost after commit');
      return response(ticket, 201);
    }
    if (url.pathname.endsWith('/support_tickets')) {
      const id = filter(url, 'id'), user = filter(url, 'user_id');
      if (!id && state.listError) return fail('List unavailable');
      const rows = state.tickets.filter(row => row.user_id === actor && (!id || row.id === id) && (!user || row.user_id === user)).map(row => ({ ...row }));
      if (!id) await pause('list');
      return response(rows);
    }
    if (url.pathname.endsWith('/support_messages')) {
      if (state.historyError) return fail('History unavailable');
      const id = filter(url, 'ticket_id');
      const rows = state.messages.filter(row => row.ticket_id === id).map(row => ({ ...row }));
      await pause('history');
      return response(rows);
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  const client = createClient('https://support-test.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  client.auth.getSession = async () => {
    state.authCalls++;
    await pause(`auth:${state.authCalls}`);
    return { data: { session: session() }, error: null };
  };
  const retryStore = {
    getItem: async key => { await pause('storage:get'); return storage.get(key) || null; },
    setItem: async (key, value) => { storage.set(key, value); await pause('storage:set'); },
    removeItem: async key => { await pause('storage:remove'); storage.delete(key); },
  };
  const cryptography = {
    randomUUID: () => `30000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`,
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    digestStringAsync: async (_algorithm, value) => { await pause('digest'); return crypto.createHash('sha256').update(value).digest('hex'); },
  };
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useRef(value) { const index = cursor++; return slots[index] || (slots[index] = { current: value }); },
    useState(value) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof value === 'function' ? value() : value };
      return [slots[index].value, next => {
        const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useCallback(callback, deps) { const index = cursor++; if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { deps, value: callback }; return slots[index].value; },
    useEffect(effect, deps) {
      const index = cursor++, old = slots[index];
      if (!old || !equal(old.deps, deps)) { slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = effect(); }); }
    },
  };
  const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const theme = { ink: { primary: '#000', inverse: '#fff', muted: '#888', secondary: '#444' }, surface: { canvas: '#fff', sunken: '#eee', raised: '#fff', hairline: '#aaa' }, brand: { base: '#333', tintBg: '#eee' } };
  function load(relative) {
    const file = path.join(root, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }, source = fs.readFileSync(file, 'utf8');
    cache.set(file, module); sources[relative] = crypto.createHash('sha256').update(source).digest('hex');
    const local = name => {
      if (name === 'react') return { ...hooks, default: hooks };
      if (name === 'react/jsx-runtime') return runtime;
      if (name === 'react-native') return { View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', ScrollView: 'ScrollView', StatusBar: 'StatusBar', TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView', StyleSheet: { hairlineWidth: 1 }, Platform: { OS: 'ios' }, Alert: { alert: (...args) => alerts.push(args) } };
      if (name === '@react-navigation/native') return { useNavigation: () => ({}), useRoute: () => ({ params: { ticketId: state.ticketId } }), useFocusEffect: callback => hooks.useEffect(() => focused ? callback() : undefined, [callback, focused]) };
      if (name === '@react-navigation/bottom-tabs') return { useBottomTabBarHeight: () => 0 };
      if (name === '@react-native-async-storage/async-storage') return retryStore;
      if (name === 'expo-crypto') return cryptography;
      if (name === '@expo/vector-icons') return { Feather: 'Feather' };
      if (name.endsWith('/SafeArea')) return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
      if (name.endsWith('/KeyboardSafe')) return { default: 'KeyboardSafe' };
      if (name.endsWith('/SettingsExit')) return { default: 'SettingsExit' };
      if (name.endsWith('/useTheme')) return { useTheme: () => ({ t: theme, isDark: false }), getTheme: () => theme, themedSheet: make => make(theme) };
      if (name.endsWith('/tokens')) return { getTheme: () => theme };
      if (name.endsWith('/authStore')) return { useAuthStore: authStore };
      if (name.endsWith('/supabase')) return { supabase: client };
      if (name.endsWith('/settingsNavigation')) return { settingsBack() {} };
      if (name.startsWith('.')) {
        const resolved = path.resolve(path.dirname(file), name);
        const found = ['.ts', '.tsx'].map(extension => resolved + extension).find(candidate => fs.existsSync(candidate));
        if (found) return load(path.relative(root, found));
      }
      throw new Error(`Unexpected import: ${name} in ${relative}`);
    };
    vm.runInNewContext(ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
      { module, exports: module.exports, require: local, console, Date, Promise, Number, Map, Set, JSON, Error, AbortController, setTimeout, clearTimeout, atob }, { filename: relative });
    return module.exports;
  }
  const Component = load(`src/screens/profile/${kind === 'reply' ? 'TicketScreen' : 'ContactSupportScreen'}.tsx`).default;
  function render() {
    let count = 0;
    while (dirty && !disposed) {
      assert.ok(++count < 50, 'Render feedback loop'); dirty = false; cursor = 0; tree = Component();
      while (effects.length) effects.shift()();
    }
  }
  async function settle() { for (let i = 0; i < 8; i++) { render(); await new Promise(setImmediate); } render(); }
  const node = predicate => { const found = walk(tree).find(predicate); assert.ok(found, 'Expected native control'); return found; };
  const input = (value, field = kind === 'reply' ? 'Reply' : 'Message') => { node(item => item.type === 'TextInput' && item.props.accessibilityLabel === field).props.onChangeText(value); render(); };
  return {
    kind, state, client, requests, storage, sources, alerts, settle, token,
    hold: defer, entered: name => pending.get(name)?.entered === true,
    release(name) { assert.ok(pending.has(name), `Missing gate: ${name}`); pending.get(name).resolve(); },
    input,
    prepare(body = 'A retained draft') { if (kind === 'create') { node(item => item.type === 'TouchableOpacity' && text(item) === 'Account').props.onPress(); render(); input('New support issue', 'Subject'); } input(body); },
    send() { node(item => item.type === 'TouchableOpacity' && (kind === 'reply' ? item.props.accessibilityLabel === 'Send' : text(item) === 'Send')).props.onPress(); },
    retry() { node(item => item.type === 'TouchableOpacity' && text(item) === 'Try again').props.onPress(); },
    focus(value) { focused = value; dirty = true; render(); },
    route(ticketId) { state.ticketId = ticketId; dirty = true; render(); },
    changeSession(owner, sessionId, rerender = true) { state.owner = owner; state.sessionId = sessionId; state.tokenRevision++; authListeners.forEach(listener => listener()); if (rerender) { dirty = true; render(); } },
    refresh() { state.tokenRevision++; authListeners.forEach(listener => listener()); },
    dispose() { disposed = true; for (const slot of slots) slot?.cleanup?.(); },
    draft: () => walk(tree).find(item => item.type === 'TextInput' && item.props.accessibilityLabel === (kind === 'reply' ? 'Reply' : 'Message'))?.props.value,
    busy: () => kind === 'reply' ? walk(tree).some(item => item.props?.accessibilityLabel === 'Sending reply') : walk(tree).some(item => item.type === 'TouchableOpacity' && item.props.disabled && walk(item).some(child => child.type === 'ActivityIndicator')),
    words: () => text(tree),
    writes: () => requests.filter(request => request.method === 'POST'),
    committed: () => kind === 'reply' ? state.messages : state.tickets.filter(row => row.id !== TICKET),
  };
}

module.exports = { memberSupportHarness, OWNER, OTHER, TICKET, TICKET_B };
