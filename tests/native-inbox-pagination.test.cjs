const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const walk = node => !node ? [] : Array.isArray(node) ? node.flatMap(walk) : typeof node === 'object'
  ? [node, ...walk(node.props?.children), ...walk(node.props?.ListHeaderComponent)] : [];
const words = node => !node ? '' : Array.isArray(node) ? node.map(words).join(' ') : typeof node === 'object' ? words(node.props?.children) : String(node);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const conversations = (active, archived = 0) => Array.from({ length: active + archived }, (_, n) => ({
  id: `chat-${n}`, title: `Member ${n}`, other_id: `person-${n}`, username: null, avatar: null, unread: 0,
  context: 'personal', is_group: false, is_archived: n >= active, is_pinned: false, is_muted: false,
  last_message: `Preview ${n}`, last_message_time: new Date(Date.UTC(2026, 10, 1) - n * 60000).toISOString(),
}));

function harness(rows, options = {}) {
  const slots = [], effects = [], calls = [], events = [], modules = new Map(), timers = new Map(), appEvents = new Set();
  const scopeEvents = new Set(), startupEvents = new Set();
  let startupValue = options.startup ?? null;
  const startupWrites = [];
  let cursor = 0, dirty = true, tree, owner = 'owner', scope = '1:owner', revision = 1, focused = true, disposed = false;
  let now = 0, nextTimer = 0, override;
  const same = (a,b) => a && b && a.length === b.length && a.every((value, n) => Object.is(value, b[n]));
  const hooks = {
    useState(initial) { const n = cursor++; if (!slots[n]) slots[n] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[n].value, update => { const value = typeof update === 'function' ? update(slots[n].value) : update;
        if (!Object.is(value, slots[n].value)) { slots[n].value = value; dirty = true; } }]; },
    useRef(initial) { const n = cursor++; return slots[n] ??= { current: initial }; },
    useCallback(fn, deps) { const n = cursor++; if (!slots[n] || !same(slots[n].deps, deps)) slots[n] = { deps, value: fn }; return slots[n].value; },
    useEffect(fn, deps) { const n = cursor++, old = slots[n]; if (!old || !same(old.deps, deps)) {
      slots[n] = { deps }; effects.push(() => { old?.cleanup?.(); slots[n].cleanup = fn(); }); } },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const historyDisk = new Map(); let historyNumber = 0;
  const app = { currentState: 'active', addEventListener(_name, fn) { appEvents.add(fn); return { remove: () => appEvents.delete(fn) }; } };
  const clock = { setTimeout(fn, delay) { const n = ++nextTimer; timers.set(n, { fn, at: now + delay }); return n; }, clearTimeout(n) { timers.delete(n); } };
  const navigation = { navigate(...args) { navigation.calls.push(args); }, calls: [] };
  const draftState = { drafts: {}, openedTimes: {}, mentionAmnesty: {},
    ensureMentionAmnesty(id) { if (draftState.mentionAmnesty[id] === undefined) {
      draftState.mentionAmnesty[id] = Object.keys(draftState.openedTimes).length ? 0 : Date.now(); dirty = true;
    } return draftState.mentionAmnesty[id]; },
    markOpened(id) { draftState.openedTimes[id] = Date.now(); dirty = true; } };
  const auth = Object.assign(() => ({ profile: { id: owner } }), { getState: () => ({ session: { user: { id: owner }, access_token: `token-${scope}` } }) });
  const query = (name, args = {}) => {
    const call = { name, args, signal: null, token: null, input: null };
    const chain = { setHeader(_name, value) { call.token = value; return chain; }, abortSignal(value) { call.signal = value; return chain; },
      upsert(value) { call.input = value; return chain; }, insert(value) { call.input = value; return chain; },
      then(ok, bad) { calls.push(call); return Promise.resolve().then(async () => {
        if (override) { const result = await override(call); if (result) return result; }
        if (name === 'get_paged_reader_capabilities') return { data: { version: 1, inbox: true, books: false }, error: null };
        if (name === 'get_inbox_mentions_v2') return { data: { version: 1, since: args.p_since,
          items: rows.filter(row => args.p_conversation_ids.includes(row.id) && row.mentionTime && row.mentionTime > Date.parse(args.p_since))
            .map(row => ({ conversation_id: row.id, latest_mention_at: new Date(row.mentionTime).toISOString() })) }, error: null };
        if (name === 'get_inbox_page_v2') {
          let base = rows.filter(row => row.context === args.p_context && !row.denied && !row.is_deleted);
          const summary = { total: base.length, archived_personal: base.filter(row => row.is_archived).length };
          if (args.p_ids) base = base.filter(row => args.p_ids.includes(row.id));
          else if (args.p_folder === 'archived') base = base.filter(row => row.is_archived);
          else base = base.filter(row => !row.is_archived && row.group_type !== 'community' && !row.request_pending
            && (!args.p_search || row.title.toLowerCase().includes(args.p_search.toLowerCase()))
            && (args.p_filter === 'groups' ? row.is_group : args.p_filter === 'unread' ? row.unread > 0 : true));
          const offset = args.p_cursor?.offset ?? 0, items = base.slice(offset, offset + args.p_limit);
          const more = offset + items.length < base.length;
          return { data: { version: 2, items, has_more: more, next_cursor: more ? { viewer: owner, offset: offset + items.length } : null, summary }, error: null };
        }
        if (name === 'conversation_settings' && call.input) Object.assign(rows.find(row => row.id === call.input.conversation_id) ?? {}, call.input);
        return { data: [], error: null };
      }).then(ok, bad); } };
    for (const key of ['select', 'eq', 'in', 'gt', 'or', 'order', 'maybeSingle']) chain[key] = () => chain;
    return chain;
  };
  const client = { rpc: query, from: name => query(name), channel() { const channel = { on(_kind, filter, callback) { events.push({ filter, callback }); return channel; }, subscribe() { return channel; } }; return channel; }, removeChannel() {} };
  const runtime = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
  let cache;
  const theme = { ink: {}, brand: {}, surface: {}, status: {} };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    const module = { exports: {} }; modules.set(relative, module);
    const requireLocal = name => {
      if (name === 'react') return { ...hooks, default: hooks };
      if (name === 'react/jsx-runtime') return runtime;
      if (name.endsWith('MeasuredHistoryList')) return { MeasuredHistoryList: 'TapTopFlatList' };
      if (name.endsWith('services/useReadingWindow')) return load('src/services/useReadingWindow.ts');
      if (name === './sessionHistory') return { createNativeSessionHistory: options => load('shared/sessionHistory.ts').createSessionHistory({ ...options,
        namespace: 'native-fixture-' + (++historyNumber), storage: { read: async keys => keys.map(key => historyDisk.get(key) ?? null),
          write: async entries => entries.forEach(([key,value]) => historyDisk.set(key,value)),
          clear: async prefix => { for (const key of historyDisk.keys()) if (key.startsWith(prefix)) historyDisk.delete(key); } } }) };

      if (name === 'react-native') return { View: 'View', Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity',
        Image: 'Image', StatusBar: 'StatusBar', StyleSheet: { create: value => value, hairlineWidth: 1 }, Platform: { OS: 'ios' }, AppState: app,
        ActionSheetIOS: { showActionSheetWithOptions() {} }, Alert: { alert() {} } };
      if (name === '@react-navigation/native') return { useIsFocused: () => focused,
        useFocusEffect: fn => hooks.useEffect(() => focused ? fn() : undefined, [fn, focused]) };
      if (name.endsWith('lib/navigationCache')) return { navigationCache: cache, navigationScope: () => scope,
        subscribeNavigationScope(fn) { scopeEvents.add(fn); return () => scopeEvents.delete(fn); } };
      if (name.endsWith('services/startupContentSnapshots')) return { inboxStartup: { peek: account => account === owner ? startupValue : null,
        hydrate: async account => account === owner ? startupValue : null,
        write: async (account, value) => { startupWrites.push({ account, value }); startupValue = value; startupEvents.forEach(fn => fn()); },
        clear: async () => { startupValue = null; startupEvents.forEach(fn => fn()); },
        subscribe(fn) { startupEvents.add(fn); return () => startupEvents.delete(fn); } } };
      if (name.endsWith('services/inboxStartup')) return { readInboxStartup: rows => options.readStartup ? options.readStartup(rows) : Promise.resolve(rows) };
      if (name.endsWith('stores/authStore')) return { useAuthStore: auth };
      if (name.endsWith('stores/unreadStore')) return { useUnreadStore: { getState: () => ({ refresh() {} }) } };
      if (name.endsWith('stores/draftStore')) return { useDraftStore: Object.assign(selector => selector(draftState), { getState: () => draftState }) };
      if (name.endsWith('services/supabase') || name === './supabase') return { supabase: client };
      if (name.endsWith('chatMediaService')) return { isChatMediaUrl: () => false, signGroupAvatars: async values => values };
      if (name.endsWith('useTheme')) return { themedSheet: fn => fn(theme), getTheme: () => theme, useTheme: () => ({ t: theme, isDark: false }) };
      if (name.endsWith('SafeArea')) return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) };
      if (name.endsWith('storiesService')) return { storiesService: { getCatchupFeed: async () => [] } };
      if (name.endsWith('TapTopList')) return { TapTopFlatList: 'TapTopFlatList' };
      if (name.endsWith('AdaptiveTabBar')) return { handleTabBarScroll() {} };
      if (name.endsWith('constants/layout')) return { TAB_BAR_CLEARANCE: 90 };
      if (name.endsWith('Skeleton')) return { ConversationsSkeleton: 'ConversationsSkeleton' };
      if (name === '@expo/vector-icons') return { Feather: 'Feather', Ionicons: 'Ionicons' };
      if (name === 'react-native-gesture-handler') return { Swipeable: 'Swipeable' };
      if (name === 'expo-haptics') return { ImpactFeedbackStyle: { Medium: 'medium' }, impactAsync() {} };
      if (name.includes('shared/') || name.endsWith('navigationInbox') || ['./recoveryReader', './pagedReaders', './inboxRefreshQueue'].includes(name)) {
        return load(path.relative(root, path.resolve(root, path.dirname(relative), name) + '.ts'));
      }
      return { default: name };
    };
    const source = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { fileName: relative,
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(source, { module, exports: module.exports, require: requireLocal, AbortController, console,
      ...clock, setInterval: () => 1, clearInterval() {}, queueMicrotask }); return module.exports;
  }
  cache = load('shared/navigationCache.ts').createNavigationCache(); cache.setScope(scope);
  const Component = load('src/screens/messages/ConversationsScreen.tsx').default;
  function render() { let guard = 0; while (dirty && !disposed) { assert.ok(++guard < 35, 'render settles'); dirty = false; cursor = 0;
    tree = Component({ navigation }); while (effects.length) effects.shift()(); } }
  async function flush() { for (let n = 0; n < 12; n++) { render(); await new Promise(done => setImmediate(done)); } render(); }
  const nodes = () => walk(tree);
  render();
  return { calls, events, navigation, cache, nodes, draftState, startupWrites,
    setStartup(value) { startupValue = value; startupEvents.forEach(fn => fn()); render(); }, list: () => nodes().find(node => node.type === 'TapTopFlatList'), flush,
    async tick(ms) { const end = now + ms; while (true) { const entry = [...timers].filter(([, timer]) => timer.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
      if (!entry) break; now = entry[1].at; timers.delete(entry[0]); entry[1].fn(); await flush(); } now = end; await flush(); },
    press(label) { const button = nodes().find(node => node.type === 'TouchableOpacity' && words(node).trim().startsWith(label)); assert.ok(button, `button ${label}`); button.props.onPress(); render(); },
    search(value) { nodes().find(node => node.type === 'TextInput').props.onChangeText(value); render(); },
    more() { const list = nodes().find(node => node.type === 'TapTopFlatList'); list.props.onEndReached(); render(); },
    setReply(fn) { override = fn; },
    focus(value) { focused = value; dirty = true; render(); },
    background(value) { app.currentState = value ? 'background' : 'active'; appEvents.forEach(fn => fn(app.currentState)); render(); },
    changeOwner(value) { owner = value; scope = `${++revision}:${value}`; cache.setScope(scope); scopeEvents.forEach(fn => fn()); dirty = true; render(); },
    dispose() { disposed = true; slots.forEach(slot => slot?.cleanup?.()); timers.clear(); },
  };
}

test('native inbox retains full Archived count while rendering a bounded first page and preserving FlatList settings', async () => {
  const h = harness(conversations(65, 125)); await h.flush();
  assert.equal(h.list().props.data.length, 30); assert.equal(h.list().props.windowSize, 10); assert.equal(h.list().props.initialNumToRender, 12);
  const archived = h.nodes().find(node => node.type === 'TouchableOpacity' && words(node).trim().startsWith('Archived'));
  assert.ok(words(archived).includes('125'));
  h.more(); h.more(); await h.flush(); assert.equal(h.list().props.data.length, 60);
  h.more(); await h.flush(); assert.equal(h.list().props.data.length, 65);
  assert.equal(h.calls.filter(call => call.name === 'get_inbox_page_v2').length, 3); h.dispose();
});

test('long native inbox walks retain 120 conversations and restore authorized measured history', async () => {
  const source = conversations(240, 90), h = harness(source); await h.flush(); const visited = new Set();
  for (let n = 0; n < 8; n++) {
    const list = h.list(), rows = list.props.data, value = list.props.history;
    rows.forEach(row => visited.add(row.id)); assert.ok(rows.length <= 120);
    list.props.snapshot.pages.forEach(page => value.measure(page.index, 100)); value.setAnchor(rows.at(-1).id);
    list.props.onScroll({ nativeEvent: { contentOffset: { y: 2000 }, layoutMeasurement: { height: 800 } } });
    if (n < 7) { h.more(); await h.flush(); }
  }
  assert.equal(visited.size, 240); assert.ok(h.list().props.snapshot.before > 0);
  source[1].denied = true;
  await h.list().props.history.around(0); await h.flush();
  assert.equal(h.list().props.data[0].id, 'chat-0'); assert.ok(!h.list().props.data.some(row => row.id === 'chat-1'));
  assert.ok(h.calls.filter(call => call.name === 'get_inbox_page_v2' && call.args.p_ids).every(call => call.args.p_ids.length <= 50));
  assert.equal(h.cache.read('1:owner', 'inbox:personal:paging').summary.archivedPersonal, 90); h.dispose();
});

test('an inbox containing only archived chats still exposes the existing Archived row', async () => {
  const h = harness(conversations(0, 75)); await h.flush(); assert.equal(h.list().props.data.length, 0);
  h.press('Archived'); await h.tick(250); assert.equal(h.list().props.data.length, 30);
  assert.ok(h.nodes().some(node => words(node).trim() === 'Archived chats')); h.dispose();
});

test('native search reaches all pages and Archived deliberately ignores search and Unread filters', async () => {
  const rows = conversations(80, 45); rows[75].title = 'Needle beyond page one'; rows[75].unread = 5;
  const h = harness(rows); await h.flush(); h.search('Needle'); await h.tick(250);
  assert.deepEqual(Array.from(h.list().props.data, row => row.id), ['chat-75']);
  h.press('Unread'); await h.tick(250); assert.equal(h.list().props.data[0].unread_count, 5);
  h.press('Archived'); await h.tick(250); assert.equal(h.list().props.data.length, 30);
  assert.ok(h.list().props.data.every(row => row.is_archived));
  assert.equal(h.calls.filter(call => call.name === 'get_inbox_page_v2').at(-1).args.p_folder, 'archived'); h.dispose();
});

test('native background pauses refresh requests and foreground rechecks canonical loaded rows', async () => {
  const h = harness(conversations(80)); await h.flush(); const before = h.calls.filter(call => call.name === 'get_inbox_page_v2').length;
  h.background(true);
  const handler = h.events.find(event => event.filter.table === 'messages' && !event.filter.filter);
  handler.callback({ new: { conversation_id: 'chat-70', sender_id: 'other', receiver_id: 'owner' } });
  await h.tick(2000); assert.equal(h.calls.filter(call => call.name === 'get_inbox_page_v2').length, before);
  h.background(false); await h.tick(200); assert.equal(h.calls.filter(call => call.name === 'get_inbox_page_v2').length, before + 1); h.dispose();
});

test('native page requests abort on blur and an ignored-abort response cannot extend the hidden list', async () => {
  const h = harness(conversations(80)); await h.flush(); const gate = deferred(); let pending;
  h.setReply(call => { if (call.name === 'get_inbox_page_v2' && call.args.p_cursor) { pending = call; return gate.promise; } });
  h.more(); await h.flush(); assert.ok(pending); h.focus(false); assert.equal(pending.signal.aborted, true);
  gate.resolve({ data: { version: 2, items: conversations(80).slice(30, 60), has_more: true,
    next_cursor: { viewer: 'owner', offset: 60 }, summary: { total: 80, archived_personal: 0 } }, error: null });
  await h.flush(); assert.equal(h.list().props.data.length, 30); h.dispose();
});

test('canonical native preview refresh preserves a matching sender prefix and clears it for a different message', async () => {
  const rows = conversations(40), h = harness(rows); await h.flush();
  rows[0].last_message = 'Our new message'; rows[0].last_message_time = '2026-11-01T11:22:33.123456+00:00';
  const listener = h.events.find(event => event.filter.table === 'conversations');
  listener.callback({ new: { id: rows[0].id, last_message: rows[0].last_message,
    last_message_time: '2026-11-01T11:22:33.123456Z', last_sender_id: 'owner', last_sender_name: 'Me' } });
  await h.tick(200); assert.equal(h.list().props.data.find(row => row.id === rows[0].id).last_sender_id, 'owner');
  h.focus(false); h.focus(true); await h.flush();
  assert.equal(h.list().props.data.find(row => row.id === rows[0].id).last_sender_id, 'owner');
  rows[0].last_message_time = '2026-11-01T11:22:33.123457+00:00';
  const current = h.events.filter(event => event.filter.table === 'conversations').at(-1);
  current.callback({ new: { id: rows[0].id, last_message: rows[0].last_message, last_message_time: rows[0].last_message_time } });
  await h.tick(200); assert.equal(h.list().props.data.find(row => row.id === rows[0].id).last_sender_id, undefined); h.dispose();
});

test('a replacement session for the same native owner clears old work and cannot revive its late inbox', async () => {
  const rows = conversations(60), h = harness(rows); await h.flush(); const gate = deferred(); let held;
  h.setReply(call => { if (call.name === 'get_inbox_page_v2' && !held) { held = call; return gate.promise; } });
  h.focus(false); h.focus(true); await h.flush(); assert.ok(held);
  h.changeOwner('owner'); await h.flush(); assert.equal(held.signal.aborted, true);
  gate.resolve({ data: { version: 2, items: [{ ...rows[0], title: 'OLD SESSION PRIVATE PREVIEW' }], has_more: false,
    next_cursor: null, summary: { total: 1, archived_personal: 0 } }, error: null });
  await h.flush(); assert.equal(h.list().props.data.length, 30);
  assert.ok(!h.list().props.data.some(row => row.other_name === 'OLD SESSION PRIVATE PREVIEW')); h.dispose();
});

test('a stalled native continuation times out, keeps loaded rows, and retries without a stuck pagination lock', async () => {
  const h = harness(conversations(60)); await h.flush(); const gate = deferred(); let pending;
  h.setReply(call => { if (call.name === 'get_inbox_page_v2' && call.args.p_cursor) { pending = call; return gate.promise; } });
  h.more(); await h.flush(); await h.tick(12000);
  assert.equal(pending.signal.aborted, true); assert.equal(h.list().props.data.length, 30);
  assert.ok(h.nodes().some(node => words(node).includes('More conversations could not be loaded')));
  h.setReply(null); h.press('Retry conversations'); await h.flush(); h.more(); await h.flush();
  assert.equal(h.list().props.data.length, 60);
  gate.resolve({ data: null, error: Error('late aborted read') }); await h.flush(); h.dispose();
});

test('native mention badges read only the loaded ninety conversations without the old table-scan fanout', async () => {
  const rows = conversations(500), h = harness(rows); await h.flush(); h.more(); await h.flush(); h.more(); await h.flush();
  await h.tick(200);
  const mentions = h.calls.filter(call => call.name === 'get_inbox_mentions_v2');
  assert.equal(mentions.length, 2); assert.equal(mentions.reduce((sum,call) => sum + call.args.p_conversation_ids.length, 0), 90);
  assert.ok(mentions.every(call => call.args.p_conversation_ids.length <= 50 && call.token === 'Bearer token-1:owner'));
  assert.equal(h.calls.filter(call => call.name === 'message_mentions' || call.name === 'messages').length, 0);
  const stamp = h.draftState.mentionAmnesty.owner; assert.ok(stamp > 0);
  await h.tick(60000); assert.equal(h.calls.filter(call => call.name === 'get_inbox_mentions_v2').length, 2); h.dispose();
});

test('native first-use amnesty covers later pages while a new mention highlights the unchanged preview UI', async () => {
  const rows = conversations(60), old = Date.now() - 60000;
  for (const row of [rows[0], rows[35]]) { row.last_message = '@musa earlier'; row.mentionTime = old; }
  const h = harness(rows); await h.flush(); await h.tick(200);
  const highlighted = id => walk(h.list().props.renderItem({ item: h.list().props.data.find(row => row.id === id) }))
    .some(node => node.type === 'Text' && node.props.style?.color === '#059669' && node.props.style?.fontWeight === '800');
  assert.equal(highlighted('chat-0'), false); const cutoff = h.draftState.mentionAmnesty.owner;
  h.more(); await h.flush(); await h.tick(200); assert.equal(highlighted('chat-35'), false);
  rows[35].last_message = '@musa new mention'; rows[35].last_message_time = new Date(cutoff + 1000).toISOString(); rows[35].mentionTime = cutoff + 1000;
  h.events.find(event => event.filter.table === 'conversations').callback({ new: { id: rows[35].id } });
  await h.tick(400); assert.equal(highlighted('chat-35'), true);
  assert.equal(h.draftState.mentionAmnesty.owner, cutoff); h.dispose();
});

test('a queued native full refresh retains its physical slot through timeout and background-resume', async () => {
  const h = harness(conversations(60)); await h.flush(); const gate = deferred(); let pending;
  const before = h.calls.filter(call => call.name === 'get_inbox_page_v2').length;
  h.setReply(call => { if (call.name === 'get_inbox_page_v2' && !pending) { pending = call; return gate.promise; } });
  h.events.find(event => event.filter.table === 'conversation_settings').callback({}); await h.tick(200);
  assert.ok(pending); await h.tick(12000); assert.equal(pending.signal.aborted, true);
  h.background(true); h.background(false); await h.tick(200);
  assert.equal(h.calls.filter(call => call.name === 'get_inbox_page_v2').length, before + 1);
  gate.resolve({ data: null, error: Error('late abort') }); await h.flush(); await h.tick(200);
  assert.equal(h.calls.filter(call => call.name === 'get_inbox_page_v2').length, before + 2); h.dispose();
});

const savedInbox = (name = 'Saved Alice') => ({ actorId: 'owner', rows: [{ id: 'chat-0', other_user_id: 'person-0', other_name: name, other_username: null, other_avatar: null, last_message: 'Saved ordinary preview', last_message_time: new Date().toISOString(), unread_count: 2, is_group: false, is_pinned: false, is_muted: false, is_archived: false, context: 'personal' }] });
test('cold native inbox paints saved names and previews before its first network response and persists the replacement', async () => {
  const gate = deferred(), h = harness(conversations(2), { startup: savedInbox() });
  h.setReply(call => call.name === 'get_inbox_page_v2' ? gate.promise : null);
  assert.equal(h.list().props.data[0].other_name, 'Saved Alice');
  assert.equal(h.list().props.data[0].last_message, 'Saved ordinary preview');
  await h.flush(); assert.equal(h.list().props.data[0].other_name, 'Saved Alice');
  assert.equal(h.cache.read('1:owner', 'inbox:personal'), null, 'disk-only rows keep their original expiry');
  gate.resolve(null); await h.flush(); assert.equal(h.list().props.data[0].other_name, 'Member 0');
  assert.equal(h.startupWrites.at(-1).value.rows.length, 2);
  h.setStartup(savedInbox('STALE RESTORE')); assert.equal(h.list().props.data[0].other_name, 'Member 0'); h.dispose();
});
test('late native inbox disk restore stays useful during network delay and disappears on expiry', async () => {
  const gate = deferred(), h = harness(conversations(1));
  h.setReply(call => call.name === 'get_inbox_page_v2' ? gate.promise : null); await h.flush();
  h.setStartup(savedInbox()); assert.equal(h.list().props.data[0].other_name, 'Saved Alice');
  h.setStartup(null); assert.equal(h.list()?.props.data.length ?? 0, 0);
  assert.ok(h.nodes().some(node => words(node).includes('Reconnect to refresh')));
  gate.resolve(null); await h.flush(); assert.equal(h.list().props.data[0].other_name, 'Member 0'); h.dispose();
});
test('native inbox never transfers cached previews to a different account and clears confirmed access denial', async () => {
  const gate = deferred(), h = harness(conversations(1), { startup: savedInbox() });
  h.setReply(call => call.name === 'get_inbox_page_v2' ? gate.promise : null); await h.flush();
  gate.resolve({ data: null, error: { code: '42501', message: 'Denied' } }); await h.flush();
  assert.equal(h.list()?.props.data.length ?? 0, 0);
  h.setStartup(savedInbox()); assert.equal(h.list()?.props.data.length ?? 0, 0);
  h.changeOwner('another'); assert.ok(!h.nodes().some(node => words(node).includes('Saved Alice'))); h.dispose();
});
