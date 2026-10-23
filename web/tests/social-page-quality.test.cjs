const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(name) {
 const module={exports:{}};
 const js=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/',name),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(js,{module,exports:module.exports,URL,Date,Map,Set,Error,require:(id)=>{if(id==="../../shared/channelMedia")return require("../../shared/channelMedia.ts");throw new Error(id);}});return module.exports;
}
const {createPagedCollection}=load('socialPages.ts');
const {channelMediaObject}=load('channelMedia.ts');
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{resolve,reject,promise};};
test('double Load more dispatch cannot issue duplicate reads',async()=>{
 const pending=defer();let calls=0;
 const store=createPagedCollection({key:x=>x.id,fetchPage:()=>{calls++;return pending.promise;}});
 const a=store.next(),b=store.next();assert.equal(calls,1);
 pending.resolve([{id:'a'}]);await Promise.all([a,b]);assert.equal(store.snapshot().items.length,1);
});
test('old identity and route responses cannot overwrite reset results',async()=>{
 const old=defer();let calls=0;
 const store=createPagedCollection({key:x=>x.id,fetchPage:()=>++calls===1?old.promise:Promise.resolve([{id:'new'}])});
 const a=store.next();await store.reload();old.resolve([{id:'private-old'}]);await a;
 assert.equal(store.snapshot().items[0].id,'new');assert.equal(store.snapshot().items.length,1);
});
test('failed continuation preserves rows and retries exact offset and snapshot',async()=>{
 const inputs=[];let attempt=0;
 const store=createPagedCollection({key:x=>x.id,size:2,fetchPage:async(...args)=>{inputs.push(args);attempt++;if(attempt===1)return[{id:'a'},{id:'b'}];if(attempt===2)throw new Error('offline');return[{id:'c'}];}});
 await store.next();await store.next();assert.equal(store.snapshot().items.length,2);assert.equal(store.snapshot().error,'offline');
 await store.next();assert.equal(store.snapshot().items.length,3);assert.equal(store.snapshot().hasMore,false);
 assert.equal(inputs[1][0],2);assert.equal(inputs[2][0],2);assert.equal(inputs[0][2],inputs[2][2]);
});
test('deduplicated page advances by raw row count, not displayed count',async()=>{
 const offsets=[];const store=createPagedCollection({key:x=>x.id,size:2,fetchPage:async(offset)=>{offsets.push(offset);return offset===0?[{id:'a'},{id:'b'}]:offset===2?[{id:'b'},{id:'c'}]:[];}});
 await store.next();await store.next();await store.next();assert.equal(offsets.join(','),'0,2,4');assert.equal(store.snapshot().items.length,3);
});
test('disposed reader cannot publish a late private response',async()=>{
 const pending=defer();const store=createPagedCollection({key:x=>x.id,fetchPage:()=>pending.promise});const a=store.next();store.cancel();pending.resolve([{id:'secret'}]);await a;assert.equal(store.snapshot().items.length,0);
});
test('channel media parser only accepts canonical first-party storage references',()=>{
 const origin='https://qa.supabase.co';
 assert.equal(channelMediaObject(origin+'/storage/v1/object/public/channel-media/c/u/a.jpg',origin).path,'c/u/a.jpg');
 assert.equal(channelMediaObject(origin+'/storage/v1/object/sign/chat-media/u/channel_a.jpg?token=secret',origin).bucket,'chat-media');
 for(const url of ['https://evil.test/storage/v1/object/public/channel-media/c/u/a.jpg',origin+'/storage/v1/object/public/avatars/a.jpg',origin+'/storage/v1/object/public/channel-media/c/%2e%2e%2fa.jpg','javascript:alert(1)'])assert.equal(channelMediaObject(url,origin),null);
});
