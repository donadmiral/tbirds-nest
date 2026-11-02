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
function nodes(tree) { const rows = []; const walk = node => { if (Array.isArray(node)) return node.forEach(walk);
  if (!node || typeof node !== 'object') return; rows.push(node); walk(node.props?.children); }; walk(tree); return rows; }
const conversations = (count, context = 'market') => Array.from({ length: count }, (_, n) => ({
  id: `${context}-${n}`, conversation_id: `${context}-${n}`, is_group: false, other_id: `other-${n}`,
  other_name: `Member ${n}`, other_username: `member${n}`, other_avatar: `avatar-${n}.jpg`,
  last_message: `Preview ${n}`, last_message_time: new Date(Date.UTC(2026, 10, 1) - n * 1000).toISOString(),
  last_message_sender_id: 'owner', unread_count: n + 2, context, context_ref_id: `subject-${n}`,
  ref_title: context === 'market' ? `Listing ${n}` : `Role ${n}`, ref_subtitle: context === 'market' ? 'GBP 12.50' : 'Company', ref_image: 'first.jpg',
}));

function scenario(rows, options = {}) {
  let owner = 'owner', scope = '1:owner', revision = 1, context = options.context ?? 'market', focused = true;
  let cursor = 0, dirty = true, tree, disposed = false, now = 0, nextTimer = 0, override;
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
  hooks.useLayoutEffect = hooks.useEffect;
  const historyDisk = new Map(); let historyNumber = 0;
  const app = { currentState: 'active', addEventListener(_event, fn) { appListeners.add(fn); return { remove: () => appListeners.delete(fn) }; } };
  const clock = { setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { at: now + delay, fn }); return id; }, clearTimeout(id) { timers.delete(id); } };
  const auth = Object.assign(() => ({ profile: owner ? { id: owner } : null }), { getState: () => ({ session: owner ? { user: { id: owner }, access_token: `token-${scope}` } : null }) });
  let badgeReads = 0;
  const navigation = { calls: [], navigate(...args) { this.calls.push(args); }, goBack() {} };
  const client = { rpc(name, args) {
    const call = { name, args, signal: null, token: null };
    const query = { setHeader(_name, value) { call.token = value; return query; }, abortSignal(value) { call.signal = value; return query; },
      then(ok, bad) { calls.push(call); return Promise.resolve().then(async () => {
        if (override) { const result = await override(call); if (result !== undefined) return result; }
        if (name === 'get_paged_reader_capabilities') return { data: { version: 1, inbox: options.ready !== false, books: false }, error: null };
        const all = rows.filter(row => row.context === args.p_context && !row.denied && (!row.owner || row.owner === owner));
        if (name === 'get_conversations_by_context') return { data: all, error: null };
        if (name === 'get_context_inbox_page_v2') {
          if (options.missing) return { data: null, error: { code: 'PGRST202' } };
          const values = args.p_ids ? all.filter(row => args.p_ids.includes(row.id)) : all;
          const offset = args.p_cursor?.offset ?? 0, items = values.slice(offset, offset + args.p_limit);
          const more = offset + items.length < values.length;
          return { data: { version: 2, items, has_more: more, next_cursor: more
            ? { version: 2, kind: 'context_inbox', viewer: owner, context: args.p_context, offset: offset + items.length } : null }, error: null };
        }
        throw Error('Unexpected RPC ' + name);
      }).then(ok, bad); } };
    return query;
  }, from() { throw Error('Raw table fanout is forbidden in context paging'); } };
  const runtime = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
  const theme = { ink: {}, surface: {}, brand: {} };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    const module = { exports: {} }; modules.set(relative, module);
    const requireLocal = name => {
      if (name === 'react') return { ...hooks, default: hooks };
      if (name === 'react/jsx-runtime') return runtime;
      if (name.endsWith('MeasuredHistoryList')) return { MeasuredHistoryList: 'FlatList' };
      if (name.endsWith('services/useReadingWindow')) return load('src/services/useReadingWindow.ts');
      if (name === './sessionHistory') return { createNativeSessionHistory: options => load('shared/sessionHistory.ts').createSessionHistory({ ...options,
        namespace: 'native-fixture-' + (++historyNumber), storage: { read: async keys => keys.map(key => historyDisk.get(key) ?? null),
          write: async entries => entries.forEach(([key,value]) => historyDisk.set(key,value)),
          clear: async prefix => { for (const key of historyDisk.keys()) if (key.startsWith(prefix)) historyDisk.delete(key); } } }) };

      if (name === 'react-native') return { View: 'View', Text: 'Text', FlatList: 'FlatList', TouchableOpacity: 'TouchableOpacity', Image: 'Image',
        RefreshControl: 'RefreshControl', ActivityIndicator: 'ActivityIndicator', StatusBar: 'StatusBar', AppState: app, StyleSheet: { hairlineWidth: 1 } };
      if (name === '@react-navigation/native') return { useFocusEffect: fn => hooks.useEffect(() => focused ? fn() : undefined, [fn, focused]) };
      if (name.endsWith('stores/authStore')) return { useAuthStore: auth };
      if (name.endsWith('stores/unreadStore')) return { useUnreadStore: { getState: () => ({ refresh() { badgeReads++; } }) } };
      if (name.endsWith('lib/navigationCache')) return { navigationScope: () => scope };
      if (name === './supabase') return { supabase: client };
      if (name.endsWith('useTheme')) return { themedSheet: fn => fn(theme), getTheme: () => theme, useTheme: () => ({ t: theme, isDark: false }) };
      if (name.endsWith('SafeArea')) return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) };
      if (name.endsWith('constants/layout')) return { TAB_BAR_CLEARANCE: 90 };
      if (name.endsWith('constants/tokens')) return { typeSize: {}, fontWeight: {}, radius: {}, space: {} };
      if (name === '@expo/vector-icons') return { Feather: 'Feather' };
      if (name.includes('shared/') || name.endsWith('services/contextInbox')) return load(path.relative(root, path.resolve(root, path.dirname(relative), name) + '.ts'));
      return { default: name };
    };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
      fileName: relative, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, { module, exports: module.exports, require: requireLocal, AbortController, ...clock });
    return module.exports;
  }
  const service = load('src/services/contextInbox.ts'), Component = load('src/screens/messages/ContextInboxScreen.tsx').default;
  function render() { let guard = 0; while (dirty && !disposed) { assert.ok(++guard < 30, 'render settles'); dirty = false; cursor = 0;
    tree = Component({ navigation, route: { params: { context } } }); while (effects.length) effects.shift()(); } }
  const list = () => nodes(tree).find(node => node.type === 'FlatList');
  async function flush() { for (let n = 0; n < 12; n++) { render(); await new Promise(done => setImmediate(done)); } render(); }
  render();
  return { calls, navigation, service, list, flush, text: () => words(tree), badgeReads: () => badgeReads,
    setReply(fn) { override = fn; }, more() { list().props.onEndReached(); render(); },
    refresh() { list().props.refreshControl.props.onRefresh(); render(); },
    focus(value) { focused = value; dirty = true; render(); },
    account(value) { owner = value; scope = value ? `${++revision}:${value}` : null; dirty = true; render(); },
    context(value) { context = value; dirty = true; render(); },
    background(value) { app.currentState = value ? 'background' : 'active'; appListeners.forEach(fn => fn(app.currentState)); render(); },
    async tick(ms) { const end = now + ms; while (true) { const next = [...timers].filter(([, row]) => row.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush(); } now = end; await flush(); },
    retry() { const footer = list()?.props.ListFooterComponent ?? tree;
      const button = nodes(footer).find(node => node.type === 'TouchableOpacity' && words(node).includes('Try again')); assert.ok(button); button.props.onPress(); render(); },
    dispose() { disposed = true; slots.forEach(slot => slot?.cleanup?.()); timers.clear(); },
  };
}

test('Market and Jobs open thirty rows, preserve their subjects/navigation and reach all ninety-five conversations', async () => {
  for (const context of ['market', 'jobs']) {
    const h = scenario(conversations(95, context), { context }); await h.flush();
    assert.equal(h.list().props.data.length, 30); assert.equal(h.badgeReads(), 1);
    assert.equal(h.calls.filter(call => call.name === 'get_context_inbox_page_v2').length, 1);
    const first = h.list().props.data[0], rendered = h.list().props.renderItem({ item: first });
    assert.ok(words(rendered).includes(context === 'market' ? 'Listing 0' : 'Role 0'));
    assert.ok(words(rendered).includes(context === 'market' ? 'GBP 12.50' : 'Company'));
    assert.ok(words(rendered).includes('You: Preview 0'));
    assert.ok(nodes(rendered).some(node => node.type === 'Image' && node.props.source.uri === 'first.jpg'));
    rendered.props.onPress(); assert.deepEqual(JSON.parse(JSON.stringify(h.navigation.calls[0])), ['Chat', {
      conversationId: `${context}-0`, userId: 'other-0', userName: 'Member 0', userAvatar: 'avatar-0.jpg',
    }]);
    h.more(); h.more(); await h.flush(); assert.equal(h.list().props.data.length, 60);
    h.more(); await h.flush(); h.more(); await h.flush(); assert.equal(h.list().props.data.length, 95);
    assert.equal(new Set(h.list().props.data.map(row => row.id)).size, 95);
    assert.equal(h.badgeReads(), 1, 'page counts never replace or repeatedly refetch full badges');
    assert.ok(h.calls.every(call => call.token === 'Bearer token-1:owner')); h.dispose();
  }
});

test('old capability and missing context RPC keep all legacy rows instead of silently truncating', async () => {
  for (const options of [{ ready: false }, { missing: true }]) {
    const h = scenario(conversations(137), options); await h.flush(); assert.equal(h.list().props.data.length, 137);
    const count = h.calls.length; h.more(); await h.flush(); assert.equal(h.calls.length, count);
    const legacy = h.calls.find(call => call.name === 'get_conversations_by_context'); assert.equal(legacy.args.p_include_groups, false);
    h.dispose();
  }
});

test('permission and malformed page failures never fall back to the old complete reader', async () => {
  for (const response of [{ data: null, error: { code: '42501' } }, { data: { version: 2, items: [], has_more: true, next_cursor: null }, error: null }]) {
    const h = scenario(conversations(40)); h.setReply(call => call.name === 'get_context_inbox_page_v2' ? response : undefined);
    await h.flush(); assert.ok(h.text().includes('Could not load messages'));
    assert.equal(h.calls.filter(call => call.name === 'get_conversations_by_context').length, 0); h.dispose();
  }
});

test('a failed continuation keeps the readable list and retry reaches the remaining conversations', async () => {
  const h = scenario(conversations(45)); await h.flush(); h.setReply(call => call.args?.p_cursor ? { data: null, error: { code: 'offline' } } : undefined);
  h.more(); await h.flush(); assert.equal(h.list().props.data.length, 30);
  assert.ok(words(h.list().props.ListFooterComponent).includes('More conversations could not be loaded'));
  h.setReply(undefined); h.retry(); await h.flush(); assert.equal(h.list().props.data.length, 45); h.dispose();
});

test('blur aborts a pending continuation and focus revalidates the existing range', async () => {
  const h = scenario(conversations(80)); await h.flush(); const gate = deferred(); let held;
  h.setReply(call => { if (call.args?.p_cursor) { held = call; return gate.promise; } }); h.more(); await h.flush();
  h.focus(false); assert.equal(held.signal.aborted, true); h.setReply(undefined);
  gate.resolve({ data: { version: 2, items: conversations(80).slice(30, 60), has_more: false, next_cursor: null }, error: null });
  await h.flush(); assert.equal(h.list().props.data.length, 30); h.focus(true); await h.flush();
  assert.equal(h.list().props.data.length, 30); assert.equal(h.badgeReads(), 2); h.dispose();
});

test('account round trips cannot publish an old page or its error into the new session', async () => {
  const h = scenario(conversations(80)); await h.flush(); const gate = deferred();
  h.setReply(call => call.args?.p_cursor ? gate.promise : undefined); h.more(); await h.flush();
  h.account('other'); h.account('owner'); h.setReply(undefined); await h.flush();
  gate.resolve({ data: { version: 2, items: [{ ...conversations(1)[0], id: 'stale', conversation_id: 'stale', last_message: 'PRIVATE STALE' }], has_more: false, next_cursor: null }, error: null });
  await h.flush(); assert.equal(h.list().props.data.length, 30); assert.ok(!h.list().props.data.some(row => row.id === 'stale')); h.dispose();
});

test('changing business context clears old rows and an earlier held response cannot restore the previous context', async () => {
  const h = scenario([...conversations(80), ...conversations(45, 'jobs')]); await h.flush(); const gate = deferred();
  h.setReply(call => call.args?.p_cursor ? gate.promise : undefined); h.more(); await h.flush(); h.context('jobs'); h.setReply(undefined); await h.flush();
  gate.resolve({ data: { version: 2, items: conversations(20), has_more: false, next_cursor: null }, error: null }); await h.flush();
  assert.ok(h.list().props.data.every(row => row.context === 'jobs')); assert.equal(h.list().props.data.length, 30); h.dispose();
});

test('refresh preserves all loaded tails while dropping newly unauthorized conversations', async () => {
  const rows = conversations(95), h = scenario(rows); await h.flush(); h.more(); await h.flush();
  rows[40].denied = true; h.refresh(); await h.flush(); assert.equal(h.list().props.data.length, 60);
  assert.ok(!h.list().props.data.some(row => row.id === 'market-40'));
  assert.ok(h.calls.some(call => call.args?.p_ids?.includes('market-40'))); h.dispose();
});

test('retry after a failed refresh revalidates the loaded range instead of appending a later page', async () => {
  const rows = conversations(95), h = scenario(rows); await h.flush(); h.more(); await h.flush();
  h.setReply(call => call.name === 'get_context_inbox_page_v2' ? { data: null, error: { code: 'offline' } } : undefined);
  h.refresh(); await h.flush(); assert.equal(h.list().props.data.length, 60);
  rows[40].denied = true; h.setReply(undefined); const before = h.calls.length; h.retry(); await h.flush();
  assert.equal(h.calls.slice(before).find(call => call.name === 'get_context_inbox_page_v2').args.p_cursor, null);
  assert.ok(!h.list().props.data.some(row => row.id === 'market-40')); h.dispose();
});

test('a hung request ends with retry feedback and is aborted; background makes no requests until resume', async () => {
  const h = scenario(conversations(80)); await h.flush(); const gate = deferred(); let held;
  h.setReply(call => { if (call.args?.p_cursor) { held = call; return gate.promise; } }); h.more(); await h.flush(); await h.tick(12000);
  assert.equal(held.signal.aborted, true); assert.ok(words(h.list().props.ListFooterComponent).includes('Try again'));
  h.background(true); const before = h.calls.length; await h.tick(60000); assert.equal(h.calls.length, before);
  h.setReply(undefined); h.background(false); await h.flush(); assert.ok(h.calls.length > before); gate.resolve({ data: null, error: { code: 'late' } });
  await h.flush(); assert.equal(h.list().props.ListFooterComponent, null); h.dispose();
});

test('context ordering keeps microseconds and puts null activity after pre-epoch timestamps', async () => {
  const h = scenario([]), row = conversations(1)[0];
  const sorted = [{ ...row, id: 'null', last_message_time: null }, { ...row, id: 'old', last_message_time: '1960-01-01T00:00:00Z' },
    { ...row, id: 'first', last_message_time: '2026-01-01T00:00:00.123457Z' }, { ...row, id: 'second', last_message_time: '2026-01-01T00:00:00.123456+00:00' }]
    .sort(h.service.compareContextConversations);
  assert.deepEqual(sorted.map(row => row.id), ['first', 'second', 'old', 'null']); h.dispose();
});

test('Market and Jobs long sessions restore cold authorized rows while retaining at most 120', async () => {
  for (const context of ['market', 'jobs']) {
    const source = conversations(210, context), h = scenario(source, { context }); await h.flush(); const visited = new Set();
    for (let n = 0; n < 7; n++) {
      const list = h.list(), value = list.props.history;
      list.props.data.forEach(row => visited.add(row.id)); assert.ok(list.props.data.length <= 120);
      list.props.snapshot.pages.forEach(page => value.measure(page.index, 100)); value.setAnchor(list.props.data.at(-1).id);
      list.props.onScroll({ nativeEvent: { contentOffset: { y: 2000 } } });
      if (n < 6) { h.more(); await h.flush(); }
    }
    assert.equal(visited.size, 210); assert.ok(h.list().props.snapshot.before > 0);
    source[1].denied = true; await h.list().props.history.around(0); await h.flush();
    assert.equal(h.list().props.data[0].id, `${context}-0`); assert.ok(!h.list().props.data.some(row => row.id === `${context}-1`));
    assert.ok(h.calls.filter(call => call.args.p_ids).every(call => call.args.p_ids.length <= 50)); h.dispose();
  }
});
