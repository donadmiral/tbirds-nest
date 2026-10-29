const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const crypto = require('node:crypto').webcrypto;
function runtime(store = new Map()) {
 const cache = new Map();
 const storage = { get length() { return store.size; }, key: i => [...store.keys()][i], getItem: key => store.get(key) ?? null, setItem: (key,value) => store.set(key,value), removeItem: key => store.delete(key) };
 function load(file) {
  file=path.resolve(__dirname,'../../',file); if(cache.has(file))return cache.get(file);
  const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};cache.set(file,module.exports);
  vm.runInNewContext(output,{module,exports:module.exports,crypto,AbortController,setTimeout,clearTimeout,window:{localStorage:storage},require:name=>load(path.relative(path.resolve(__dirname,'../../'),path.resolve(path.dirname(file),name+'.ts')))});
  return module.exports;
 }
 return { api:load('web/lib/messageOutbox.ts'),store,storage };
}
const intent={sender_id:'sender',conversation_id:'conversation',receiver_id:'receiver',text:'Only one message',media_url:null,media_type:null,thumbnail_url:null,view_limit:null,reply_to_id:null};
function client() {
 const rows=new Map();let inserts=0,offline=false,account='sender',lostResponse=false,reject=false;
 return {rows,get inserts(){return inserts;},set offline(v){offline=v;},set account(v){account=v;},set lostResponse(v){lostResponse=v;},set reject(v){reject=v;},
 auth:{getSession:async()=>({data:{session:{user:{id:account}}}})},from(){let input,filters={};const q={select(){return q;},eq(k,v){filters[k]=v;return q;},single(){return q;},maybeSingle(){return q;},insert(v){input=v[0];return q;},abortSignal(){return q;},then(ok,bad){return Promise.resolve().then(()=>{if(offline)throw Error('offline');if(input){inserts++;if(reject)return {error:{code:'42501'}};rows.set(input.id,{...input,created_at:new Date().toISOString()});if(lostResponse){lostResponse=false;offline=true;throw Error('lost response');}return {data:rows.get(input.id)};}return {data:[...rows.values()].find(row=>Object.entries(filters).every(([k,v])=>row[k]===v))||null};}).then(ok,bad);}};return q;}};
}
test('lost accepted POST recovers after reload without creating a second message',async()=>{
 const first=runtime(),server=client();const queued=first.api.enqueueMessage(intent);server.lostResponse=true;
 assert.equal((await first.api.sendOutboxMessage(server,queued)).status,'pending');assert.equal(server.inserts,1);assert.equal(first.api.readOutbox('sender').length,1);
 server.offline=false;const reloaded=runtime(first.store);const recovered=reloaded.api.readOutbox('sender')[0];assert.equal(recovered.id,queued.id);
 assert.equal((await reloaded.api.sendOutboxMessage(server,recovered)).status,'confirmed');assert.equal(server.inserts,1);assert.equal(reloaded.api.readOutbox('sender').length,0);
});
test('offline queue survives, duplicate retries share one attempt, and account switches cannot send',async()=>{
 const h=runtime(),server=client(),queued=h.api.enqueueMessage(intent);server.account='other';await h.api.sendOutboxMessage(server,queued);assert.equal(server.inserts,0);assert.equal(h.api.readOutbox('other').length,0);
 server.account='sender';await Promise.all([h.api.sendOutboxMessage(server,queued),h.api.sendOutboxMessage(server,queued)]);assert.equal(server.inserts,1);
});
test('explicit rejection retains recoverable same-ID intent and sign-out removes private drafts',async()=>{
 const h=runtime(),server=client(),queued=h.api.enqueueMessage(intent);server.reject=true;
 assert.equal((await h.api.sendOutboxMessage(server,queued)).status,'rejected');assert.equal(h.api.readOutbox('sender')[0].id,queued.id);
 h.api.clearOutbox('sender');assert.equal(h.api.readOutbox('sender').length,0);
});
test('storage failure does not accept a message that cannot be recovered',()=>{
 const h=runtime();h.storage.setItem=()=>{throw Error('quota');};assert.throws(()=>h.api.enqueueMessage(intent),/cannot save/);
});
