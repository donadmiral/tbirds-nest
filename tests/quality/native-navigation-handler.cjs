const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const routers = require('@react-navigation/routers');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const turn = () => new Promise(resolve => setImmediate(resolve));
const walk = node => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object'
  ? [node, ...walk(node.props?.children)] : [];

// The production AppNavigator and the installed Navigation 6 helper/cache/focus
// hooks execute below. Only the native host and React hook scheduling are fake;
// dependency identity and effect cleanup follow the installed hook contracts.
function hookHost(contexts = new Map()) {
  const instances = new Map();
  let current;
  const next = () => ({ slots: current.slots, index: current.cursor++ });
  const react = {
    createRef: () => ({ current: null }),
    useContext: key => contexts.get(key),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useMemo(fn, deps) {
      const { slots, index } = next();
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useRef(value) {
      const { slots, index } = next();
      return slots[index] ?? (slots[index] = { current: value });
    },
    useState(initial) {
      const { slots, index } = next();
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useEffect(fn, deps) {
      const { slots, index } = next(), previous = slots[index];
      if (!same(previous?.deps, deps)) {
        slots[index] = { deps, cleanup: previous?.cleanup };
        current.effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = fn(); });
      }
    },
  };
  react.useLayoutEffect = react.useEffect;
  react.default = react;
  react.__esModule = true;
  return {
    react,
    render(key, fn, commit = true) {
      const instance = instances.get(key) || { slots: [], effects: [], cursor: 0 };
      instances.set(key, instance); current = instance; instance.cursor = 0;
      const result = fn(); current = undefined;
      const effects = instance.effects.splice(0);
      if (commit) effects.forEach(effect => effect());
      return result;
    },
    dispose(key) {
      const instance = instances.get(key);
      instance?.slots.forEach(slot => slot?.cleanup?.()); instances.delete(key);
    },
  };
}

function compile(file, requireModule, globals = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(read(file), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, require: requireModule,
    console, process, setTimeout, clearTimeout, AbortController, ...globals }, { filename: file });
  return module.exports;
}

function appHarness() {
  const host = hookHost(), messages = [], navigators = [];
  const jsx = (type, props, key) => ({ type, props, key });
  const NavigationContainer = 'NavigationContainer';
  const palette = { surface: { canvas: '#fff', hairline: '#ddd' }, ink: { primary: '#111' }, brand: { base: '#123' }, status: { danger: '#f00' } };
  const state = { session: { user: { id: 'owner' } }, profile: { id: 'owner', username: 'owner' }, loading: false, isPasswordRecovery: false };
  let revision = 1;
  const auth = select => select(state);
  auth.getState = () => state;
  const createNavigator = () => {
    const value = { Navigator: `Navigator${navigators.length}`, Screen: 'Screen', Group: 'Group' };
    navigators.push(value); return value;
  };
  const mocks = {
    react: host.react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Platform: { OS: 'android' }, StyleSheet: { absoluteFill: {} } },
    '@react-navigation/native': { NavigationContainer, DefaultTheme: { colors: {} }, DarkTheme: { colors: {} } },
    '@react-navigation/native-stack': { createNativeStackNavigator: createNavigator },
    '@react-navigation/bottom-tabs': { createBottomTabNavigator: createNavigator },
    '../theme/useTheme': { useTheme: () => ({ t: palette, isDark: false }), themedSheet: () => ({}) },
    '../stores/themeStore': { useThemeStore: select => select({ init() {} }) },
    '../stores/authStore': { useAuthStore: auth },
    '../lib/navigationCache': { navigationRevision: () => revision, subscribeNavigationScope: () => () => {} },
  };
  const Component = compile('src/navigation/AppNavigator.tsx', name => mocks[name] || { __esModule: true, default: name },
    { console: { log: (...args) => messages.push(args) } }).default;
  function render() {
    // Unrelated provider effects are deliberately not mounted; this acceptance
    // renders the actual navigation-container props and session-key branches.
    const tree = host.render('app', () => Component(), false);
    const nodes = walk(tree), container = nodes.find(node => node.type === NavigationContainer);
    assert.ok(container);
    return { handler: container.props.onUnhandledAction,
      stackKey: nodes.find(node => node.type === navigators[0].Navigator)?.key };
  }
  return { state, render, messages,
    profile(value = { ...state.profile }) { state.profile = value; },
    recovery(value) { state.isPasswordRecovery = value; },
    account(owner) { state.session = { user: { id: owner } }; state.profile = { id: owner, username: owner }; revision++; },
  };
}

function navigationHarness(app, onFocus) {
  const UnhandledActionContext = {}, NavigationContext = {}, NavigationBuilderContext = {};
  const contexts = new Map([[NavigationContext, undefined], [NavigationBuilderContext, { stackRef: { current: undefined } }]]);
  const host = hookHost(contexts), listeners = { focus: new Set(), blur: new Set() };
  let focused = true, currentNavigation, starts = 0, cleanups = 0;
  const router = routers.StackRouter({});
  const state = router.getInitialState({ routeNames: ['Profile'], routeParamList: {}, routeGetIdList: {} });
  const getState = () => state, setOptions = () => {}, onAction = () => true;
  const emitter = { emit() {}, create: () => ({ addListener(event, fn) {
    listeners[event].add(fn); return () => listeners[event].delete(fn);
  } }) };
  const modules = {
    react: host.react, '@react-navigation/routers': routers,
    './NavigationContext': { __esModule: true, default: NavigationContext },
    './UnhandledActionContext': { __esModule: true, default: UnhandledActionContext },
    './NavigationBuilderContext': { __esModule: true, default: NavigationBuilderContext },
    './types': { PrivateValueStore: class {} },
    './useNavigation': { __esModule: true, default: () => currentNavigation },
  };
  const requireModule = name => { assert.ok(name in modules, name); return modules[name]; };
  const helpers = compile('node_modules/@react-navigation/core/src/useNavigationHelpers.tsx', requireModule).default;
  const cache = compile('node_modules/@react-navigation/core/src/useNavigationCache.tsx', requireModule).default;
  const focusEffect = compile('node_modules/@react-navigation/core/src/useFocusEffect.tsx', requireModule).default;
  const effect = () => { starts++; onFocus?.(); return () => { cleanups++; }; };
  const parent = { isFocused: () => focused, getId: () => 'parent' };
  contexts.set(NavigationContext, parent);
  return {
    render() {
      contexts.set(UnhandledActionContext, app.render().handler);
      host.render('navigation', () => {
        const navigation = helpers({ id: 'profile', onAction, getState, emitter, router });
        currentNavigation = cache({ state, getState, navigation, setOptions, router, emitter })[state.routes[0].key];
      });
      host.render('focus', () => focusEffect(effect));
      return currentNavigation;
    },
    focus(value) { focused = value; for (const fn of [...listeners[value ? 'focus' : 'blur']]) fn(); },
    get starts() { return starts; }, get cleanups() { return cleanups; },
    dispose() { host.dispose('focus'); },
  };
}

function profileLoader(app) {
  const file = 'src/screens/profile/ProfileScreen.tsx';
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'load') initializer = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(initializer);
  const module = { exports: {} }, owner = { userId: 'owner', sessionScope: '1:owner' }, calls = [];
  const output = ts.transpileModule(`module.exports = ${initializer}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const globals = { module, useCallback: fn => fn, userId: 'owner', scope: { current: owner },
    profileRequest: { current: 0 }, mounted: { current: true }, navigationScope: () => owner.sessionScope,
    profileReadRef: { current: null }, prefetchedOwner: { current: null },
    takePrefetched: () => null, awaitPrefetched: async () => null,
    authProfileRef: { get current() { return app.state.profile; } },
    setAuthProfile: profile => app.profile(profile),
    setLoading() {}, setRefreshing() {}, setLoadError() {}, setProfile() {}, setStats() {}, AbortController,
    supabase: { rpc(name) { calls.push(name); return name; } },
    profileContentRead: async (_owner, _scope, _signal, work) => work({ check() {}, read: async name => name === 'get_profile'
      ? { id: 'owner', username: 'owner', full_name: 'Fixture owner', counts: {} } : null }),
  };
  vm.runInNewContext(output, globals);
  return { load: module.exports, calls };
}

test('actual navigation containers retain one unhandled-action handler across profile refresh and recovery branches', () => {
  const app = appHarness(), first = app.render().handler;
  assert.equal(typeof first, 'function');
  app.profile(); assert.equal(app.render().handler, first);
  app.recovery(true); assert.equal(app.render().handler, first);
  app.profile(); assert.equal(app.render().handler, first);
  app.recovery(false); assert.equal(app.render().handler, first);
});

test('actual Profile completion cannot restart installed Navigation focus reads through the container callback', async () => {
  const app = appHarness(), profile = profileLoader(app), pending = [];
  const nav = navigationHarness(app, () => { pending.push(profile.load()); });
  try {
    const first = nav.render();
    for (let count = 0; count < 6; count++) {
      await Promise.all(pending.splice(0)); await turn(); nav.render();
    }
    assert.equal(profile.calls.filter(name => name === 'get_profile').length, 1,
      'a successful profile merge must not trigger another focused profile read');
    assert.equal(nav.starts, 1); assert.equal(nav.cleanups, 0);
    assert.equal(nav.render(), first, 'installed helpers and per-screen cache retain their navigation object');
  } finally { nav.dispose(); await Promise.all(pending); }
});

test('stable callback preserves genuine blur/refocus refresh and duplicate focus suppression', () => {
  const app = appHarness(), nav = navigationHarness(app);
  try {
    nav.render(); assert.equal(nav.starts, 1);
    nav.focus(true); assert.equal(nav.starts, 1);
    nav.focus(false); assert.equal(nav.cleanups, 1);
    app.profile(); nav.render(); assert.equal(nav.starts, 1, 'background profile changes must not start a focused read');
    nav.focus(true); assert.equal(nav.starts, 2);
    nav.focus(true); assert.equal(nav.starts, 2);
    app.profile(); nav.render(); assert.equal(nav.starts, 2);
  } finally { nav.dispose(); }
});

test('unhandled behavior still ignores GO_BACK and logs only the unexpected action type', () => {
  const app = appHarness(), handler = app.render().handler;
  handler({ type: 'GO_BACK', payload: { private: 'do not log' } });
  assert.equal(app.messages.length, 0);
  handler({ type: 'NAVIGATE', payload: { private: 'do not log' } });
  handler(undefined);
  assert.deepEqual(app.messages.map(row => Array.from(row)), [
    ['[nav] unhandled action', 'NAVIGATE'], ['[nav] unhandled action', undefined],
  ]);
});

test('callback stability does not remove the actual root navigator session/ABA keys', () => {
  const app = appHarness(), first = app.render();
  app.account('other'); const second = app.render();
  app.account('owner'); const third = app.render();
  assert.notEqual(first.stackKey, second.stackKey);
  assert.notEqual(second.stackKey, third.stackKey);
  assert.notEqual(first.stackKey, third.stackKey);
  assert.equal(second.handler, first.handler); assert.equal(third.handler, first.handler);
});
