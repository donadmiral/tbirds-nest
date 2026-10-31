const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/screens/feed/FeedScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('FeedScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let previewStart, previewEnd, dismiss, publish;
const visit = node => {
  if (ts.isVariableStatement(node) && node.getText(ast).startsWith('const [composerPreview, setComposerPreview]')) previewStart = node.getStart(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes("functions.invoke('link-preview'")) previewEnd = node.parent.end;
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onPress' && node.initializer?.expression?.getText(ast).includes('setComposerPreview(null)')) dismiss = node.initializer.expression.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'createPost') publish = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
};
visit(ast);
assert.ok(previewStart && previewEnd && dismiss && publish, 'Load the actual native preview effect, dismiss control, and publisher');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function previewFixture(text = 'Read https://example.com/page') {
  let preview = null, cursor = 0, timerId = 0, cleanup, dependencies, authenticatedOwner = 'owner';
  const refs = [], timers = new Map(), requests = [];
  const context = {
    composerText: text, userId: 'owner',
    useState: () => [preview, next => { preview = typeof next === 'function' ? next(preview) : next; }],
    useRef: value => refs[cursor++] ??= { current: value },
    useEffect(fn, deps) {
      if (dependencies && deps.every((value, i) => Object.is(value, dependencies[i]))) return;
      cleanup?.(); dependencies = deps; cleanup = fn();
    },
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
    supabase: { functions: { invoke: (name, options) => new Promise(resolve => requests.push({ name, options, resolve })) } },
    useAuthStore: { getState: () => ({ profile: { id: authenticatedOwner } }) },
  };
  const body = compile(`this.render=()=>{${source.slice(previewStart, previewEnd)};this.dismiss=${dismiss};};`);
  vm.runInNewContext(body, context);
  const render = next => { if (next != null) context.composerText = next; cursor = 0; context.render(); };
  render();
  return {
    render, dismiss: () => context.dismiss(), get preview() { return preview; }, requests,
    begin() { const [id, fn] = [...timers][0] ?? []; assert.ok(fn, 'A preview request should be scheduled'); timers.delete(id); return fn(); },
    setOwner: owner => { authenticatedOwner = owner; context.userId = owner; render(); },
    authenticate: owner => { authenticatedOwner = owner; },
    dispose: () => cleanup?.(), get scheduled() { return timers.size; },
  };
}

test('native dismissed preview stays dismissed after a late same-URL refresh and caption edits', async () => {
  const h = previewFixture();
  try {
    let work = h.begin();
    h.requests[0].resolve({ data: { url: 'https://example.com/page', title: 'First preview' }, error: null });
    await work;
    h.render('Read https://example.com/page with a new caption');
    work = h.begin();
    h.dismiss();
    assert.equal(h.preview, null);
    h.requests[1].resolve({ data: { url: 'https://example.com/page', title: 'Late preview' }, error: null });
    await work;
    assert.equal(h.preview, null, 'A pending request must respect the Remove preview action');
    h.render('Read https://example.com/page with another caption');
    assert.equal(h.scheduled, 0);
    assert.equal(h.preview, null);
    h.render('Read https://example.org/another');
    assert.equal(h.scheduled, 1, 'A different URL may obtain a new preview');
    work = h.begin();
    h.requests[2].resolve({ data: { url: 'https://example.org/another', title: 'Another preview' }, error: null });
    await work;
    assert.equal(h.preview.url, 'https://example.org/another');
  } finally { h.dispose(); }
});

test('native preview dismissal resets for an empty new draft and another account', async () => {
  const h = previewFixture();
  try {
    const work = h.begin();
    h.requests[0].resolve({ data: { url: 'https://example.com/page', title: 'First' }, error: null });
    await work;
    h.dismiss();
    h.render('');
    assert.equal(h.preview, null);
    h.render('Read https://example.com/page');
    assert.equal(h.scheduled, 1, 'The same URL in a fresh draft may obtain a preview');
    const next = h.begin();
    h.requests[1].resolve({ data: { url: 'https://example.com/page', title: 'New draft' }, error: null });
    await next;
    h.dismiss();
    h.setOwner('another-owner');
    assert.equal(h.scheduled, 1, 'A different account does not inherit the previous account’s dismissal');
  } finally { h.dispose(); }
});

test('native preview rejects a late result immediately after an Auth owner change', async () => {
  const h = previewFixture();
  try {
    const work = h.begin();
    h.authenticate('another-owner');
    h.requests[0].resolve({ data: { url: 'https://example.com/page', title: 'Previous account' }, error: null });
    await work;
    assert.equal(h.preview, null);
  } finally { h.dispose(); }
});

test('native URL changes and cleanup reject responses from a superseded preview request', async () => {
  const h = previewFixture();
  try {
    const old = h.begin();
    h.render('Read https://example.org/new');
    const current = h.begin();
    h.requests[1].resolve({ data: { url: 'https://example.org/new', title: 'Current' }, error: null });
    await current;
    h.requests[0].resolve({ data: { url: 'https://example.com/page', title: 'Old' }, error: null });
    await old;
    assert.equal(h.preview.url, 'https://example.org/new');
    h.render('Read https://example.net/third');
    const late = h.begin();
    h.dispose();
    h.requests[2].resolve({ data: { url: 'https://example.net/third', title: 'Unmounted' }, error: null });
    await late;
    assert.equal(h.preview, null);
  } finally { h.dispose(); }
});

function publicationFixture(text, preview) {
  const posts = [], errors = [], calls = []; let id = 0;
  const context = {
    publicationBusy: { current: false }, publicationAttempt: { current: null }, userId: 'owner', composerText: text,
    composerMedia: [], composerPreview: preview, composerSoundtrack: null, exclusivePost: false, innovationPost: false,
    innoField: null, innoStage: null, postAudience: 'everyone', commentPolicy: 'everyone', postCategory: null,
    articleTitle: '', quotingPost: null, threadingPost: null, composerSensitive: false, collabPicks: [], pollOpts: null,
    pollDays: 1, composerProducts: [], MUSIC_CATALOG_ENABLED: false, currentAuthorId: owner => owner,
    uniqueCollaborators: () => [], Crypto: { randomUUID: () => `fixture-${++id}` },
    useAuthStore: { getState: () => ({ profile: { id: 'owner' } }) },
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' }, access_token: 'fixture-token' } } }) },
      from: table => ({ upsert: async rows => { calls.push(table); if (table === 'posts') posts.push(...rows); return { error: null }; } }),
      rpc: async name => { calls.push(name); throw Error('Preview cache is unavailable'); },
    },
    Haptics: { notificationAsync: async () => {}, NotificationFeedbackType: { Success: 1 } },
    feedListRef: { current: null }, Keyboard: { dismiss() {} }, loadFeed() {}, Alert: { alert: (...args) => errors.push(args) },
    setTimeout: () => 1, clearTimeout() {},
  };
  for (const name of ['setPostConfirmed', 'setPostProgress', 'setComposerReview', 'setSelectedComposerMedia', 'setPosting', 'setPublicationLocked', 'setMusicOpen', 'setComposerOpen', 'setComposerText', 'setComposerMedia', 'setComposerSoundtrack', 'setExclusivePost', 'setComposerProducts', 'setInnovationPost', 'setPostAudience', 'setCommentPolicy', 'setComposerSensitive', 'setCollabPicks', 'setPollOpts', 'setPollDays', 'setQuotingPost', 'setThreadingPost']) context[name] = () => {};
  vm.runInNewContext(compile(`this.publish=${publish};`), context);
  return { context, posts, errors, calls };
}

test('native publication cannot attach a stale preview after its URL changes or is removed', async () => {
  for (const text of ['Read https://example.org/current', 'A post with no external link']) {
    const h = publicationFixture(text, { url: 'https://example.com/old', title: 'Old preview' });
    await h.context.publish();
    assert.equal(h.errors.length, 0);
    assert.equal(h.posts.length, 1);
    assert.equal(h.posts[0].link_url, undefined);
    assert.equal(h.context.publicationAttempt.current, null);
  }
});

test('native publication preserves the current link without depending on a cache acknowledgment', async () => {
  const h = publicationFixture('Read https://example.com/current', { url: 'https://example.com/current', title: 'Verified preview' });
  await h.context.publish();
  assert.equal(h.errors.length, 0);
  assert.equal(h.posts.length, 1);
  assert.equal(h.posts[0].link_url, 'https://example.com/current');
  assert.deepEqual(h.calls, ['posts']);
  assert.equal(h.context.publicationAttempt.current, null);
});
