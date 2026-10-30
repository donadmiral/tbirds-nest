// Actual draft hook and connection-screen behavior with deterministic async adapters.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 45; i++) await Promise.resolve(); };
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
    useMemo(factory, deps) { const key = cursor++; if (!slots[key] || changed(slots[key].deps, deps)) slots[key] = { value: factory(), deps }; return slots[key].value; },
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
function moduleSource(source, imports = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require(name) { assert.ok(name in imports, 'Unexpected import ' + name); return imports[name]; }, ...globals }); return module.exports;
}
function nodes(tree, result = []) {
  if (!tree || typeof tree !== 'object') return result;
  if (Array.isArray(tree)) { tree.forEach(child => nodes(child, result)); return result; }
  result.push(tree); nodes(tree.props?.children, result); return result;
}
function words(tree) { if (tree == null || typeof tree === 'boolean') return ''; if (typeof tree !== 'object') return String(tree); return Array.isArray(tree) ? tree.map(words).join('') : words(tree.props?.children); }
function press(tree, label) { const node = nodes(tree).find(node => node.type === 'TouchableOpacity' && words(node) === label); assert.ok(node, label + ' button exists'); return node.props.onPress(); }
function draftHarness(options = {}) {
  const source = fs.readFileSync(path.join(root, 'src/screens/feed/FeedScreen.tsx'), 'utf8'), ast = ts.createSourceFile('FeedScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useFeedTextDraft'); assert.ok(fn);
  const hook = hooks(), reads = [], writes = [], timers = new Map(); let owner = options.owner || 'a', nextTimer = 0;
  const store = { session: { user: { id: owner } }, profile: { id: owner } };
  const storage = {
    getItem(key) { const wait = deferred(); reads.push({ key, ...wait }); return wait.promise; },
    async setItem(key, value) { writes.push({ key, value: JSON.parse(value) }); },
    async removeItem(key) { writes.push({ key, remove: true }); },
  };
  const fnExport = moduleSource('export ' + fn.getText(ast), {}, { ...hook.react, AsyncStorage: storage, useAuthStore: { getState: () => store },
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); } }).useFeedTextDraft;
  hook.mount(() => fnExport(owner));
  return { hook, reads, writes, timers, view: hook.render,
    account(id) { owner = id; store.session = id ? { user: { id } } : null; store.profile = id ? { id } : null; hook.invalidate(); hook.render(); },
    fireTimers() { const all = [...timers.values()]; timers.clear(); all.forEach(fn => fn()); },
  };
}

test('draft restoration preserves new text and switches typed before local storage returns', async () => {
  const h = draftHarness(); h.view().setComposerText('New words'); h.view().setInnovationPost(true);
  h.reads[0].resolve(JSON.stringify({ text: 'Old draft', exclusive: true, innovation: false })); await flush();
  assert.equal(h.view().composerText, 'New words'); assert.equal(h.view().innovationPost, true); assert.equal(h.view().exclusivePost, false);
  h.fireTimers(); await flush(); assert.deepEqual(h.writes, [{ key: 'pc_draft:a', value: { text: 'New words', exclusive: false, innovation: true } }]); h.hook.unmount();
});

test('empty initial render cannot erase a saved draft before hydration completes', async () => {
  const h = draftHarness(); h.fireTimers(); await flush(); assert.equal(h.writes.length, 0);
  h.reads[0].resolve(JSON.stringify({ text: 'Keep this', exclusive: true, innovation: false })); await flush();
  assert.equal(h.view().composerText, 'Keep this'); assert.equal(h.view().exclusivePost, true);
  h.fireTimers(); await flush(); assert.equal(h.writes.length, 1); assert.equal(h.writes[0].remove, undefined); h.hook.unmount();
});

test('old account hydration cannot populate or persist into the next owner draft', async () => {
  const h = draftHarness(); h.account('b'); assert.equal(h.view().composerText, '');
  h.reads[0].resolve(JSON.stringify({ text: 'A private draft', exclusive: true })); await flush();
  assert.equal(h.view().composerText, ''); assert.equal(h.writes.length, 0);
  h.reads[1].resolve(JSON.stringify({ text: 'B private draft', innovation: true })); await flush();
  assert.equal(h.view().composerText, 'B private draft'); h.fireTimers(); await flush();
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].key, 'pc_draft:b'); assert.equal(h.writes[0].value.text, 'B private draft'); h.hook.unmount();
});

test('draft timer and pending hydration cannot write after sign-out or unmount', async () => {
  const h = draftHarness(); h.reads[0].resolve(JSON.stringify({ text: 'Saved' })); await flush(); h.view();
  assert.equal(h.timers.size, 1); h.account(null); h.fireTimers(); assert.equal(h.writes.length, 0); h.hook.unmount();
  const late = draftHarness(); late.hook.unmount(); late.reads[0].resolve(JSON.stringify({ text: 'Too late' })); await flush();
  assert.equal(late.hook.writesAfterUnmount, 0); assert.equal(late.writes.length, 0);
});

test('failed draft read preserves storage until the user makes a deliberate new edit', async () => {
  const h = draftHarness(); h.reads[0].reject(new Error('Storage temporarily unavailable')); await flush(); h.view(); h.fireTimers();
  assert.equal(h.writes.length, 0);
  h.view().setComposerText('A deliberate replacement'); h.view(); h.fireTimers(); await flush();
  assert.equal(h.writes[0].value.text, 'A deliberate replacement'); h.hook.unmount();
});

function followHarness(options = {}) {
  const hook = hooks(), calls = [], alerts = [], profile = { id: 'target', full_name: 'Synthetic person', username: 'synthetic', avatar_url: null };
  let owner = 'a', serverFollowing = !!options.following, mutationCount = 0;
  const store = { session: { user: { id: owner } }, profile: { id: owner } };
  const useAuthStore = select => select(store); useAuthStore.getState = () => store;
  const client = { from(table) {
    const query = { table, kind: 'read', fields: '', filters: {} };
    const builder = {
      select(fields) { query.fields = fields; return builder; }, eq(key, value) { query.filters[key] = value; return builder; },
      neq() { return builder; }, order() { return builder; }, range() { return builder; }, in(key, value) { query.in = { key, value }; return builder; },
      insert(row) { query.kind = 'insert'; query.row = row; return builder; }, delete() { query.kind = 'delete'; return builder; }, maybeSingle() { query.single = true; return builder; },
      then(resolve, reject) {
        calls.push(query);
        if (query.kind !== 'read') {
          mutationCount++;
          const result = options.mutation ? options.mutation(query, mutationCount, () => { serverFollowing = query.kind === 'insert'; }) : { data: null, error: null };
          if (!options.mutation) serverFollowing = query.kind === 'insert';
          return Promise.resolve(result).then(resolve, reject);
        }
        if (options.read) { const result = options.read(query); if (result !== undefined) return Promise.resolve(result).then(resolve, reject); }
        const data = table === 'profiles' ? [profile] : query.fields === 'follower_id' ? [{ follower_id: 'target' }]
          : query.single ? serverFollowing ? { following_id: 'target' } : null : serverFollowing ? [{ following_id: 'target' }] : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    }; return builder;
  }, rpc: async () => ({ error: null }) };
  const native = Object.fromEntries(['View', 'Text', 'TouchableOpacity', 'TextInput', 'FlatList', 'ActivityIndicator'].map(name => [name, name]));
  native.StyleSheet = { hairlineWidth: 1 }; native.Alert = { alert: (...args) => alerts.push(args) };
  const Screen = moduleSource(fs.readFileSync(path.join(root, 'src/screens/profile/FollowListScreen.tsx'), 'utf8'), {
    react: hook.react, 'react/jsx-runtime': runtime, 'react-native': native,
    '../../theme/useTheme': { themedSheet: () => ({}), getTheme: () => ({ ink: { secondary: '#666' } }), useTheme: () => ({}) },
    '../../components/TierName': 'TierName', '../../components/SafeArea': { SafeAreaView: 'SafeAreaView' }, '../../components/VerifiedBadge': 'VerifiedBadge',
    '@react-navigation/native': { useNavigation: () => ({ goBack() {}, push() {} }), useRoute: () => ({ params: { userId: 'list-owner' } }) },
    '@expo/vector-icons': { Feather: 'Feather' }, 'expo-image': { Image: 'Image' }, '../../services/supabase': { supabase: client }, '../../stores/authStore': { useAuthStore },
  }).default;
  hook.mount(Screen);
  return { hook, calls, alerts, view: hook.render,
    get mutations() { return calls.filter(query => query.kind !== 'read'); },
    row() { const list = nodes(hook.render()).find(node => node.type === 'FlatList'); assert.ok(list, 'connections loaded'); return list.props.renderItem({ item: profile }); },
    account(id) { owner = id; store.session = { user: { id } }; store.profile = { id }; hook.invalidate(); hook.render(); },
    setServerFollowing(value) { serverFollowing = value; },
  };
}

test('resolved follow denial rolls back, shows retry, and an explicit retry can succeed', async () => {
  const h = followHarness({ mutation: (_query, count, commit) => { if (count === 1) return { data: null, error: { code: '42501' } }; commit(); return { data: null, error: null }; } }); await flush();
  await press(h.row(), 'Follow'); assert.ok(words(h.row()).includes('Follow')); assert.equal(words(h.row()).includes('Following'), false);
  assert.equal(h.alerts[0][0], 'Could not follow'); const retry = h.alerts[0][2].find(action => action.text === 'Retry'); retry.onPress(); await flush();
  assert.equal(h.mutations.length, 2); assert.ok(words(h.row()).includes('Following')); h.hook.unmount();
});

test('duplicate follow taps share one operation and denial restores an existing following state', async () => {
  const pending = deferred(); const h = followHarness({ following: true, mutation: () => pending.promise }); await flush();
  const row = h.row(); const first = press(row, 'Following'); const second = press(row, 'Following'); await flush(); assert.equal(h.mutations.length, 1);
  pending.resolve({ data: null, error: { code: '42501' } }); await Promise.all([first, second]);
  assert.ok(words(h.row()).includes('Following')); assert.equal(h.alerts[0][0], 'Could not unfollow'); h.hook.unmount();
});

test('late old-account follow failure cannot roll back a newer account or clear its lock', async () => {
  const first = deferred(), second = deferred(); const h = followHarness({ mutation: (_q, count) => count === 1 ? first.promise : second.promise }); await flush();
  const old = press(h.row(), 'Follow'); await flush(); h.account('b'); await flush();
  const next = press(h.row(), 'Follow'); await flush(); first.resolve({ error: { code: '42501' } }); await old;
  assert.equal(h.alerts.length, 0); assert.ok(words(h.row()).includes('Following'));
  const button = nodes(h.row()).find(node => node.type === 'TouchableOpacity' && words(node) === 'Following'); assert.equal(button.props.disabled, true);
  second.resolve({ error: null }); await next; assert.equal(h.mutations.length, 2); h.hook.unmount();
});

test('retry reconciles an already committed follow without a duplicate insert', async () => {
  const h = followHarness({ mutation: (_query, _count, commit) => { commit(); return Promise.reject(new Error('Response lost')); } }); await flush();
  await press(h.row(), 'Follow'); assert.equal(h.mutations.length, 1); assert.equal(h.alerts.length, 1);
  h.alerts[0][2].find(action => action.text === 'Retry').onPress(); await flush();
  assert.equal(h.mutations.length, 1); assert.ok(words(h.row()).includes('Following')); h.hook.unmount();
});

test('stale follow-list reads and an old retry cannot repopulate another account', async () => {
  const pending = deferred(); let firstRead = true;
  const h = followHarness({ read: query => { if (query.fields === 'follower_id' && firstRead) { firstRead = false; return pending.promise; } }, mutation: () => ({ error: { code: '42501' } }) });
  h.account('b'); await flush(); pending.resolve({ data: [{ follower_id: 'wrong-owner-row' }], error: null }); await flush();
  const list = nodes(h.view()).find(node => node.type === 'FlatList'); assert.equal(list.props.data[0].id, 'target');
  await press(h.row(), 'Follow'); const retry = h.alerts[0][2].find(action => action.text === 'Retry'); h.account('c'); await flush();
  retry.onPress(); await flush(); assert.equal(h.mutations.length, 1); h.hook.unmount();
});

test('follow-list read errors are visible and retryable instead of looking empty', async () => {
  let failed = true; const h = followHarness({ read: query => query.fields === 'follower_id' && failed ? { data: null, error: { message: 'Offline' } } : undefined }); await flush();
  assert.match(words(h.view()), /Connections could not be loaded/); failed = false; press(h.view(), 'Retry'); await flush();
  assert.doesNotMatch(words(h.view()), /Connections could not be loaded/); assert.ok(h.row()); h.hook.unmount();
});

test('a list read that started before a successful follow cannot undo its new state', async () => {
  const pending = deferred(); let statusReads = 0;
  const ids = ['target', ...Array.from({ length: 39 }, (_, index) => 'other-' + index)];
  const h = followHarness({ read: query => {
    if (query.fields === 'follower_id') return { data: ids.map(follower_id => ({ follower_id })), error: null };
    if (query.table === 'profiles') return { data: ids.map(id => ({ id, full_name: id })), error: null };
    if (query.in?.key === 'following_id' && ++statusReads === 2) return pending.promise;
  } }); await flush();
  nodes(h.view()).find(node => node.type === 'FlatList').props.onEndReached(); await flush();
  assert.equal(statusReads, 2); await press(h.row(), 'Follow');
  pending.resolve({ data: [], error: null }); await flush();
  assert.ok(words(h.row()).includes('Following')); h.hook.unmount();
});

test('follow completion after unmount cannot roll back state or show a stale error', async () => {
  const pending = deferred(); const h = followHarness({ mutation: () => pending.promise }); await flush();
  const work = press(h.row(), 'Follow'); await flush(); h.hook.unmount(); pending.resolve({ error: { code: '42501' } }); await work;
  assert.equal(h.alerts.length, 0); assert.equal(h.hook.writesAfterUnmount, 0);
});

test('a list read started during a follow cannot overwrite its later confirmed result', async () => {
  const read = deferred(), mutation = deferred(); let statusReads = 0;
  const ids = ['target', ...Array.from({ length: 39 }, (_, index) => 'other-' + index)];
  const h = followHarness({ mutation: () => mutation.promise, read: query => {
    if (query.fields === 'follower_id') return { data: ids.map(follower_id => ({ follower_id })), error: null };
    if (query.table === 'profiles') return { data: ids.map(id => ({ id, full_name: id })), error: null };
    if (query.in?.key === 'following_id' && ++statusReads === 2) return read.promise;
  } }); await flush();
  const responding = press(h.row(), 'Follow'); await flush();
  nodes(h.view()).find(node => node.type === 'FlatList').props.onEndReached(); await flush(); assert.equal(statusReads, 2);
  mutation.resolve({ data: null, error: null }); await responding;
  read.resolve({ data: [], error: null }); await flush();
  assert.ok(words(h.row()).includes('Following')); h.hook.unmount();
});
