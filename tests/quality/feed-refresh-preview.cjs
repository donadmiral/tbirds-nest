const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/screens/feed/FeedScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('FeedScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let result;
  function visit(node) { if (predicate(node)) result = node; ts.forEachChild(node, visit); }
  visit(ast);
  assert.ok(result, 'Expected actual feed implementation');
  return result;
}
function execute(code, scope) {
  return vm.runInNewContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, scope);
}
const id = 'quoted-post';
const old = { content: 'Original', user_id: 'author', media: { url: 'authorized-old', media_type: 'image' }, mediaCount: 1 };
const fresh = { id, content: 'Updated', user_id: 'author', media: { url: 'authorized-new', media_type: 'image' }, mediaCount: 1 };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(mode, { rows = [fresh], queryError = null, queryStatus = 200, denied = false, queued = false } = {}) {
  const idsName = mode === 'refresh' ? 'qIds' : 'qIds2';
  const rowsName = mode === 'refresh' ? 'qRows' : 'qRows2';
  const block = find(node => ts.isIfStatement(node) && node.expression.getText(ast) === `${idsName}.length > 0`);
  let value = { [id]: old }, current = true, release;
  const gate = new Promise(resolve => { release = resolve; });
  const updates = [];
  const apply = update => { value = update(value); };
  const scope = {
    [idsName]: [id], [rowsName]: [], preservePosition: false,
    isCurrent: () => current,
    setQuotedMap: update => queued ? updates.push(update) : apply(update),
    sharedPostPreview: row => ({ media: row.media, mediaCount: row.mediaCount }),
    withoutPrivateMedia: input => input.map(row => ({ ...row, media: { ...row.media, url: '' } })),
    hydratePostMedia: async input => { await gate; if (denied) throw Error('Denied'); return input; },
    supabase: { from() { const query = { select() { return query; }, in() { return Promise.resolve({ data: rows, error: queryError, status: queryStatus }); } }; return query; } },
  };
  const done = execute(`(async () => { ${block.getText(ast)} })()`, scope);
  return { done, release, get value() { return value; }, changeScope() { current = false; }, flush() { while (updates.length) apply(updates.shift()); } };
}

for (const mode of ['refresh', 'paging']) {
  test(`${mode} keeps the painted quote intact while a renewed grant is pending`, async () => {
    const h = harness(mode); await tick();
    assert.equal(h.value[id], old);
    h.release(); await h.done;
    assert.equal(h.value[id].media.url, 'authorized-new');
    assert.equal(h.value[id].content, 'Updated');
  });
  test(`${mode} removes an authoritative missing source before media enrichment`, async () => {
    const h = harness(mode, { rows: [] }); await tick();
    assert.equal(h.value[id], undefined);
    h.release(); await h.done;
    assert.equal(h.value[id], undefined);
  });
  test(`${mode} clears denied media after revalidation instead of retaining old access`, async () => {
    const h = harness(mode, { denied: true }); await tick();
    assert.equal(h.value[id], old);
    h.release(); await h.done;
    assert.equal(h.value[id].media.url, '');
  });
  test(`${mode} preserves a visible source when the metadata request fails`, async () => {
    const h = harness(mode, { rows: null, queryError: { message: 'Offline' } }); await h.done;
    assert.equal(h.value[id], old);
  });
  test(`${mode} preserves a visible source when the metadata response is malformed`, async () => {
    const h = harness(mode, { rows: null }); await h.done;
    assert.equal(h.value[id], old);
  });
  test(`${mode} removes the source on an explicit authorization refusal`, async () => {
    for (const queryStatus of [401, 403]) {
      const h = harness(mode, { queryError: { message: 'Access denied' }, queryStatus }); await tick();
      assert.equal(h.value[id], undefined);
      h.release(); await h.done; assert.equal(h.value[id], undefined);
    }
  });
  test(`${mode} rejects both pending and queued updates from an obsolete scope`, async () => {
    const h = harness(mode, { queued: true }); await tick();
    h.changeScope(); h.release(); await h.done; h.flush();
    assert.equal(h.value[id], old);
  });
}

test('comment refresh keeps previews on transient failure and removes denied or deleted content', async () => {
  const block = find(node => ts.isIfStatement(node) && node.expression.getText(ast) === 'ids.length > 0'
    && node.getText(ast).includes('const commentsDenied'));
  const initial = { post: { body: 'Visible comment', authorName: 'Author', likes: 1 }, other: { body: 'Other post' } };
  let value = initial;
  let comments = { data: null, error: { message: 'offline' }, status: 503 };
  let authors = { data: [], error: null, status: 200 };
  const scope = {
    ids: ['post'], preservePosition: true, requestedAt: 1,
    isCurrent: () => true, feedSnapshotFresh: () => true, liveFence: () => ({}),
    setCommentPreviews: update => { value = update(value); },
    supabase: { from(table) {
      const response = table === 'profiles' ? authors : comments;
      const query = { select() { return query; }, in() { return query; }, order() { return query; },
        then(onValue, onError) { return Promise.resolve(response).then(onValue, onError); } };
      return query;
    } },
  };
  const refresh = () => execute(`(async () => { ${block.getText(ast)} })()`, scope);
  await refresh(); assert.equal(value, initial);
  comments = { data: [], error: null, status: 200 };
  await refresh(); assert.equal(value.post, undefined); assert.equal(value.other, initial.other);
  value = initial; comments = { data: null, error: { code: '42501' }, status: 403 };
  await refresh(); assert.equal(value.post, undefined);
  value = initial; comments = { data: [{ post_id: 'post', user_id: 'author', body: 'Updated comment' }], error: null, status: 200 };
  authors = { data: null, error: { message: 'offline' }, status: 503 };
  await refresh(); assert.equal(value, initial);
  authors = { data: null, error: { code: '42501' }, status: 403 };
  await refresh(); assert.equal(value.post.body, 'Updated comment'); assert.equal(value.post.authorName, 'User');
});

test('the primary feed response keeps existing quote author profiles until enrichment is ready', () => {
  const call = find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'setProfilesMap'
    && node.arguments[0]?.getText(ast).includes('...pmFromFeed'));
  const author = { id: 'quote-author', full_name: 'Quote author', avatar_url: 'painted-avatar' };
  let profiles = { 'quote-author': author, 'post-author': { id: 'post-author', full_name: 'Old name' } };
  execute(call.getText(ast), {
    isCurrent: () => true,
    pmFromFeed: { 'post-author': { id: 'post-author', full_name: 'New name' } },
    setProfilesMap: update => { profiles = update(profiles); },
  });
  assert.equal(profiles['quote-author'], author);
  assert.equal(profiles['post-author'].full_name, 'New name');
});

test('author enrichment retains pending quote identity but removes missing or denied profile details', () => {
  const block = find(node => ts.isIfStatement(node) && node.expression.getText(ast).startsWith('profilesDenied ||'));
  const initial = { quote: { id: 'quote', full_name: 'Previous quote author' }, main: { id: 'main', full_name: 'Current feed author' } };
  let value = initial;
  const scope = {
    isCurrent: () => true, profilesDenied: false, profilesError: { message: 'offline' }, pData: null,
    qRows: [{ user_id: 'quote' }, { user_id: 'main' }], pmFromFeed: { main: initial.main },
    setProfilesMap: update => { value = update(value); },
  };
  execute(block.getText(ast), scope); assert.equal(value, initial);
  scope.profilesError = null; scope.pData = [];
  execute(block.getText(ast), scope); assert.equal(value.quote, undefined); assert.equal(value.main, initial.main);
  value = initial; scope.profilesDenied = true; scope.pData = null;
  execute(block.getText(ast), scope); assert.equal(value.quote, undefined); assert.equal(value.main, initial.main);
});

for (const [name, setter, initial] of [
  ['hydrateCollabs', 'setCollabs', { post: [{ id: 'collaborator', full_name: 'Contributor' }] }],
  ['hydratePolls', 'setPollPosts', { post: true }],
]) {
  test(`${name} preserves visible enrichment on request failure and reconciles a successful empty response`, async () => {
    const declaration = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name);
    const callback = declaration.initializer.arguments[0].getText(ast);
    let value = initial, result = { data: null, error: { message: 'offline' } };
    const query = { select() { return query; }, in() { return query; }, eq() { return query; }, then(fn) { return Promise.resolve(result).then(fn); } };
    const scope = { metadataFence: () => () => true, supabase: { from: () => query }, [setter]: update => { value = update(value); } };
    execute(`(${callback})(['post'])`, scope); await tick();
    assert.equal(value, initial, 'A transient failure cannot erase visible metadata');
    result = { data: [], error: null };
    execute(`(${callback})(['post'])`, scope); await tick();
    assert.equal(name === 'hydrateCollabs' ? value.post.length : value.post, name === 'hydrateCollabs' ? 0 : false);
    value = initial;
    result = { data: null, error: { code: '42501', message: 'denied' }, status: 403 };
    execute(`(${callback})(['post'])`, scope); await tick();
    assert.equal(name === 'hydrateCollabs' ? value.post.length : value.post, name === 'hydrateCollabs' ? 0 : false,
      'An explicit permission denial removes the previously displayed metadata');
  });
}
