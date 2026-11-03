import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadConfig,requireTaskRole,TASK_LIFETIME_MS} from '../config.mjs';
import {jobPlan,validateJob,boundedResponse,WorkerFailure,safeFailure} from '../protocol.mjs';
import {transcriptionBackend} from '../backend.mjs';
import {env,config,job,json,failure} from './fixtures.mjs';

test('configuration fixes region/project/role and caps local or absolute task lifetime',()=>{
 const now=1760000000000;assert.equal(loadConfig(env,now).taskDeadline,now+TASK_LIFETIME_MS);
 assert.equal(loadConfig({...env,LIVE_TRANSCRIPTION_TASK_DEADLINE_MS:String(now-1)},now).taskDeadline,now-1);
 assert.equal(loadConfig({...env,LIVE_TRANSCRIPTION_TASK_DEADLINE_MS:String(now+1000)},now).taskDeadline,now+1000);
 assert.equal(loadConfig({...env,LIVE_TRANSCRIPTION_EXECUTION_ENABLED:undefined},now).enabled,false);
 for(const extra of [{SUPABASE_URL:'https://other.supabase.co'},{SUPABASE_URL:env.SUPABASE_URL+'/foreign'},{AWS_REGION:'us-east-1'},
 {AWS_ACCOUNT_ID:'bad'},{LIVE_TRANSCRIPTION_BUCKET:'../escape'},{LIVE_TRANSCRIPTION_DATA_ROLE_ARN:'arn:aws:iam::999999999999:role/Other'},
 {LIVE_TRANSCRIPTION_WORKER_SECRET:'short'},{LIVE_TRANSCRIPTION_TASK_DEADLINE_MS:String(now+240001)},{LIVE_TRANSCRIPTION_TASK_DEADLINE_MS:'Infinity'}])assert.throws(()=>loadConfig({...env,...extra},now),failure('CONFIGURATION_INVALID'));
});
test('production AWS credential provider accepts only ECS relative task credentials',()=>{
 const task={AWS_CONTAINER_CREDENTIALS_RELATIVE_URI:'/v2/credentials/11111111-1111-4111-8111-111111111111'};assert.doesNotThrow(()=>requireTaskRole(task));
 for(const key of ['AWS_CONTAINER_CREDENTIALS_FULL_URI','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_PROFILE','AWS_SHARED_CREDENTIALS_FILE','AWS_WEB_IDENTITY_TOKEN_FILE','AWS_ENDPOINT_URL_S3'])assert.throws(()=>requireTaskRole({...task,[key]:'forbidden'}),failure('CONFIGURATION_INVALID'));
 assert.throws(()=>requireTaskRole({AWS_CONTAINER_CREDENTIALS_RELATIVE_URI:'https://attacker.invalid/'}),failure('CONFIGURATION_INVALID'));
});
test('deterministic job fingerprint binds source, format, duration and fixed output without subtitle files',()=>{
 const original=jobPlan(job(),config());assert.equal(original.input,'transcription/'+job().id+'/source.flac');assert.equal(original.output,'transcription/'+job().id+'/result.json');
 assert.equal(original.request.Subtitles,undefined);assert.deepEqual(original.request.JobExecutionSettings,{AllowDeferredExecution:false,DataAccessRoleArn:env.LIVE_TRANSCRIPTION_DATA_ROLE_ARN});
 assert.deepEqual(jobPlan(job({configuration_hash:original.fingerprint}),config()),original);
 assert.throws(()=>jobPlan(job({configuration_hash:original.fingerprint,duration_ms:31000}),config()),failure('AWS_CONFIGURATION_CONFLICT'));
 for(const extra of [{id:'../escape'},{job_name:'different'},{duration_ms:600001},{language:'unknown'},{cleanup:'true'}])assert.throws(()=>validateJob(job(extra)),failure('JOB_INVALID'));
});
test('broker secret is sent only to fixed project endpoint; cleanup uses fixed lease contract',async()=>{
 const calls=[];const api=transcriptionBackend(config(),{fetcher:async(url,init)=>{calls.push({url,init,body:JSON.parse(init.body)});return json({data:{ok:true}});}});
 await api.defer(job({cleanup:true}));await api.settle(job({cleanup:true}),'NOT_FOUND');
 assert.deepEqual(calls.map(x=>x.body.action),['cleanup_defer','settle']);
 for(const c of calls){assert.equal(c.url,env.SUPABASE_URL+'/functions/v1/live-transcription-worker');assert.equal(c.init.redirect,'error');assert.equal(c.init.credentials,'omit');assert.equal(c.init.headers.Authorization,'Bearer '+env.LIVE_TRANSCRIPTION_WORKER_SECRET);assert.equal(c.body.lease_id,job().lease_id);}
});
test('source grants bind exact project, rendered clip path, format and short expiry',async()=>{
 const item=job(),path=`/storage/v1/object/sign/live-clips/${item.id}/${item.lease_id}/${item.clip_id}/${item.id}/horizontal.mp4`;
 const good={url:env.SUPABASE_URL+path+'?token=synthetic-private-grant',job_name:item.job_name,duration_ms:item.duration_ms,language:item.language,expires_in:120};
 const source=async(value)=>transcriptionBackend(config(),{fetcher:async()=>json({data:value})}).source(item);
 assert.equal(await source(good),good.url);
 for(const extra of [{url:'https://attacker.invalid'+path+'?token=x'},{url:env.SUPABASE_URL+path.replace(item.clip_id,item.id)+'?token=x'},{url:good.url+'#fragment'},{url:good.url.replace('horizontal.mp4','vertical.mp4')},{expires_in:121},{job_name:'other'}])await assert.rejects(source({...good,...extra}),failure('SOURCE_GRANT_INVALID'));
});
test('broker rejects oversized, malformed and revoked responses without echoing bodies',async()=>{
 const api=value=>transcriptionBackend(config(),{fetcher:async()=>value});
 await assert.rejects(api(new Response('x'.repeat(65537))).claim(),failure('MEDIA_TOO_LARGE'));
 await assert.rejects(api(json({data:{items:[job(),job()]}})).claim(),failure('BROKER_RESPONSE_INVALID'));
 await assert.rejects(api(new Response('{"error":"CLIP_CHANGED","token":"DO_NOT_ECHO"}',{status:409})).check(job()),error=>error.code==='CLIP_CHANGED'&&!error.message.includes('DO_NOT_ECHO'));
 await assert.rejects(api(json({data:{error:'DAILY_BUDGET'}})).submit(job(),'a'.repeat(64)),failure('DAILY_LIMIT'));
 await assert.rejects(boundedResponse(new Response('12345'),4,AbortSignal.timeout(1000)),failure('MEDIA_TOO_LARGE'));
 assert.equal(safeFailure(new Error('private URL and secret')).message,'AWS_UNAVAILABLE');assert.equal(safeFailure(new WorkerFailure('not-allowed')).code,'AWS_UNAVAILABLE');
});
