const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const key='10000000-0000-4000-8000-000000000001';
const userId='10000000-0000-4000-8000-000000000002';
const sessionId='10000000-0000-4000-8000-000000000003';
const provisionId='10000000-0000-4000-8000-000000000004';
function load(name,svc,auth={requirePermission:async()=>({id:userId,sessionId})}) {
  const module={exports:{}};
  const source=fs.readFileSync(path.join(__dirname,'../lib/',name+'.ts'),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    module,exports:module.exports,Buffer,process:{env:{SUPABASE_SERVICE_ROLE_KEY:'synthetic-test-secret'}},
    require(id){if(id==='server-only')return {};if(id==='node:crypto')return crypto;if(id==='./adminAuth')return auth;if(id==='./supabaseAdmin')return {serviceClient:()=>svc};if(id==='./adminRpcAvailability')return load('adminRpcAvailability');throw new Error('Unexpected import '+id);},
  });return module.exports;
}
function form(fields={}){const f=new FormData();for(const [k,v] of Object.entries({command_key:key,...fields}))f.set(k,v);return f;}
test('commands send the verified native session and preserve replay key',async()=>{
  let received;
  const {runAdminCommand}=load('adminCommand',{rpc:async(name,args)=>{received={name,args};return {data:{success:true,command_key:key},error:null};}});
  assert.equal((await runAdminCommand('suspendUser','user_moderate',form({id:userId,reason:'spam'}))).success,true);
  assert.equal(received.name,'triniti_platinum_admin_command');assert.equal(received.args.p_session_id,sessionId);assert.equal(received.args.p_actor_id,userId);assert.equal(received.args.p_key,key);
  assert.deepEqual(JSON.parse(JSON.stringify(received.args.p_payload)),{id:userId,reason:'spam'});
});
test('expected command failures survive the production server action boundary as data',async()=>{
 const {runAdminCommand}=load('adminCommand',{rpc:async()=>({data:null,error:{message:'LAST_SUPER_ADMIN'}})});
 const result=await runAdminCommand('deactivateStaff','staff_manage',form({uid:userId}));
 assert.equal(result.success,false);assert.match(result.error,/at least one active super/);
});
test('an explicitly missing command endpoint returns unavailable without encouraging a retry',async()=>{
 for(const error of [
  {code:'PGRST202',message:'Could not find the function public.triniti_platinum_admin_command(p_actor_id, p_key) in the schema cache'},
  {code:'42883',message:'function public.triniti_platinum_admin_command(uuid, uuid) does not exist'},
 ]){
  let calls=0;
  const {runAdminCommand}=load('adminCommand',{rpc:async()=>{calls++;return {data:null,error};}});
  const result=await runAdminCommand('suspendUser','user_moderate',form({id:userId,reason:'spam'}));
  assert.equal(result.success,false);assert.match(result.error,/unavailable on this deployment/);assert.match(result.error,/No change was made/);assert.doesNotMatch(result.error,/retry/i);assert.equal(calls,1);
 }
});
test('network, permission and missing dependency errors are not mistaken for an absent command endpoint',async()=>{
 for(const error of [
  {code:'PGRST003',message:'Timed out waiting for a pool connection'},
  {code:'42501',message:'permission denied for function triniti_platinum_admin_command'},
  {code:'42883',message:'function private_dependency(uuid) does not exist'},
  {code:'PGRST202',message:'Could not find the function public.other_command() in the schema cache'},
 ]){
  const {runAdminCommand}=load('adminCommand',{rpc:async()=>({data:null,error})});
  const result=await runAdminCommand('suspendUser','user_moderate',form({id:userId,reason:'spam'}));
  assert.equal(result.success,false);assert.doesNotMatch(result.error,/unavailable on this deployment|No change was made/);
 }
 const network=new Error('connection reset');
 const {runAdminCommand}=load('adminCommand',{rpc:async()=>{throw network;}});
 await assert.rejects(runAdminCommand('suspendUser','user_moderate',form({id:userId,reason:'spam'})),error=>error===network);
});
test('unconfirmed or wrong-key command responses never report success',async()=>{
 for(const data of [null,{success:false},{success:true,command_key:crypto.randomUUID()}]){
  const {runAdminCommand}=load('adminCommand',{rpc:async()=>({data,error:null})});
  assert.equal((await runAdminCommand('suspendUser','user_moderate',form({id:userId,reason:'spam'}))).success,false);
 }
});
test('missing permission and malformed form are stopped before database calls',async()=>{
 let calls=0;const svc={rpc:async()=>{calls++;}};
 const denied=load('adminCommand',svc,{requirePermission:async()=>{throw new Error('Denied');}});
 await assert.rejects(denied.runAdminCommand('suspendUser','user_moderate',form()),/Denied/);
 const allowed=load('adminCommand',svc);const duplicate=form({id:userId});duplicate.append('id',userId);
 await assert.rejects(allowed.runAdminCommand('suspendUser','user_moderate',duplicate),/Invalid form/);assert.equal(calls,0);
});
function provisionMock({mismatch=false,createRace=false,finishError=false}={}){
 let created=false;const calls=[];
 const user={id:userId,email:'staff@example.test',app_metadata:{triniti_provision_id:mismatch?'wrong':provisionId}};
 return {calls,svc:{
  rpc:async(name,args)=>{calls.push({name,args});return args.p_phase==='reserve'?{data:{success:true,auth_user_id:userId,email:user.email,provision_id:provisionId},error:null}:{data:{success:true,complete:!finishError},error:finishError?{message:'failure'}:null};},
  auth:{admin:{getUserById:async()=>mismatch||created?{data:{user},error:null}:{data:{user:null},error:{status:404}},createUser:async(args)=>{calls.push({create:args});created=true;return createRace?{data:{user:null},error:{status:422}}:{data:{user},error:null};}}}
 }};
}
test('provisioning transmits only a keyed password digest to SQL and finishes the reserved identity',async()=>{
 const mock=provisionMock(),{provisionAccount}=load('adminProvision',mock.svc);
 const result=await provisionAccount('staff',form({email:'Staff@Example.Test',role:'support_agent',password:'unique-test-password'}));
 assert.equal(result.success,true);const reserve=mock.calls[0].args;
 assert.equal(reserve.p_payload.email,'staff@example.test');assert.equal(reserve.p_payload.password,undefined);assert.match(reserve.p_payload.password_digest,/^[a-f0-9]{64}$/);
 assert.equal(mock.calls.find(c=>c.create).create.id,userId);assert.equal(mock.calls.at(-1).args.p_phase,'finish');
});
test('provisioning refuses a mismatched existing identity without changing staff privileges',async()=>{
 const mock=provisionMock({mismatch:true}),{provisionAccount}=load('adminProvision',mock.svc);
 assert.equal((await provisionAccount('staff',form({email:'staff@example.test',role:'support_agent',password:'unique-test-password'}))).success,false);
 assert.equal(mock.calls.length,1);
});
test('provisioning recovers a concurrent creation only when reservation metadata matches',async()=>{
 const mock=provisionMock({createRace:true}),{provisionAccount}=load('adminProvision',mock.svc);
 assert.equal((await provisionAccount('staff',form({email:'staff@example.test',role:'support_agent',password:'unique-test-password'}))).success,true);
 assert.equal(mock.calls.at(-1).args.p_phase,'finish');
});
test('incomplete setup and password truncation are explicit errors',async()=>{
 const mock=provisionMock({finishError:true}),{provisionAccount}=load('adminProvision',mock.svc);
 assert.equal((await provisionAccount('staff',form({email:'staff@example.test',role:'support_agent',password:'unique-test-password'}))).success,false);
 const previous=mock.calls.length;
 assert.equal((await provisionAccount('staff',form({email:'staff@example.test',role:'support_agent',password:'é'.repeat(40)}))).success,false);
 assert.equal(mock.calls.length,previous);
});

test('missing provisioning reports unavailable before any account identity is created', async () => {
 for (const error of [
  {code:'PGRST202',message:'Could not find the function public.triniti_admin_provision(p_actor_id, p_phase) in the schema cache'},
  {code:'42883',message:'function public.triniti_admin_provision(uuid, text) does not exist'},
 ]) {
  const calls=[];
  const {provisionAccount}=load('adminProvision', {rpc:async(name,args)=>{calls.push({name,args});return {data:null,error};},auth:{admin:{createUser(){throw new Error('must not create an account');},getUserById(){throw new Error('must not read an account');}}}});
  const result=await provisionAccount('staff',form({email:'staff@example.test',role:'support_agent',password:'unique-test-password'}));
  assert.equal(result.success,false);assert.match(result.error,/unavailable on this deployment/);assert.match(result.error,/No account was created/);assert.doesNotMatch(result.error,/retry/i);assert.equal(calls.length,1);
 }
});
test('a provisioning endpoint lost after reservation preserves the partial-setup warning', async () => {
 const mock=provisionMock();const rpc=mock.svc.rpc;
 mock.svc.rpc=async(name,args)=>{const result=await rpc(name,args);return args.p_phase==='finish'?{data:null,error:{code:'PGRST202',message:'Could not find the function public.triniti_admin_provision() in the schema cache'}}:result;};
 const {provisionAccount}=load('adminProvision',mock.svc);
 const result=await provisionAccount('staff',form({email:'staff@example.test',role:'support_agent',password:'unique-test-password'}));
 assert.equal(result.success,false);assert.match(result.error,/reserved account identity may already exist/);assert.doesNotMatch(result.error,/No account was created/);assert.equal(mock.calls.filter(c=>c.create).length,1);
});
test('provisioning permission and dependency errors retain uncertainty instead of claiming endpoint absence', async () => {
 for (const error of [{code:'42501',message:'permission denied'},{code:'42883',message:'function private_dependency(uuid) does not exist'},{code:'PGRST003',message:'Pool timeout'}]) {
  const {provisionAccount}=load('adminProvision',{rpc:async()=>({data:null,error})});
  const result=await provisionAccount('staff',form({email:'staff@example.test',role:'support_agent',password:'unique-test-password'}));
  assert.equal(result.success,false);assert.doesNotMatch(result.error,/unavailable on this deployment|No account was created/);
 }
});
