const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname,'..');
function run(source, globals={}) {
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{accountScopeRef:{current:'owner:me'},module,exports:module.exports,AbortController,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,...globals});
  return module.exports;
}
const delivery=run(fs.readFileSync(path.join(root,'shared/messageDelivery.ts'),'utf8'));
const intent={id:'10000000-0000-4000-8000-000000000001',conversation_id:'chat',sender_id:'me',receiver_id:'other',text:'Hello',media_url:null,media_type:null,thumbnail_url:null,reply_to_id:null,view_limit:null};
function server(options={}) {
  const rows=new Map(),calls=[];let first=true;
  return {rows,calls,auth:{getSession:async()=>({data:{session:{user:{id:'owner'}}},error:null})},from(){let op='select',input,filters={};const query={
    insert(value){op='insert';input=value[0];return query;},select(){return query;},eq(k,v){filters[k]=v;return query;},single(){return query;},maybeSingle(){return query;},abortSignal(){return query;},
    then(ok,bad){return Promise.resolve().then(()=>{calls.push({op,input,filters});if(op==='insert'){
      if(options.denied)return{data:null,error:{code:'42501'}};
      if(rows.has(input.id))return{data:null,error:{code:'23505'}};
      rows.set(input.id,{...input,created_at:'2026-10-22T10:00:00Z'});
      if(options.loseFirst&&first){first=false;throw new Error('response lost');}
      return{data:rows.get(input.id),error:null};
    }if(options.readFailure)return{data:null,error:{message:'offline'}};
      const data=rows.get(filters.id);return{data:data&&Object.entries(filters).every(([k,v])=>data[k]===v)?data:null,error:null};}).then(ok,bad);}
  };return query;}};
}
function callback(name) {
  const source=fs.readFileSync(path.join(root,'src/screens/messages/ChatScreen.tsx'),'utf8');
  const ast=ts.createSourceFile('chat.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;
  function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)found=node.initializer.arguments[0].getText(ast);ts.forEachChild(node,visit);}visit(ast);return found;
}
test('a committed message with a lost response reconciles without inserting another row',async()=>{
  const client=server({loseFirst:true});const result=await delivery.deliverMessage(client,intent);
  assert.equal(result.status,'confirmed');assert.equal(client.rows.size,1);assert.equal(client.calls.filter(c=>c.op==='insert').length,1);
  const retry=await delivery.deliverMessage(client,intent,true);assert.equal(retry.status,'confirmed');assert.equal(client.calls.filter(c=>c.op==='insert').length,1);
});
test('unknown outcomes retain their ID, and a failed reconciliation does not replay',async()=>{
  const client=server({loseFirst:true,readFailure:true});assert.equal((await delivery.deliverMessage(client,intent)).status,'pending');
  assert.equal((await delivery.deliverMessage(client,intent,true)).status,'pending');assert.equal(client.calls.filter(c=>c.op==='insert').length,1);
});
test('a collision with different content and a definitive denial never look delivered',async()=>{
  const client=server();client.rows.set(intent.id,{...intent,text:'Different',created_at:'2026-10-22T10:00:00Z'});
  assert.equal((await delivery.deliverMessage(client,intent,true)).status,'conflict');assert.equal(client.calls.filter(c=>c.op==='insert').length,0);
  assert.equal((await delivery.deliverMessage(server({denied:true}),intent)).status,'rejected');
});
test('the actual native sender persists the ID before sending and handles a lost committed response',async()=>{
  const client=server({loseFirst:true});let persisted=false,queue=[],visible=[],confirmed=[];
  const globals={...delivery,currentUserId:'me',conversationId:'chat',getOrCreateConversation:async()=>'chat',supabase:client,isGroup:false,otherUser:{id:'other'},passedUserId:'other',pendingViewLimitRef:{current:null},
    useAuthStore:{getState:()=>({session:{user:{id:'owner'}}})},
    makeMessageId:()=>intent.id,mountedRef:{current:true},activeConversation:{current:'chat'},LayoutAnimation:{configureNext(){},create(){},Types:{easeInEaseOut:0},Properties:{opacity:0}},
    mergeMessagePage:(a,b)=>a.concat(b),setMessages(fn){visible=fn(visible);},mergeMsg:async row=>{confirmed.push(row);},refreshStatus:async()=>{},Alert:{alert(){throw new Error('unexpected alert');}},
    useNetStore:{getState:()=>({enqueue:async value=>{await Promise.resolve();queue.push(value);persisted=true;},removeFromOutbox:id=>{assert.equal(persisted,true);queue=queue.filter(row=>row.id!==id);}})},
    deliverMessage:async(...args)=>{assert.equal(persisted,true);return delivery.deliverMessage(...args);}
  };
  const send=run('export const send='+callback('doSend'),globals).send;
  assert.equal(await send('Hello'),true);assert.equal(client.rows.size,1);assert.equal(queue.length,0);assert.equal(confirmed[0].id,intent.id);assert.equal(visible[0].id,intent.id);
});
test('outbox flush skips other accounts and legacy IDs and retains uncertain delivery',async()=>{
  const source=fs.readFileSync(path.join(root,'src/stores/netStore.ts'),'utf8');const ast=ts.createSourceFile('net.ts',source,ts.ScriptTarget.Latest,true);let fn;
  ast.statements.forEach(node=>{if(ts.isFunctionDeclaration(node)&&node.name.text==='flushOutbox')fn=node.getText(ast);});
  const client=server();const other={...intent,id:'other-id',owner_auth_id:'another',key:'other-id'};const legacy={key:'legacy'};const mine={...intent,owner_auth_id:'owner',key:intent.id};let queue=[other,legacy,mine],attempts=0;
  const code='let flushing=false; const outboxWrite=Promise.resolve(); const waitForOutboxHydration=async()=>{};\n'+fn+'\nexport { flushOutbox };';
  const result=run(code,{require:()=>({supabase:client}),useNetStore:{getState:()=>({outbox:queue,removeFromOutbox:key=>{queue=queue.filter(row=>row.key!==key);}})},deliverMessage:async(_client,item,reconcileFirst)=>{attempts++;assert.equal(reconcileFirst,true);assert.equal(item.id,intent.id);return{status:'pending'};}});
  await result.flushOutbox();assert.equal(attempts,1);assert.equal(queue.length,3);
});
test('message IDs use random UUID format',()=>{
  const ids=Array.from({length:100},delivery.makeMessageId);assert.equal(new Set(ids).size,100);ids.forEach(id=>assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/));
});
test('the actual native sender stops if the account changes during conversation lookup',async()=>{
  let owner='owner-a',resolve;const waiting=new Promise(done=>{resolve=done;});
  const send=run('export const send='+callback('doSend'),{currentUserId:'sender-a',useAuthStore:{getState:()=>({session:{user:{id:owner}}})},getOrCreateConversation:()=>waiting}).send;
  const pending=send('Private draft');owner='owner-b';resolve('chat');assert.equal(await pending,false);
});
test('realtime confirmation arriving before an uncertain send result keeps its confirmed status',async()=>{
  let visible=[];
  const globals={currentUserId:'me',getOrCreateConversation:async()=>'chat',supabase:server(),isGroup:false,otherUser:{id:'other'},passedUserId:'other',pendingViewLimitRef:{current:null},
    useAuthStore:{getState:()=>({session:{user:{id:'owner'}}})},makeMessageId:()=>intent.id,mountedRef:{current:true},activeConversation:{current:'chat'},
    LayoutAnimation:{configureNext(){},create(){},Types:{easeInEaseOut:0},Properties:{opacity:0}},mergeMessagePage:(a,b)=>a.concat(b),setMessages(fn){visible=fn(visible);},
    useNetStore:{getState:()=>({enqueue:async()=>{}})},deliverMessage:async()=>{visible=[{...intent,_optimistic:false}];return{status:'pending'};}
  };
  const send=run('export const send='+callback('doSend'),globals).send;assert.equal(await send('Hello'),true);
  assert.equal(visible[0]._optimistic,false);assert.equal(visible[0]._queued,undefined);
});
test('background receipt synchronization confirms the open chat without a history reload',async()=>{
  const source=fs.readFileSync(path.join(root,'src/screens/messages/ChatScreen.tsx'),'utf8');const ast=ts.createSourceFile('chat.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let sync;
  function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('receipt.owner_auth_id'))sync=node.arguments[0].getText(ast);ts.forEachChild(node,visit);}visit(ast);
  let visible=[{...intent,_optimistic:true,_queued:true}];const ref={current:visible};
  const receipt={...intent,created_at:'2026-10-22T10:00:00Z'};
  const module=run('export const mergeMsg='+callback('mergeMsg')+'; export const sync='+sync,{
    confirmedOutbox:[{owner_auth_id:'owner',message:receipt},{owner_auth_id:'different-owner',message:{...receipt,id:'foreign'}}],confirmationBaseline:{current:{seen:new Set()}},session:{user:{id:'owner'}},conversationId:'chat',messagesRef:ref,
    isChatMediaUrl:()=>false,mountedRef:{current:true},activeConversation:{current:'chat'},LayoutAnimation:{configureNext(){},create(){},Types:{easeInEaseOut:0},Properties:{opacity:0}},
    setMessages(fn){visible=fn(visible);ref.current=visible;},mergeMessagePage:(a,b)=>a.concat(b)
  });
  module.sync();await Promise.resolve();assert.equal(visible.length,1);assert.equal(visible[0]._optimistic,false);assert.equal(visible[0]._queued,undefined);
  visible=[];ref.current=[];module.sync();await Promise.resolve();assert.equal(visible.length,0,'an old receipt must not resurrect a removed message');
});

test('shared-post reconciliation never confirms a different post with the same message ID',async()=>{
  const client=server();
  const share={...intent,text:null,shared_post_id:'post-a'};
  client.rows.set(share.id,{...share,shared_post_id:'post-b',created_at:'2026-10-25T10:00:00Z'});
  assert.equal((await delivery.deliverMessage(client,share,true)).status,'conflict');
  assert.equal(client.calls.filter(c=>c.op==='insert').length,0);
});
test('shared-post lost responses reconcile once while normal messages accept nullable share fields',async()=>{
  const client=server({loseFirst:true});
  const share={...intent,text:null,shared_post_id:'post-a'};
  assert.equal((await delivery.deliverMessage(client,share)).status,'confirmed');
  assert.equal((await delivery.deliverMessage(client,share,true)).status,'confirmed');
  assert.equal(client.rows.size,1);
  const ordinary=server();ordinary.rows.set(intent.id,{...intent,shared_post_id:null,created_at:'2026-10-25T10:00:00Z'});
  assert.equal((await delivery.deliverMessage(ordinary,intent,true)).status,'confirmed');
});
