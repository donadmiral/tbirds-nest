import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertPreviewEnvironment,fixtureBelongsToRun,sanitizedFailure,runAcceptance,QA_ORIGIN,storageFailureIsDenied,authLookupProvesAbsent} from './completion-qa-auth-acceptance.mjs';
const sha='a'.repeat(40),env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/completion-20261101',VERCEL_GIT_COMMIT_SHA:sha,NEXT_PUBLIC_SUPABASE_URL:QA_ORIGIN,SUPABASE_SERVICE_ROLE_KEY:'private-fixture',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public-fixture'};
test('production, wrong branch/project/source and missing server credentials are rejected before a client is created',async()=>{
 for(const change of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{NEXT_PUBLIC_SUPABASE_URL:'https://prlkikhckbifseosbukl.supabase.co'},{VERCEL_GIT_COMMIT_SHA:'b'.repeat(40)},{SUPABASE_SERVICE_ROLE_KEY:''},{SUPABASE_SERVICE_ROLE_KEY:'public-fixture'}]){
  let created=false;await assert.rejects(runAcceptance({env:{...env,...change},expectedSource:sha,clientFactory:()=>{created=true;throw new Error('must not run');}}));assert.equal(created,false);
 }
 assert.deepEqual(assertPreviewEnvironment(env,sha),{origin:QA_ORIGIN,source:sha,branch:'codex/completion-20261101'});
});
test('cleanup requires the exact created ID, run, immutable Auth marker and disposable address',()=>{
 const user={id:'synthetic-id',email:'completion-run1-owner@example.invalid',app_metadata:{completion_qa_fixture:true,completion_qa_run:'run1'}};
 assert.equal(fixtureBelongsToRun(user,'run1','synthetic-id'),true);
 for(const changed of [{...user,id:'other'},{...user,email:'real@example.com'},{...user,app_metadata:{...user.app_metadata,completion_qa_run:'another'}},{...user,app_metadata:{...user.app_metadata,completion_qa_fixture:'true'}},null])assert.equal(fixtureBelongsToRun(changed,'run1','synthetic-id'),false);
});
test('failure receipts never serialize provider messages, credentials, tokens or request bodies',()=>{
 const unsafe={message:'sensitive-token',details:'private-body',code:'https://secret.invalid/token',status:403};
 assert.deepEqual(sanitizedFailure(unsafe,'fixture'),{stage:'fixture',code:'CHECK_FAILED',status:403});
 assert.deepEqual(sanitizedFailure({code:'QA_CHECK_FAILED'},'fixture'),{stage:'fixture',code:'QA_CHECK_FAILED'});
});
test('provider outages and invalid requests cannot masquerade as Storage access denial or Auth absence',()=>{
 for(const error of [{status:503,statusCode:'404'},{status:500,statusCode:'NoSuchKey'},{status:400,statusCode:'InvalidRequest'},{status:404,statusCode:'TenantNotFound'},{status:0},new Error('timeout'),null])assert.equal(storageFailureIsDenied(error),false);
 for(const error of [{status:400,statusCode:'404'},{status:403,statusCode:'AccessDenied'},{status:404,statusCode:'NoSuchKey'}])assert.equal(storageFailureIsDenied(error),true);
 assert.equal(authLookupProvesAbsent({data:{user:null},error:{status:404,code:'user_not_found'}}),true);
 for(const error of [{status:503,code:'user_not_found'},{status:404,code:'unknown'},{status:0,code:'timeout'},null])assert.equal(authLookupProvesAbsent({data:{user:null},error}),false);
});

function simulatedProvider(fault){
 const users=new Map(),files=new Map(),deleted=new Set();let revoked=false,ownerId;
 const clientFactory=(url,key,options)=>{
  const isAdmin=key==='private-fixture';let identity;
  const query={select(){return this;},eq(_column,id){this.id=id;return this;},async single(){return{data:{id:this.id,account_type:'personal',deactivated_at:null,push_token:null},error:null};},async maybeSingle(){return{data:users.has(this.id)?{id:this.id}:null,error:null};}};
  return{
   from(){return Object.create(query);},
   auth:{admin:{
    async createUser(input){const user={id:input.id,email:input.email,app_metadata:input.app_metadata,is_anonymous:false};users.set(user.id,user);if(input.email.includes('-owner@'))ownerId=user.id;return{data:{user},error:null};},
    async getUserById(id){if(fault==='auth_readback_503'&&deleted.has(id))return{data:{user:null},error:{status:503,code:'unexpected_failure'}};return users.has(id)?{data:{user:users.get(id)},error:null}:{data:{user:null},error:{status:404,code:'user_not_found'}};},
    async deleteUser(id){users.delete(id);deleted.add(id);return{data:{user:null},error:null};},
   },
   async signInWithPassword({email}){identity=[...users.values()].find(user=>user.email===email);return{data:{user:identity,session:{access_token:identity.id}},error:null};},
   async getUser(){return{data:{user:identity},error:null};},async refreshSession(){return{data:{user:identity,session:{access_token:identity.id}},error:null};},
   async signOut(){revoked=true;return{error:null};}},
   storage:{from(){return{
    async upload(path,bytes){files.set(path,Buffer.from(bytes));return{data:{path},error:null};},
    async download(){return{data:null,error:fault==='other_read_503'?{status:503,statusCode:'503'}:{status:400,statusCode:'403'}};},
    async remove(paths){if(fault!=='storage_remove_noop')for(const path of paths)files.delete(path);return{data:[],error:null};},
    async list(prefix,{search}){if(fault==='storage_readback_503')return{data:null,error:{status:503}};return{data:[...files.keys()].filter(path=>path===`${prefix}/${search}`).map(()=>({name:search})),error:null};},
   };}},
   async rpc(){return fault==='stale_rpc_503'?{data:null,status:503,error:{code:'PGRST000'}}:{data:null,status:403,error:{code:'42501'}};},
  };
 };
 const fetcher=async(input,init)=>{
  const url=new URL(input);
  if(url.pathname.includes('/storage/v1/object/public/'))return Response.json(fault==='public_read_503'?{code:'InternalError'}:{code:'NoSuchKey',statusCode:'404'},{status:fault==='public_read_503'?503:400});
  if(url.pathname.endsWith('/content-media-sign')){
   const file=[...files.keys()][0],isOwner=init.headers.Authorization===`Bearer ${ownerId}`;
   return Response.json({urls:isOwner?[{key:`post-media/${file}`,url:`${QA_ORIGIN}/functions/v1/media-content/post-media/${file}?token=${'a'.repeat(64)}`}]:[],expiresAt:Date.now()+300000});
  }
  if(url.pathname.includes('/media-content/'))return revoked?Response.json({error:'unavailable'},{status:403}):new Response([...files.values()][0],{status:200,headers:{'Cache-Control':'private, no-store, max-age=0'}});
  throw new Error('unexpected fixture request');
 };
 return{clientFactory,fetcher,users,files,deleted};
}
test('complete synthetic harness proves all seven assertions and exact cleanup on normal provider responses',async()=>{
 const provider=simulatedProvider();const receipt=await runAcceptance({env,expectedSource:sha,...provider});assert.equal(receipt.allChecksPassed,true,JSON.stringify(receipt));assert.equal(receipt.checks.length,7);assert.equal(provider.users.size,0);assert.equal(provider.files.size,0);
});
for(const fault of ['public_read_503','other_read_503','stale_rpc_503','storage_remove_noop','storage_readback_503','auth_readback_503'])test(`failure injection ${fault} cannot produce an accepted receipt`,async()=>{
 const provider=simulatedProvider(fault);const receipt=await runAcceptance({env,expectedSource:sha,...provider});assert.equal(receipt.allChecksPassed,false);assert.ok(receipt.failure||receipt.cleanup.some(row=>!row.passed));
 if(fault.startsWith('storage_'))assert.ok(receipt.cleanup.some(row=>row.kind==='auth'&&row.label==='owner'&&row.code==='QA_FIXTURE_FILES_NOT_CONFIRMED_ERASED'));
});
