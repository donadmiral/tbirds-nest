const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const realParser = require(path.join(root, 'node_modules/@react-navigation/core/lib/commonjs/getStateFromPath.js')).default;
function harness() {
  const calls = [];
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/navigation/linking.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (name === 'expo-linking') return { createURL: p => 'platinum-circles-qa://' + p };
      if (name === '@react-navigation/native') return { getStateFromPath: (value, config) => {
        calls.push(value);
        return realParser(value, config);
      } };
      throw new Error('Unexpected import ' + name);
    },
  });
  const { linking, getSafeStateFromPath, MAX_DEEP_LINK_PATH_LENGTH } = module.exports;
  return { calls, linking, parse: value => linking.getStateFromPath(value, linking.config), getSafeStateFromPath, limit: MAX_DEEP_LINK_PATH_LENGTH };
}
function focused(state) {
  let route;
  while (state) {
    route = state.routes[state.index || 0];
    state = route.state;
  }
  return route;
}

test('malformed escapes and invalid UTF-8 never reach the tolerant navigation decoder', () => {
  const h = harness();
  for (const value of ['post/%', 'user/%FF', 'post/example?x=%', 'feed?x=%zz', 'feed?%C3=value',
    'feed?x=%C3', 'feed?x=%E0%80%AF', 'feed?x=%ED%A0%80', 'feed?x=%F4%90%80%80', 'feed?x=%FF'.repeat(20)]) {
    assert.equal(h.parse(value), undefined);
  }
  assert.equal(h.calls.length, 0, 'invalid input must be rejected before calling the vulnerable package');
});

test('the published advisory-shaped oversized input is rejected without invoking dependency parsing', () => {
  const h = harness();
  let payload = 'feed?x=';
  for (let i = 0; i < 32000; i++) {
    payload += '%' + Math.floor(i / 256).toString(16).padStart(2, '0') + '%' + (i % 256).toString(16).padStart(2, '0') + 'x';
  }
  payload += '%zz';
  assert.ok(payload.length > 224000);
  assert.equal(h.parse(payload), undefined);
  assert.equal(h.calls.length, 0);
});

test('oversized well-formed paths are bounded while a path at the documented limit still works', () => {
  const h = harness();
  const prefix = 'feed?text=';
  const maximum = prefix + 'a'.repeat(h.limit - prefix.length);
  assert.equal(h.parse(maximum + 'a'), undefined);
  assert.equal(h.calls.length, 0);
  assert.equal(focused(h.parse(maximum)).params.text.length, h.limit - prefix.length);
  assert.equal(h.calls.length, 1);
});

test('actual Navigation 6 parser still resolves the app post, profile, chat and story routes', () => {
  const h = harness();
  for (const [value, name, param] of [
    ['post/post-123', 'Post', 'postId'],
    ['user/user-123', 'UserProfile', 'userId'],
    ['chat/user-123', 'Chat', 'userId'],
    ['story/story-123', 'StoryViewer', 'storyId'],
  ]) {
    const route = focused(h.parse(value));
    assert.equal(route.name, name);
    assert.equal(route.params[param], value.split('/')[1]);
    assert.deepEqual(h.parse(value), realParser(value, h.linking.config));
  }
});

test('PKCE, email and recovery callback paths preserve valid query and fragment payloads', () => {
  const h = harness();
  for (const value of [
    'auth/callback?code=fixture-pkce-code&type=signup',
    'auth/callback?code=fixture-recovery-code&type=recovery',
    'auth/callback#access_token=fixture.token.signature&refresh_token=fixture-refresh&type=recovery',
    'verify-email?email=person%2Bqa%40example.test',
    'signup?invite=fixture-invite',
  ]) {
    assert.deepEqual(h.parse(value), realParser(value, h.linking.config));
  }
  assert.equal(focused(h.parse('auth/callback?code=fixture-pkce-code')).params.code, 'fixture-pkce-code');
});

test('valid UTF-8, escaped delimiters, literal percent signs and repeated query values retain their meaning', () => {
  const h = harness();
  const value = 'feed?name=Jos%C3%A9+%F0%9F%8E%89&literal=%25zz&delimiter=%26%3D&tag=one&tag=two';
  const route = focused(h.parse(value));
  assert.equal(route.params.name, 'José 🎉');
  assert.equal(route.params.literal, '%zz');
  assert.equal(route.params.delimiter, '&=');
  assert.deepEqual(route.params.tag, ['one', 'two']);
  assert.equal(h.calls[0], value, 'validation must not pass an already-decoded path to the parser');
});

test('both authenticated and unauthenticated containers use the guarded cold and warm link configuration', () => {
  const h = harness();
  assert.equal(h.linking.getStateFromPath, h.getSafeStateFromPath);
  const navigation = fs.readFileSync(path.join(root, 'src/navigation/AppNavigator.tsx'), 'utf8');
  assert.equal((navigation.match(/<NavigationContainer\b/g) || []).length, 2);
  assert.equal((navigation.match(/<NavigationContainer[^>]*linking=\{linking\}/g) || []).length, 2);
  assert.deepEqual(h.parse('feed?initial=1'), realParser('feed?initial=1', h.linking.config));
  assert.deepEqual(h.parse('post/post-123?warm=1'), realParser('post/post-123?warm=1', h.linking.config));
});

test('unknown valid routes retain the navigation library result', () => {
  const h = harness();
  assert.equal(h.parse('not-a-registered-route'), undefined);
  assert.equal(h.calls.length, 1);
});
