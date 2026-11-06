const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const jsx = (type, props, key) => ({ type, props, key });
const walk = value => !value || typeof value !== 'object' ? [] : Array.isArray(value)
  ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
function compile(file, imports) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module, exports: module.exports, require(name) {
    assert.ok(name in imports, `Unexpected import: ${name}`); return imports[name];
  } });
  return module.exports;
}

test('late story-ring metadata keeps the feed avatar frame, image path and source object', () => {
  let memo;
  const react = { useMemo(fn, deps) {
    if (!memo || !deps.every((value, i) => Object.is(value, memo.deps[i]))) memo = { deps, value: fn() };
    return memo.value;
  } };
  const Avatar = compile('src/components/feed/FeedAuthorAvatar.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', TouchableOpacity: 'Button', StyleSheet: { create: value => value } },
    'expo-image': { Image: 'Image' }, '../../theme/useTheme': { useTheme: () => ({ t: { ink: { faint: '#aaa' }, status: { link: '#123', linkBg: '#eee' } } }) },
  }).default;
  let opened = 0;
  const props = { userId: 'author', name: 'Author', uri: 'https://example.test/avatar.jpg', onStory: () => opened++ };
  const first = Avatar(props), image = walk(first).find(node => node.type === 'Image');
  const pathToImage = tree => [tree.type, tree.props.children.type, tree.props.children.props.children[0].type];
  for (const storyUnseen of [true, false, undefined]) {
    const next = Avatar({ ...props, storyUnseen });
    assert.equal(next.props.style, first.props.style, 'The slot never acquires a new border or padding');
    assert.deepEqual(pathToImage(next), pathToImage(first), 'The native image keeps the same ancestors');
    const nextImage = walk(next).find(node => node.type === 'Image');
    assert.equal(nextImage.props.source, image.props.source);
    assert.equal(nextImage.props.recyclingKey, image.props.recyclingKey);
    assert.equal(nextImage.props.transition, 0);
    const button = walk(next).find(node => node.type === 'Button');
    assert.equal(button.props.disabled, storyUnseen === undefined);
    if (storyUnseen !== undefined) button.props.onPress();
  }
  assert.equal(opened, 2);
});

test('the story highlight rotates natively without blocking list interactions and stops on disposal', () => {
  const effects = [], configs = []; let started = 0, stopped = 0;
  class Value { interpolate(config) { return config; } }
  const Ring = compile('src/components/stories/PlatinumRing.tsx', {
    react: { useRef: value => ({ current: value }), useEffect: fn => effects.push(fn) },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Easing: { linear: 'linear' }, StyleSheet: { absoluteFillObject: { position: 'absolute' } },
      Animated: { View: 'AnimatedView', Value, timing(_value, config) { configs.push(config); return config; },
        loop: () => ({ start() { started++; }, stop() { stopped++; } }) } },
    'react-native-svg': { default: 'Svg', Circle: 'Circle', Defs: 'Defs', LinearGradient: 'Gradient', Stop: 'Stop' },
  }).default;
  const tree = Ring({ userId: 'author', size: 66 });
  const cleanup = effects.shift()();
  assert.equal(configs.length, 1); assert.equal(started, 1);
  assert.equal(configs[0].useNativeDriver, true); assert.equal(configs[0].isInteraction, false);
  assert.equal(configs[0].easing, 'linear');
  assert.ok(walk(tree).some(node => node.type === 'AnimatedView' && node.props.style[1].transform[0].rotate));
  assert.equal(walk(tree).some(node => node.type === 'Circle' && node.props.strokeDashoffset), false);
  cleanup(); assert.equal(stopped, 1);
  Ring({ userId: 'author', size: 66, active: false }); effects.shift()();
  assert.equal(started, 1, 'Inactive rings start no animation');
});

test('story catchup distinguishes transient failure from a confirmed empty or denied feed', async () => {
  const source = fs.readFileSync(path.join(root, 'src/services/storiesService.ts'), 'utf8');
  const ast = ts.createSourceFile('storiesService.ts', source, ts.ScriptTarget.Latest, true);
  let method;
  const visit = node => { if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'getCatchupFeed') method = node; ts.forEachChild(node, visit); };
  visit(ast); assert.ok(method);
  let result;
  const get = vm.runInNewContext(ts.transpileModule(`({ ${method.getText(ast)} }).getCatchupFeed`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { supabase: { rpc: async () => result }, console: { log() {} } });
  result = { data: null, error: { message: 'network unavailable' }, status: 503 };
  await assert.rejects(get(), /could not refresh/);
  result = { data: null, error: null, status: 200 };
  await assert.rejects(get(), /could not refresh/);
  for (const status of [401, 403]) {
    result = { data: null, error: { message: 'denied' }, status };
    assert.equal((await get()).length, 0);
  }
  result = { data: null, error: { code: '42501', message: 'denied' }, status: 400 };
  assert.equal((await get()).length, 0);
  result = { data: [], error: null, status: 200 };
  assert.equal((await get()).length, 0);
  result = { data: [{ user_id: 'author' }], error: null, status: 200 };
  assert.equal((await get())[0].user_id, 'author');
});
