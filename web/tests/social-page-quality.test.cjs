const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(name) {
 const module={exports:{}};
 const js=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/',name),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(js,{module,exports:module.exports,URL,Date,Map,Set,Error,AbortController,require:(id)=>{if(id==="../../shared/channelMedia")return require("../../shared/channelMedia.ts");throw new Error(id);}});return module.exports;
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
test('warm reader renders all saved pages before refresh and resumes the raw server offset',async()=>{
 const inputs=[],gate=defer();let hold=true;
 const memory={items:[{id:'a'},{id:'b'},{id:'c'}],offset:4,asOf:'old-snapshot',hasMore:true};
 const store=createPagedCollection({key:x=>x.id,size:2,memory,fetchPage:async(offset,size,asOf)=>{inputs.push({offset,size,asOf});if(hold)await gate.promise;return offset===0?[{id:'a'},{id:'b'}]:offset===2?[{id:'b'},{id:'c'}]:[{id:'d'}];}});
 assert.equal(store.snapshot().items.length,3);const work=store.refresh();assert.equal(store.snapshot().items.length,3);
 hold=false;gate.resolve();await work;assert.equal(store.snapshot().items.length,3);await store.next();
 assert.equal(inputs.map(x=>x.offset).join(','),'0,2,4');assert.equal(new Set(inputs.map(x=>x.asOf)).size,1);assert.notEqual(inputs[0].asOf,'old-snapshot');assert.equal(store.snapshot().items.length,4);
});
test('rapid foreground refreshes share a read, while a confirmed mutation cancels obsolete work',async()=>{
 const first=defer(),second=defer(),signals=[];let calls=0;
 const store=createPagedCollection({key:x=>x.id,memory:{items:[{id:'a',caption:'old'}],offset:1,asOf:'old',hasMore:false},fetchPage:(_o,_s,_a,signal)=>{signals.push(signal);return ++calls===1?first.promise:second.promise;}});
 const a=store.refresh();assert.equal(store.refresh(),a);assert.equal(store.refresh(),a);assert.equal(calls,1);
 const b=store.refresh(true);assert.equal(signals[0].aborted,true);second.resolve([{id:'a',caption:'saved'}]);await b;first.resolve([{id:'a',caption:'obsolete'}]);await a;
 assert.equal(store.snapshot().items[0].caption,'saved');assert.equal(calls,2);
});
test('local caption, like and deletion changes survive a delayed multi-page replacement',async()=>{
 const gate=defer();const initial=[{id:'a',caption:'old',liked:false},{id:'b',caption:'remove'},{id:'c',caption:'third'},{id:'d',caption:'fourth'}];
 const store=createPagedCollection({key:x=>x.id,size:2,memory:{items:initial,offset:4,asOf:'old',hasMore:true},fetchPage:async offset=>{if(offset===2)await gate.promise;return initial.slice(offset,offset+2).map(x=>({...x}));}});
 const work=store.refresh();await Promise.resolve();
 store.setItems(rows=>rows.filter(row=>row.id!=='b').map(row=>row.id==='a'?{...row,caption:'edited while refreshing',liked:true}:row));
 gate.resolve();await work;
 assert.equal(store.snapshot().items[0].caption,'edited while refreshing');assert.equal(store.snapshot().items[0].liked,true);assert.equal(store.snapshot().items.some(row=>row.id==='b'),false);assert.equal(store.remember().offset,4);
});
test('failed warm refresh preserves content and retry restarts at zero instead of silently continuing an old snapshot',async()=>{
 let fails=true;const offsets=[];const store=createPagedCollection({key:x=>x.id,size:2,memory:{items:[{id:'old'}],offset:1,asOf:'old',hasMore:false},fetchPage:async offset=>{offsets.push(offset);if(fails)throw Error('offline');return [{id:'fresh'}];}});
 await store.refresh();assert.equal(store.snapshot().items[0].id,'old');assert.equal(store.snapshot().error,'offline');fails=false;await store.next();assert.equal(offsets.join(','),'0,0');assert.equal(store.snapshot().items[0].id,'fresh');
});
test('cancel aborts transport and prevents a late warm refresh from publishing or replacing remembered rows',async()=>{
 const gate=defer();let signal;const old={id:'kept'};const store=createPagedCollection({key:x=>x.id,memory:{items:[old],offset:1,asOf:'old',hasMore:false},fetchPage:(_o,_s,_a,s)=>{signal=s;return gate.promise;}});
 const work=store.refresh();store.cancel();assert.equal(signal.aborted,true);gate.resolve([{id:'secret-old-session'}]);await work;assert.equal(store.snapshot().items[0],old);
});
