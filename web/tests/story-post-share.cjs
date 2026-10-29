const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const source=compile('lib/storyPostShare.ts');
const id='11111111-1111-4111-8111-111111111111';
const authorId='22222222-2222-4222-8222-222222222222';
function setup(options={}){
 const reads=[],hydrated=[];
 const post={id,user_id:authorId,content:'Current caption',audience:'everyone',archived_at:null,is_exclusive:false,community_id:null,...options.post};
 const profile={id:authorId,username:'author',full_name:'Current name',profile_visibility:'public',deactivated_at:null,...options.profile};
 const client={rpc:async(name,payload)=>{reads.push({name,payload});return{data:options.allowed??true,error:options.accessError??null};},from:table=>{
  const call={table,filters:{}};reads.push(call);const query={select:()=>query,eq:(key,value)=>{call.filters[key]=value;return query;},order:()=>query,maybeSingle:()=>query,then:(ok,bad)=>Promise.resolve(options.result?options.result(table):{data:table==='posts'?post:table==='profiles'?profile:[{url:'canonical-photo',media_type:'image',width:1080,height:1920,sort_order:0}],error:null}).then(ok,bad)};return query;
 }};
 const module={exports:{}};
 vm.runInNewContext(source,{module,exports:module.exports,Promise,Error,require:name=>{
  if(name==='../../shared/contentMedia')return{CONTENT_UUID:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i};
  if(name==='./contentMedia')return{hydratePostMedia:async rows=>{hydrated.push(rows);return options.hydrate?options.hydrate(rows):rows.map(row=>({...row,sticker:{...row.sticker,postMediaUrl:'authorized-preview'}}));}};
  throw Error(name);
 }});
 return{reads,hydrated,load:(postId=id,check=()=>{})=>module.exports.loadPostStorySticker(client,postId,check)};
}
test('public feed share uses current source fields and authorized preview media',async()=>{
 const h=setup();const s=await h.load();assert.equal(s.postId,id);assert.equal(s.postText,'Current caption');assert.equal(s.postUsername,'author');assert.equal(s.postMediaWidth,1080);assert.equal(s.postMediaHeight,1920);assert.equal(s.postMediaUrl,'authorized-preview');assert.equal(h.hydrated[0][0].id,id);
});
test('invalid or denied source never reaches post rows or media signing',async()=>{
 const bad=setup();await assert.rejects(bad.load('not-an-id'),/not available/);assert.equal(bad.reads.length,0);
 const denied=setup({allowed:false});await assert.rejects(denied.load(),/not available/);assert.equal(denied.reads.length,1);assert.equal(denied.hydrated.length,0);
});
test('restricted, community, archived and exclusive posts cannot widen their audience',async()=>{
 for(const post of [{audience:'followers'},{community_id:id},{archived_at:'2026-10-29'},{is_exclusive:true}]){
  const h=setup({post});await assert.rejects(h.load(),/Only public posts/);assert.equal(h.hydrated.length,0);
 }
});
test('private or deactivated authors cannot seed a public reference card',async()=>{
 for(const profile of [{profile_visibility:'private'},{deactivated_at:'2026-10-29'}]){const h=setup({profile});await assert.rejects(h.load(),/public profiles/);assert.equal(h.hydrated.length,0);}
});
test('denied media stays unavailable and never falls back to its original URL',async()=>{
 const h=setup({hydrate:rows=>rows.map(row=>({...row,sticker:{...row.sticker,postMediaUrl:null}}))});await assert.rejects(h.load(),/preview could not load/);
});
test('identity checks stop subsequent reads after an account change',async()=>{
 let checks=0;const h=setup();await assert.rejects(h.load(id,()=>{if(++checks===2)throw Error('Account changed');}),/Account changed/);assert.equal(h.reads.length,1);assert.equal(h.hydrated.length,0);
});
test('source read failures settle as an actionable error',async()=>{
 const h=setup({result:()=>({data:null,error:{message:'offline'}})});await assert.rejects(h.load(),/could not load/);assert.equal(h.hydrated.length,0);
});
