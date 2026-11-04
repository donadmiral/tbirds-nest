const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../..');

// Use the installed React Native style flattener, including nested style arrays.
const flattenedModule = { exports: {} };
vm.runInNewContext(babel.transformSync(fs.readFileSync(path.join(root,
  'node_modules/react-native/Libraries/StyleSheet/flattenStyle.js'), 'utf8'), {
  presets: [require.resolve('@react-native/babel-preset')], configFile: false, babelrc: false,
}).code, { module: flattenedModule, exports: flattenedModule.exports });
const flatten = flattenedModule.exports.default;

function component() {
  const animations = [], effects = [];
  class Value {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    stopAnimation() {}
    interpolate(config) { return { value: this, config }; }
  }
  const Animated = { Value, View: 'Animated.View', spring: (value, config) => ({
    start() { animations.push(config); value.setValue(config.toValue); },
  }) };
  let routeRef;
  const React = { useEffect: fn => effects.push(fn()), useRef: value => routeRef ??= { current: value } };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/components/AdaptiveTabBar.tsx'), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require: name => {
    if (name === 'react') return { default: React, ...React };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { Animated, StyleSheet: { flatten,
      absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } } };
    if (name === '@react-navigation/bottom-tabs') return { BottomTabBar: 'BottomTabBar' };
    throw new Error('Unexpected dependency: ' + name);
  } });
  return { ...module.exports, animations, effects };
}

function props(style, keepVisible = false) {
  return { keepVisible, state: { index: 0, routes: [{ key: 'home' }] },
    descriptors: { home: { options: { tabBarStyle: style } } }, navigation: {}, insets: { bottom: 34 } };
}

for (const [name, screenHeight, bottomInset] of [
  ['iPhone portrait safe area', 852, 34], ['iPhone landscape safe area', 393, 21],
  ['Android compact minimum inset', 640, 16], ['Android gesture inset', 844, 34],
]) {
  for (const keepVisible of [false, true]) test(`${name} encloses native tab buttons with keepVisible=${keepVisible}`, () => {
    const api = component(), bottom = bottomInset + 10;
    const style = Object.freeze({ position: 'absolute', left: 16, right: 16, height: 64, bottom });
    const input = props(style, keepVisible), tree = api.default(input), frame = flatten(tree.props.style);
    assert.equal(tree.props.pointerEvents, 'box-none', 'background content remains interactive');
    assert.equal(frame.position, 'absolute'); assert.equal(frame.bottom, 0);
    assert.equal(frame.left, 0); assert.equal(frame.right, 0);
    assert.ok(Number.isFinite(frame.height) && frame.height > 0, 'the native parent must have nonzero bounds');
    const barTopWithinParent = frame.height - style.bottom - style.height;
    assert.ok(barTopWithinParent >= 0 && barTopWithinParent + style.height <= frame.height,
      'all 64-point tab controls fit inside their native accessibility container');
    assert.equal(screenHeight - frame.height + barTopWithinParent, screenHeight - bottom - 64,
      'the actual floating bar stays at its original screen position');
    assert.equal(Boolean(frame.transform), !keepVisible);
    const child = tree.props.children;
    assert.equal(child.type, 'BottomTabBar');
    assert.equal(child.props.descriptors, input.descriptors); assert.equal(child.props.navigation, input.navigation);
    assert.equal(child.props.keepVisible, undefined, 'only real BottomTabBar props reach the child');
  });
}

test('focused descriptor and safe-area style changes recompute the native container using installed style flattening', () => {
  const api = component(), input = props([{ position: 'absolute', height: 64 }, false, [{ bottom: 44 }]]);
  assert.equal(flatten(api.default(input).props.style).height, 108);
  input.descriptors.home.options.tabBarStyle = [{ position: 'absolute', height: 64, bottom: 44 }, { bottom: 31 }];
  assert.equal(flatten(api.default(input).props.style).height, 95);
  input.state.routes.push({ key: 'profile' }); input.state.index = 1;
  input.descriptors.profile = { options: { tabBarStyle: { position: 'absolute', height: 72, bottom: 26 } } };
  assert.equal(flatten(api.default(input).props.style).height, 98);
});

test('nonnumeric or invalid dimensions use native parent bounds without invented sizes', () => {
  const api = component();
  for (const style of [{ position: 'absolute', height: '20%', bottom: 10 },
    { position: 'absolute', height: 64, bottom: { value: 10 } },
    { position: 'absolute', height: NaN, bottom: 10 }, { position: 'absolute', height: 64, bottom: -10 }]) {
    const frame = flatten(api.default(props(style)).props.style);
    assert.equal(frame.top, 0); assert.equal(frame.bottom, 0); assert.equal(frame.height, undefined);
  }
});

test('default and nonabsolute tab bars retain their natural parent sizing and bottom placement', () => {
  const api = component();
  for (const style of [undefined, { height: 64 }, { position: 'relative', height: 64 }]) {
    for (const keepVisible of [false, true]) {
      const frame = flatten(api.default(props(style, keepVisible)).props.style);
      assert.equal(frame.position, undefined); assert.equal(frame.top, undefined);
      assert.equal(frame.height, undefined, 'the in-flow child sizes the native parent');
    }
  }
});

test('scroll hide/reveal remains active normally and stops when reduced-motion or screen-reader visibility is requested', () => {
  const api = component(), input = props({ position: 'absolute', height: 64, bottom: 44 });
  api.default(input);
  const scroll = y => api.handleTabBarScroll({ nativeEvent: { contentOffset: { y } } });
  scroll(20); scroll(40); scroll(15); scroll(0);
  assert.deepEqual(api.animations.map(value => value.toValue), [1, 0]);
  assert.ok(api.animations.every(value => value.useNativeDriver === true));
  input.keepVisible = true; const frame = flatten(api.default(input).props.style);
  scroll(80); assert.equal(api.animations.length, 2); assert.equal(frame.transform, undefined);
  input.keepVisible = false; api.default(input); scroll(80);
  assert.equal(api.animations.at(-1).toValue, 1);
  api.effects.at(-1)(); scroll(140); assert.equal(api.animations.length, 3, 'cleanup restores passive visibility');
});

test('slow gestures accumulate distance and reveal the bar with the unchanged three-point scroll events', () => {
  const api = component(); api.default(props({}));
  const scroll = y => api.handleTabBarScroll({ nativeEvent: { contentOffset: { y } } });
  for (let y = 0; y <= 96; y += 3) scroll(y);
  assert.deepEqual(api.animations.map(row => row.toValue), [1]);
  for (let y = 93; y >= 12; y -= 3) scroll(y);
  assert.deepEqual(api.animations.map(row => row.toValue), [1, 0]);
});

test('fast gestures retain immediate hide and reveal without duplicate animation restarts', () => {
  const api = component(); api.default(props({}));
  for (const y of [0, 80, 180, 90, 70]) api.handleTabBarScroll({ nativeEvent: { contentOffset: { y } } });
  assert.deepEqual(api.animations.map(row => row.toValue), [1, 0]);
});

test('small directional reversals reset travel and stationary jitter never flaps navigation', () => {
  const api = component(); api.default(props({}));
  const scroll = y => api.handleTabBarScroll({ nativeEvent: { contentOffset: { y } } });
  scroll(100);
  for (const y of [97, 94, 97, 94, 91, 94, 91, 88, 91]) scroll(y);
  assert.deepEqual(api.animations.map(row => row.toValue), [1]);
  for (const y of [88, 85, 82, 79]) scroll(y);
  assert.deepEqual(api.animations.map(row => row.toValue), [1, 0]);
  for (let i = 0; i < 30; i++) { scroll(80); scroll(79); }
  assert.equal(api.animations.length, 2);
});

test('top bounce reveals once and its rebound cannot hide the bar', () => {
  const api = component(); api.default(props({}));
  for (const y of [80, 0, -40, -70, -20, 0, 2, 0]) api.handleTabBarScroll({ nativeEvent: { contentOffset: { y } } });
  assert.deepEqual(api.animations.map(row => row.toValue), [1, 0]);
});

test('bottom bounce is clamped while real upward movement still reveals navigation', () => {
  const api = component(); api.default(props({}));
  const scroll = y => api.handleTabBarScroll({ nativeEvent: { contentOffset: { y }, contentSize: { height: 1000 }, layoutMeasurement: { height: 500 } } });
  for (const y of [0, 480, 500, 540, 520, 500]) scroll(y);
  assert.deepEqual(api.animations.map(row => row.toValue), [1]);
  for (const y of [497, 494, 491, 488]) scroll(y);
  assert.deepEqual(api.animations.map(row => row.toValue), [1, 0]);
});

test('invalid offsets do not corrupt the accumulated slow gesture', () => {
  const api = component(); api.default(props({}));
  const scroll = y => api.handleTabBarScroll({ nativeEvent: { contentOffset: { y } } });
  scroll(90); scroll(87); scroll(NaN); scroll(Infinity); scroll('0'); api.handleTabBarScroll({});
  for (const y of [84, 81, 78]) scroll(y);
  assert.deepEqual(api.animations.map(row => row.toValue), [1, 0]);
});

test('tab changes reveal navigation and establish the restored scroll position without inherited travel', () => {
  const api = component(), input = props({}); api.default(input);
  const scroll = y => api.handleTabBarScroll({ nativeEvent: { contentOffset: { y } } });
  scroll(80); scroll(77); scroll(74);
  input.state.routes.push({ key: 'profile' }); input.state.index = 1;
  input.descriptors.profile = { options: { tabBarStyle: {} } };
  const tree = api.default(input);
  assert.equal(flatten(tree.props.style).transform[0].translateY.value.value, 0);
  scroll(500); scroll(503); scroll(506);
  assert.equal(api.animations.length, 1, 'restored position and partial new travel do not hide');
  scroll(509); scroll(512);
  assert.deepEqual(api.animations.map(row => row.toValue), [1, 1]);
  for (const y of [509, 506, 503, 500]) scroll(y);
  assert.deepEqual(api.animations.map(row => row.toValue), [1, 1, 0]);
});
