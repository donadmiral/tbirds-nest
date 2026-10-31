const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function compile(source, globals = {}, fileName = 'fixture.ts') {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, console, Error, Promise, Map, Set, RegExp, AbortController, setTimeout, clearTimeout, ...globals });
  return module.exports;
}
const cacheModule = compile(read('shared/navigationCache.ts'));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const plain = value => JSON.parse(JSON.stringify(value));
const emptyFilters = { minPrice: '', maxPrice: '', condition: null, city: '', sort: 'recent' };
const selection = extras => ({ tab: 'browse', search: '', category: null, homeCity: 'Harare', filters: { ...emptyFilters }, ...extras });
const listing = id => ({ id: String(id), title: 'Listing ' + id, status: 'available', images: [], price: 10, category: 'Electronics', hidden_at: null });

function serviceHarness(respond = () => ({ data: [], error: null }), timers = {}) {
  let scope = '1:owner', owner = 'owner', token = 'owner-token';
  const calls = [], listeners = new Set(), cache = cacheModule.createNavigationCache(); cache.setScope(scope);
  const navigation = { navigationCache: cache, navigationScope: () => scope, subscribeNavigationScope(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  const auth = selector => selector(auth.getState()); auth.getState = () => ({ session: owner ? { user: { id: owner }, access_token: token } : null, profile: owner ? { id: owner, location: 'Harare' } : null });
  function query(table, args) {
    const call = { table, args, filters: [], headers: {}, columns: null, action: 'read' };
    const q = {
      setHeader(name, value) { call.headers[name] = value; return q; }, abortSignal(signal) { call.signal = signal; return q; },
      select(value) { call.columns = value; return q; }, range(start, end) { call.range = [start, end]; return q; },
      upsert(value) { call.action = 'upsert'; call.value = value; return q; }, delete() { call.action = 'delete'; return q; },
      then(ok, bad) { calls.push(call); return Promise.resolve().then(() => respond(call)).then(ok, bad); },
    };
    for (const key of ['eq', 'neq', 'is', 'in', 'ilike', 'gte', 'lte', 'order']) q[key] = (...value) => { call.filters.push([key, ...value]); return q; };
    return q;
  }
  const client = { rpc: (name, args) => query(name, args), from: name => query(name) };
  const service = compile(read('src/services/navigationDirectory.ts'), { ...timers, require(name) {
    if (name.endsWith('/navigationCache')) return navigation;
    if (name.endsWith('/authStore')) return { useAuthStore: auth };
    if (name === './supabase') return { supabase: client };
    throw Error(name);
  } });
  function account(next, nextScope = (Number(scope?.split(':')[0] || 0) + 1) + ':' + next) {
    owner = next; token = next + '-token'; scope = next ? nextScope : null;
    cache.setScope(scope); listeners.forEach(fn => fn());
  }
  return { service, navigation, cache, auth, client, calls, listeners, account };
}

test('ranked Market counts scanned rows even when RLS hydration removes visible records', async () => {
  const h = serviceHarness(call => call.table === 'get_market_feed' ? { data: Array.from({ length: 31 }, (_, i) => listing(i)), error: null }
    : call.table === 'marketplace_listings' ? { data: [listing(4), listing(7)], error: null } : { data: [{ listing_id: '7' }], error: null });
  const page = await h.service.readMarketDirectory('1:owner', selection(), 60, [], true, new AbortController().signal);
  assert.deepEqual(plain(page.rows.map(row => row.id)), ['4', '7']); assert.equal(page.nextOffset, 90); assert.equal(page.hasMore, true);
  assert.deepEqual(plain(page.savedIds), ['7']);
  assert.equal(h.calls.find(call => call.table === 'get_market_feed').args.p_offset, 60);
  for (const call of h.calls) { assert.equal(call.headers.Authorization, 'Bearer owner-token'); assert.ok(call.signal instanceof AbortSignal); }
  assert.equal(h.listeners.size, 0);
});

test('Market starts saved-state and ranked reads together and does not mask their failures', async () => {
  const gate = deferred();
  const h = serviceHarness(call => call.table === 'get_market_feed' ? gate.promise : { data: null, error: Error('saved unavailable') });
  const run = h.service.readMarketDirectory('1:owner', selection(), 0, [], true, new AbortController().signal);
  await assert.rejects(run, /saved unavailable/);
  assert.equal(h.calls.length, 2); assert.ok(h.calls.every(call => call.signal.aborted));
  gate.resolve({ data: [listing('late')], error: null }); await settle();
  assert.equal(h.calls.length, 2, 'a failed parallel request cancels later hydration');
});

test('retained Market pages use current RLS/filter data in batches of at most 100 and two at once', async () => {
  let pending = 0, maximum = 0; const gates = [], batches = [];
  const h = serviceHarness(call => {
    if (call.table === 'get_market_feed') return { data: [listing('fresh')], error: null };
    const ids = call.filters.find(filter => filter[0] === 'in')[2]; batches.push(ids);
    pending++; maximum = Math.max(maximum, pending); const gate = deferred(); gates.push(() => { pending--; gate.resolve({ data: ids.filter(id => id !== 'revoked').map(listing), error: null }); }); return gate.promise;
  });
  const ids = ['revoked', ...Array.from({ length: 245 }, (_, i) => String(i))];
  const run = h.service.readMarketDirectory('1:owner', selection(), 0, ids, false, new AbortController().signal);
  await settle(); assert.equal(gates.length, 2); gates.splice(0).forEach(done => done()); await settle(); gates.splice(0).forEach(done => done());
  const page = await run; assert.equal(maximum, 2); assert.ok(batches.every(batch => batch.length <= 100));
  assert.equal(page.retained.length, 245); assert.ok(page.retained.every(row => row.id !== 'revoked'));
  assert.ok(h.calls.filter(call => call.table === 'marketplace_listings').every(call => call.filters.some(filter => filter[0] === 'is' && filter[1] === 'hidden_at' && filter[2] === null)));
});

test('Market cancellation stops retained batches and ignores a late read across A to B to A', async () => {
  const gate = deferred(), h = serviceHarness(call => call.table === 'get_market_feed' ? gate.promise : { data: [], error: null });
  const run = h.service.readMarketDirectory('1:owner', selection(), 0, ['private'], false, new AbortController().signal);
  await settle(); h.account('second'); h.account('owner');
  await assert.rejects(run, /account changed|cancelled/); gate.resolve({ data: [listing('late')], error: null }); await settle();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].signal.aborted, true); assert.equal(h.listeners.size, 0);
});

test('all directory stages share a 12-second bound even when a transport never settles', async () => {
  const timers = new Map(); let n = 0;
  const h = serviceHarness(() => new Promise(() => {}), { setTimeout(fn, delay) { timers.set(++n, { fn, delay }); return n; }, clearTimeout(id) { timers.delete(id); } });
  const run = h.service.readChannelDirectory('1:owner', 'communities', '', new AbortController().signal);
  await settle(); assert.equal(h.calls.length, 2); assert.equal(timers.size, 1);
  const timer = [...timers.values()][0]; assert.equal(timer.delay, 12000); timer.fn();
  await assert.rejects(run, /could not be confirmed/); assert.ok(h.calls.every(call => call.signal.aborted)); assert.equal(timers.size, 0); assert.equal(h.listeners.size, 0);
});

test('Market background reconciliation retains scroll and cursor, removes revoked rows, and adopts updated values', () => {
  const { service } = serviceHarness();
  const previous = { rows: [listing('known'), listing('revoked')], savedIds: [], offset: 90, hasMore: true, top: 620, ready: true };
  const next = service.mergeMarketDirectory(previous, { rows: [listing('new'), { ...listing('known'), price: 42 }], retained: [listing('known')], savedIds: [], nextOffset: 30, hasMore: true }, false, true);
  assert.deepEqual(plain(next.rows.map(row => row.id)), ['known']); assert.equal(next.rows[0].price, 42); assert.equal(next.top, 620); assert.equal(next.offset, 90); assert.equal(next.hasMore, true);
  const allRevoked = service.mergeMarketDirectory(previous, { rows: [listing('new')], retained: [], savedIds: [], nextOffset: 1, hasMore: false }, false, true);
  assert.equal(allRevoked.top, 0); assert.equal(allRevoked.offset, 1); assert.deepEqual(plain(allRevoked.rows.map(row => row.id)), ['new']);
});

test('Market filter reads keep price/category/sort and owner selling context on the server', async () => {
  const h = serviceHarness(() => ({ data: [], error: null }));
  await h.service.readMarketDirectory('1:owner', selection({ filters: { ...emptyFilters, minPrice: '2', maxPrice: '9', condition: 'Good', city: 'Bulawayo', sort: 'price_low' }, category: 'Other', search: 'chair' }), 30, [], false, new AbortController().signal);
  assert.deepEqual(h.calls[0].range, [30, 60]);
  for (const entry of [['gte', 'price', 2], ['lte', 'price', 9], ['eq', 'category', 'Other'], ['eq', 'condition', 'Good'], ['ilike', 'location_city', '%Bulawayo%'], ['ilike', 'title', '%chair%']]) assert.ok(h.calls[0].filters.some(value => JSON.stringify(value) === JSON.stringify(entry)));
  await h.service.readMarketDirectory('1:owner', selection({ tab: 'selling' }), 0, [], false, new AbortController().signal);
  assert.ok(h.calls[1].filters.some(value => JSON.stringify(value) === JSON.stringify(['eq', 'seller_id', 'owner'])));
});

test('community invitations are merged once, and a partial or malformed directory response never becomes an empty success', async () => {
  const h = serviceHarness(call => ({ data: call.table === 'get_communities' ? [{ id: 'normal' }, { id: 'also-invited' }] : [{ id: 'invite-only', name: 'Private club' }, { id: 'also-invited' }], error: null }));
  const result = await h.service.readChannelDirectory('1:owner', 'communities', '', new AbortController().signal);
  assert.deepEqual(plain(result.map(row => row.id)), ['invite-only', 'also-invited', 'normal']); assert.equal(result[0].join_mode, 'invite');
  for (const bad of [null, {}, [{ name: 'missing id' }]]) {
    const malformed = serviceHarness(() => ({ data: bad, error: null }));
    await assert.rejects(malformed.service.readChannelDirectory('1:owner', 'channels', '', new AbortController().signal), /could not be verified/);
  }
  const partial = serviceHarness(call => call.table === 'get_my_community_invites' ? { data: null, error: Error('invites unavailable') } : { data: [{ id: 'public' }], error: null });
  await assert.rejects(partial.service.readChannelDirectory('1:owner', 'communities', '', new AbortController().signal), /invites unavailable/);
});

test('directory mutations pin their owner, reject pre-dispatch account round trips and clear subscriptions', async () => {
  const h = serviceHarness(() => ({ data: 'confirmed', error: null }));
  const result = await h.service.mutateDirectory('1:owner', (pin, ownerId) => pin(h.client.from('saved_listings').upsert({ user_id: ownerId, listing_id: 'item' })));
  assert.equal(result, 'confirmed'); assert.equal(h.calls[0].headers.Authorization, 'Bearer owner-token'); assert.equal(h.calls[0].value.user_id, 'owner'); assert.equal(h.listeners.size, 0);
  const pending = h.service.mutateDirectory('1:owner', pin => pin(h.client.rpc('create_channel')));
  h.account('second'); h.account('owner'); await assert.rejects(pending, /account changed|cancelled/);
  assert.equal(h.calls.length, 1); assert.equal(h.listeners.size, 0);
});

test('real Supabase query builders keep explicit owner Authorization for directory RPCs and writes', async () => {
  const { createClient } = require('@supabase/supabase-js'), requests = [];
  const client = createClient('https://fixture.supabase.co', 'fixture-anon-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init.headers), signal: init.signal, body: init.body });
    return new Response(String(url).includes('/rpc/') ? '[]' : '', { status: String(url).includes('/rpc/') ? 200 : 201, headers: { 'content-type': 'application/json' } });
  } } });
  const h = serviceHarness();
  const service = compile(read('src/services/navigationDirectory.ts'), { require(name) {
    if (name.endsWith('/navigationCache')) return h.navigation;
    if (name.endsWith('/authStore')) return { useAuthStore: h.auth };
    if (name === './supabase') return { supabase: client };
    throw Error(name);
  } });
  await service.readChannelDirectory('1:owner', 'channels', 'Music', new AbortController().signal);
  await service.mutateDirectory('1:owner', (pin, ownerId) => pin(client.from('saved_listings').upsert({ user_id: ownerId, listing_id: 'item' })));
  assert.equal(requests.length, 2); assert.ok(requests.every(request => request.headers.get('authorization') === 'Bearer owner-token'));
  assert.ok(requests.every(request => request.signal instanceof AbortSignal)); assert.equal(JSON.parse(requests[1].body).user_id, 'owner');
});

function componentHarness(which, { readMarket, readChannels, mutate, seed } = {}) {
  const h = serviceHarness(), slots = [], timers = new Map(); let cursor = 0, layouts = [], effects = [], dirty = false, tree, focused = true, nextTimer = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => value === b[i]);
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { const value = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; } }]; },
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { effect(fn, deps, false); }, useLayoutEffect(fn, deps) { effect(fn, deps, true); },
    useSyncExternalStore(subscribe, get) { const [, update] = hooks.useState(0); hooks.useEffect(() => subscribe(() => update(v => v + 1)), [subscribe]); return get(); },
  };
  function effect(fn, deps, layout) {
    const i = cursor++, old = slots[i];
    if (!old || !same(old.deps, deps)) { const record = { deps, cleanup: old?.cleanup }; slots[i] = record; (layout ? layouts : effects).push(() => { record.cleanup?.(); record.cleanup = fn(); }); }
  }
  const calls = [], alerts = [], navigation = { navigate() {}, goBack() {} };
  const directory = { ...h.service,
    readMarketDirectory: async (...args) => { calls.push({ kind: 'market', args }); return readMarket ? readMarket(...args) : { rows: [listing('market')], retained: [], nextOffset: 1, hasMore: false, savedIds: [] }; },
    readChannelDirectory: async (...args) => { calls.push({ kind: 'channels', args }); return readChannels ? readChannels(...args) : [{ id: args[1], name: args[1] }]; },
    mutateDirectory: mutate || h.service.mutateDirectory,
  };
  if (seed) seed(h.cache, directory);
  const light = compile(read('src/constants/tokens/light.ts')).light;
  const stubs = new Proxy({}, { get: (_, name) => name === '__esModule' ? true : String(name) });
  const unread = selector => selector({ counts: { market: 0 } }); unread.getState = () => ({ refresh() {} });
  function requireMock(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
    if (name === 'react-native') return { ...stubs, View: 'View', Text: 'Text', StyleSheet: { hairlineWidth: 1 }, TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity', FlatList: 'FlatList', ActivityIndicator: 'ActivityIndicator', RefreshControl: 'RefreshControl', Alert: { alert: (...args) => alerts.push(args) }, useWindowDimensions: () => ({ width: 390 }), Modal: 'Modal', ScrollView: 'ScrollView', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios' } };
    if (name === '@react-navigation/native') return { useNavigation: () => navigation, useFocusEffect: fn => hooks.useEffect(() => focused ? fn() : undefined, [fn, focused]) };
    if (name.endsWith('/useTheme')) return { themedSheet: factory => factory(light), getTheme: () => light, useTheme: () => ({ t: light, isDark: false }) };
    if (name.endsWith('/authStore')) return { useAuthStore: h.auth };
    if (name.endsWith('/unreadStore')) return { useUnreadStore: unread };
    if (name.endsWith('/navigationCache')) return h.navigation;
    if (name.endsWith('/navigationDirectory')) return directory;
    if (name.endsWith('/supabase')) return { supabase: h.client };
    if (name.endsWith('/SafeArea')) return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 20 }) };
    if (name.endsWith('/MarketFilterSheet')) return { default: 'MarketFilterSheet', __esModule: true, EMPTY_FILTERS: emptyFilters };
    if (name.endsWith('/marketService')) return { MARKET_CATEGORIES: ['Electronics'], marketService: { getListing: async () => null } };
    if (name.endsWith('/categories')) return { CATEGORIES: [] };
    if (name.endsWith('/AdaptiveTabBar')) return { handleTabBarScroll() {} };
    if (name.endsWith('/screenTransition')) return { prefetch() {} };
    return stubs;
  }
  const file = which === 'market' ? 'src/screens/market/MarketScreen.tsx' : 'src/screens/channels/ChannelsScreen.tsx';
  const Component = compile(read(file), { require: requireMock, setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } }, file).default;
  function render() {
    let loops = 0;
    do { assert.ok(++loops < 30, 'component settles'); dirty = false; cursor = 0; tree = Component({ navigation }); const run = layouts; layouts = []; run.forEach(fn => fn()); } while (dirty);
    const run = effects; effects = []; run.forEach(fn => fn()); return tree;
  }
  function nodes() { const result = []; function visit(value) { if (Array.isArray(value)) return value.forEach(visit); if (!value || typeof value !== 'object') return; result.push(value); visit(value.props?.children); } visit(tree); return result; }
  function list() { return nodes().find(node => (node.type === 'TapTopFlatList' || node.type === 'FlatList') && !node.props.horizontal); }
  return { ...h, calls, alerts, timers, render, nodes, list, directory, focus(next) { focused = next; render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    async flush() { for (let i = 0; i < 4; i++) { await settle(); render(); } },
    fireTyping() { const tasks = [...timers.entries()].filter(([, task]) => task.delay === 250); tasks.forEach(([id, task]) => { timers.delete(id); task.fn(); }); render(); },
  };
}

test('Market restores a loaded grid and exact saved scroll before a slow focus refresh, with no focus debounce', async () => {
  const gate = deferred();
  const h = componentHarness('market', { seed(cache, service) { cache.save('1:owner', service.marketDirectoryKey(selection()), { rows: [listing('known')], savedIds: [], offset: 60, hasMore: true, top: 420, ready: true }); }, readMarket: () => gate.promise });
  h.render(); assert.deepEqual(plain(h.list().props.data.map(row => row.id)), ['known']); assert.equal(h.list().props.contentOffset.y, 420);
  assert.equal(h.nodes().some(node => node.type === 'ListRowSkeleton'), false); assert.equal(h.timers.size, 0); assert.equal(h.calls.length, 1);
  h.list().props.onScroll({ nativeEvent: { contentOffset: { y: 650 } } });
  gate.resolve({ rows: [listing('new'), listing('known')], retained: [listing('known')], nextOffset: 30, hasMore: true, savedIds: [] }); await h.flush();
  assert.equal(h.list().props.contentOffset.y, 650); assert.deepEqual(plain(h.list().props.data.map(row => row.id)), ['known']); h.unmount();
});

test('Market tab returns restore each loaded view while failed refresh leaves content and scroll visible', async () => {
  let fail = false;
  const h = componentHarness('market', { readMarket: async (_scope, select) => { if (fail) throw Error('offline'); return { rows: [listing(select.tab)], retained: [listing(select.tab)], nextOffset: 1, hasMore: false, savedIds: [] }; } });
  h.render(); await h.flush(); h.list().props.onScroll({ nativeEvent: { contentOffset: { y: 320 } } });
  h.nodes().find(node => node.props?.accessibilityRole === 'tab' && node.props.children.props.children === 'Saved').props.onPress(); h.render(); await h.flush();
  assert.equal(h.list().props.data[0].id, 'saved'); fail = true;
  h.nodes().find(node => node.props?.accessibilityRole === 'tab' && node.props.children.props.children === 'Browse').props.onPress(); h.render();
  assert.equal(h.list().props.data[0].id, 'browse'); assert.equal(h.list().props.contentOffset.y, 320);
  await h.flush(); assert.equal(h.list().props.data[0].id, 'browse'); assert.equal(h.nodes().some(node => node.type === 'ListRowSkeleton'), false);
  assert.ok(h.nodes().some(node => node.type === 'Text' && String(node.props.children).includes('Could not load listings'))); h.unmount();
});

test('Market only debounces changed text, preserves loaded content while typing, and cancels departed searches', async () => {
  const gate = deferred();
  const h = componentHarness('market', { readMarket: async (_scope, select) => select.search ? gate.promise : { rows: [listing('known')], retained: [], nextOffset: 1, hasMore: false, savedIds: [] } });
  h.render(); await h.flush();
  h.nodes().find(node => node.type === 'TextInput').props.onChangeText('camera'); h.render();
  assert.equal(h.calls.length, 1); assert.equal(h.list().props.data[0].id, 'known'); h.fireTyping(); assert.equal(h.calls.length, 2);
  h.focus(false); assert.equal(h.calls[1].args.at(-1).aborted, true);
  gate.resolve({ rows: [listing('late')], retained: [], nextOffset: 1, hasMore: false, savedIds: [] }); await h.flush();
  assert.ok(!h.list()?.props.data.some(row => row.id === 'late')); h.unmount();
});

for (const which of ['market', 'channels']) test(`${which} clears retained rows, controls and requests across an account round trip`, async () => {
  const h = componentHarness(which); h.render(); await h.flush();
  h.nodes().find(node => node.type === 'TextInput').props.onChangeText('private search'); h.render();
  const oldKey = h.list().key;
  h.account('second'); h.render(); h.account('owner'); h.render();
  assert.equal(h.nodes().find(node => node.type === 'TextInput').props.value, '');
  assert.equal(h.cache.read('1:owner', oldKey), null); assert.equal(h.list()?.props.data.length || 0, 0);
  await h.flush(); h.unmount();
});

test('Channels restores each tab and scroll immediately, keeps data on error, and removes revoked invitations after success', async () => {
  let fail = false, revoked = false;
  const h = componentHarness('channels', { readChannels: async (_scope, tab) => { if (fail) throw Error('offline'); return revoked ? [] : [{ id: tab, name: tab, has_invite: tab === 'communities' }]; } });
  h.render(); await h.flush(); h.list().props.onScroll({ nativeEvent: { contentOffset: { y: 220 } } });
  const tab = name => h.nodes().find(node => node.props?.accessibilityRole === 'tab' && node.props.children[1].props.children === name);
  tab('Communities').props.onPress(); h.render(); await h.flush(); h.list().props.onScroll({ nativeEvent: { contentOffset: { y: 110 } } });
  fail = true; tab('Channels').props.onPress(); h.render(); assert.equal(h.list().props.data[0].id, 'channels'); assert.equal(h.list().props.contentOffset.y, 220); assert.equal(h.timers.size, 0);
  await h.flush(); assert.equal(h.list().props.data[0].id, 'channels'); assert.ok(h.nodes().some(node => node.type === 'Text' && String(node.props.children).includes('directory could not be loaded')));
  tab('Communities').props.onPress(); h.render(); assert.equal(h.list().props.data[0].id, 'communities'); assert.equal(h.list().props.contentOffset.y, 110);
  fail = false; revoked = true; h.focus(false); h.focus(true); await h.flush(); assert.equal(h.list().props.data.length, 0); h.unmount();
});

test('an already resolved empty directory remains an empty view during a slow refresh', async () => {
  const gate = deferred(); let first = true;
  const h = componentHarness('channels', { readChannels: () => { if (first) { first = false; return []; } return gate.promise; } });
  h.render(); await h.flush(); h.focus(false); h.focus(true); h.render();
  assert.equal(h.list().props.data.length, 0); assert.equal(h.nodes().some(node => node.type === 'ActivityIndicator'), false);
  gate.resolve([]); await h.flush(); h.unmount();
});

test('Market only marks a save after confirmation and ignores an older refresh saved-state response', async () => {
  const write = deferred(), refresh = deferred(); let reads = 0;
  const h = componentHarness('market', { readMarket: () => ++reads === 1 ? { rows: [listing('item')], retained: [], nextOffset: 1, hasMore: false, savedIds: [] } : refresh.promise, mutate: () => write.promise });
  h.render(); await h.flush(); h.focus(false); h.focus(true);
  const save = h.list().props.renderItem({ item: listing('item') }).props.children.find(node => node?.props?.accessibilityLabel === 'Save listing');
  const pending = save.props.onPress(); h.render(); assert.equal(h.list().props.renderItem({ item: listing('item') }).props.children.find(node => node?.props?.accessibilityLabel === 'Save listing').props.accessibilityState.selected, false);
  write.resolve(null); await pending; await h.flush();
  refresh.resolve({ rows: [listing('item')], retained: [], nextOffset: 1, hasMore: false, savedIds: [] }); await h.flush();
  const confirmed = h.list().props.renderItem({ item: listing('item') }).props.children.find(node => node?.props?.accessibilityLabel === 'Unsave listing');
  assert.ok(confirmed); assert.equal(confirmed.props.accessibilityState.selected, true); h.unmount();
});
