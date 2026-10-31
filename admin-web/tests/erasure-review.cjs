const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const actor='10000000-0000-4000-8000-000000000001',session='10000000-0000-4000-8000-000000000002',key='10000000-0000-4000-8000-000000000003',request='10000000-0000-4000-8000-000000000004',version='f'.repeat(32);
function load(svc,{permission=async p=>{assert.equal(p,'account_delete');return{id:actor,sessionId:session};},revalidate=()=>{}}={}){
 const cache=new Map();
 function source(file){if(cache.has(file))return cache.get(file);const m={exports:{}};cache.set(file,m.exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
   module:m,exports:m.exports,require(id){if(id==='server-only')return{};if(id==='./adminAuth')return{requirePermission:permission};if(id==='./supabaseAdmin')return{serviceClient:()=>svc};if(id==='./adminRpcAvailability')return source('lib/adminRpcAvailability.ts');if(id==='@/lib/adminErasureReview')return source('lib/adminErasureReview.ts');if(id==='next/cache')return{revalidatePath:revalidate};throw Error('Unexpected import '+id);},
  });cache.set(file,m.exports);return m.exports;
 }return source('app/users/deletions/actions.ts');
}
function form(change={}){const f=new FormData();for(const[k,v]of Object.entries({command_key:key,source:'admin',request_id:request,version,action:'resume',note:'Reviewed the request and its current eligibility.',confirm:'RESUME',...change}))if(v!==null)f.set(k,v);return f;}
const receipt=(change={})=>({success:true,command_key:key,source:'admin',request_id:request,version,state:'queued',outcome:'queued',hold_reason:null,...change});
test('actual server action sends only the verified actor/session and exact form identity',async()=>{
 let received,refreshed=[];const action=load({rpc:async(name,args)=>{received={name,args};return{data:receipt(),error:null}}},{revalidate:p=>refreshed.push(p)});
 const result=await action.reviewErasure(form());assert.equal(result.success,true);assert.match(result.message,/queued/);assert.doesNotMatch(result.message,/is complete/);
 assert.equal(received.name,'triniti_admin_erasure_review');assert.equal(received.args.p_actor_id,actor);assert.equal(received.args.p_session_id,session);assert.equal(received.args.p_version,version);assert.equal(received.args.p_confirm,'RESUME');assert.deepEqual(refreshed,['/users/deletions']);
});
test('missing permission stops the real action before any database request',async()=>{
 let calls=0;const action=load({rpc:async()=>{calls++}},{permission:async()=>{throw Error('Not permitted')}});
 await assert.rejects(action.reviewErasure(form()),/Not permitted/);assert.equal(calls,0);
});
test('invalid, duplicate, forged or unconfirmed form fields never reach the database',async()=>{
 let calls=0;const action=load({rpc:async()=>{calls++}});
 for(const fields of [{confirm:null},{command_key:'bad'},{version:'bad'},{source:'forged'},{request_id:'bad'},{action:'eraseNow'},{note:'short'},{actor_id:actor}])assert.equal((await action.reviewErasure(form(fields))).success,false);
 const dup=form();dup.append('request_id',request);assert.equal((await action.reviewErasure(dup)).success,false);assert.equal(calls,0);
});
test('note action does not silently request resume even when the checkbox is checked',async()=>{
 let args;const action=load({rpc:async(_,a)=>{args=a;return{data:receipt({state:'retention_review',outcome:'noted'}),error:null}}});
 const r=await action.reviewErasure(form({action:'note'}));assert.equal(r.success,true);assert.equal(args.p_confirm,null);assert.match(r.message,/state was not changed/);
});
test('every real retention outcome stays held and never claims completion',async()=>{
 for(const reason of ['financial_records','managed_account','ownership_review','application_review','storage_changed','worker_review']){
  const action=load({rpc:async()=>({data:receipt({outcome:'held',state:'retention_review',hold_reason:reason}),error:null})});
  const r=await action.reviewErasure(form());assert.equal(r.success,true);assert.match(r.message,/remains on hold/);assert.doesNotMatch(r.message,/complete\./);
 }
});
test('wrong-key, mismatched-target and contradictory responses never confirm an action',async()=>{
 for(const change of [{command_key:actor},{source:'self_service'},{request_id:actor},{version:null},{state:'completed'},{outcome:'completed'},{outcome:'held',state:'retention_review',hold_reason:'unknown'},{outcome:'noted'}]){
  let refreshes=0;const action=load({rpc:async()=>({data:receipt(change),error:null})},{revalidate:()=>refreshes++});
  assert.equal((await action.reviewErasure(form())).success,false);assert.equal(refreshes,0);
 }
});
test('stale and unavailable responses remain actionable without a false success',async()=>{
 for(const [message,expected]of [['ERASURE_REVIEW_STALE',/changed while/],['ERASURE_WORKER_UNAVAILABLE',/Restore worker health/],['ERASURE_WORKER_ACTIVE',/still processing/],['ERASURE_ACCOUNT_NOT_DISABLED',/not safely disabled/]]){
  let refreshes=0;const action=load({rpc:async()=>({data:null,error:{message}})},{revalidate:()=>refreshes++});
  const r=await action.reviewErasure(form());assert.equal(r.success,false);assert.match(r.error,expected);assert.equal(refreshes,0);
 }
});
test('missing endpoint is explicit but unrelated provider errors preserve uncertainty',async()=>{
 const missing=load({rpc:async()=>({data:null,error:{code:'PGRST202',message:'Could not find the function public.triniti_admin_erasure_review() in the schema cache'}})});
 assert.match((await missing.reviewErasure(form())).error,/unavailable on this deployment/);
 const network=load({rpc:async()=>({data:null,error:{code:'PGRST003',message:'connection unavailable'}})});
 assert.match((await network.reviewErasure(form())).error,/not confirmed/);
});
test('identity-stage resumption is described as pending and never as erased',async()=>{
 const action=load({rpc:async()=>({data:receipt({state:'identity_pending',outcome:'identity_pending'}),error:null})});
 const r=await action.reviewErasure(form());assert.equal(r.success,true);assert.match(r.message,/not complete/);
});
