const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const owner = '10000000-0000-4000-8000-000000000001';
const another = '10000000-0000-4000-8000-000000000002';
const pause = () => new Promise(resolve => setImmediate(resolve));
function queued(number, overrides = {}) {
  const id = `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
  return { id, key:id, owner_auth_id:owner, queued_at:number, conversation_id:'30000000-0000-4000-8000-000000000001', sender_id:owner, receiver_id:another,
    text:`Message ${number}`, media_url:null, media_type:null, thumbnail_url:null, reply_to_id:null, view_limit:null, ...overrides };
}
function load(options = {}) {
  const saved = JSON.stringify({state:{outbox:options.saved || []},version:0});
  let disk = saved, writes = [], deliveries = [], account = owner;
  let resolveRead, rejectRead;
  const firstRead = new Promise((resolve, reject) => {resolveRead=resolve;rejectRead=reject;});
  const storage = {getItem:()=>firstRead, setItem:async(key,value)=>{if(options.failWrites)throw new Error('storage unavailable');writes.push(value);disk=value;},removeItem:async()=>{disk=null;}};
  const client = {auth:{getSession:async()=>({data:{session:account ? {user:{id:account}}:null},error:null})}};
  const module = {exports:{}};
  const source = fs.readFileSync(path.join(root,'src/stores/netStore.ts'),'utf8')+'\nexport { flushOutbox as flushForTest };';
  const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  function mockRequire(name) {
    if(name === '@react-native-async-storage/async-storage')return storage;
    if(name === 'react-native')return {AppState:{addEventListener(){return{remove(){}};}}};
    if(name === '../services/supabase')return {supabase:client};
    if(name === '../../shared/messageDelivery')return {deliverMessage:async(_client,intent,reconcileFirst)=>{
      deliveries.push({intent,reconcileFirst,account});
      return options.deliver ? options.deliver(intent,deliveries.length) : {status:'confirmed',row:{...intent,created_at:new Date().toISOString()}};
    }};
    return require(name);
  }
  vm.runInNewContext(code,{module,exports:module.exports,require:mockRequire,process:{env:{}},console,AbortController,setTimeout,clearTimeout,setInterval:()=>0,fetch:async()=>({status:200})});
  return {store:module.exports.useNetStore,flush:module.exports.flushForTest,retry:module.exports.retryOutboxMessage,writes,deliveries,
    resolve:()=>resolveRead(saved),reject:()=>rejectRead(new Error('cannot read saved outbox')),
    disk:()=>disk && JSON.parse(disk).state.outbox,account:value=>{account=value;}};
}
test('enqueue and connectivity changes wait for hydration and preserve old plus new messages',async()=>{
  const h=load({saved:[queued(1)]});
  const pending=h.store.getState().enqueue(queued(2));
  h.store.getState().setOnline(false);
  await pause();assert.equal(h.writes.length,0,'must not overwrite saved outbox before reading it');
  h.resolve();await pending;await pause();
  assert.deepEqual(Array.from(h.store.getState().outbox,x=>x.id),[queued(1).id,queued(2).id]);
  assert.deepEqual(h.disk().map(x=>x.id),[queued(1).id,queued(2).id]);
});
test('flush waits for durable hydration and removes only confirmed messages',async()=>{
  const h=load({saved:[queued(1)]});const pending=h.flush();await pause();assert.equal(h.deliveries.length,0);
  h.resolve();await pending;await pause();assert.equal(h.deliveries.length,1);assert.equal(h.deliveries[0].reconcileFirst,true);
  assert.equal(h.store.getState().outbox.length,0);assert.equal(h.disk().length,0);
  const receipt=h.store.getState().confirmed[0];
  assert.equal(receipt.owner_auth_id,owner);assert.equal(receipt.message.id,queued(1).id);
  assert.equal(JSON.parse(h.writes.at(-1)).state.confirmed,undefined,'delivery receipts are transient, not a second persistent message cache');
});
test('a denied item remains reviewable without blocking later queued messages',async()=>{
  const h=load({saved:[queued(1),queued(2)],deliver:intent=>({status:intent.id===queued(1).id?'rejected':'confirmed',row:intent})});
  h.resolve();await pause();await h.flush();await pause();
  assert.deepEqual(h.deliveries.map(x=>x.intent.id),[queued(1).id,queued(2).id]);
  assert.deepEqual(Array.from(h.store.getState().outbox,x=>x.id),[queued(1).id]);
  await h.flush();assert.equal(h.deliveries.length,2,'denied row must not be retried indefinitely');
});
test('other accounts and legacy entries are preserved without automatic replay',async()=>{
  const foreign=queued(1,{owner_auth_id:another,sender_id:another});const legacy={key:'legacy-key',text:'Legacy draft',sender_id:owner,conversation_id:queued(1).conversation_id};
  const h=load({saved:[foreign,legacy,queued(2)]});h.resolve();await pause();await h.flush();await pause();
  assert.deepEqual(h.deliveries.map(x=>x.intent.id),[queued(2).id]);
  assert.deepEqual(Array.from(h.store.getState().outbox,x=>x.key),[foreign.key,legacy.key]);
  h.account(null);await h.flush();assert.equal(h.deliveries.length,1);
});
test('failed hydration cannot replace saved messages with a new queue',async()=>{
  const h=load({saved:[queued(1)]});const pending=h.store.getState().enqueue(queued(2));h.reject();
  await assert.rejects(pending);assert.equal(h.writes.length,0);assert.deepEqual(h.disk().map(x=>x.id),[queued(1).id]);
});
test('a failed persistence write rejects enqueue before any delivery attempt',async()=>{
  const h=load({failWrites:true});h.resolve();await pause();
  await assert.rejects(h.store.getState().enqueue(queued(1)));
  assert.equal(h.deliveries.length,0);assert.equal(h.store.getState().outbox.length,0);
});
test('checking a selected message does not get stuck behind an earlier pending item',async()=>{
  const h=load({saved:[queued(1),queued(2,{failed:true})],deliver:intent=>({status:intent.id===queued(1).id?'pending':'confirmed',row:intent})});
  h.resolve();await pause();await h.retry(queued(2).key);await pause();
  assert.deepEqual(h.deliveries.map(x=>x.intent.id),[queued(2).id]);
  assert.deepEqual(Array.from(h.store.getState().outbox,x=>x.id),[queued(1).id]);
});
