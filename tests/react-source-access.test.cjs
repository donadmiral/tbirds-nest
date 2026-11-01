const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), ts = require('typescript');
const id = '12345678-1234-1234-1234-123456789abc';
const mediaId = '22345678-1234-1234-1234-123456789abc';
const contentScope={exports:{},URL};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../shared/contentMedia.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,contentScope);
function fixture() {
  const state = { owner: 'reader', scope: '1:reader', canView: true, post: {id,user_id:'creator',audience:'everyone',content:'The source post',post_media:[{id:mediaId,url:'https://qa.supabase.co/storage/v1/object/public/post-media/creator/source.mp4',media_type:'video',width:1920,height:1080,sort_order:0}]}, author:{id:'creator',username:'original',full_name:'Original',profile_visibility:'public'}, reads:0 };
  const row = table => { const builder = {select(){return this},eq(){return this},abortSignal(){return this},async maybeSingle(){state.reads++;return {data:structuredClone(table==='posts'?state.post:state.author),error:null}}};return builder };
  const modules = {
    '../../shared/contentMedia':contentScope.exports,
    '../../shared/orderRequest':{orderTimeout:async work=>await work},
    './supabase':{SUPABASE_URL:'https://qa.supabase.co',supabase:{rpc(){return {abortSignal(){return this},then(resolve,reject){return Promise.resolve({data:state.canView,error:null}).then(resolve,reject)}}},from:row}},
    './contentMedia':{hydratePostMedia:async rows=>rows.map(row=>({...row,uri:row.uri.replace('/public/','/sign/')+'?token=test-capability'}))},
    '../lib/navigationCache':{navigationScope:()=>state.scope},
    '../stores/authStore':{useAuthStore:{getState:()=>({session:state.owner?{user:{id:state.owner}}:null})}},
  };
  const scope={exports:{},require:name=>{if(!(name in modules))throw Error(name);return modules[name]}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/services/reactSourceAccess.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
  return {state,...scope.exports};
}
test('React resolves canonical original media and creator, ignoring route URI/name claims',async()=>{
 const f=fixture();const source=await f.prepareReactPostSource({postId:id,uri:'https://attacker.invalid/private.mp4',kind:'image',creatorId:'other',creatorName:'Other',allowReact:true});
 assert.equal(source.uri,'https://qa.supabase.co/storage/v1/object/sign/post-media/creator/source.mp4?token=test-capability');assert.equal(source.creatorId,'creator');assert.equal(source.creatorName,'@original');assert.equal(source.kind,'video');assert.equal(source.sourceMediaId,mediaId);await f.assertReactSourceAccess({...source,uri:'file:///local-copy.mp4'});
});
test('fresh visibility and public audience prevent reusing a private or withdrawn original',async()=>{
 for(const change of [f=>f.state.canView=false,f=>f.state.post.audience='followers',f=>f.state.post.is_exclusive=true,f=>f.state.post.archived_at='now',f=>f.state.post.community_id='community',f=>f.state.author.profile_visibility='private',f=>f.state.author.deactivated_at='now',f=>f.state.post.post_media[0].is_sensitive=true]){
  const f=fixture(),source=await f.prepareReactPostSource({postId:id,uri:'',kind:'image'});change(f);await assert.rejects(f.assertReactSourceAccess({...source,uri:'file:///cached.mp4'}),/no longer available/);
 }
});
test('a source edit is rejected before staging as well as before publication',async()=>{
 const f=fixture(),source=await f.prepareReactPostSource({postId:id,uri:'',kind:'image'});f.state.post.post_media[0].url='https://qa.supabase.co/storage/v1/object/public/post-media/creator/replaced.mp4';
 await assert.rejects(f.prepareReactPostSource(source),/original post changed/);await assert.rejects(f.assertReactSourceAccess(source),/original post changed/);
});
test('text posts retain canonical text and metadata for the rendered source card',async()=>{
 const f=fixture();f.state.post.post_media=[];const source=await f.prepareReactPostSource({postId:id,uri:'file:///forged.png',kind:'image',text:'Forged'});
 assert.equal(source.uri,'');assert.equal(source.text,'The source post');assert.equal(source.kind,'image');await f.assertReactSourceAccess({...source,uri:'file:///rendered-source-card.png'});
});
test('a foreign media ID and a remote source without a post grant fail closed; local picks remain usable',async()=>{
 const f=fixture();await assert.rejects(f.prepareReactPostSource({postId:id,sourceMediaId:'foreign',uri:'',kind:'video'}),/no longer available/);
 await assert.rejects(f.prepareReactPostSource({uri:'https://media.example/private.mp4',kind:'video',allowReact:true}),/no longer available/);
 const local=await f.prepareReactPostSource({uri:'file:///my-pick.mp4',kind:'video',creatorId:'forged'});assert.equal(local.uri,'file:///my-pick.mp4');assert.equal(local.creatorId,undefined);
});

test('an external URL inserted into a public post cannot become an authorized React download',async()=>{
 const f=fixture();f.state.post.post_media[0].url='https://outside.invalid/asset.mp4';await assert.rejects(f.prepareReactPostSource({postId:id,uri:'',kind:'video'}),/no longer available/);
});
