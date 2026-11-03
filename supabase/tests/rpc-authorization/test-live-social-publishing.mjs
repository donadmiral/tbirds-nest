import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {loadDeployedMediaBaseline,source} from './deployed-media-baseline.mjs';
const db=new PGlite({extensions}),actors={host:randomUUID(),viewer:randomUUID()},sessions={host:randomUUID(),viewer:randomUUID()};
const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
async function as(role,name,sql,args=[]){
 await db.exec('savepoint request');try{await db.exec(`set local role ${role}`);const claims={sub:actors[name]||null,role,session_id:sessions[name]||null,is_anonymous:false};
 await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[claims.sub||'',role,JSON.stringify(claims)]);
 const result=await value(sql,args);await db.exec('reset role;release savepoint request');return result;
 }catch(error){await db.exec('rollback to savepoint request;release savepoint request');throw error;}
}
const service=(sql,args=[])=>as('service_role',null,sql,args);
const oauth=(action,data={},name='host',authSid=sessions[name])=>service('select public.live_oauth_operation($1,$2,$3,$4)',[actors[name],authSid,action,JSON.stringify(data)]);
const command=(name,session,clip,action,payload={},request=randomUUID())=>as('authenticated',name,'select public.live_clip_command($1,$2,$3,$4,$5)',[session,clip,action,JSON.stringify(payload),request]);
const transcriptCommand=(name,clip,action,payload={},request=randomUUID())=>as('authenticated',name,'select public.live_transcription_command($1,$2,$3,$4)',[clip,action,JSON.stringify(payload),request]);
const worker=(action,id=null,lease=null,payload={})=>service('select public.live_transcription_worker($1,$2,$3,$4)',[action,id,lease,JSON.stringify(payload)]);
const state=()=>({id:randomUUID(),platform:'x',state_hash:'a'.repeat(64),ciphertext:'v1.synthetic.iv.cipher'});
async function begin(){await db.exec("update live_streams.integration_runtime set enabled=true where platform='x'");const data=state();assert.equal((await oauth('begin',data)).ok,true);return data;}
async function connect(){const data=await begin();const claimed=await oauth('claim',{platform:'x',state_hash:data.state_hash});await oauth('finish',{id:data.id,platform:'x',account_id:'external-owner',account_name:'Synthetic owner',ciphertext:'v1.synthetic.iv.connection',scopes:['tweet.write'],expires_at:new Date(Date.now()+7200000).toISOString()});return claimed;}
async function readyClip({format='horizontal',watermark=true,bytes=1024}={}){
 const {session_id}=await as('authenticated','host','select public.live_command($1,$2,$3,$4)',['create',null,JSON.stringify({title:'Synthetic transcript stream',topic:'gaming',audience:'public',recording_enabled:true}),randomUUID()]);
 if(!watermark)await command('host',session_id,null,'settings',{watermark_required:false,brand_text:''});
 await db.query("update live_streams.sessions set state='live',started_at=now()-interval '5 minutes' where id=$1",[session_id]);const instance=await value('select instance_id from live_streams.provider_sessions where session_id=$1',[session_id]);
 await db.query('update live_streams.provider_sessions set playback_path=$2 where session_id=$1',[session_id,`live/${session_id}/${instance}/master.m3u8`]);
 const spec={title:'Synthetic transcript clip',caption:'',tags:[],start_ms:0,end_ms:30000,cover_ms:1000,formats:[format],watermark,brand_text:watermark?'Platinum Circles':'',burn_captions:false,subtitles:[]};
 const {clip_id}=await command('host',session_id,null,'create',spec),job=(await service('select public.live_claim_clip_jobs(1)')).items[0];
 const width=format==='vertical'?720:1280,height=format==='vertical'?1280:720;
 const assets=[{name:format+'.mp4',bytes,sha256:'a'.repeat(64),content_type:'video/mp4',width,height,duration_ms:30000,format},{name:'thumbnail.jpg',bytes:100,sha256:'b'.repeat(64),content_type:'image/jpeg'}];
 for(const a of assets)await db.query("insert into storage.objects(bucket_id,name,version,metadata,user_metadata) values('live-clips',$1,$2,$3,$4)",[job.output_prefix+a.name,randomUUID(),JSON.stringify({size:a.bytes,mimetype:a.content_type}),JSON.stringify({live_clip_id:clip_id,live_clip_job_id:job.id,live_clip_lease_id:job.lease_id,sha256:a.sha256})]);
 await service('select public.live_finish_clip_job($1,$2,true,$3,null)',[job.id,job.lease_id,JSON.stringify({assets,duration_ms:30000,width,height})]);return {clip:clip_id,session:session_id};
}
const draft=()=>({provider:'aws_transcribe',timing:'provider_words',requires_review:true,text:'Hello world.',language:'en-US',cues:[{start_ms:100,end_ms:900,text:'Hello world.'}]});
before(async()=>{
 await loadDeployedMediaBaseline(db);await db.exec('alter table auth.users add column if not exists is_anonymous boolean default false');
 for(const file of ['20261103000609_live_portable_control_plane.sql','20261103002857_live_clips_and_distribution.sql','20261103055547_live_optional_integrations.sql','20261103061323_live_direct_social_publishing.sql'])await db.exec(await source('supabase/migrations/'+file));
 for(const[name,id]of Object.entries(actors)){await db.query('insert into auth.users(id,email) values($1,$2)',[id,`integration-${name}@example.test`]);await db.query("insert into public.profiles(id,username,full_name,email,profile_visibility,account_type) values($1,$2,$2,$3,'public','personal') on conflict(id) do update set username=excluded.username,profile_visibility='public',account_type='personal'",[id,'integration_'+name,`integration-${name}@example.test`]);await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sessions[name],id]);}
 await db.exec("update live_streams.clip_runtime set enabled=true,project_origin='https://abcdefghijklmnopqrst.supabase.co'");
});
after(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
const social=(actor,clip,action,payload={},request=randomUUID())=>as('authenticated',actor,'select public.live_social_command($1,$2,$3,$4)',[clip,action,JSON.stringify(payload),request]);
const socialWorker=(action,id=null,lease=null,payload={})=>service('select public.live_social_worker($1,$2,$3,$4)',[action,id,lease,JSON.stringify(payload)]);
const consent=()=>({platform:'x',format:'horizontal',consent:true,title:'Reviewed synthetic post',caption:'No actual provider is contacted'});
async function permitted(options){const ready=await readyClip(options);await connect();await db.exec("update live_streams.integration_runtime set publishing_enabled=true where platform='x'");return ready;}
test('direct queue is private, starts gated, and ordinary users cannot obtain connection credentials',async()=>{
 assert.equal(await value("select count(*) from pg_indexes where schemaname='live_streams' and indexname in ('social_connections_platform','social_publish_actor','social_publish_connection','social_publish_clip')"),4);
 const {clip}=await readyClip();await assert.rejects(social('host',clip,'publish',consent()),/INTEGRATION_DISABLED/);
 await assert.rejects(as('authenticated','host','select * from live_streams.social_publish_jobs'),/permission denied/);
 await assert.rejects(as('authenticated','host',"select public.live_social_worker('claim')"),/permission denied/);
 await assert.rejects(as('authenticated','host',"select public.live_social_credentials($1,$2,'x')",[actors.host,sessions.host]),/permission denied/);
 await assert.rejects(as('anon',null,"select public.live_social_command(null,'history')"),/permission denied/);
});
test('direct publication requires actual clip authority and separate recorded consent',async()=>{
 const {clip}=await permitted();await assert.rejects(social('viewer',clip,'publish',consent()),/ACCESS_DENIED/);
 await assert.rejects(social('host',clip,'publish',{...consent(),consent:false}),/INVALID_REQUEST/);
 const request=randomUUID(),one=await social('host',clip,'publish',consent(),request),two=await social('host',clip,'publish',consent(),request);assert.equal(one.id,two.id);assert.equal(two.duplicate,true);
 await assert.rejects(social('host',clip,'publish',{...consent(),caption:'Changed'},request),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(social('host',clip,'publish',consent()),/PUBLICATION_CONFIRMATION_REQUIRED/);
 assert.equal(await value('select count(*) from live_streams.social_publish_jobs'),1);
});
test('device share keeps truthful export_required history and never enqueues a direct post',async()=>{
 const {clip,session}=await permitted();const result=await command('host',session,clip,'share',{destination:'x',format:'horizontal'});assert.equal(result.state,'export_required');assert.equal(await value('select count(*) from live_streams.social_publish_jobs'),0);
});
test('private source audiences and unapproved media cannot enter direct publication queue',async()=>{
 const {clip,session}=await permitted();await db.query("update live_streams.sessions set audience='followers' where id=$1",[session]);await assert.rejects(social('host',clip,'publish',consent()),/PRIVATE_STREAM_EXPORT_RESTRICTED/);
 await db.query("update live_streams.sessions set audience='public' where id=$1",[session]);await db.query("update live_streams.clips set moderation_state='pending' where id=$1",[clip]);await assert.rejects(social('host',clip,'publish',consent()),/REVIEW_REQUIRED/);
});
test('lease owns a specific job; expired/foreign leases cannot checkpoint or publish',async()=>{
 const {clip}=await permitted();const queued=await social('host',clip,'publish',consent()),claim=(await socialWorker('claim')).items[0];assert.equal(claim.id,queued.id);assert.equal((await socialWorker('check',claim.id,claim.lease_id)).ok,true);
 assert.equal((await socialWorker('checkpoint',claim.id,randomUUID(),{phase:'publishing',ciphertext:'v1.synthetic.iv.state'})).ok,false);
 await assert.rejects(socialWorker('finish',claim.id,claim.lease_id,{provider_id:'123'}),/INVALID_REQUEST/);
 await db.query("update live_streams.social_publish_jobs set lease_until=now()-interval '1 second' where id=$1",[claim.id]);assert.equal((await socialWorker('check',claim.id,claim.lease_id)).ok,false);
});
test('lost publish acknowledgment becomes confirmation_required and is never blindly retried',async()=>{
 const {clip}=await permitted();await social('host',clip,'publish',consent());const claim=(await socialWorker('claim')).items[0];await socialWorker('checkpoint',claim.id,claim.lease_id,{phase:'publishing',ciphertext:'v1.synthetic.iv.upload'});
 await db.query("update live_streams.social_publish_jobs set lease_until=now()-interval '1 second' where id=$1",[claim.id]);assert.deepEqual((await socialWorker('claim')).items,[]);
 assert.equal(await value('select state from live_streams.social_publish_jobs where id=$1',[claim.id]),'confirmation_required');await assert.rejects(social('host',clip,'retry',{id:claim.id}),/PUBLICATION_CONFIRMATION_REQUIRED/);
 await social('host',clip,'reconcile',{id:claim.id});const next=(await socialWorker('claim')).items[0];const checked=await socialWorker('check',next.id,next.lease_id);assert.equal(checked.reconcile_only,true);
 await assert.rejects(socialWorker('checkpoint',next.id,next.lease_id,{phase:'publishing',ciphertext:'v1.synthetic.iv.other'}),/PUBLICATION_CONFIRMATION_REQUIRED/);
});
test('safe polling failures can retry the same encrypted checkpoint and respect backoff',async()=>{
 const {clip}=await permitted();await social('host',clip,'publish',consent());const job=(await socialWorker('claim')).items[0];await socialWorker('checkpoint',job.id,job.lease_id,{phase:'processing',ciphertext:'v1.synthetic.iv.known'});await socialWorker('defer',job.id,job.lease_id,{after_seconds:99999});assert.deepEqual((await socialWorker('claim')).items,[]);
 const delta=await value('select extract(epoch from next_attempt_at-now()) from live_streams.social_publish_jobs where id=$1',[job.id]);assert.equal(Number(delta),3600);
 await db.query("update live_streams.social_publish_jobs set next_attempt_at=now()-interval '1 second' where id=$1",[job.id]);const next=(await socialWorker('claim')).items[0];assert.equal(next.id,job.id);assert.notEqual(next.lease_id,job.lease_id);assert.equal((await socialWorker('check',next.id,next.lease_id)).progress_ciphertext,'v1.synthetic.iv.known');
});
test('disconnect or source rights revocation fences a queued provider mutation',async()=>{
 const {clip}=await permitted();await social('host',clip,'publish',consent());const job=(await socialWorker('claim')).items[0];await oauth('disconnect',{platform:'x'});assert.equal((await socialWorker('check',job.id,job.lease_id)).error,'CLIP_CHANGED');assert.equal(await value('select state from live_streams.social_publish_jobs where id=$1',[job.id]),'cancelled');
});
test('a provider success racing revocation remains an honest receipt with revoked_after_dispatch',async()=>{
 const {clip,session}=await permitted();await social('host',clip,'publish',consent());const job=(await socialWorker('claim')).items[0];await socialWorker('checkpoint',job.id,job.lease_id,{phase:'publishing',ciphertext:'v1.synthetic.iv.post'});
 await command('host',session,clip,'copyright',{status:'blocked',reason:'Synthetic race after authorized dispatch'});assert.equal((await socialWorker('receipt',job.id,job.lease_id)).ok,true);
 const result=await socialWorker('finish',job.id,job.lease_id,{provider_id:'123',external_url:'https://x.com/i/status/123'});assert.equal(result.state,'published');assert.equal(await value('select revoked_after_dispatch from live_streams.social_publish_jobs where id=$1',[job.id]),true);
 assert.equal((await socialWorker('finish',job.id,job.lease_id,{provider_id:'123'})).duplicate,true);assert.equal((await socialWorker('receipt',job.id,job.lease_id)).ok,true);
});
test('history is owner-scoped, bounded and never exposes consent, upload capabilities or ciphertext',async()=>{
 const {clip}=await permitted();await social('host',clip,'publish',consent());const history=await social('host',null,'history');assert.equal(history.items.length,1);assert.ok(!JSON.stringify(history).includes('ciphertext'));assert.ok(!JSON.stringify(history).includes('consent'));assert.deepEqual((await social('viewer',null,'history')).items,[]);
});
test('closing a dispatched request requires explicit provider review even during processing',async()=>{
 const {clip}=await permitted();await social('host',clip,'publish',consent());const job=(await socialWorker('claim')).items[0];await socialWorker('checkpoint',job.id,job.lease_id,{phase:'publishing',ciphertext:'v1.synthetic.iv.post'});await socialWorker('checkpoint',job.id,job.lease_id,{phase:'processing',ciphertext:'v1.synthetic.iv.known'});
 await assert.rejects(social('host',clip,'cancel',{id:job.id}),/PUBLICATION_CONFIRMATION_REQUIRED/);await social('host',clip,'cancel',{id:job.id,checked_provider:true});assert.equal(await value('select state from live_streams.social_publish_jobs where id=$1',[job.id]),'cancelled');
});
async function pullJob(bytes=1024){
 const ready=await permitted({format:'vertical',watermark:false,bytes});
 await db.exec("update live_streams.social_connections set platform='tiktok';update live_streams.integration_runtime set enabled=true,publishing_enabled=true where platform='tiktok'");
 const payload={...consent(),platform:'tiktok',format:'vertical',privacy:'SELF_ONLY',disable_comment:true,disable_duet:true,disable_stitch:true,brand_content:false,brand_organic:false,is_aigc:false,agree_music_usage:true};
 await social('host',ready.clip,'publish',payload);const job=(await socialWorker('claim')).items[0];return{...ready,...job};
}
const pull=(job,hash='a'.repeat(64),consume=true)=>service('select public.live_social_pull_grant($1,$2,$3)',[job.id,hash,consume]);
test('TikTok pull capability is stable, creator-bound, private and cannot read before authorized dispatch',async()=>{
 const job=await pullJob(),grant=await socialWorker('pull_grant',job.id,job.lease_id,{token_hash:'a'.repeat(64),ciphertext:'v1.synthetic.iv.pull'});assert.equal(grant.bytes,1024);assert.equal(await pull(job),null);
 const again=await socialWorker('pull_grant',job.id,job.lease_id,{token_hash:'b'.repeat(64),ciphertext:'v1.synthetic.iv.other'});assert.equal(again.token_hash,'a'.repeat(64));assert.equal(again.ciphertext,grant.ciphertext);
 await socialWorker('checkpoint',job.id,job.lease_id,{phase:'publishing',ciphertext:'v1.synthetic.iv.sending'});assert.equal((await pull(job)).bucket,'live-clips');assert.equal(await pull(job,'b'.repeat(64)),null);
 await assert.rejects(as('authenticated','host','select public.live_social_pull_grant($1,$2,true)',[job.id,'a'.repeat(64)]),/permission denied/);
 assert.ok(!JSON.stringify(await social('host',job.clip,'history')).includes('pull_'));
});
test('provider pull rights are revoked by source policy, session deletion, expiry and read budget',async()=>{
 const job=await pullJob();await socialWorker('pull_grant',job.id,job.lease_id,{token_hash:'a'.repeat(64),ciphertext:'v1.synthetic.iv.pull'});await socialWorker('checkpoint',job.id,job.lease_id,{phase:'publishing',ciphertext:'v1.synthetic.iv.sending'});
 await db.query('update live_streams.social_publish_jobs set pull_reads=32 where id=$1',[job.id]);assert.equal(await pull(job),null);
 await db.query("update live_streams.social_publish_jobs set pull_reads=0,pull_expires_at=now()-interval '1 second' where id=$1",[job.id]);assert.equal(await pull(job),null);
 await db.query("update live_streams.social_publish_jobs set pull_expires_at=now()+interval '1 hour' where id=$1",[job.id]);await command('host',job.session,job.clip,'copyright',{status:'blocked',reason:'Synthetic pull revocation'});assert.equal(await pull(job),null);
 await command('host',job.session,job.clip,'copyright',{status:'cleared',reason:'Restore synthetic fixture'});await db.query('delete from auth.sessions where id=$1',[sessions.host]);assert.equal(await pull(job),null);
});
test('provider pull rejects media above the bounded proxy limit before exposing a capability',async()=>{
 const job=await pullJob(134217729);await assert.rejects(socialWorker('pull_grant',job.id,job.lease_id,{token_hash:'a'.repeat(64),ciphertext:'v1.synthetic.iv.pull'}),/MEDIA_TOO_LARGE/);
 assert.equal(await value('select pull_token_hash from live_streams.social_publish_jobs where id=$1',[job.id]),null);
});
test('provider pull immediately denies a disconnected creator account',async()=>{
 const job=await pullJob();await socialWorker('pull_grant',job.id,job.lease_id,{token_hash:'a'.repeat(64),ciphertext:'v1.synthetic.iv.pull'});await socialWorker('checkpoint',job.id,job.lease_id,{phase:'publishing',ciphertext:'v1.synthetic.iv.sending'});await oauth('disconnect',{platform:'tiktok'});assert.equal(await pull(job),null);
});
