const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function compile(source, globals = {}) {
  const module = {exports:{}};
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {module,exports:module.exports,...globals});
  return module.exports;
}
const receipts = compile(fs.readFileSync(path.join(root, 'shared/messageReceipts.ts'),'utf8'));
test('group seen summary uses shared watermarks and resets immediately for a newer message', () => {
  const rows = [
    { user_id: 'me', last_read_at: '2026-11-05T12:02:00Z' },
    { user_id: 'one', last_read_at: '2026-11-05T12:01:00Z' },
    { user_id: 'two', last_read_at: '2026-11-05T12:00:00Z' },
    { user_id: 'three', last_read_at: null },
    { user_id: 'one', last_read_at: '2026-11-05T12:01:00Z' },
  ];
  const old = { sender_id: 'me', created_at: '2026-11-05T12:00:30Z' };
  assert.deepEqual(Array.from(receipts.groupReadersForMessage(rows, old, 'me')), ['one']);
  assert.deepEqual(Array.from(receipts.groupReadersForMessage(rows, { ...old, created_at: '2026-11-05T12:01:30Z' }, 'me')), []);
  for (const message of [undefined, { ...old, sender_id: 'one' }, { ...old, created_at: 'bad timestamp' }]) {
    assert.deepEqual(Array.from(receipts.groupReadersForMessage(rows, message, 'me')), []);
  }
  assert.deepEqual(Array.from(receipts.groupReadersForMessage(rows, old, null)), []);
});
function nativeRead(globals) {
  const source = fs.readFileSync(path.join(root,'src/screens/messages/ChatScreen.tsx'),'utf8');
  const ast = ts.createSourceFile('chat.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'markRead') callback=node.initializer.arguments[0].getText(ast); ts.forEachChild(node,visit); }
  visit(ast);
  return compile('exports.markRead = '+callback,{...receipts,...globals}).markRead;
}
test('DM receipts use one checked server call, preserving delivered/viewed timestamps',async()=>{
  const calls=[];
  await receipts.acknowledgeConversationRead({rpc:async(name,args)=>{calls.push({name,args});return{error:null};}},{conversationId:'chat',userId:'me',isGroup:false});
  assert.equal(calls.length,1); assert.equal(calls[0].name,'mark_conversation_read');
  assert.equal(calls[0].args.p_conv_id,'chat'); assert.equal(calls[0].args.p_user_id,'me');
  await assert.rejects(receipts.acknowledgeConversationRead({rpc:async()=>({error:{message:'denied'}})},{conversationId:'chat',userId:'me',isGroup:false}));
});
test('group receipts use the authenticated member watermark contract',async()=>{
  const calls=[]; await receipts.acknowledgeConversationRead({rpc:async(name,args)=>{calls.push({name,args});return{error:null};}},{conversationId:'group',userId:'me',isGroup:true});
  assert.equal(calls[0].name,'mark_conversation_read_v2'); assert.equal(calls[0].args.p_conversation_id,'group'); assert.equal(calls.length,1);
});
test('native actual receipt handler ignores a background, unfocused, unloaded or scrolled-away chat',async()=>{
  const state={AppState:{currentState:'active'},focusedRef:{current:true},atLatestRef:{current:true},historyLoadedRef:{current:true},latestContentRef:{current:true}};
  let writes=0,refreshes=0;
  const globals={...state,threadHistory:{current:{atLatest:()=>state.latestContentRef.current}},conversationId:'chat',currentUserId:'me',isGroup:false,accountScopeRef:{current:1},mountedRef:{current:true},activeConversation:{current:'chat'},readObscured:{current:false},readPending:{current:new Set()},readRequested:{current:new Set()},lastRead:{current:''},messagesRef:{current:[{id:'incoming'}]},supabase:{rpc:async()=>{writes++;return{error:null};}},refreshStatus:async()=>{refreshes++;}};
  const mark=nativeRead(globals);
  for (const [ref,key,disabled,enabled] of [[state.AppState,'currentState','background','active'],[state.focusedRef,'current',false,true],[state.atLatestRef,'current',false,true],[state.historyLoadedRef,'current',false,true],[state.latestContentRef,'current',false,true]]) {
    ref[key]=disabled; await mark(); assert.equal(writes,0); ref[key]=enabled;
  }
  await mark(); assert.equal(writes,1); assert.equal(refreshes,1); await mark(); assert.equal(writes,1);
  globals.messagesRef.current=[{id:'next'}]; await mark(); assert.equal(writes,2);
});
test('failed native receipt does not invent read status and can retry the same message',async()=>{
  let failed=true,writes=0,refreshes=0;
  const globals={conversationId:'chat',currentUserId:'me',isGroup:false,AppState:{currentState:'active'},focusedRef:{current:true},atLatestRef:{current:true},historyLoadedRef:{current:true},threadHistory:{current:{atLatest:()=>true}},accountScopeRef:{current:1},mountedRef:{current:true},activeConversation:{current:'chat'},readObscured:{current:false},readPending:{current:new Set()},readRequested:{current:new Set()},lastRead:{current:''},messagesRef:{current:[{id:'incoming'}]},supabase:{rpc:async()=>{writes++;return{error:failed?{message:'offline'}:null};}},refreshStatus:async()=>{refreshes++;}};
  const mark=nativeRead(globals); await mark(); assert.equal(globals.lastRead.current,''); assert.equal(refreshes,0);
  failed=false; await mark(); assert.equal(writes,2); assert.equal(refreshes,1);
});
test('unread counts consume canonical and legacy fields and add duplicate conversation rows',()=>{
  const result=receipts.conversationUnreadCounts([{conversation_id:'a',unread:3},{conversation_id:'a',unread:2},{conversation_id:'b',unread_count:4},{conversation_id:'c',unread:-1},{conversation_id:'d',unread:'bad'}]);
  assert.deepEqual({...result},{a:5,b:4});
});
