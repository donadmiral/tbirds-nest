import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workerConfig,serviceConfig} from '../config.mjs';
import {runJob} from '../run-job.mjs';
const env={SUPABASE_URL:'https://owned.supabase.co',MEDIA_BROKER_URL:'https://owned.supabase.co/functions/v1/media-broker',MEDIA_BROKER_KEY:'40000000-0000-4000-8000-000000000001.'+'a'.repeat(64)};
test('non-HTTP jobs require backend credentials while HTTP workers additionally require cron authentication',()=>{
 assert.equal(workerConfig(env).maxInputBytes,536870912);
 assert.throws(()=>serviceConfig(env),/credentials/);
 assert.throws(()=>workerConfig({SUPABASE_URL:env.SUPABASE_URL}),/credentials/);
 assert.equal(serviceConfig({...env,CRON_SECRET:'b'.repeat(32)}).cronSecret,'b'.repeat(32));
 assert.equal(workerConfig({...env,MEDIA_WORKER_DEADLINE_MS:'999999999'}).deadlineMs,720000);
});
test('external scheduler observes transient failure without reclassifying durable dead letters or logging private job details',async()=>{
 for(const [state,expected]of[['ready',0],['idle',0],['failed',0],['retry',1],['unavailable',1]]){
  let receipt;const exit=await runJob({async drain(){return{state,job_id:'private-id',source_path:'private-path',error:'private-error',assets:4,bytes:100};}},{maxJobs:1,report:value=>receipt=value});
  assert.equal(exit,expected);assert.deepEqual(receipt,{event:'media_rendition_job',state,reason:['ready','failed'].includes(state)?'max_jobs':state==='idle'?'queue_empty':state,attempted:1,ready:state==='ready'?1:0,failed:state==='failed'?1:0,assets:state==='ready'?4:0,bytes:state==='ready'?100:0});
 }
});
test('one reservation drains at most eight jobs sequentially and preserves aggregate counts',async()=>{
 let calls=0,active=0,peak=0,receipt;
 const exit=await runJob({async drain(){calls++;peak=Math.max(peak,++active);await Promise.resolve();active--;return{state:'ready',assets:3,bytes:12};}},{report:value=>receipt=value});
 assert.equal(exit,0);assert.equal(calls,8);assert.equal(peak,1);
 assert.deepEqual(receipt,{event:'media_rendition_job',state:'ready',reason:'max_jobs',attempted:8,ready:8,failed:0,assets:24,bytes:96});
});
test('batch stops on empty, busy and transient queues without immediate retries',async()=>{
 for(const terminal of ['idle','busy','retry','unavailable']){
  let calls=0,receipt;const states=['ready','failed',terminal,'ready'];
  const exit=await runJob({async drain(){return{state:states[calls++],assets:2,bytes:8};}},{report:value=>receipt=value});
  assert.equal(calls,3);assert.equal(exit,['retry','unavailable'].includes(terminal)?1:0);
  assert.equal(receipt.ready,1);assert.equal(receipt.failed,1);assert.equal(receipt.assets,2);assert.equal(receipt.bytes,8);
 }
});
test('one shared deadline protects later jobs and avoids fresh leases near expiry',async()=>{
 let at=0,calls=0,receipt;
 await runJob({async drain(){calls++;at=700000;return{state:'ready'};}},{now:()=>at,report:value=>receipt=value});
 assert.equal(calls,1);assert.equal(receipt.reason,'deadline_guard');
 let secondSignal;
 const exit=await runJob({async drain(signal){secondSignal=signal;return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({state:'retry'}),{once:true}));}},{deadlineMs:20});
 assert.equal(exit,1);assert.equal(secondSignal.aborted,true);
});
test('pre-cancelled or invalid batches cannot acquire a lease',async()=>{
 let calls=0;const worker={async drain(){calls++;return{state:'ready'};}};
 const controller=new AbortController();controller.abort();
 assert.equal(await runJob(worker,{signal:controller.signal}),1);
 for(const options of [{maxJobs:0},{maxJobs:9},{maxJobs:1.5},{deadlineMs:720001},{deadlineMs:Infinity}])await assert.rejects(runJob(worker,options),/invalid_batch_limits/);
 assert.equal(calls,0);
});
test('job cancellation reaches the same durable worker without another lease or process',async()=>{
 const controller=new AbortController();let calls=0;
 const running=runJob({drain(signal){calls++;return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({state:'retry'}),{once:true}));}},{signal:controller.signal});
 controller.abort();assert.equal(await running,1);assert.equal(calls,1);
});
