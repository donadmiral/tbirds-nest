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
async function readyClip(){
 const {session_id}=await as('authenticated','host','select public.live_command($1,$2,$3,$4)',['create',null,JSON.stringify({title:'Synthetic transcript stream',topic:'gaming',audience:'public',recording_enabled:true}),randomUUID()]);
 await db.query("update live_streams.sessions set state='live',started_at=now()-interval '5 minutes' where id=$1",[session_id]);const instance=await value('select instance_id from live_streams.provider_sessions where session_id=$1',[session_id]);
 await db.query('update live_streams.provider_sessions set playback_path=$2 where session_id=$1',[session_id,`live/${session_id}/${instance}/master.m3u8`]);
 const spec={title:'Synthetic transcript clip',caption:'',tags:[],start_ms:0,end_ms:30000,cover_ms:1000,formats:['horizontal'],watermark:true,brand_text:'Platinum Circles',burn_captions:false,subtitles:[]};
 const {clip_id}=await command('host',session_id,null,'create',spec),job=(await service('select public.live_claim_clip_jobs(1)')).items[0];
 const assets=[{name:'horizontal.mp4',bytes:1024,sha256:'a'.repeat(64),content_type:'video/mp4',width:1280,height:720,duration_ms:30000,format:'horizontal'},{name:'thumbnail.jpg',bytes:100,sha256:'b'.repeat(64),content_type:'image/jpeg'}];
 for(const a of assets)await db.query("insert into storage.objects(bucket_id,name,version,metadata,user_metadata) values('live-clips',$1,$2,$3,$4)",[job.output_prefix+a.name,randomUUID(),JSON.stringify({size:a.bytes,mimetype:a.content_type}),JSON.stringify({live_clip_id:clip_id,live_clip_job_id:job.id,live_clip_lease_id:job.lease_id,sha256:a.sha256})]);
 await service('select public.live_finish_clip_job($1,$2,true,$3,null)',[job.id,job.lease_id,JSON.stringify({assets,duration_ms:30000,width:1280,height:720})]);return {clip:clip_id,session:session_id};
}
const draft=()=>({provider:'aws_transcribe',timing:'provider_words',requires_review:true,text:'Hello world.',language:'en-US',cues:[{start_ms:100,end_ms:900,text:'Hello world.'}]});
before(async()=>{
 await loadDeployedMediaBaseline(db);await db.exec('alter table auth.users add column if not exists is_anonymous boolean default false');
 for(const file of ['20261103000609_live_portable_control_plane.sql','20261103002857_live_clips_and_distribution.sql','20261103055547_live_optional_integrations.sql'])await db.exec(await source('supabase/migrations/'+file));
 for(const[name,id]of Object.entries(actors)){await db.query('insert into auth.users(id,email) values($1,$2)',[id,`integration-${name}@example.test`]);await db.query("insert into public.profiles(id,username,full_name,email,profile_visibility,account_type) values($1,$2,$2,$3,'public','personal') on conflict(id) do update set username=excluded.username,profile_visibility='public',account_type='personal'",[id,'integration_'+name,`integration-${name}@example.test`]);await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sessions[name],id]);}
 await db.exec("update live_streams.clip_runtime set enabled=true,project_origin='https://abcdefghijklmnopqrst.supabase.co'");
});
after(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
test('all optional gates start off; no anonymous RPC, direct tables or service credential function access',async()=>{
 assert.equal(await value('select count(*) from live_streams.integration_runtime where enabled or publishing_enabled'),0);
 await assert.rejects(as('anon',null,'select public.live_integration_context()'),/permission denied/);
 await assert.rejects(as('authenticated','host','select * from live_streams.social_connections'),/permission denied/);
 await assert.rejects(as('authenticated','host','select public.live_oauth_operation($1,$2,$3,$4)',[actors.host,sessions.host,'status','{}']),/permission denied/);
 await assert.rejects(as('authenticated','host',"select public.live_transcription_worker('claim')"),/permission denied/);
 assert.equal((await oauth('begin',state())).error,'INTEGRATION_DISABLED');assert.equal((await worker('claim')).error,'INTEGRATION_DISABLED');
});
test('OAuth states bind exact user, Auth session and provider, consume once and expire',async()=>{
 const data=await begin();assert.equal((await oauth('claim',{platform:'x',state_hash:data.state_hash},'viewer')).error,'STATE_EXPIRED');
 assert.equal((await oauth('claim',{platform:'x',state_hash:data.state_hash},'host',sessions.viewer)).error,'AUTH_REQUIRED');
 const claimed=await oauth('claim',{platform:'x',state_hash:data.state_hash});assert.equal(claimed.id,data.id);assert.ok(claimed.ciphertext);
 assert.equal((await oauth('claim',{platform:'x',state_hash:data.state_hash})).error,'STATE_REPLAYED');
 await db.query("update live_streams.oauth_states set expires_at=now()-interval '1 second' where id=$1",[data.id]);assert.equal((await oauth('failed',{platform:'x',id:data.id})).error,'STATE_EXPIRED');
});
test('revoked Auth session cannot claim a state, refresh, or read connection context',async()=>{
 const data=await begin();await db.query('delete from auth.sessions where id=$1',[sessions.host]);
 assert.equal((await oauth('claim',{platform:'x',state_hash:data.state_hash})).error,'AUTH_REQUIRED');
 await assert.rejects(as('authenticated','host','select public.live_integration_context()'),/AUTH_REQUIRED/);
});
test('ordinary metadata readers never receive cipher, scope tokens, or provider secret fields',async()=>{
 await connect();const read=await as('authenticated','host','select public.live_platform_connections()');assert.equal(read.items[0].account_name,'Synthetic owner');assert.equal(read.items[0].can_publish,false);assert.equal(read.direct_publishing,false);assert.ok(!JSON.stringify(read).includes('cipher'));
 assert.deepEqual((await as('authenticated','viewer','select public.live_platform_connections()')).items,[]);
});
test('refresh lease serializes rotation; disconnect invalidates stale lease completion and outstanding states',async()=>{
 const connected=await connect(),refresh=await oauth('refresh_claim',{platform:'x'});assert.equal(refresh.id,connected.connection_id);
 assert.equal((await oauth('refresh_claim',{platform:'x'})).error,'OPERATION_AMBIGUOUS');
 await oauth('disconnect',{platform:'x'});
 assert.equal((await oauth('refresh_finish',{platform:'x',id:refresh.id,lease_id:refresh.lease_id,version:refresh.version,ciphertext:'v1.synthetic.iv.new',expires_at:new Date(Date.now()+100000).toISOString()})).error,'RECONNECT_REQUIRED');
 assert.equal(await value('select ciphertext from live_streams.social_connections where id=$1',[refresh.id]),null);
});
test('expired refresh exchange requires re-consent instead of reusing rotating token',async()=>{
 await connect();const refresh=await oauth('refresh_claim',{platform:'x'});await db.query("update live_streams.social_connections set refresh_until=now()-interval '1 second' where id=$1",[refresh.id]);assert.equal((await oauth('refresh_claim',{platform:'x'})).error,'RECONNECT_REQUIRED');assert.equal(await value('select ciphertext from live_streams.social_connections where id=$1',[refresh.id]),null);
});
test('transcription admission requires owner authority, consent, enabled service and idempotent request',async()=>{
 const {clip}=await readyClip();await assert.rejects(transcriptCommand('viewer',clip,'request',{consent:true,language:'en-US'}),/ACCESS_DENIED/);
 await assert.rejects(transcriptCommand('host',clip,'request',{consent:true,language:'en-US'}),/INTEGRATION_DISABLED/);
 await db.exec("update live_streams.integration_runtime set enabled=true where platform='transcription'");
 await assert.rejects(transcriptCommand('host',clip,'request',{language:'en-US'}),/INVALID_REQUEST/);
 const id=randomUUID(),payload={consent:true,language:'en-US'},a=await transcriptCommand('host',clip,'request',payload,id),b=await transcriptCommand('host',clip,'request',payload,id);assert.equal(a.id,b.id);assert.equal(b.duplicate,true);
 await assert.rejects(transcriptCommand('host',clip,'request',{...payload,language:'fr-FR'},id),/IDEMPOTENCY_CONFLICT/);
});
test('missing transcription configuration fails closed for admission and worker claims',async()=>{
 const {clip}=await readyClip();await db.exec("delete from live_streams.integration_runtime where platform='transcription'");
 await assert.rejects(transcriptCommand('host',clip,'request',{consent:true,language:'en-US'}),/INTEGRATION_DISABLED/);assert.equal((await worker('claim')).error,'INTEGRATION_DISABLED');assert.equal(await value('select count(*) from live_streams.transcription_jobs'),0);
});
test('leased source and completion reject stale leases and copyright/session revocation',async()=>{
 const {clip,session}=await readyClip();await db.exec("update live_streams.integration_runtime set enabled=true where platform='transcription'");await transcriptCommand('host',clip,'request',{consent:true,language:'en-US'});
 const job=(await worker('claim')).items[0];assert.equal((await worker('check',job.id,job.lease_id)).ok,true);assert.equal((await worker('check',job.id,randomUUID())).ok,false);
 await command('host',session,clip,'copyright',{status:'blocked',reason:'Synthetic revoked rights'});
 assert.equal((await worker('finish',job.id,job.lease_id,draft())).error,'CLIP_CHANGED');assert.equal(await value('select draft from live_streams.transcription_jobs where id=$1',[job.id]),null);
});
test('transcription completion creates draft only; explicit review queues existing renderer with validated captions',async()=>{
 const {clip}=await readyClip();await db.exec("update live_streams.integration_runtime set enabled=true where platform='transcription'");await transcriptCommand('host',clip,'request',{consent:true,language:'en-US'});const job=(await worker('claim')).items[0];
 assert.equal((await worker('finish',job.id,job.lease_id,draft())).state,'draft');assert.deepEqual(await value('select subtitles from live_streams.clips where id=$1',[clip]),[]);
 await assert.rejects(transcriptCommand('viewer',clip,'review',{id:job.id,reviewed:true,cues:draft().cues}),/ACCESS_DENIED/);
 await assert.rejects(transcriptCommand('host',clip,'review',{id:job.id,cues:draft().cues}),/REVIEW_REQUIRED/);
 const payload={id:job.id,reviewed:true,cues:draft().cues,burn_captions:true},request=randomUUID();const result=await transcriptCommand('host',clip,'review',payload,request);assert.equal(result.state,'queued');assert.deepEqual(await value('select subtitles from live_streams.clips where id=$1',[clip]),draft().cues);assert.equal(await value('select watermark from live_streams.clips where id=$1',[clip]),true);
 assert.equal((await transcriptCommand('host',clip,'review',payload,request)).duplicate,true);
});
test('caption completion refuses fabricated overlaps and out-of-range cues without consuming lease',async()=>{
 const {clip}=await readyClip();await db.exec("update live_streams.integration_runtime set enabled=true where platform='transcription'");await transcriptCommand('host',clip,'request',{consent:true,language:'en-US'});const job=(await worker('claim')).items[0];
 await assert.rejects(worker('finish',job.id,job.lease_id,{...draft(),cues:[{start_ms:0,end_ms:40000,text:'Too long'}]}),/INVALID_CAPTIONS/);assert.equal((await worker('check',job.id,job.lease_id)).ok,true);
});
test('draft reads inherit clip-read revocation when source clipping is disabled',async()=>{
 const {clip,session}=await readyClip();await db.exec("update live_streams.integration_runtime set enabled=true where platform='transcription'");await transcriptCommand('host',clip,'request',{consent:true,language:'en-US'});const job=(await worker('claim')).items[0];await worker('finish',job.id,job.lease_id,draft());
 assert.equal((await transcriptCommand('host',clip,'status')).items[0].draft.text,'Hello world.');await command('host',session,null,'settings',{copyright_policy:'disabled'});
 await assert.rejects(transcriptCommand('host',clip,'status'),/ACCESS_DENIED/);await assert.rejects(transcriptCommand('host',clip,'review',{id:job.id,reviewed:true,cues:draft().cues}),/ACCESS_DENIED/);
});
test('a deferred AWS job keeps one deterministic identity and cannot finish after creator Auth revocation',async()=>{
 const {clip}=await readyClip();await db.exec("update live_streams.integration_runtime set enabled=true where platform='transcription'");await transcriptCommand('host',clip,'request',{consent:true,language:'en-US'});const job=(await worker('claim')).items[0];await worker('defer',job.id,job.lease_id);
 assert.deepEqual((await worker('claim')).items,[]);await db.query("update live_streams.transcription_jobs set next_attempt_at=now()-interval '1 second' where id=$1",[job.id]);const next=(await worker('claim')).items[0];assert.equal(next.id,job.id);assert.equal(next.job_name,job.job_name);assert.notEqual(next.lease_id,job.lease_id);
 await db.query('delete from auth.sessions where id=$1',[sessions.host]);assert.equal((await worker('check',next.id,next.lease_id)).error,'CLIP_CHANGED');
});
