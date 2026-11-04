const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { createHostRenderer } = require('../helpers/react-host-renderer.cjs');
const root = path.resolve(__dirname, '../..');
const base = 'https://media.test';
const oldUrl = base + '/storage/v1/object/sign/post-media/article/picture.jpg?token=first';
const renewedUrl = oldUrl.replace('token=first', 'token=renewed');
const replacementUrl = renewedUrl.replace('picture.jpg', 'different.jpg');
const noop = () => {};
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function compile(file, imports = () => { throw Error('Unexpected dependency'); }) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read(file), {
    fileName: file, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require: imports, console, URL, setTimeout, clearTimeout }, { filename: file });
  return module.exports;
}
const media = compile('shared/contentMedia.ts');
const display = compile('shared/imageDisplayIdentity.ts', name => {
  assert.equal(name, './contentMedia'); return media;
});
const light = compile('src/constants/tokens/light.ts').light;
const dark = compile('src/constants/tokens/dark.ts').dark;
const lightsOut = compile('src/constants/tokens/lightsOut.ts', () => ({ dark })).lightsOut;
const post = { id: 'post', user_id: 'author', content: 'Main post', author: { id: 'author', full_name: 'Author' }, post_media: [], post_products: [], likes_count: 0, comments_count: 0, reposts_count: 0, bookmarks_count: 0 };

// Mount the complete production component with real hooks and reconciliation.
// Only network effects, loaded state and native/child component boundaries are supplied.
function screen({ name = 'PostScreen', seed = {}, params = { postId: 'post' }, theme = light } = {}) {
  const file = 'src/screens/feed/' + name + '.tsx';
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const stateNames = component.body.statements.filter(ts.isVariableStatement).flatMap(statement => statement.declarationList.declarations)
    .filter(declaration => ts.isArrayBindingPattern(declaration.name) && ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(ast) === 'useState')
    .map(declaration => declaration.name.elements[0].name.getText(ast));
  let stateIndex = 0, viewerId = 'viewer', routeParams = params;
  const setters = {}, navigationCalls = [];
  const initial = { post, loading: false, ...seed };
  const hooks = { ...React, useEffect: noop, useState(value) {
    const slot = React.useRef();
    if (!slot.current) slot.current = stateNames[stateIndex++];
    const name = slot.current;
    assert.ok(name, 'every production state hook has a named fixture slot');
    const result = React.useState(Object.hasOwn(initial, name) ? initial[name] : value);
    setters[name] = result[1]; return result;
  }};
  const authState = () => ({ session: { user: { id: viewerId } }, profile: { id: viewerId } });
  const useAuthStore = Object.assign(selector => selector(authState()), { getState: authState });
  const Render = compile(file, name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'react-native') return { View: 'View', Text: 'Text', Image: 'Image', TouchableOpacity: 'TouchableOpacity', StatusBar: 'StatusBar', ScrollView: 'ScrollView', StyleSheet: { hairlineWidth: 1 }, Dimensions: { get: () => ({ width: 390, height: 844 }) }, useWindowDimensions: () => ({ width: 390, height: 844 }), AppState: { addEventListener: () => ({ remove: noop }) }, Keyboard: { dismiss: noop }, Alert: { alert: noop } };
    if (name.endsWith('/theme/useTheme')) return { useTheme: () => ({ t: theme, isDark: theme !== light }), themedSheet: factory => factory(theme) };
    if (name.endsWith('/screenTransition')) return { useAfterTransition: () => true };
    if (name.endsWith('/components/SafeArea')) return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
    if (name.endsWith('/CommentsPanel')) return { __esModule: true, default: props => React.createElement('CommentsPanel', null, props.header) };
    if (name.endsWith('/authStore')) return { useAuthStore };
    if (name === '@react-navigation/native') return { useFocusEffect: noop };
    if (name === '@expo/vector-icons') return { Feather: 'Feather', Ionicons: 'Ionicons' };
    if (name.endsWith('/skeletons')) return { PostSkeleton: 'PostSkeleton' };
    if (name.endsWith('/supabase')) return { supabase: {}, SUPABASE_URL: base };
    if (name.endsWith('/imageDisplayIdentity')) return display;
    if (name === '../../../shared/contentMedia') return media;
    if (name.endsWith('/constants/layout')) return { TAB_BAR_CLEARANCE: 60 };
    return { __esModule: true, default: name.split('/').at(-1) };
  }).default;
  function Component() {
    stateIndex = 0;
    return React.createElement(Render, { route: { params: routeParams }, navigation: { navigate: (...args) => navigationCalls.push(args), push: (...args) => navigationCalls.push(args), goBack: noop } });
  }
  const host = createHostRenderer();
  const render = (next = {}) => {
    if ('viewerId' in next) viewerId = next.viewerId;
    if (next.params) routeParams = next.params;
    host.render(React.createElement(Component));
  };
  return { ...host, render, navigationCalls, set: (name, value) => host.update(() => setters[name](value)) };
}
function healthy(h) { assert.deepEqual(h.errors.map(error => (error.cause || error).message), []); }
function images(h) { return h.nodes().filter(node => node.type === 'Image'); }
function gallery(kind, url = oldUrl) {
  if (kind === 'PostScreen') {
    const h = screen({ seed: { post: { ...post, article_title: 'Article' }, galleryImages: [{ url }] } });
    return { h, change: next => h.set('galleryImages', next) };
  }
  const source = { postId: 'post', title: 'Article', body: 'Body' };
  const result = { source, viewer: 'viewer', article: source, gallery: [{ url }] };
  const h = screen({ name: 'ArticleReaderScreen', params: { article: source }, seed: { result } });
  return { h, change: next => h.set('result', { ...result, gallery: next }) };
}

for (const [mode, theme] of Object.entries({ light, dark, lightsOut })) test(`PostScreen renders both thread directions with ${mode} colors and post navigation`, t => {
  const h = screen({ theme, seed: {
    threadAbove: [{ id: 'above', user_id: 'author', content: 'Thread above', author: { id: 'author', full_name: 'Parent author' } }],
    threadBelow: [{ id: 'below', user_id: 'reply-author', content: 'Thread below', author: { id: 'reply-author', username: 'reply' } }],
  }});
  t.after(h.close); h.render(); healthy(h);
  for (const text of ['Thread above', 'Thread below']) {
    const row = h.nodes().find(node => node.type === 'Text' && node.props.children === text);
    assert.ok(row, 'thread content must be rendered'); assert.equal(row.props.style.color, theme.ink.primary);
  }
  const rows = h.nodes().filter(node => node.type === 'TouchableOpacity' && node.props.style?.paddingVertical === 10 && node.props.style?.paddingHorizontal === 16);
  assert.equal(rows.length, 2);
  for (const row of rows) { assert.equal(row.children[0].props.style.backgroundColor, theme.surface.sunken); row.props.onPress(); }
  assert.deepEqual(h.navigationCalls.map(([name, params]) => [name, params.postId]), [['Post', 'above'], ['Post', 'below']]);
});

for (const kind of ['PostScreen', 'ArticleReaderScreen']) {
  test(`${kind} keeps the rendered gallery image through grant renewal and uses the exact new URL`, t => {
    const { h, change } = gallery(kind); t.after(h.close); h.render(); healthy(h);
    const before = images(h)[0]; assert.ok(before); assert.equal(before.props.source.uri, oldUrl);
    change([{ url: renewedUrl }]); healthy(h);
    assert.equal(images(h)[0], before, 'renewing only the delivery token must update the existing native image');
    assert.equal(images(h)[0].props.source.uri, renewedUrl);
    assert.equal(images(h)[0].props.fadeDuration, 0);
    assert.equal(h.created.filter(node => node.type === 'Image').length, 1);
    assert.equal(h.removed.includes(before), false);
  });
  test(`${kind} replaces the gallery image when the actual media object changes`, t => {
    const { h, change } = gallery(kind); t.after(h.close); h.render(); healthy(h);
    const before = images(h)[0]; change([{ url: replacementUrl }]); healthy(h);
    assert.notEqual(images(h)[0], before); assert.equal(h.removed.includes(before), true);
    assert.equal(images(h)[0].props.source.uri, replacementUrl);
  });
}

for (const boundary of ['account', 'post']) test(`PostScreen gallery identity resets at the ${boundary} boundary`, t => {
  const { h } = gallery('PostScreen'); t.after(h.close); h.render(); healthy(h);
  const before = images(h)[0];
  h.render(boundary === 'account' ? { viewerId: 'another-viewer' } : { params: { postId: 'another-post' } }); healthy(h);
  assert.notEqual(images(h)[0], before); assert.equal(h.removed.includes(before), true);
  assert.equal(images(h)[0].props.source.uri, oldUrl);
});
