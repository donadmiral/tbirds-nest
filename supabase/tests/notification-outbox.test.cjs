const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
const {webcrypto}=require('node:crypto');
function load(relative,deps={}){
 const module={exports:{}};
 const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../..',relative),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{module,exports:module.exports,Request,Response,AbortSignal,TextEncoder,TextDecoder,crypto:webcrypto,
  setTimeout,clearTimeout,Date,Promise,Set,Map,require(name){if(name in deps)return deps[name];throw Error('Unexpected dependency '+name);}});
 return module.exports;
}
const delivery=load('supabase/functions/_shared/pushDelivery.ts');
const compatible=load('supabase/functions/send-push-notification/compatibility.ts',{'../_shared/pushDelivery.ts':delivery});
const {createNotificationOutboxHandler,notificationDispatchOutcome}=load('supabase/functions/process-notification-outbox/handler.ts',{
 '../_shared/pushDelivery.ts':delivery,'../send-push-notification/compatibility.ts':compatible,
});
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const SERVICE='synthetic-notification-worker-service-credential';
const request=(auth=SERVICE)=>new Request('https://synthetic.invalid/worker',{method:'POST',headers:auth?{Authorization:'Bearer '+auth}:{},body:'{"record":{"id":"forged"}}'});
function harness(options={}){
 const calls=[],sent=[],acks=[];let count=0,now=1000;
 const service={from(){throw Error('Injected delivery should not query tables');},rpc(name,args){
  calls.push({name,args});
  let data,error=null;
  if(name==='drain_notification_fanout_v1')data={jobs:16,notifications:0};
  else if(name==='claim_notification_dispatch_v1')data=count<(options.jobs??1)?[{id:id(++count),notification_id:id(100+count),lease_id:id(200+count),attempts:1,lease_until:'2026-11-02T12:00:00Z'}]:[];
  else if(name==='complete_notification_dispatch_v1'){acks.push(args);data=options.ack!==false;}
  else throw Error('Unexpected RPC '+name);
  if(options.error===name)error=Error('Synthetic unavailable');
  return{abortSignal(){return Promise.resolve({data,error});}};
 }};
 const deliver=async req=>{
  sent.push({body:await req.json(),authorization:req.headers.get('Authorization')});
  now+=options.advanceMs??0;
  if(options.throw)throw Error('Synthetic provider private details must not be logged');
  return Response.json(options.body??{accepted:1,rejected:0,unknown:0},{status:options.status??200});
 };
 return{calls,sent,acks,handler:createNotificationOutboxHandler({service,serviceKey:SERVICE,fetch:()=>{throw Error('No real network');},
  deliver,now:()=>now,maxJobs:options.limit,authorizeLegacyService:options.authorize,authorizeWorker:options.worker})};
}
test('worker rejects public and ordinary callers before claiming or fanout',async()=>{
 for(const key of [null,'synthetic-anon','synthetic-user']){
  const h=harness();assert.equal((await h.handler(request(key))).status,401);assert.equal(h.calls.length,0);
 }
});
test('legacy service proof must be the boolean true',async()=>{
 for(const proof of [false,'true',[],null]){
  const h=harness({authorize:async()=>proof});assert.equal((await h.handler(request('legacy'))).status,401);assert.equal(h.calls.length,0);
 }
 const h=harness({authorize:async()=>true});assert.equal((await h.handler(request('legacy'))).status,200);
});
test('single-use worker proof must be true before any claim, and caller content cannot select jobs',async()=>{
 for(const proof of [false,'true',[],null]){
  const h=harness({worker:async()=>proof});assert.equal((await h.handler(request('pc_notify_synthetic'))).status,401);assert.equal(h.calls.length,0);
 }
 const h=harness({worker:async()=>true});assert.equal((await h.handler(request('pc_notify_synthetic'))).status,200);
 assert.deepEqual(h.sent[0].body,{record:{id:id(101)}});
});
test('worker delivers only the canonical leased ID through the compatible handler contract',async()=>{
 const h=harness();const response=await h.handler(request());assert.equal(response.status,200);
 assert.deepEqual(h.sent,[{body:{record:{id:id(101)}},authorization:'Bearer '+SERVICE}]);
 assert.equal(h.acks[0].p_id,id(1));assert.equal(h.acks[0].p_lease_id,id(201));assert.equal(h.acks[0].p_accepted,1);
 assert.equal((await response.json()).accepted,1);
});
test('success HTTP with missing or rejected provider receipts is never blindly acknowledged as delivery',async()=>{
 for(const [body,outcome,error]of [
  [{unexpected:true},'retry','INVALID_PROVIDER_RECEIPT'],
  [{accepted:0,rejected:1,unknown:0},'dead','PROVIDER_REJECTED'],
  [{accepted:0,rejected:0,unknown:1},'retry','PROVIDER_OUTCOME_UNKNOWN'],
 ]){
  const h=harness({body});await h.handler(request());assert.equal(h.acks[0].p_outcome,outcome);assert.equal(h.acks[0].p_error_code,error);
 }
});
test('partial provider acceptance retains unresolved outcomes without automatically duplicating successful devices',async()=>{
 const h=harness({status:502,body:{accepted:1,rejected:0,unknown:1}});await h.handler(request());
 assert.equal(h.acks[0].p_outcome,'dead');assert.equal(h.acks[0].p_error_code,'PARTIAL_PROVIDER_UNKNOWN');
 assert.equal(h.acks[0].p_accepted,1);assert.equal(h.acks[0].p_unknown,1);
});
test('current preference/no-device skips complete once and are not retried',async()=>{
 const h=harness({body:{skipped:'preference',category:'messages'}});await h.handler(request());
 assert.equal(h.acks[0].p_outcome,'skipped');assert.equal(h.acks[0].p_error_code,null);
});
test('provider interruption is persisted under the lease with a sanitized retry code',async()=>{
 const h=harness({throw:true});await h.handler(request());
 assert.equal(h.acks[0].p_outcome,'retry');assert.equal(h.acks[0].p_error_code,'DISPATCH_INTERRUPTED');
 assert.equal(h.acks[0].p_unknown,1);
});
test('uncommitted or stale receipt stops the batch and reports unavailable',async()=>{
 const h=harness({jobs:4,ack:false});assert.equal((await h.handler(request())).status,503);
 assert.equal(h.sent.length,1);assert.equal(h.acks.length,1);
});
test('worker claims serially and obeys both item and elapsed time bounds',async()=>{
 const h=harness({jobs:50,limit:3});await h.handler(request());assert.equal(h.sent.length,3);
 const timed=harness({jobs:50,limit:12,advanceMs:10000});await timed.handler(request());assert.equal(timed.sent.length,3);
 assert.ok(timed.calls.filter(c=>c.name==='claim_notification_dispatch_v1').every(c=>c.args.p_limit===1));
});
test('fanout or claim failure cannot consume or acknowledge a notification',async()=>{
 for(const error of ['drain_notification_fanout_v1','claim_notification_dispatch_v1']){
  const h=harness({error});assert.equal((await h.handler(request())).status,503);assert.equal(h.sent.length,0);assert.equal(h.acks.length,0);
 }
});
test('classification distinguishes permanent contract failures from transient failures',()=>{
 assert.equal(notificationDispatchOutcome(403,{error:'Denied'}).outcome,'dead');
 assert.equal(notificationDispatchOutcome(503,{error:'Unavailable'}).outcome,'retry');
 assert.equal(notificationDispatchOutcome(429,{error:'Rate limited'}).outcome,'retry');
});
