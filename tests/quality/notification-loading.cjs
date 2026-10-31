const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const filename = 'src/screens/notifications/NotificationsScreen.tsx';
const source = fs.readFileSync(path.join(root, filename), 'utf8');
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = (code, globals = {}) => {
 const module = { exports: {} };
 vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText,
  { module, exports: module.exports, Promise, Map, Set, Date, URL, console, AbortController, setTimeout, clearTimeout, ...globals });
 return module.exports;
};
function callback(name, globals) {
 let expression;
 function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) expression = node.initializer.getText(ast); ts.forEachChild(node, visit); }
 visit(ast); assert.ok(expression, name);
 return compile('module.exports = ' + expression, { useCallback: fn => fn, ...globals });
}
function namedFunction(name, globals = {}) {
 const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
 assert.ok(declaration, name);
 return compile(declaration.getText(ast) + '\nmodule.exports = ' + name, globals);
}
const inviteKey = namedFunction('collaboratorInviteKey');
const media = compile(fs.readFileSync(path.join(root, 'shared/contentMedia.ts'), 'utf8'));
const base = 'https://notifications-fixture.invalid';
const raw = base + '/storage/v1/object/public/post-media/owner/photo.jpg';
const signed = base + '/storage/v1/object/sign/post-media/owner/photo.jpg?token=verified';
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const row = (index, extra = {}) => ({ notification_id: `notice-${index}`, post_id: '10000000-0000-4000-8000-000000000001', post_thumb: raw, type: 'like', actor_name: 'Person', message: 'Liked your post', ...extra });
function fixture({ read, sign, thumbs } = {}) {
 let scope = '1:viewer';
 const state = { rows: [], thumbs: {}, error: null, loading: true, loadingMore: false, refreshing: false, done: false };
 const requests = [], signs = [], thumbnailRequests = [];
 const set = key => value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
 const globals = {
  userId: 'viewer', generation: { current: 0 }, owner: { current: 'viewer' }, mounted: { current: true }, cursorRef: { current: { offset: 0, asOf: '2026-10-31' } }, pageLock: { current: false }, done: false,
  navigationScope: () => scope, deadline: value => Promise.resolve(value),
  setRows: set('rows'), setThumbs: set('thumbs'), setError: set('error'), setLoading: set('loading'), setLoadingMore: set('loadingMore'), setRefreshing: set('refreshing'), setDone: set('done'),
  withoutPrivateMedia: rows => media.replaceContentMedia(rows, base, new Map()),
  invitesFirst: rows => [...rows.filter(row => row.type === 'collab_invite' || row.type === 'community_invite'), ...rows.filter(row => row.type !== 'collab_invite' && row.type !== 'community_invite')],
  supabase: { rpc: (name, params) => { requests.push({ name, params }); return read ? read(params) : Promise.resolve({ data: [row(1)], error: null }); } },
  hydratePostMedia: rows => { signs.push(rows); return sign ? sign(rows) : Promise.resolve(rows.map(row => ({ ...row, post_thumb: signed }))); },
  hydrateThumbs: (rows, ...rest) => { thumbnailRequests.push({ rows, args: rest }); return thumbs ? thumbs(rows) : Promise.resolve(); },
 };
 globals.hydrateRows = callback('hydrateRows', globals);
 return { state, globals, requests, signs, thumbnailRequests, load: callback('load', globals), more: callback('loadMore', globals),
  account(next) { scope = next; }, decorate: (...args) => globals.hydrateRows(...args), scope: () => scope };
}
function renderState(state) {
 let expression;
 function visit(node) { if (ts.isConditionalExpression(node) && node.condition.getText(ast) === 'loading' && node.getText(ast).includes('<TapTopSectionList')) expression = node.getText(ast); ts.forEachChild(node, visit); }
 visit(ast); assert.ok(expression);
 const element = (type, props, ...children) => ({ type, props: props || {}, children });
 return compile('module.exports = () => (' + expression + ')', {
  React: { createElement: element, Fragment: 'Fragment' }, View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', RefreshControl: 'RefreshControl',
  TapTopSectionList: 'TapTopSectionList', ListRowSkeleton: 'ListRowSkeleton', EmptyState: 'EmptyState', Feather: 'Feather',
  s: {}, t: { ink: { primary: '#000' }, status: { link: '#005' } }, getTheme: () => ({ ink: { faint: '#666' } }), insets: { bottom: 0 }, TAB_BAR_CLEARANCE: 0,
  ...state, filt: 'all', reqCount: 0, sections: [], renderRow: () => {}, load: () => {}, loadMore: () => {}, setLoading: () => {}, setRefreshing: () => {}, setFilt: () => {},
 })();
}

test('notification text and controls publish before thumbnail signing or decoration settles', async () => {
 const signing = deferred(), thumbnail = deferred(), h = fixture({ sign: () => signing.promise, thumbs: () => thumbnail.promise });
 await h.load();
 assert.equal(h.state.loading, false); assert.equal(h.state.rows.length, 1); assert.equal(h.state.rows[0].message, 'Liked your post'); assert.equal(h.state.rows[0].post_thumb, null);
 assert.equal(h.globals.cursorRef.current.offset, 1); assert.equal(h.signs.length, 1); assert.equal(h.thumbnailRequests.length, 1); assert.equal(renderState(h.state).type, 'TapTopSectionList');
 signing.resolve([{ ...row(1), post_thumb: signed }]); await turn(); assert.equal(h.state.rows[0].post_thumb, signed);
 thumbnail.resolve(); await turn(); assert.equal(h.state.error, null);
});
test('late first-page media cannot discard an appended notification page', async () => {
 const signing = deferred(), h = fixture({ read: params => Promise.resolve({ data: params.p_offset ? [row(61)] : Array.from({ length: 60 }, (_, i) => row(i + 1)), error: null }), sign: rows => rows.length === 60 ? signing.promise : Promise.resolve(rows.map(row => ({ ...row, post_thumb: signed }))) });
 await h.load(); assert.equal(h.state.rows.length, 60); assert.equal(h.state.done, false);
 await h.more(); await turn(); assert.equal(h.state.rows.length, 61); assert.equal(h.state.rows[60].notification_id, 'notice-61');
 signing.resolve(Array.from({ length: 60 }, (_, i) => row(i + 1, { post_thumb: signed }))); await turn();
 assert.equal(h.state.rows.length, 61); assert.equal(h.state.rows[0].post_thumb, signed); assert.equal(h.state.rows[60].post_thumb, signed); assert.equal(h.globals.cursorRef.current.offset, 61);
});
test('a thumbnail outage keeps notification metadata and shows an inline retry', async () => {
 const h = fixture({ sign: async () => { throw Error('Signing offline'); } }); await h.load(); await turn();
 assert.equal(h.state.rows.length, 1); assert.equal(h.state.rows[0].post_thumb, null); assert.match(h.state.error, /photos could not load/);
 const rendered = renderState(h.state); assert.equal(rendered.type, 'TapTopSectionList'); assert.ok(JSON.stringify(rendered.props.ListHeaderComponent).includes('Retry activity'));
});
test('a failed refresh preserves already visible activity instead of replacing the list with a full-screen error', async () => {
 const h = fixture({ read: async () => ({ data: null, error: Error('Offline') }) }); h.state.rows = [row(1, { post_thumb: signed })]; h.state.loading = false;
 await h.load(); assert.equal(h.state.rows.length, 1); assert.equal(h.state.error, 'Offline'); assert.equal(renderState(h.state).type, 'TapTopSectionList');
 h.state.rows = []; assert.equal(renderState(h.state).type, 'View');
});
test('a media response cannot overwrite a read or invitation change made after publication', async () => {
 const gate = deferred(), h = fixture({ sign: () => gate.promise }); await h.load();
 const newer = { ...h.state.rows[0], unread_in_group: 0, read_at: '2026-10-31' }; h.state.rows = [newer];
 gate.resolve([row(1, { post_thumb: signed, unread_in_group: 1, read_at: null })]); await turn();
 assert.equal(h.state.rows[0], newer); assert.equal(h.state.rows[0].unread_in_group, 0);
});
test('session A-to-B-to-A invalidates a pending metadata response before publishing or signing', async () => {
 const gate = deferred(), h = fixture({ read: () => gate.promise }); const work = h.load();
 h.account('2:other'); h.account('3:viewer'); gate.resolve({ data: [row(1)], error: null }); await work;
 assert.equal(h.state.rows.length, 0); assert.equal(h.signs.length, 0); assert.equal(h.thumbnailRequests.length, 0);
});
test('session changes also suppress late media and media errors', async () => {
 const gate = deferred(), h = fixture({ sign: () => gate.promise }); await h.load(); const published = h.state.rows;
 h.account('2:other'); h.account('3:viewer'); gate.reject(Error('Expired')); await turn();
 assert.equal(h.state.rows, published); assert.equal(h.state.error, null);
});
test('failed periodic renewal strips expired capabilities without deleting readable activity', async () => {
 const h = fixture({ sign: async () => { throw Error('No longer authorized'); } });
 const batch = [row(1, { post_thumb: signed })]; h.state.rows = batch; h.state.thumbs = { 'p:post': signed };
 await h.decorate(batch, batch, h.globals.generation.current, 'viewer', h.scope(), true);
 assert.equal(h.state.rows.length, 1); assert.equal(h.state.rows[0].message, batch[0].message); assert.equal(h.state.rows[0].post_thumb, null); assert.equal(Object.keys(h.state.thumbs).length, 0);
});
test('malformed metadata cannot establish a successful empty activity result', async () => {
 for (const data of [null, [null], [{}]]) {
  const h = fixture({ read: async () => ({ data, error: null }) }); await h.load(); assert.match(h.state.error, /could not be verified/); assert.equal(h.state.loading, false); assert.equal(h.signs.length, 0);
 }
});
test('pagination does not dispatch after the navigation session has been cleared', async () => {
 const h = fixture(); h.account(null); await h.more();
 assert.equal(h.requests.length, 0); assert.equal(h.state.loadingMore, false); assert.equal(h.globals.pageLock.current, false);
});
test('invitation cleanup follows invitation identity changes without rerunning for photo decoration', () => {
 let expression;
 function visit(node) { if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.getText(ast).includes('pruneAnsweredInvites')) expression = node.getText(ast); ts.forEachChild(node, visit); }
 visit(ast); assert.ok(expression);
 let previous = [], calls = [];
 const pruneAnsweredInvites = key => calls.push(key);
 const render = rows => compile(expression, { inviteKey: inviteKey(rows), pruneAnsweredInvites, useEffect: (run, deps) => { if (deps.some((value, i) => value !== previous[i])) { previous = deps; run(); } } });
 const initial = [row(1, { type: 'collab_invite' })];
 render(initial); render(initial.map(item => ({ ...item, post_thumb: signed, read_at: '2026-10-31' })));
 assert.equal(calls.length, 1);
 render([row(2, { type: 'collab_invite' })]);
 assert.equal(calls.length, 2); assert.equal(JSON.parse(calls[1])[0].id, 'notice-2');
});
function invitationFixture(read = async () => ({ data: [], error: null })) {
 const h = fixture(), queries = [], deletes = [];
 h.globals.supabase.from = table => {
  const query = { table, filters: [], values: [] };
  const builder = { select: () => builder, delete: () => builder, eq: (field, value) => { query.filters.push([field, value]); return builder; }, in: (field, values) => {
   query.values = [field, values];
   if (table === 'post_collaborators') { queries.push(query); return read(); }
   deletes.push(query); return Promise.resolve({ data: null, error: null });
  } };
  return builder;
 };
 return { ...h, queries, deletes, prune: callback('pruneAnsweredInvites', h.globals) };
}
test('an unavailable or malformed collaborator lookup cannot remove invitations or delete notifications', async () => {
 for (const outcome of [() => Promise.resolve({ data: null, error: Error('Offline') }), () => Promise.resolve({ data: null, error: null }), () => Promise.resolve({ data: [{}], error: null }), () => Promise.reject(Error('Timed out'))]) {
  const h = invitationFixture(outcome); h.state.rows = [row(1, { type: 'collab_invite' })]; const original = h.state.rows;
  await h.prune(inviteKey(original)); assert.equal(h.state.rows, original); assert.equal(h.deletes.length, 0);
 }
});
test('an invitation check cannot remove rows after a refresh or same-user session restart', async () => {
 for (const change of [h => { h.globals.generation.current++; }, h => { h.account('2:other'); h.account('3:viewer'); }]) {
  const gate = deferred(), h = invitationFixture(() => gate.promise); h.state.rows = [row(1, { type: 'collab_invite' })]; const original = h.state.rows;
  const work = h.prune(inviteKey(original)); change(h); gate.resolve({ data: [], error: null }); await work;
  assert.equal(h.state.rows, original); assert.equal(h.deletes.length, 0);
 }
});
test('verified answered invitations are removed without touching open invitations or ordinary activity', async () => {
 const openPost = '10000000-0000-4000-8000-000000000002';
 const h = invitationFixture(async () => ({ data: [{ post_id: openPost }], error: null }));
 h.state.rows = [row(1, { type: 'collab_invite' }), row(2, { type: 'collab_invite', post_id: openPost }), row(3)];
 await h.prune(inviteKey(h.state.rows));
 assert.deepEqual(Array.from(h.state.rows, item => item.notification_id), ['notice-2', 'notice-3']);
 assert.deepEqual(Array.from(h.deletes[0].values[1]), ['notice-1']); assert.deepEqual(h.deletes[0].filters, [['recipient_id', 'viewer']]);
});
