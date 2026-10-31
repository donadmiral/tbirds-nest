const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/screens/messages/ChatScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('ChatScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function compile(code, globals = {}) {
 const module = { exports: {} };
 vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module, exports: module.exports, Promise, Map, Set, Date, Error, ...globals });
 return module.exports;
}
let callback;
function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'fetchMessages') callback = node.initializer.getText(ast); ts.forEachChild(node, visit); }
visit(ast); assert.ok(callback);
const history = compile(fs.readFileSync(path.join(root, 'shared/messageHistory.ts'), 'utf8'));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const row = (id = 'message-1') => ({ id, conversation_id: 'conversation', text: 'A visible message', created_at: '2026-10-31T03:00:00Z', media_url: 'private-locator' });
function fixture({ read, sign, detail } = {}) {
 const state = { messages: [], loading: true, error: null, hasOlder: false }, reads = [], signs = [], details = [];
 const set = key => value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
 const globals = {
  conversationId: 'conversation', accountScopeRef: { current: 0 }, historyRequest: { current: 0 }, mountedRef: { current: true }, activeConversation: { current: 'conversation' }, historyLoadedRef: { current: false }, historyCursor: { current: null },
  setMessages: set('messages'), setLoading: set('loading'), setHistoryError: set('error'), setHasOlder: set('hasOlder'),
  ...history, useCallback: fn => fn,
  signChatMedia: rows => { signs.push(rows); return sign ? sign(rows) : Promise.resolve(rows.map(item => ({ ...item, media_url: 'authorized-capability' }))); },
  supabase: { from(table) {
   const query = { table, filters: [], order: [] }; reads.push(query);
   const builder = { select: () => builder, eq: (key, value) => { query.filters.push([key, value]); return builder; }, order: (key, value) => { query.order.push([key, value]); return builder; }, limit: count => { query.limit = count; return read ? read() : Promise.resolve({ data: [row()], error: null }); } };
   return builder;
  } },
 };
 for (const name of ['loadReactions', 'refreshStatus', 'loadStarredIds', 'loadSavedIds']) globals[name] = (...args) => { details.push({ name, args }); return detail ? detail(name) : Promise.resolve(); };
 return { state, globals, reads, signs, details, load: compile('module.exports = ' + callback, globals) };
}

test('authorized chat history displays while all independent decorations are still pending', async () => {
 const gate = deferred(), h = fixture({ detail: () => gate.promise }); let settled = false;
 const work = h.load().then(() => { settled = true; }); await turn();
 assert.equal(settled, false); assert.equal(h.state.messages.length, 1); assert.equal(h.state.messages[0].media_url, 'authorized-capability');
 assert.equal(h.state.loading, false); assert.equal(h.globals.historyLoadedRef.current, true);
 assert.deepEqual(h.details.map(item => item.name), ['loadReactions', 'refreshStatus', 'loadStarredIds', 'loadSavedIds']);
 gate.resolve(); await work; assert.equal(h.state.error, null);
});
test('media authorization remains mandatory before history can appear', async () => {
 const gate = deferred(), h = fixture({ sign: () => gate.promise }); const work = h.load(); await turn();
 assert.equal(h.state.messages.length, 0); assert.equal(h.state.loading, true); assert.equal(h.details.length, 0); assert.equal(h.globals.historyLoadedRef.current, false);
 gate.reject(Error('No media access')); await work;
 assert.equal(h.state.messages.length, 0); assert.equal(h.state.loading, false); assert.match(h.state.error, /Messages could not be loaded/); assert.equal(h.details.length, 0);
});
test('an enrichment failure never hides already authorized and published messages', async () => {
 const h = fixture({ detail: name => name === 'loadReactions' ? Promise.reject(Error('Offline')) : Promise.resolve() }); await h.load();
 assert.equal(h.state.messages.length, 1); assert.equal(h.state.loading, false); assert.equal(h.globals.historyLoadedRef.current, true); assert.ok(h.state.error);
 assert.equal(h.details.length, 4);
});
test('stale metadata cannot start signing or decorations after a conversation or account change', async () => {
 for (const change of [h => { h.globals.activeConversation.current = 'other'; }, h => { h.globals.accountScopeRef.current++; }, h => { h.globals.mountedRef.current = false; }]) {
  const gate = deferred(), h = fixture({ read: () => gate.promise }); const work = h.load(); change(h); gate.resolve({ data: [row()], error: null }); await work;
  assert.equal(h.signs.length, 0); assert.equal(h.details.length, 0); assert.equal(h.state.messages.length, 0);
 }
});
test('stale signed responses cannot publish messages or release a newer loading state', async () => {
 const gate = deferred(), h = fixture({ sign: () => gate.promise }); const work = h.load(); await turn();
 h.globals.historyRequest.current++; gate.resolve([{ ...row(), media_url: 'authorized-capability' }]); await work;
 assert.equal(h.state.messages.length, 0); assert.equal(h.state.loading, true); assert.equal(h.details.length, 0);
});
test('late enrichment failure cannot modify the next history request', async () => {
 const details = deferred(), nextRead = deferred(); let request = 0;
 const h = fixture({ read: () => ++request === 1 ? Promise.resolve({ data: [row()], error: null }) : nextRead.promise, detail: () => details.promise });
 const first = h.load(); await turn(); assert.equal(h.state.loading, false);
 const second = h.load(); assert.equal(h.state.loading, true); details.reject(Error('Old details failed')); await first;
 assert.equal(h.state.loading, true); assert.equal(h.state.error, null);
 nextRead.resolve({ data: [], error: null }); await second;
 assert.equal(h.state.loading, false);
});
test('messages arriving while history is signed survive its publication', async () => {
 const gate = deferred(), h = fixture({ sign: () => gate.promise }); const work = h.load(); await turn();
 h.state.messages = [{ ...row('new-message'), created_at: '2026-10-31T03:01:00Z', media_url: null }];
 gate.resolve([{ ...row(), media_url: 'authorized-capability' }]); await work;
 assert.deepEqual(Array.from(h.state.messages, item => item.id), ['new-message', 'message-1']);
});
