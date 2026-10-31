const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const babel = require('@babel/core');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');

const styleModule = { exports: {} };
vm.runInNewContext(babel.transformSync(fs.readFileSync(path.join(root,
  'node_modules/react-native/Libraries/StyleSheet/flattenStyle.js'), 'utf8'), {
  presets: [require.resolve('@react-native/babel-preset')], configFile: false, babelrc: false,
}).code, { module: styleModule, exports: styleModule.exports });
const flatten = styleModule.exports.default;

function load(source, imports, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { ...globals, module, exports: module.exports, require: name => {
    if (!Object.hasOwn(imports, name)) throw new Error('Unexpected import: ' + name);
    return imports[name];
  } });
  return module.exports;
}

function descendants(node, type) {
  if (Array.isArray(node)) return node.flatMap(child => descendants(child, type));
  if (!node || typeof node !== 'object') return [];
  return [...(node.type === type ? [node] : []), ...descendants(node.props?.children, type)];
}

// Run the actual AppNavigator functions and installed native-entry tab views.
// Only React hooks and native hosts are simulated; effects/screens are not run.
function renderTabs(platform, business) {
  const jsx = (type, props) => ({ type, props });
  const React = { useRef: value => ({ current: value }), useEffect() {}, useContext: () => undefined,
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useCallback: callback => callback, Fragment: 'Fragment' };
  class Value {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    stopAnimation() {}
    interpolate(value) { return value; }
  }
  const Platform = { OS: platform, isPad: false, select: values => values[platform] ?? values.default };
  const StyleSheet = { flatten, create: value => value, hairlineWidth: 1,
    absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } };
  const native = { Platform, StyleSheet, Animated: { Value, View: 'Animated.View' },
    Pressable: 'Pressable', View: 'View', Text: 'Text' };
  const nav = { useTheme: () => ({ colors: { primary: '#fff', text: '#fff', card: '#111', border: '#333' } }),
    useLinkBuilder: () => name => '/' + name,
    NavigationContext: { Provider: 'NavigationContext' }, NavigationRouteContext: { Provider: 'RouteContext' },
    CommonActions: { navigate: payload => ({ type: 'NAVIGATE', payload }) }, Link: 'Link' };
  const imports = { react: { __esModule: true, default: React, ...React },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': native,
    '@react-navigation/native': nav, color: require('color'),
    './TabBarIcon': { __esModule: true, default: 'TabBarIcon' } };
  const installed = file => fs.readFileSync(path.join(root,
    'node_modules/@react-navigation/bottom-tabs/src/views', file), 'utf8');
  const Item = load(installed('BottomTabItem.tsx'), imports).default;
  const Bar = load(installed('BottomTabBar.tsx'), { ...imports,
    '@react-navigation/elements': { MissingIcon: 'MissingIcon' },
    'react-native-safe-area-context': { useSafeAreaFrame: () => ({ width: 390, height: 844 }) },
    '../utils/BottomTabBarHeightCallbackContext': { __esModule: true, default: {} },
    '../utils/useIsKeyboardShown': { __esModule: true, default: () => false },
    './BottomTabItem': { __esModule: true, default: Item },
  }).default;
  const source = fs.readFileSync(path.join(root, 'src/navigation/AppNavigator.tsx'), 'utf8');
  const parsed = ts.createSourceFile('AppNavigator.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = ['getTabIcon', 'TabBarButton', 'MainTabs'].map(name => {
    const fn = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(fn, 'The actual navigator function must exist: ' + name);
    return 'export ' + fn.getText(parsed);
  }).join('\n');
  const app = load(functions, imports, { React, ...native, useState: React.useState, useEffect: React.useEffect,
    useTheme: () => ({ t: { ink: { primary: '#fff', secondary: '#aaa' },
      surface: { raised: '#111', hairline: '#333' } }, isDark: true }),
    useNavigationAccessibility: () => ({ reduceMotion: false, screenReader: false,
      highContrast: false, reduceTransparency: false }),
    useAuthStore: selector => selector({ profile: { id: 'synthetic-owner', account_type: business ? 'business' : 'personal' } }),
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 34 }),
    Tab: { Navigator: 'Tab.Navigator', Screen: 'Tab.Screen' },
    FeedStackNav: 'FeedStackNav', NetworkStackNav: 'NetworkStackNav', JobsStackNav: 'JobsStackNav',
    StudioScreen: 'StudioScreen', MessagesStackNav: 'MessagesStackNav', ProfileStackNav: 'ProfileStackNav',
    BlurView: 'BlurView', Haptics: { selectionAsync: () => Promise.resolve() },
  });
  const tabs = app.MainTabs();
  const routes = descendants(tabs, 'Tab.Screen').map(node => ({ name: node.props.name, key: node.props.name + '-route' }));
  const events = [], dispatches = [];
  const navigation = { emit: event => { events.push(event); return { defaultPrevented: false }; },
    dispatch: action => dispatches.push(action) };
  const state = { key: 'main-tabs', index: routes.findIndex(route => route.name === tabs.props.initialRouteName), routes };
  const descriptors = Object.fromEntries(routes.map(route => [route.key,
    { navigation, options: tabs.props.screenOptions({ route, navigation }) }]));
  const tree = Bar({ state, descriptors, navigation, insets: { top: 0, left: 0, right: 0, bottom: 34 } });
  const buttons = descendants(tree, Item).map(node => {
    const custom = Item(node.props);
    assert.equal(custom.type, app.TabBarButton, 'installed navigation must call the actual custom button');
    return { route: node.props.route, host: custom.type(custom.props) };
  });
  return { buttons, state, events, dispatches };
}

for (const platform of ['ios', 'android']) for (const business of [false, true]) {
  test(`${platform} ${business ? 'business' : 'personal'} tabs keep stable native IDs, labels and activation through the installed navigator`, () => {
    const { buttons, state, events, dispatches } = renderTabs(platform, business);
    assert.equal(buttons.length, 5);
    assert.equal(new Set(buttons.map(button => button.host.props.testID)).size, 5);
    assert.ok(buttons.some(button => button.route.name === (business ? 'Studio' : 'Jobs')));
    for (const { route, host } of buttons) {
      const id = 'main-tab-' + route.name.toLowerCase();
      assert.equal(host.type, 'Pressable');
      assert.equal(host.props.testID, id);
      assert.equal(host.props.accessibilityLabel, route.name === 'Feed' ? 'Home' : route.name);
      assert.equal(host.props.accessibilityRole, platform === 'ios' ? 'button' : 'tab');
      assert.equal(host.props.accessibilityState.selected, route.key === state.routes[state.index].key);
      const style = flatten(host.props.style);
      assert.ok(style.minWidth >= 48 && style.minHeight >= 48);
      host.props.onPress();
      assert.equal(events.at(-1).type, 'tabPress'); assert.equal(events.at(-1).target, route.key);
      if (!host.props.accessibilityState.selected) assert.equal(dispatches.at(-1).payload.name, route.name);
      host.props.onLongPress();
      assert.equal(events.at(-1).type, 'tabLongPress'); assert.equal(events.at(-1).target, route.key);
    }
    const home = buttons.find(button => button.route.name === 'Feed').host;
    const observedSystemHome = { props: { testID: 'com.android.launcher3:id/home', accessibilityLabel: 'Home' } };
    assert.deepEqual([observedSystemHome, ...buttons.map(button => button.host)]
      .filter(node => /^main-tab-feed$/.test(node.props.testID)), [home],
    'the native ID identifies only the app tab even when the system exposes the same Home label');
  });
}

test('native flows select all main tabs by their rendered IDs and preserve the navigation sequence', () => {
  const labels = new Set(['Home', 'Market', 'Jobs', 'Studio', 'Messages', 'Profile']);
  const actualIds = new Set([false, true].flatMap(business => renderTabs('android', business).buttons.map(button => button.host.props.testID)));
  function commands(nodes) {
    return nodes.flatMap(node => [node, ...commands(node.repeat?.commands ?? []),
      ...commands(typeof node.runFlow === 'object' ? node.runFlow.commands ?? [] : [])]);
  }
  const ids = [];
  const directory = path.join(root, 'tests/native/flows');
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.yaml')).sort()) {
    const documents = YAML.parseAllDocuments(fs.readFileSync(path.join(directory, file), 'utf8'));
    assert.ok(documents.every(document => document.errors.length === 0), file + ' must remain valid YAML');
    for (const command of commands(documents[1].toJSON())) {
      const tap = command.tapOn;
      assert.ok(!(typeof tap === 'string' && labels.has(tap)), file + ' must not select a main tab by an ambiguous label');
      if (tap && typeof tap === 'object' && tap.id?.startsWith('main-tab-')) {
        assert.deepEqual(Object.keys(tap), ['id'], 'tab actions use the semantic ID without a coordinate or fallback');
        assert.ok(actualIds.has(tap.id), 'flow selector must resolve to an actual app tab: ' + tap.id);
        ids.push(tap.id);
      }
    }
  }
  assert.deepEqual(ids, ['main-tab-market', 'main-tab-feed', 'main-tab-jobs', 'main-tab-messages',
    'main-tab-profile', 'main-tab-feed', 'main-tab-messages', 'main-tab-feed']);
});
