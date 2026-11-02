import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {Sandbox} from '@vercel/sandbox';
import {RUNTIME_PIN,createRuntimePin} from '../runtime-pin.mjs';

const at=Date.parse('2026-11-02T18:00:00Z');
const secret='fixture-cron-secret-'.repeat(3);
const env={VERCEL_ENV:'preview',MEDIA_SANDBOX_RUNTIME_PIN_ENABLED:'true',CRON_SECRET:secret};
const jwt=claims=>Buffer.from('{"alg":"RS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.fixture_signature';
const token=jwt({owner_id:RUNTIME_PIN.teamId,project_id:RUNTIME_PIN.projectId,environment:'preview',exp:at/1000+7200});
const input={method:'POST',authorization:'Bearer '+secret,oidcToken:token};
const sessionId='sbx_runtime_pin_fixture_123';
const snapshotId='snap_runtime_pin_fixture_456';
// The actual SDK refresh helper sees a harmless synthetic token, so these
// transport tests cannot trigger local credential lookup or provider traffic.
const oldToken=process.env.VERCEL_OIDC_TOKEN;
process.env.VERCEL_OIDC_TOKEN=jwt({owner_id:RUNTIME_PIN.teamId,project_id:RUNTIME_PIN.projectId,environment:'preview',exp:4102444800});
after(()=>{if(oldToken===undefined)delete process.env.VERCEL_OIDC_TOKEN;else process.env.VERCEL_OIDC_TOKEN=oldToken;});
const session=(status='running')=>({id:sessionId,memory:4096,vcpus:2,region:'pdx1',timeout:120000,status,requestedAt:at,createdAt:at,updatedAt:at,cwd:'/vercel/sandbox',sourceSnapshotId:RUNTIME_PIN.sourceSnapshotId});
const sandbox={name:RUNTIME_PIN.name,persistent:false,region:'pdx1',createdAt:at,updatedAt:at,currentSessionId:sessionId,status:'running'};
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

function harness({environment=env,clock=()=>at,createStatus=200,snapshotStatus=200,expiresAt,stopStatus='stopped',failNetwork=false,wrongSource=false}={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  const path=new URL(url).pathname;
  calls.push({path,method:options.method,headers:options.headers,body:options.body?JSON.parse(options.body):undefined});
  if(path==='/api/v3/sandboxes'){
   if(failNetwork)throw Error('provider raw diagnostic and secret must never be returned');
   if(createStatus!==200)return new Response('provider diagnostic',{status:createStatus});
   return json({sandbox,session:{...session(),...(wrongSource?{sourceSnapshotId:'snap_wrong_12345'}:{})},routes:[]});
  }
  if(path.endsWith('/snapshot')){
   if(snapshotStatus!==200)return new Response('provider diagnostic',{status:snapshotStatus});
   return json({session:session('stopped'),snapshot:{id:snapshotId,sourceSessionId:sessionId,region:'pdx1',status:'created',sizeBytes:484406502,createdAt:at,updatedAt:at,...(expiresAt===undefined?{}:{expiresAt})}});
  }
  if(path.endsWith('/stop'))return json({session:session(stopStatus),sandbox:{...sandbox,status:stopStatus}});
  throw Error('unexpected API call '+path);
 };
 return{calls,pin:createRuntimePin({Sandbox,env:environment,now:clock,fetchImpl})};
}

test('preview gate, fixed cutoff, POST and CRON authentication all precede provider access',async()=>{
 for(const [environment,request,clock,status] of [
  [{...env,VERCEL_ENV:'production'},input,()=>at,404],
  [{...env,MEDIA_SANDBOX_RUNTIME_PIN_ENABLED:'false'},input,()=>at,404],
  [env,input,()=>RUNTIME_PIN.cutoffMs,404],
  [env,{...input,method:'GET'},()=>at,405],
  [env,{...input,authorization:'Bearer wrong'},()=>at,401],
  [{...env,CRON_SECRET:'short'},input,()=>at,401],
 ]){
  const h=harness({environment,clock});assert.equal((await h.pin(request)).status,status);assert.equal(h.calls.length,0);
 }
});
test('provider scope and valid lifetime are required without disclosing the OIDC token',async()=>{
 for(const oidcToken of [undefined,'malformed',jwt({owner_id:RUNTIME_PIN.teamId,project_id:'prj_other',environment:'preview',exp:at/1000+7200}),jwt({owner_id:RUNTIME_PIN.teamId,project_id:RUNTIME_PIN.projectId,environment:'production',exp:at/1000+7200}),jwt({owner_id:RUNTIME_PIN.teamId,project_id:RUNTIME_PIN.projectId,environment:'preview',exp:at/1000+120})]){
  const h=harness();assert.deepEqual(await h.pin({...input,oidcToken}),{status:503,body:{error:'oidc_unavailable'}});assert.equal(h.calls.length,0);
 }
});
test('actual SDK sends exactly one clean fixed create and session snapshot with numeric zero expiry',async()=>{
 const h=harness(),result=await h.pin(input);
 assert.deepEqual(result,{status:200,body:{state:'pinned',snapshot_id:snapshotId,expires_at:null,size_bytes:484406502}});
 assert.equal(h.calls.length,2);
 const create=h.calls[0];assert.equal(create.path,'/api/v3/sandboxes');
 assert.equal(create.body.name,RUNTIME_PIN.name);assert.equal(create.body.projectId,RUNTIME_PIN.projectId);
 assert.deepEqual(create.body.source,{type:'snapshot',snapshotId:RUNTIME_PIN.sourceSnapshotId});
 assert.equal(create.body.persistent,false);assert.deepEqual(create.body.ports,[]);assert.deepEqual(create.body.networkPolicy,{mode:'deny-all'});
 assert.equal(create.body.timeout,120000);assert.deepEqual(create.body.resources,{vcpus:2});assert.equal(create.body.region,'pdx1');
 assert.equal(create.body.env,undefined);assert.equal(create.body.mounts,undefined);
 assert.equal(h.calls[1].path,`/api/v2/sandboxes/sessions/${sessionId}/snapshot`);assert.deepEqual(h.calls[1].body,{expiration:0});
 for(const call of h.calls){assert.equal(call.headers.get('authorization'),'Bearer '+token);assert.equal(JSON.stringify(call.body).includes(token),false);}
 assert.equal(JSON.stringify(result).includes(token),false);assert.equal(JSON.stringify(result).includes(secret),false);
});
test('one concurrent attempt per handler and fixed name across fresh handlers provide no resume path',async()=>{
 const h=harness();const results=await Promise.all([h.pin(input),h.pin(input)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(h.calls.filter(c=>c.path==='/api/v3/sandboxes').length,1);
 const second=harness({createStatus:409});assert.equal((await second.pin(input)).status,503);assert.equal(second.calls.length,1);
 assert.equal(second.calls[0].body.name,RUNTIME_PIN.name);assert.ok(second.calls.every(c=>c.method==='POST'&&!c.path.includes('/resume')));
});
test('actual SDK never retries failed or ambiguous create POSTs, including network and 429/5xx',async()=>{
 for(const failure of [{createStatus:429},{createStatus:503},{failNetwork:true}]){
  const h=harness(failure);const result=await h.pin(input);
  assert.deepEqual(result,{status:503,body:{error:'runtime_pin_unavailable'}});assert.equal(h.calls.length,1);
  assert.equal((await h.pin(input)).status,409);assert.equal(h.calls.length,1);
 }
});
test('failed snapshot has no retry and stops only its exact captured session',async()=>{
 const h=harness({snapshotStatus:503});assert.equal((await h.pin(input)).status,503);
 assert.deepEqual(h.calls.map(c=>c.path),['/api/v3/sandboxes',`/api/v2/sandboxes/sessions/${sessionId}/snapshot`,`/api/v2/sandboxes/sessions/${sessionId}/stop`]);
});
test('expiring snapshot never reports success and no second snapshot is attempted',async()=>{
 const h=harness({expiresAt:at+2592000000});assert.deepEqual(await h.pin(input),{status:503,body:{error:'runtime_pin_unavailable'}});
 assert.equal(h.calls.length,2);assert.equal((await h.pin(input)).status,409);
});
test('unexpected clone identity is stopped before snapshot; ambiguous stop fails closed',async()=>{
 const h=harness({wrongSource:true,stopStatus:'stopping'});assert.deepEqual(await h.pin(input),{status:503,body:{error:'runtime_pin_cleanup_unconfirmed'}});
 assert.deepEqual(h.calls.map(c=>c.path),['/api/v3/sandboxes',`/api/v2/sandboxes/sessions/${sessionId}/stop`]);
});
