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
  let receipt;const exit=await runJob({async drain(){return{state,job_id:'private-id',source_path:'private-path',error:'private-error',assets:4,bytes:100};}},{report:value=>receipt=value});
  assert.equal(exit,expected);assert.deepEqual(receipt,{event:'media_rendition_job',state,assets:4,bytes:100});
 }
});
test('job cancellation reaches the same durable worker without another lease or process',async()=>{
 const controller=new AbortController();let calls=0;
 const running=runJob({drain(signal){calls++;return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({state:'retry'}),{once:true}));}},{signal:controller.signal});
 controller.abort();assert.equal(await running,1);assert.equal(calls,1);
});
