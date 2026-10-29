const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function compile(source, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, ...globals });
  return module.exports;
}
function handler(file, component, name, globals) {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === component);
  let expression;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) expression = node.initializer.getText(ast); ts.forEachChild(node, visit); }
  visit(fn.body); assert.ok(expression, component + '.' + name);
  return compile('const ' + name + ' = ' + expression + '; exports.run = ' + name, { useCallback: fn => fn, ...globals }).run;
}
function deferred() { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function nativeHarness(file, component, rpc, initialProps = {}) {
  const slots = []; let cursor = 0, effects = [], props = initialProps, owner = 'owner', tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => value === b[i]);
  const hooks = {
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const auth = selector => selector(auth.getState()); auth.getState = () => ({ session: { user: { id: owner } }, profile: { id: owner } });
  const theme = compile(read('src/constants/tokens/light.ts')).light;
  const stubs = new Proxy({}, { get: (_, key) => key === '__esModule' ? true : String(key) });
  let resource;
  function requireMock(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
    if (name.endsWith('/authStore')) return { useAuthStore: auth };
    if (name.endsWith('/supabase')) return { supabase: { rpc } };
    if (name.endsWith('/useTheme')) return { themedSheet: factory => factory(theme), getTheme: () => theme, useTheme: () => ({ t: theme }) };
    if (name.endsWith('/SafeArea')) return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 20 }) };
    if (name.endsWith('/StudioLoadError')) return { StudioLoadError: 'StudioLoadError' };
    if (name.endsWith('/useStudioResource')) return resource ?? (resource = compile(read('src/hooks/useStudioResource.ts'), { require: requireMock }));
    return stubs;
  }
  const target = compile(read(file) + '\nexports.TestComponent = ' + component, { require: requireMock, setTimeout, clearTimeout });
  function render(next = props) { props = next; cursor = 0; tree = target.TestComponent(props); const jobs = effects; effects = []; jobs.forEach(fn => fn()); return tree; }
  function nodes() { const list = []; function walk(value) { if (Array.isArray(value)) return value.forEach(walk); if (!value || typeof value !== 'object') return; list.push(value); walk(value.props?.children); } walk(tree); return list; }
  return { render, nodes, owner: next => { owner = next; }, flush: async () => { for (let i = 0; i < 3; i++) { await flush(); render(); } } };
}

test('native Studio Settings replaces failed-load spinner with retry, then loads the saved business', async () => {
  let failure = true;
  const h = nativeHarness('src/screens/studio/StudioScreen.tsx', 'SettingsSeg', async () => failure ? { data: null, error: Error('offline') } : { data: { profile: { bio: 'Saved bio' }, business: { category: 'Design' }, role: 'owner', members: [], devices: [] }, error: null }, { me: {}, reload: async () => {} });
  h.render(); await h.flush();
  const error = h.nodes().find(node => node.type === 'StudioLoadError'); assert.match(error.props.message, /could not be refreshed/);
  assert.equal(h.nodes().some(node => node.type === 'ActivityIndicator'), false);
  failure = false; await error.props.onRetry(); await h.flush();
  assert.ok(h.nodes().some(node => node.type === 'TextInput' && node.props.value === 'Saved bio'));
});

test('native channel settings keep unsaved edits across callback changes and read the current member notification value', async () => {
  const calls = [];
  const props = { visible: true, channelId: 'channel', meId: 'owner', myRole: 'owner', onClose() {}, onChannelUpdated() {} };
  const h = nativeHarness('src/components/ChannelSettingsSheet.tsx', 'ChannelSettingsSheet', async name => {
    calls.push(name); return name === 'get_channel_detail' ? { data: [{ name: 'Original', is_member: true, my_notification_level: 'mute' }], error: null } : { data: [], error: null };
  }, props);
  h.render(); await h.flush();
  const input = h.nodes().find(node => node.type === 'TextInput' && node.props.placeholder === 'Channel name');
  input.props.onChangeText('Unsaved'); h.render({ ...props, onChannelUpdated() {} }); await h.flush();
  assert.equal(calls.length, 2, 'parent renders do not refetch and overwrite the editor');
  assert.equal(h.nodes().find(node => node.type === 'TextInput' && node.props.placeholder === 'Channel name').props.value, 'Unsaved');
  assert.equal(calls[0], 'get_channel_detail', 'notification setting comes from the current viewer, not first 100 members');
  const mute = h.nodes().find(node => node.type === 'TouchableOpacity' && node.props.children?.props?.children === 'Mute');
  assert.ok(mute.props.style[1], 'Mute remains selected even when the current viewer is outside the member page');
});

test('native channel settings reject partial loads instead of exposing blank editable defaults', async () => {
  const h = nativeHarness('src/components/ChannelSettingsSheet.tsx', 'ChannelSettingsSheet', async name => name === 'get_channel_detail' ? { data: [{ name: 'Existing', is_member: true }], error: null } : { data: null, error: Error('members unavailable') }, { visible: true, channelId: 'channel', meId: 'owner', myRole: 'owner', onClose() {} });
  h.render(); await h.flush();
  assert.ok(h.nodes().some(node => node.type === 'StudioLoadError' && node.props.message));
  assert.equal(h.nodes().some(node => node.type === 'TextInput' && node.props.placeholder === 'Channel name'), false);
});

test('native directory failures are visible, and old search results cannot replace a newer query', async () => {
  const wait = deferred(); let rows = [], error = null; const scope = { current: 'owner:channels:old' };
  const globals = { uid: 'owner', mounted: { current: true }, searchScope: scope, request: { current: 0 }, setLoading() {}, setLoadError: value => { error = value; }, setRows: value => { rows = value; }, supabase: { rpc: () => wait.promise } };
  const load = handler('src/screens/channels/ChannelsScreen.tsx', 'ChannelsScreen', 'load', globals);
  const pending = load('old', 'channels'); scope.current = 'owner:channels:new'; wait.resolve({ data: [{ id: 'old' }], error: null }); await pending; assert.equal(rows.length, 0);
  globals.supabase.rpc = async () => ({ data: null, error: Error('offline') });
  await load('new', 'channels'); assert.match(error, /could not be loaded/); assert.equal(rows.length, 0);
});

for (const platform of ['native', 'web']) test(`${platform} channel creation prevents double taps and ignores old-account completion`, async () => {
  const wait = deferred(), locks = { current: new Set() }, routes = []; let valid = true, calls = 0, cleared = 0;
  const common = { cName: 'Updates', cDesc: 'News', cAud: 'everyone', locks, supabase: { rpc: () => { calls++; return wait.promise; } }, setCName: () => { cleared++; }, setCDesc() {}, setCAud() {} };
  const globals = platform === 'native' ? { ...common, uid: 'owner', currentAccount: () => valid, setCreating() {}, setCreateOpen() {}, load: async () => {}, query: '', navigation: { navigate: (...args) => routes.push(args) }, Alert: { alert() {} } }
    : { ...common, me: 'owner', mounted: { current: true }, scope: { current: 1 }, account: { current: 'owner' }, setCreating() {}, setBusy() {}, setActionError() {}, router: { push: url => routes.push(url) } };
  const run = platform === 'native' ? handler('src/screens/channels/ChannelsScreen.tsx', 'ChannelsScreen', 'createChannel', globals) : handler('web/app/channels/page.tsx', 'ChannelsPage', 'create', globals);
  const pending = run(); await run(); assert.equal(calls, 1);
  valid = false; if (platform === 'web') globals.account.current = 'new-owner';
  wait.resolve({ data: { id: 'created', name: 'Updates' }, error: null }); await pending;
  assert.equal(routes.length, 0); assert.equal(cleared, 0);
});

test('native channel mutations report transport failure, serialize taps and suppress late results', async () => {
  let valid = true, applied = 0, calls = 0; const alerts = [], wait = deferred();
  const globals = { scope: { current: 1 }, current: () => valid, locks: { current: new Set() }, Alert: { alert: (...args) => alerts.push(args) } };
  const run = handler('src/components/ChannelSettingsSheet.tsx', 'ChannelSettingsSheet', 'runAction', globals);
  const work = () => { calls++; return wait.promise; };
  const pending = run('member', work, () => { applied++; }, 'Could not update'); await run('member', work, () => { applied++; }, 'Could not update');
  assert.equal(calls, 1); wait.reject(Error('offline')); await pending; assert.equal(alerts.length, 1); assert.equal(applied, 0); assert.equal(globals.locks.current.size, 0);
  const late = deferred(), next = run('member', () => late.promise, () => { applied++; }, 'Could not update'); valid = false; late.resolve({ error: null }); await next; assert.equal(applied, 0);
});

test('web member roles report network failure and do not apply a successful response after unmount', async () => {
  let valid = true, changes = 0, writes = 0; const wait = deferred(), alerts = [];
  const globals = { isOwner: true, current: () => valid, actionLocks: { current: new Set() }, channelId: 'channel', setMembers: () => { changes++; }, supabase: { rpc: () => { writes++; return wait.promise; } }, alert: message => alerts.push(message) };
  const apply = handler('web/app/channels/[id]/page.tsx', 'ChannelSettings', 'applyRole', globals);
  const pending = apply({ user_id: 'member' }, 'moderator'); await apply({ user_id: 'member' }, 'collaborator'); assert.equal(writes, 1);
  wait.reject(Error('offline')); await pending; assert.equal(alerts.length, 1); assert.equal(changes, 0);
  const late = deferred(); globals.supabase.rpc = () => late.promise; const next = apply({ user_id: 'member' }, 'moderator'); valid = false; late.resolve({ error: null }); await next; assert.equal(changes, 0);
});

test('native business code creation cannot duplicate a tap or reveal a previous account code', async () => {
  let valid = true, issued = 0, calls = 0; const wait = deferred();
  const globals = { newName: 'Teammate', acting: { current: false }, isOwner: true, current: () => valid, setBusy() {}, setIssued: () => { issued++; }, setNewName() {}, load: async () => {}, Alert: { alert() {} }, supabase: { rpc: () => { calls++; return wait.promise; } } };
  const create = handler('src/screens/studio/StudioScreen.tsx', 'SettingsSeg', 'addMember', globals);
  const pending = create(); await create(); assert.equal(calls, 1); valid = false; wait.resolve({ data: 'PRIVATE-CODE', error: null }); await pending; assert.equal(issued, 0);
});

test('native channel media chooser stops after an account switch during permission', async () => {
  let valid = true, pickers = 0; const wait = deferred();
  const attach = handler('src/screens/channels/ChannelScreen.tsx', 'ChannelScreen', 'attach', { scope: { current: 1 }, uid: 'owner', actionLock: { current: false }, valid: () => valid, ImagePicker: { requestMediaLibraryPermissionsAsync: () => wait.promise, launchImageLibraryAsync: () => { pickers++; return { canceled: true }; } }, setAttaching() {}, Alert: { alert() {} } });
  const pending = attach(); valid = false; wait.resolve({ granted: true }); await pending; assert.equal(pickers, 0);
});

test('native channel icon upload cannot mutate the channel after its account or sheet changes', async () => {
  const wait = deferred(); let valid = true, writes = 0;
  const pick = handler('src/components/ChannelSettingsSheet.tsx', 'ChannelSettingsSheet', 'pickIcon', { scope: { current: 1 }, isOwner: true, meId: 'owner', channelId: 'channel', current: () => valid, locks: { current: new Set() }, setIconBusy() {}, ImagePicker: { requestMediaLibraryPermissionsAsync: async () => ({ granted: true }), launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'image.jpg', width: 5, height: 5 }] }) }, uploadMedia: () => wait.promise, supabase: { rpc: async () => { writes++; return { error: null }; } }, setIconUrl() {}, updatedRef: { current() {} }, Alert: { alert() {} } });
  const pending = pick(); await flush(); valid = false; wait.resolve({ url: 'old-owner-object' }); await pending; assert.equal(writes, 0);
});

test('native channel read markers require a foreground focused unobscured latest view and can retry errors', async () => {
  let writes = 0, fail = false; const errors = [];
  const globals = { scope: { current: 1 }, channelId: 'channel', uid: 'owner', loadedIdentity: { current: 'owner:channel' }, messagesRef: { current: [{ id: 'newest' }] }, valid: () => true, readPending: { current: false }, lastRead: { current: '' }, readState: { current: { focused: true, isMember: true, obscured: false } }, atLatest: { current: true }, AppState: { currentState: 'active' }, deadline: work => work, supabase: { rpc: async () => { writes++; return { error: fail ? Error('offline') : null }; } }, setLoadError: error => errors.push(error) };
  const mark = handler('src/screens/channels/ChannelScreen.tsx', 'ChannelScreen', 'markRead', globals);
  for (const [ref, key, blocked, allowed] of [[globals.AppState, 'currentState', 'background', 'active'], [globals.readState.current, 'focused', false, true], [globals.readState.current, 'isMember', false, true], [globals.readState.current, 'obscured', true, false], [globals.atLatest, 'current', false, true], [globals.loadedIdentity, 'current', 'previous:channel', 'owner:channel']]) {
    ref[key] = blocked; await mark(); assert.equal(writes, 0); ref[key] = allowed;
  }
  await mark(); await mark(); assert.equal(writes, 1);
  globals.messagesRef.current = [{ id: 'next' }]; fail = true; await mark(); assert.equal(globals.lastRead.current, 'newest'); assert.equal(errors.length, 1);
  fail = false; await mark(); assert.equal(globals.lastRead.current, 'next');
});

test('web channel read markers ignore hidden, unfocused, obscured and scrolled-away updates', async () => {
  let writes = 0; const rect = { top: 500, bottom: 501 }; let focused = true;
  const globals = { epoch: { current: 1 }, channelId: 'channel', readPending: { current: false }, lastRead: { current: '' }, readState: { current: { message: 'latest', ready: true } }, endRef: { current: { getBoundingClientRect: () => rect } }, document: { visibilityState: 'visible', hasFocus: () => focused }, window: { innerHeight: 800 }, withTimeout: work => work, supabase: { rpc: async () => { writes++; return { error: null }; } }, setError() {} };
  const mark = handler('web/app/channels/[id]/page.tsx', 'ChannelInner', 'markRead', globals);
  globals.document.visibilityState = 'hidden'; await mark(); globals.document.visibilityState = 'visible';
  focused = false; await mark(); focused = true;
  globals.readState.current.ready = false; await mark(); globals.readState.current.ready = true;
  rect.bottom = 1200; await mark(); rect.bottom = 501;
  assert.equal(writes, 0); await mark(); await mark(); assert.equal(writes, 1);
});
