const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const words = node => node == null ? '' : Array.isArray(node) ? node.map(words).join('')
  : typeof node === 'object' ? words(node.props?.children) : String(node);
function nodes(tree) { const list = []; const walk = node => { if (Array.isArray(node)) return node.forEach(walk);
  if (!node || typeof node !== 'object') return; list.push(node); walk(node.props?.children); }; walk(tree); return list; }
const conversations = (primary, requests, business = 'business') => Array.from({ length: primary + requests }, (_, n) => ({
  id: `${business}-${n}`, conversation_id: `${business}-${n}`, business, context: 'market', other_id: `customer-${n}`,
  other_name: `Customer ${n}`, other_username: `customer${n}`, other_avatar: `avatar-${n}.jpg`,
  last_text: `Business preview ${n}`, last_at: new Date(Date.UTC(2026, 10, 1) - n * 1000).toISOString(),
  last_sender: business, unread: n + 1, is_request: n >= primary,
}));

function scenario(rows, options = {}) {
  let owner = 'human', scope = '1:human', revision = 1, business = 'business', focused = true, allowed = true;
  let cursor = 0, dirty = true, tree, disposed = false, now = 0, timerId = 0, override;
  const slots = [], effects = [], calls = [], timers = new Map(), modules = new Map(), appListeners = new Set();
  const same = (a, b) => a && b && a.length === b.length && a.every((value, n) => Object.is(value, b[n]));
  const hooks = {
    useState(initial) { const n = cursor++; if (!slots[n]) slots[n] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[n].value, update => { const value = typeof update === 'function' ? update(slots[n].value) : update;
        if (!Object.is(value, slots[n].value)) { slots[n].value = value; dirty = true; } }]; },
    useRef(initial) { const n = cursor++; return slots[n] ??= { current: initial }; },
    useCallback(fn, deps) { const n = cursor++; if (!slots[n] || !same(slots[n].deps, deps)) slots[n] = { value: fn, deps }; return slots[n].value; },
    useEffect(fn, deps) { const n = cursor++, prior = slots[n]; if (!prior || !same(prior.deps, deps)) {
      slots[n] = { deps }; effects.push(() => { prior?.cleanup?.(); slots[n].cleanup = fn(); }); } },
  };
  const app = { currentState: 'active', addEventListener(_event, fn) { appListeners.add(fn); return { remove: () => appListeners.delete(fn) }; } };
  const clock = { setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { at: now + delay, fn }); return id; }, clearTimeout(id) { timers.delete(id); } };
  const auth = Object.assign(() => ({ profile: { id: owner } }), { getState: () => ({ session: { user: { id: owner }, access_token: `token-${scope}` } }) });
  const navigation = { calls: [], navigate(...args) { this.calls.push(args); }, goBack() {} };
  const client = { rpc(name, args) {
    const call = { name, args, signal: null, token: null };
    const query = { setHeader(_key, value) { call.token = value; return query; }, abortSignal(value) { call.signal = value; return query; },
      then(ok, bad) { calls.push(call); return Promise.resolve().then(async () => {
        if (override) { const result = await override(call); if (result !== undefined) return result; }
        if (name === 'get_paged_reader_capabilities') return { data: { version: 1, inbox: options.ready !== false, books: false }, error: null };
        const all = allowed ? rows.filter(row => row.business === args.p_business_id && !row.denied) : [];
        if (name === 'get_business_conversations') return { data: all, error: null };
        if (name === 'get_business_inbox_page_v2') {
          if (options.missing) return { data: null, error: { code: 'PGRST202' } };
          const selected = args.p_ids ? all.filter(row => args.p_ids.includes(row.id)) : all.filter(row => row.is_request === (args.p_tab === 'requests'));
          const offset = args.p_cursor?.offset ?? 0, items = selected.slice(offset, offset + args.p_limit), more = offset + items.length < selected.length;
          return { data: { version: 2, can_view: allowed, items, has_more: more, next_cursor: more
            ? { version: 2, kind: 'business_inbox', viewer: owner, business: args.p_business_id, tab: args.p_tab, offset: offset + items.length } : null,
            summary: { primary: all.filter(row => !row.is_request).length, requests: all.filter(row => row.is_request).length } }, error: null };
        }
        throw Error('Unexpected RPC ' + name);
      }).then(ok, bad); } };
    return query;
  }, from() { throw Error('Raw conversation fanout is forbidden'); } };
  const runtime = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
  const theme = { ink: {}, surface: {}, brand: {} };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    const module = { exports: {} }; modules.set(relative, module);
    const requireLocal = name => {
      if (name === 'react') return { ...hooks, default: hooks };
      if (name === 'react/jsx-runtime') return runtime;
      if (name === 'react-native') return { View: 'View', Text: 'Text', FlatList: 'FlatList', TouchableOpacity: 'TouchableOpacity', Image: 'Image',
        RefreshControl: 'RefreshControl', ActivityIndicator: 'ActivityIndicator', StatusBar: 'StatusBar', AppState: app, StyleSheet: { hairlineWidth: 1 } };
      if (name === '@react-navigation/native') return { useNavigation: () => navigation,
        useRoute: () => ({ params: { businessId: business, businessName: 'The business' } }),
        useFocusEffect: fn => hooks.useEffect(() => focused ? fn() : undefined, [fn, focused]) };
      if (name.endsWith('stores/authStore')) return { useAuthStore: auth };
      if (name.endsWith('lib/navigationCache')) return { navigationScope: () => scope };
      if (name === './supabase') return { supabase: client };
      if (name.endsWith('useTheme')) return { themedSheet: fn => fn(theme), useTheme: () => ({ t: theme, isDark: false }) };
      if (name.endsWith('SafeArea')) return { SafeAreaView: 'SafeAreaView' };
      if (name.endsWith('skeletons')) return { ListRowSkeleton: 'Skeleton' };
      if (name === '@expo/vector-icons') return { Feather: 'Feather' };
      if (name.includes('shared/') || name.endsWith('services/businessInbox')) return load(path.relative(root, path.resolve(root, path.dirname(relative), name) + '.ts'));
      return { default: name };
    };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
      fileName: relative, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, { module, exports: module.exports, require: requireLocal, AbortController, ...clock }); return module.exports;
  }
  const service = load('src/services/businessInbox.ts'), Component = load('src/screens/profile/BusinessInboxScreen.tsx').default;
  function render() { let guard = 0; while (dirty && !disposed) { assert.ok(++guard < 30, 'render settles'); dirty = false; cursor = 0;
    tree = Component(); while (effects.length) effects.shift()(); } }
  const list = () => nodes(tree).find(node => node.type === 'FlatList');
  async function flush() { for (let n = 0; n < 12; n++) { render(); await new Promise(done => setImmediate(done)); } render(); }
  render();
  return { calls, navigation, service, list, flush, text: () => words(tree),
    setReply(fn) { override = fn; }, more() { list().props.onEndReached(); render(); },
    tab(label) { const button = nodes(list().props.ListHeaderComponent).find(row => row.type === 'TouchableOpacity' && words(row).startsWith(label));
      assert.ok(button); button.props.onPress(); render(); },
    refresh() { list().props.refreshControl.props.onRefresh(); render(); },
    focus(value) { focused = value; dirty = true; render(); },
    account(value) { owner = value; scope = `${++revision}:${value}`; dirty = true; render(); },
    business(value) { business = value; dirty = true; render(); },
    permit(value) { allowed = value; },
    background(value) { app.currentState = value ? 'background' : 'active'; appListeners.forEach(fn => fn(app.currentState)); render(); },
    async tick(ms) { const end = now + ms; while (true) { const next = [...timers].filter(([, row]) => row.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush(); } now = end; await flush(); },
    retry() { const button = nodes(list()?.props.ListFooterComponent ?? tree).find(row => row.type === 'TouchableOpacity' && words(row).includes('Try again'));
      assert.ok(button); button.props.onPress(); render(); },
    dispose() { disposed = true; slots.forEach(slot => slot?.cleanup?.()); timers.clear(); },
  };
}

test('business paging preserves full Primary/Requests counts, sender preview and acting-business navigation', async () => {
  const h = scenario(conversations(65, 75)); await h.flush();
  assert.equal(h.list().props.data.length, 30); assert.ok(words(h.list().props.ListHeaderComponent).includes('Primary 65'));
  assert.ok(words(h.list().props.ListHeaderComponent).includes('Requests 75'));
  const item = h.list().props.data[0], row = h.list().props.renderItem({ item }); assert.ok(words(row).includes('You: Business preview 0'));
  assert.ok(words(row).includes('MARKET')); row.props.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(h.navigation.calls[0])), ['Chat', { conversationId: 'business-0', userId: 'customer-0', userName: 'Customer 0',
    actAsId: 'business', otherUser: { id: 'customer-0', full_name: 'Customer 0', username: 'customer0', avatar_url: 'avatar-0.jpg' } }]);
  assert.ok(h.calls.every(call => call.token === 'Bearer token-1:human'));
  assert.ok(h.calls.filter(call => call.name === 'get_business_inbox_page_v2').every(call => call.args.p_business_id === 'business'));
  h.more(); h.more(); await h.flush(); assert.equal(h.list().props.data.length, 60);
  h.more(); await h.flush(); assert.equal(h.list().props.data.length, 65);
  h.tab('Requests'); await h.flush(); assert.equal(h.list().props.data.length, 30);
  h.more(); await h.flush(); h.more(); await h.flush(); assert.equal(h.list().props.data.length, 75);
  assert.ok(h.list().props.data.every(row => row.is_request)); h.tab('Primary'); await h.flush();
  assert.equal(h.list().props.data.length, 65, 'returning to a tab retains the loaded window'); h.dispose();
});

test('an inbox with only requests still exposes the full Requests tab rather than false empty state', async () => {
  const h = scenario(conversations(0, 85)); await h.flush(); assert.equal(h.list().props.data.length, 0);
  assert.ok(words(h.list().props.ListHeaderComponent).includes('Requests 85'));
  h.tab('Requests'); await h.flush(); assert.equal(h.list().props.data.length, 30); h.dispose();
});

test('disabled capability or missing business RPC keeps every legacy destination and exact tab totals', async () => {
  for (const options of [{ ready: false }, { missing: true }]) {
    const h = scenario(conversations(137, 103), options); await h.flush(); assert.equal(h.list().props.data.length, 137);
    h.tab('Requests'); await h.flush(); assert.equal(h.list().props.data.length, 103);
    assert.ok(words(h.list().props.ListHeaderComponent).includes('Primary 137'));
    const before = h.calls.length; h.more(); await h.flush(); assert.equal(h.calls.length, before); h.dispose();
  }
});

test('membership denial on continuation removes retained rows and tab totals immediately', async () => {
  const h = scenario(conversations(80, 40)); await h.flush(); h.permit(false); h.more(); await h.flush();
  assert.equal(h.list(), undefined); assert.ok(h.text().includes('No conversations yet'));
  h.permit(true); h.focus(false); h.focus(true); await h.flush(); assert.equal(h.list().props.data.length, 30); h.dispose();
});

test('permission failures never downgrade to an old definer reader', async () => {
  const h = scenario(conversations(40, 0)); h.setReply(call => call.name === 'get_business_inbox_page_v2' ? { data: null, error: { code: '42501' } } : undefined);
  await h.flush(); assert.ok(h.text().includes('could not be loaded')); assert.equal(h.calls.filter(call => call.name === 'get_business_conversations').length, 0); h.dispose();
});

test('failed continuation and refresh retries repeat the correct operation without dropping readable rows', async () => {
  const rows = conversations(80, 20), h = scenario(rows); await h.flush();
  h.setReply(call => call.args?.p_cursor ? { data: null, error: { code: 'offline' } } : undefined); h.more(); await h.flush();
  assert.equal(h.list().props.data.length, 30); h.setReply(undefined); h.retry(); await h.flush(); assert.equal(h.list().props.data.length, 60);
  h.setReply(call => call.name === 'get_business_inbox_page_v2' ? { data: null, error: { code: 'offline' } } : undefined);
  h.refresh(); await h.flush(); rows[40].denied = true; h.setReply(undefined); const before = h.calls.length; h.retry(); await h.flush();
  assert.equal(h.calls.slice(before).find(call => call.name === 'get_business_inbox_page_v2').args.p_cursor, null);
  assert.ok(!h.list().props.data.some(row => row.id === 'business-40')); h.dispose();
});

test('tab, business and account changes reject delayed responses and preserve only the current acting identity', async () => {
  const h = scenario([...conversations(80, 40), ...conversations(80, 40, 'other-business')]); await h.flush();
  const gate = deferred(); let held; h.setReply(call => { if (call.args?.p_cursor) { held = call; return gate.promise; } });
  h.more(); await h.flush(); h.tab('Requests'); assert.equal(held.signal.aborted, true); await h.flush();
  h.business('other-business'); await h.flush(); h.account('other-human'); h.account('human'); h.setReply(undefined); await h.flush();
  gate.resolve({ data: { version: 2, can_view: true, items: [{ ...conversations(1, 0)[0], id: 'stale', conversation_id: 'stale' }],
    has_more: false, next_cursor: null, summary: { primary: 1, requests: 0 } }, error: null }); await h.flush();
  assert.ok(h.list().props.data.every(row => row.business === 'other-business' && row.is_request)); h.dispose();
});

test('blur/background abort reads, and a hung visible page times out with retry feedback', async () => {
  const h = scenario(conversations(80, 20)); await h.flush(); const gate = deferred(); let held;
  h.setReply(call => { if (call.args?.p_cursor) { held = call; return gate.promise; } }); h.more(); await h.flush();
  h.focus(false); assert.equal(held.signal.aborted, true); h.setReply(undefined); h.focus(true); await h.flush();
  h.setReply(call => { if (call.args?.p_cursor) { held = call; return gate.promise; } }); h.more(); await h.flush(); await h.tick(12000);
  assert.equal(held.signal.aborted, true); assert.ok(words(h.list().props.ListFooterComponent).includes('Try again'));
  h.background(true); const before = h.calls.length; await h.tick(60000); assert.equal(h.calls.length, before);
  h.setReply(undefined); h.background(false); await h.flush(); assert.ok(h.calls.length > before);
  gate.resolve({ data: null, error: { code: 'late' } }); await h.flush(); assert.equal(h.list().props.ListFooterComponent, null); h.dispose();
});
