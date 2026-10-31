const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const { createFixture } = require('../native/audit/backend-fixture.cjs');
const ORIGIN = 'https://uaulhuelcfkjwojtymmw.supabase.co';
const OWNER = '10000000-0000-4000-8000-000000000001';
const PEER = '10000000-0000-4000-8000-000000000002';
const POST = '20000000-0000-4000-8000-000000000001';
const CAPTION = 'A moment worth remembering.';
const read = file => fs.readFileSync(path.resolve(file), 'utf8');
const compile = (code, fileName) => ts.transpileModule(code, {
  fileName, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const text = node => node == null ? '' : Array.isArray(node) ? node.map(text).join('')
  : typeof node === 'object' ? text(node.props?.children) : String(node);

async function signed(caseId) {
  const fixture = createFixture(), responses = [];
  const sdk = createClient(ORIGIN, 'synthetic-no-provider-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const response = await fixture.fetch(input, init);
      const url = new URL(String(input));
      responses.push({ path: url.pathname, query: url.search, method: init?.method || 'GET', status: response.status });
      return response;
    } },
  });
  const auth = await sdk.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  assert.equal(auth.error, null); fixture.selectAuditCase(caseId, 'baseline');
  return { fixture, sdk, responses, auth };
}

function modules(overrides = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (Object.hasOwn(overrides, file)) return overrides[file];
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} }; cache.set(file, mod.exports);
    new Function('require', 'module', 'exports', compile(read(file), file))(name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      assert.ok(name.startsWith('.'), 'Unmodeled module: ' + name);
      const base = path.resolve(path.dirname(file), name);
      const found = [base, base + '.ts', base + '.tsx', base + '.cjs'].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      assert.ok(found, 'Missing relative module: ' + name);
      return load(found);
    }, mod, mod.exports);
    cache.set(file, mod.exports); return mod.exports;
  }
  return load;
}

function actualMethod(file, name, context) {
  const source = read(file), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), found = [];
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === name) found.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(found.length, 1);
  return vm.runInNewContext(compile('({' + found[0] + '})', file), context)[name];
}

async function actualStories(sdk) {
  const load = modules({ [path.resolve('src/services/supabase.ts')]: { supabase: sdk, SUPABASE_URL: ORIGIN } });
  const hydration = load('src/services/contentMedia.ts');
  return actualMethod('src/services/storiesService.ts', 'getUserStories', {
    supabase: sdk, hydrateStoryMedia: hydration.hydrateStoryMedia,
  })(PEER);
}

function viewerElement(kind, currentStory) {
  const file = 'src/screens/stories/StoryViewerScreen.tsx', source = read(file);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), found = [];
  function visit(node) {
    if (kind === 'caption' && ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'MemoryCaption') found.push(node.getText(ast));
    if (kind === 'background' && ts.isConditionalExpression(node) && node.condition.getText(ast) === 'isText'
      && node.whenTrue.getText(ast).includes('text_background')) found.push(node.whenTrue.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(found.length, 1);
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
  return vm.runInNewContext(compile('(' + found[0] + ')', file), {
    React, currentStory, MemoryCaption: 'MemoryCaption', chromeOpacity: { value: 1 }, isOwn: false, insets: { bottom: 0 },
    mediaMt: null, stickers: currentStory.stickers_json || [], BackgroundLayer: 'BackgroundLayer',
    View: 'View', Image: 'Image', LinearGradient: 'Gradient', StyleSheet: { absoluteFill: {} }, s: { media: {} },
  });
}

function renderCaption(props) {
  const React = { memo: value => value, createElement: (type, options, ...children) => ({ type, props: { ...options, children } }) };
  const load = modules({
    react: { __esModule: true, default: React },
    'react-native': { Text: 'Text', StyleSheet: { create: value => value } },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      useAnimatedStyle: fn => fn(), interpolate: () => 1 },
  });
  return load('src/components/stories/MemoryCaption.tsx').default(props);
}

// Execute the entire mounted PollCard, including both its real effects, through
// the installed SDK. Only React scheduling/native hosts and unused child UI are
// controlled; the fixture must accept the real requests and record no unknowns.
function pollCard(sdk) {
  const slots = [], effects = []; let cursor = 0, dirty = false, tree;
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }];
    },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { deps, fn }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) {
      const previous = slots[i]; slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
    } },
  };
  const load = modules({
    react: { __esModule: true, default: React, ...React },
    'react-native': { View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', StyleSheet: { create: value => value }, Alert: { alert() { throw new Error('No voting authorized'); } } },
    '@expo/vector-icons': { Feather: 'Feather' },
    [path.resolve('src/services/supabase.ts')]: { supabase: sdk },
    [path.resolve('src/theme/useTheme.ts')]: { useTheme: () => ({ t: {} }) },
    [path.resolve('src/stores/authStore.ts')]: { useAuthStore: selector => selector({ profile: { id: OWNER } }) },
    [path.resolve('src/components/PollVotersSheet.tsx')]: { __esModule: true, default: 'PollVotersSheet' },
  });
  const Component = load('src/components/PollCard.tsx').default;
  function render() { cursor = 0; dirty = false; tree = Component({ postId: POST }); while (effects.length) effects.shift()(); }
  return {
    async settle() { render(); for (let i = 0; i < 12; i++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) render(); } return tree; },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('actual Story service and viewer caption render the unchanged audit expectation from published fields', async () => {
  const { sdk, fixture } = await signed('stories-storyviewer');
  const [story] = await actualStories(sdk);
  const element = viewerElement('caption', story);
  assert.equal(text(renderCaption(element.props)), CAPTION);
  assert.equal(story.caption, CAPTION);
  assert.deepEqual(story.stickers_json, []);
  for (const key of ['text_content', 'background_color', 'text_color', 'font_style', 'text_stickers']) assert.equal(Object.hasOwn(story, key), false, key);
  assert.deepEqual(fixture.receipt.unhandled, []);
  assert.deepEqual(fixture.receipt.audit.diagnostics, []);
});

test('the actual text-story background branch consumes the canonical published background', async () => {
  const { sdk } = await signed('stories-storyviewer');
  const [story] = await actualStories(sdk);
  const background = viewerElement('background', story);
  assert.equal(background.type, 'View');
  assert.equal(background.props.style.at(-1).backgroundColor, '#24354f');
  assert.equal(story.text_background.kind, 'solid');
});

test('the mounted real PollCard completes its author and no-poll reads without a hidden contract failure', async () => {
  const { sdk, fixture, responses } = await signed('feed-post');
  const mounted = pollCard(sdk);
  try {
    assert.equal(await mounted.settle(), null, 'A post with no poll has no invented voting controls');
    const poll = responses.filter(row => row.path === '/rest/v1/rpc/get_poll');
    assert.deepEqual(poll.map(row => row.status), [200]);
    assert.equal(responses.filter(row => row.path === '/rest/v1/posts' && row.query.includes('select=user_id')).length, 1);
    assert.deepEqual(fixture.receipt.unhandled, []);
    assert.deepEqual(fixture.receipt.audit.diagnostics, []);
    assert.equal(fixture.receipt.audit.mutations.length, 0);
  } finally { mounted.dispose(); }
});

test('get_poll accepts only the declared no-poll post read and rejects extra fields, methods, cases and mutations', async () => {
  const { sdk } = await signed('feed-post');
  const good = await sdk.rpc('get_poll', { p_post_id: POST });
  assert.equal(good.status, 200); assert.deepEqual(good.data, []);
  for (const args of [{ p_post_id: PEER }, { p_post_id: POST, p_extra: true }, {}]) assert.equal((await sdk.rpc('get_poll', args)).status, 501);
  assert.equal((await sdk.rpc('get_poll', { p_post_id: POST }, { get: true })).status, 501);
  assert.equal((await sdk.rpc('vote_poll', { p_post_id: POST, p_option_id: PEER })).status, 501);
  const other = await signed('feed-search-controls');
  assert.equal((await other.sdk.rpc('get_poll', { p_post_id: POST })).status, 501);
});

test('get_poll is fenced to the currently issued audit bearer and never permits another origin', async () => {
  const { sdk, fixture, auth } = await signed('feed-post');
  const original = auth.data.session.access_token;
  await sdk.auth.signOut();
  assert.equal((await fixture.fetch(ORIGIN + '/rest/v1/rpc/get_poll', { method: 'POST',
    headers: { Authorization: 'Bearer ' + original }, body: JSON.stringify({ p_post_id: POST }) })).status, 401);
  await sdk.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  assert.equal((await fixture.fetch(ORIGIN + '/rest/v1/rpc/get_poll', { method: 'POST',
    headers: { Authorization: 'Bearer ' + original }, body: JSON.stringify({ p_post_id: POST }) })).status, 401);
  assert.equal((await sdk.rpc('get_poll', { p_post_id: POST })).status, 200);
  assert.equal((await fixture.fetch('https://example.invalid/rest/v1/rpc/get_poll', { method: 'POST',
    body: JSON.stringify({ p_post_id: POST }) })).status, 501);
});
