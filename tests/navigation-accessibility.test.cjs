// node --test tests/navigation-accessibility.test.cjs
// Runs the actual preference hook and tab components against native API doubles.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const flush = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const plain = value => JSON.parse(JSON.stringify(value));

function runtime() {
  const state = [], effects = [], pending = [];
  let cursor = 0, updates = 0;
  const useState = initial => {
    const key = cursor++;
    if (!(key in state)) state[key] = typeof initial === 'function' ? initial() : initial;
    return [state[key], value => { updates++; state[key] = typeof value === 'function' ? value(state[key]) : value; }];
  };
  const react = {
    useState,
    useRef: initial => useState(() => ({ current: initial }))[0],
    useCallback: callback => callback,
    useEffect(fn, deps) {
      const key = cursor++, old = effects[key];
      if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) pending.push(() => {
        old?.cleanup?.(); effects[key] = { deps, cleanup: fn() };
      });
    },
  };
  react.default = react;
  const jsx = (type, props) => ({ type, props });
  return {
    react, jsx,
    render(fn, props) { cursor = 0; const result = fn(props); pending.splice(0).forEach(effect => effect()); return result; },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); },
    updates: () => updates,
  };
}

function load(source, imports) {
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: id => {
    assert.ok(Object.hasOwn(imports, id), `unexpected import ${id}`); return imports[id];
  } });
  return module.exports;
}

function preferences(os = 'ios') {
  const r = runtime(), events = new Map(), reads = {};
  const api = { addEventListener(name, callback) { events.set(name, callback); return { remove: () => events.delete(name) }; } };
  for (const name of ['isReduceMotionEnabled', 'isScreenReaderEnabled', 'isReduceTransparencyEnabled', 'isDarkerSystemColorsEnabled', 'isHighTextContrastEnabled']) {
    api[name] = () => { reads[name] ??= deferred(); return reads[name].promise; };
  }
  const { useNavigationAccessibility } = load(fs.readFileSync(path.join(root, 'src/hooks/useNavigationAccessibility.ts'), 'utf8'), {
    react: r.react, 'react-native': { AccessibilityInfo: api, Platform: { OS: os } },
  });
  return { ...r, events, reads, get: () => plain(r.render(useNavigationAccessibility)) };
}

test('native chrome starts still, opaque and readable while preferences load', async () => {
  const h = preferences();
  assert.deepEqual(h.get(), { reduceMotion: true, reduceTransparency: true, screenReader: true, highContrast: true });
  await flush(); Object.values(h.reads).forEach(read => read.resolve(false)); await flush();
  assert.deepEqual(h.get(), { reduceMotion: false, reduceTransparency: false, screenReader: false, highContrast: false });
  h.unmount();
});

test('a preference event cannot be overwritten by a stale initial read', async () => {
  const h = preferences(); h.get(); await flush();
  h.events.get('reduceMotionChanged')(true);
  h.events.get('reduceTransparencyChanged')(true);
  h.events.get('screenReaderChanged')(true);
  h.events.get('darkerSystemColorsChanged')(true);
  Object.values(h.reads).forEach(read => read.resolve(false)); await flush();
  assert.deepEqual(h.get(), { reduceMotion: true, reduceTransparency: true, screenReader: true, highContrast: true });
  h.events.get('reduceMotionChanged')(false);
  assert.equal(h.get().reduceMotion, false);
  h.unmount();
});

test('Android keeps opacity and listens to its own contrast setting', async () => {
  const h = preferences('android'); h.get(); await flush();
  assert.equal(h.reads.isReduceTransparencyEnabled, undefined);
  assert.equal(h.reads.isDarkerSystemColorsEnabled, undefined);
  Object.values(h.reads).forEach(read => read.resolve(false)); await flush();
  assert.equal(h.get().reduceTransparency, true);
  assert.equal(h.get().highContrast, false);
  h.events.get('highTextContrastChanged')(true);
  assert.equal(h.get().highContrast, true);
  h.unmount();
});

test('native query failures retain usable chrome and unmount removes listeners', async () => {
  const h = preferences(); h.get(); await flush();
  Object.values(h.reads).forEach(read => read.reject(new Error('unavailable'))); await flush();
  assert.equal(h.get().reduceTransparency, true); assert.equal(h.get().reduceMotion, true);
  h.unmount(); assert.equal(h.events.size, 0);
  const late = preferences(); late.get(); await flush(); late.unmount(); const count = late.updates();
  Object.values(late.reads).forEach(read => read.resolve(false)); await flush();
  assert.equal(late.updates(), count);
});

function tabHarness() {
  const r = runtime(), animations = [];
  class Value {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    stopAnimation() {}
    interpolate(config) { return config; }
  }
  const Animated = { Value, View: 'AnimatedView' };
  for (const method of ['spring', 'timing']) Animated[method] = (value, config) => ({ start() { animations.push({ method, config }); value.value = config.toValue; } });
  const imports = {
    react: r.react, 'react-native': { Animated, Pressable: 'Pressable' },
    'react/jsx-runtime': { jsx: r.jsx, jsxs: r.jsx },
    '@react-navigation/bottom-tabs': { BottomTabBar: 'BottomTabBar' },
  };
  const source = fs.readFileSync(path.join(root, 'src/navigation/AppNavigator.tsx'), 'utf8');
  const parsed = ts.createSourceFile('AppNavigator.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'TabBarButton');
  const { TabBarButton } = load('import React from "react"; import { Animated, Pressable } from "react-native"; const Haptics = { selectionAsync: () => Promise.resolve() }; export ' + fn.getText(parsed), imports);
  const { default: AdaptiveTabBar, handleTabBarScroll } = load(fs.readFileSync(path.join(root, 'src/components/AdaptiveTabBar.tsx'), 'utf8'), imports);
  return { ...r, animations, button: props => r.render(TabBarButton, props), bar: props => r.render(AdaptiveTabBar, props), scroll: y => handleTabBarScroll({ nativeEvent: { contentOffset: { y } } }) };
}

test('custom native tabs preserve accessibility, disabled state and activation handlers', () => {
  const h = tabHarness(); let presses = 0, warmups = 0;
  const tab = h.button({ children: 'Home', accessibilityLabel: 'Home', accessibilityRole: 'button', accessibilityState: { selected: true }, testID: 'home-tab', disabled: true, onPress: () => presses++, onWarm: () => warmups++, reduceMotion: true });
  assert.equal(tab.props.accessibilityLabel, 'Home'); assert.equal(tab.props.accessibilityRole, 'button');
  assert.equal(tab.props.accessibilityState.selected, true); assert.equal(tab.props.disabled, true); assert.equal(tab.props.testID, 'home-tab');
  tab.props.onPress(); assert.equal(presses, 1);
  assert.equal(tab.props.style[1].minHeight, 48); assert.equal(tab.props.style[1].minWidth, 48);
  tab.props.onPressIn(); tab.props.onPressOut(); assert.equal(h.animations.length, 0); assert.equal(warmups, 1);
  h.unmount();
});

test('native press animation works normally and resets when reduced motion turns on', () => {
  const h = tabHarness(); let warmups = 0;
  const onWarm = () => warmups++;
  const tab = h.button({ children: 'Home', reduceMotion: false, onWarm });
  tab.props.onPressIn(); assert.equal(h.animations.length, 1); assert.equal(warmups, 1);
  const reduced = h.button({ children: 'Home', reduceMotion: true, onWarm });
  assert.equal(reduced.props.children.props.style.transform[0].scale.value, 1);
  reduced.props.onPressIn(); reduced.props.onPressOut(); assert.equal(h.animations.length, 1); assert.equal(warmups, 2);
  h.unmount();
});

test('accessible native navigation stays visible while the content scrolls', () => {
  const h = tabHarness(); const bar = h.bar({ keepVisible: true, state: {} });
  assert.equal(bar.props.style, undefined); h.scroll(100); assert.equal(h.animations.length, 0);
  const normal = h.bar({ keepVisible: false, state: {} });
  assert.ok(normal.props.style.transform); h.scroll(100); assert.equal(h.animations.length, 1);
  h.bar({ keepVisible: true, state: {} }); h.scroll(200); assert.equal(h.animations.length, 1);
  h.unmount();
});
