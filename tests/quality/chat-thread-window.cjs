/** Production ChatScreen retention/paging/render callbacks with native layout
 * acknowledgements. This checks component ownership and geometry, not pixels. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '../..'), source = fs.readFileSync(path.join(root, 'src/screens/messages/ChatScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('ChatScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), snippets = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['setMessages','loadOlderMessages','restoreVisibleThread','listData'].includes(node.name.getText(ast))) snippets[node.name.getText(ast)] = node.initializer.getText(ast);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'bindThreadHistory') snippets.bind = node.getText(ast);
  if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === 'FlatList'
    && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'inverted')) for (const attribute of node.attributes.properties) {
    if (ts.isJsxAttribute(attribute) && ['renderItem','onScroll'].includes(attribute.name.getText(ast))) snippets[attribute.name.getText(ast)] = attribute.initializer.expression.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
function pure(file) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'shared', file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, AbortController, require: name => pure(name.replace('./','')) }); return module.exports;
}
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row = n => ({ id: id(n), conversation_id: 'conversation', sender_id: 'peer', created_at: new Date(1767225600000+n*60_000).toISOString(), text: 'Native retained message ' + n });
const turn = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const rows = Array.from({ length: 500 }, (_, n) => row(n + 1)), reads = [], denied = new Set(); let actor = 'owner';
  const env = { ...pure('messageHistory'), ...pure('threadWindow'), Promise, AbortController, exports: {},
    useCallback: fn => fn, useMemo: fn => fn(),
    messages: [], threadWindow: null, searchQuery: '', searchMessages: [], historyError: null,
    activeConversation: { current: 'conversation' }, conversationId: 'conversation', accountScopeRef: { current: 0 }, mountedRef: { current: true },
    threadHistory: { current: null }, threadOwner: { current: '' }, threadStop: { current: null }, threadPosition: { current: { offset: 0, viewport: 500 } },
    messagesRef: { current: [] }, atLatestRef: { current: true }, historyCursor: { current: row(451) }, historyRequest: { current: 0 }, olderPending: { current: false }, hasOlder: true, loading: false,
    useAuthStore: { getState: () => ({ session: { user: { id: actor } } }) }, signChatMedia: async rows => rows,
    setMessageState: rows => { env.messages = rows; }, setThreadWindow: value => { env.threadWindow = value; }, setHistoryError: value => { env.historyError = value; },
    setHasOlder: value => { env.hasOlder = value; }, setLoadingOlder() {}, loadReactions: async () => {}, markRead: async () => {},
    fmtSep: () => 'Today', sameDay: (a,b) => a?.slice(0,10) === b?.slice(0,10), s: { sep: {}, sepTxt: {} }, View: 'View', Text: 'Text', renderMsg: ({ item }) => ({ type: 'Message', props: { id: item.data.id } }),
    supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: actor }, access_token: 'synthetic-owner-token' } }, error: null }) },
      from(table) {
        const read = { table, ids: null, before: Infinity, maximum: Infinity, conversation: null, headers: {} }; reads.push(read);
        const query = { select: () => query, eq(key,value) { if (key === 'conversation_id') read.conversation=value; return query; },
          in(key,value) { if(key === 'id') read.ids=value; return query; }, order: () => query,
          or(value) { read.before=Number(value.match(/id\.lt\.([0-9a-f-]+)/i)[1].split('-').at(-1)); return query; }, limit(value) { read.maximum=value; return query; },
          abortSignal(value) { read.signal=value; return query; }, setHeader(name,value) { read.headers[name]=value; return query; },
          then(yes,no) { return Promise.resolve({ data: table === 'messages' ? rows.filter(row=>!denied.has(row.id) && (!read.ids||read.ids.includes(row.id)) && Number(row.id.split('-').at(-1))<read.before).sort((a,b)=>b.id.localeCompare(a.id)).slice(0,read.maximum) : [], error:null }).then(yes,no); },
        }; return query;
      } },
    require: name => { assert.equal(name,'react/jsx-runtime'); return { jsx: (type,props) => ({ type,props }), jsxs: (type,props) => ({ type,props }) }; },
  };
  const context = vm.createContext(env);
  const code = `${snippets.bind}\nvar setMessages=${snippets.setMessages}; var restoreVisibleThread=${snippets.restoreVisibleThread}; var loadOlderMessages=${snippets.loadOlderMessages}; var renderItem=${snippets.renderItem}; var onScroll=${snippets.onScroll}; var data=()=>(${snippets.listData});`;
  vm.runInContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,context);
  const measure = () => env.data().filter(item=>item.type==='msg').forEach(item => {
    const tree=env.renderItem({item}), inner=tree.props.children;
    inner.props.onLayout({nativeEvent:{layout:{height:40+Number(item.id.split('-').at(-1))%17+(item.dayLabel?24:0)}}});
  });
  env.setMessages(rows.slice(-50)); measure();
  return { env,reads,rows,measure,denied, changeAccount() { actor='different-owner';env.accountScopeRef.current++;env.bindThreadHistory(true); } };
}
test('actual native paging/setter/render callbacks traverse500 rows without retaining more than120 messages', async () => {
  const h=harness(), {env}=h;
  for(let n=0;n<9;n++) {
    env.atLatestRef.current=false;
    await env.threadHistory.current.near(1e9,500);
    await env.loadOlderMessages(); h.measure();
    assert.ok(env.messages.length<=120); assert.equal(env.historyError,null);
  }
  assert.equal(env.threadWindow.total,500); assert.equal(env.historyCursor.current.id,id(1));
  const data=env.data(); assert.ok(data.some(item=>item.type==='gap'));
  for(const item of data.filter(item=>item.type==='gap')) assert.ok(env.renderItem({item}).props.style.height>0);
  assert.ok(h.reads.filter(read=>read.table==='messages'&&!read.ids).every(read=>read.maximum===50));
});
test('native reverse scrolling reauthorizes cold IDs and account change discards the full previous ledger', async () => {
  const h=harness(), {env}=h;
  for(let n=0;n<9;n++) { env.atLatestRef.current=false;await env.threadHistory.current.near(1e9,500);await env.loadOlderMessages();h.measure(); }
  h.denied.add(id(499));
  env.onScroll({nativeEvent:{contentOffset:{y:0},layoutMeasurement:{height:500}}}); await turn(); await turn(); h.measure();
  assert.equal(env.messages.some(row=>row.id===id(499)),false);
  assert.equal(env.messages.some(row=>row.id===id(500)),true);
  const restores=h.reads.filter(read=>read.table==='messages'&&read.ids);
  assert.ok(restores.length);assert.ok(restores.every(read=>read.ids.length<=100&&read.conversation==='conversation'&&read.headers.Authorization==='Bearer synthetic-owner-token'));
  h.changeAccount(); assert.equal(env.messages.length,0);assert.equal(env.threadWindow.total,0);
});
