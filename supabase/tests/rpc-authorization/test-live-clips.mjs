import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions } from './live-schema-fixture.mjs';
import { loadDeployedMediaBaseline, source } from './deployed-media-baseline.mjs';
const db = new PGlite({extensions});
const actors=Object.fromEntries(['host','viewer','stranger'].map(n=>[n,randomUUID()]));
const sessions=Object.fromEntries(Object.keys(actors).map(n=>[n,randomUUID()]));
const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
async function as(role,name,sql,args=[]){
 await db.exec('savepoint request');
 try{await db.exec(`set local role ${role}`);
 const claims={sub:actors[name]||null,role,session_id:sessions[name]||null,is_anonymous:false};
 await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[claims.sub||'',role,JSON.stringify(claims)]);
 const result=await value(sql,args);await db.exec('reset role;release savepoint request');return result;
 }catch(error){await db.exec('rollback to savepoint request;release savepoint request');throw error;}
}
const spec=()=>({title:'Verified synthetic clip',caption:'A complete test recording',tags:['test'],start_ms:0,end_ms:30000,cover_ms:1000,formats:['horizontal','vertical'],watermark:true,brand_text:'Platinum Circles',burn_captions:false,subtitles:[{start_ms:0,end_ms:2000,text:'Synthetic test caption'}]});
const command=(actor,session,clip,action,payload={},request=randomUUID())=>as('authenticated',actor,'select public.live_clip_command($1,$2,$3,$4,$5)',[session,clip,action,JSON.stringify(payload),request]);
const service=(name,args=[])=>as('service_role',null,name,args);
async function createSession(audience='public'){
 const {session_id:id}=await as('authenticated','host','select public.live_command($1,$2,$3,$4)',['create',null,JSON.stringify({title:'Synthetic stream',topic:'gaming',audience,recording_enabled:true}),randomUUID()]);
 await db.query("update live_streams.sessions set state='live',started_at=now()-interval '5 minutes' where id=$1",[id]);
 const instance=await value('select instance_id from live_streams.provider_sessions where session_id=$1',[id]);
 await db.query('update live_streams.provider_sessions set playback_path=$2 where session_id=$1',[id,`live/${id}/${instance}/master.m3u8`]);return id;
}
async function createClip(id,actor='host',payload=spec()){return(await command(actor,id,null,'create',payload)).clip_id;}
async function claim(){return(await service('select public.live_claim_clip_jobs(1)')).items[0];}
async function finish(job){
 const assets=[{name:'horizontal.mp4',bytes:1024,sha256:'a'.repeat(64),content_type:'video/mp4',width:1280,height:720,duration_ms:30000,format:'horizontal'},
 {name:'vertical.mp4',bytes:1024,sha256:'b'.repeat(64),content_type:'video/mp4',width:720,height:1280,duration_ms:30000,format:'vertical'},
 {name:'thumbnail.jpg',bytes:100,sha256:'c'.repeat(64),content_type:'image/jpeg'},
 {name:'captions.vtt',bytes:100,sha256:'d'.repeat(64),content_type:'text/vtt'}];
 const manifest={assets,duration_ms:30000,width:1280,height:720};
 for(const a of assets)await db.query("insert into storage.objects(bucket_id,name,version,metadata,user_metadata) values('live-clips',$1,$2,$3,$4)",[job.output_prefix+a.name,randomUUID(),JSON.stringify({size:a.bytes,mimetype:a.content_type}),JSON.stringify({live_clip_id:job.clip_id,live_clip_job_id:job.id,live_clip_lease_id:job.lease_id,sha256:a.sha256})]);
 const result=await service('select public.live_finish_clip_job($1,$2,true,$3,null)',[job.id,job.lease_id,JSON.stringify(manifest)]);return{result,manifest};
}
before(async()=>{
 await loadDeployedMediaBaseline(db);await db.exec('alter table auth.users add column if not exists is_anonymous boolean default false;');
 await db.exec(await source('supabase/migrations/20261103000609_live_portable_control_plane.sql'));
 try{await db.exec(await source('supabase/migrations/20261103002857_live_clips_and_distribution.sql'));}catch(error){throw new Error(JSON.stringify({message:error.message,position:error.position,internalPosition:error.internalPosition,where:error.where,internalQuery:error.internalQuery}));}
 // The managed Storage operation helper is installed by Storage, not by app
 // migrations. Model its documented exact normalization in this local fixture.
 await db.exec(`create function storage.allow_only_operation(operation text) returns boolean language sql stable as $$
 select coalesce(nullif(regexp_replace(current_setting('storage.operation',true),'^storage[.]',''),'')=nullif(regexp_replace(operation,'^storage[.]',''),''),false)$$;`);
 await db.exec(await source('supabase/migrations/20261103082746_live_clip_signed_upload_preflight.sql'));
 await db.exec(await source('supabase/migrations/20261103083628_live_clip_signing_probe_transport_metadata.sql'));
 for(const[name,id]of Object.entries(actors)){
 await db.query('insert into auth.users(id,email) values($1,$2)',[id,`clip-${name}@example.test`]);
 await db.query("insert into public.profiles(id,username,email,full_name,profile_visibility,account_type) values($1,$2,$3,$2,'public','personal') on conflict(id) do update set username=excluded.username,profile_visibility='public',account_type='personal'",[id,`clip_${name}`,`clip-${name}@example.test`]);
 await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sessions[name],id]);}
 await db.exec("update live_streams.clip_runtime set enabled=true,project_origin='https://abcdefghijklmnopqrst.supabase.co'");
});
after(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
async function storageProbe(job,{role='service_role',operation='storage.object.sign_upload_url',version='1',metadata=null,userMetadata=null,name=job.output_prefix+'horizontal.mp4'}={}){
 await db.exec('savepoint storage_probe');
 try{
  await db.query("select set_config('request.jwt.claim.role',$1,true),set_config('storage.operation',$2,true)",[role,operation]);
  return await value("insert into storage.objects(bucket_id,name,version,metadata,user_metadata) values('live-clips',$1,$2,$3,$4) returning owner_id",[name,version,metadata===null?null:JSON.stringify(metadata),userMetadata===null?null:JSON.stringify(userMetadata)]);
 }finally{await db.exec('rollback to savepoint storage_probe;release savepoint storage_probe');}
}
test('signed upload preflight binds the active owner and rolls back without a finished object',async()=>{
 const id=await createSession();await createClip(id);const job=await claim();
 assert.equal(await storageProbe(job),actors.host);
 assert.equal(await storageProbe(job,{operation:'object.sign_upload_url'}),actors.host);
 assert.equal(await value("select count(*) from storage.objects where bucket_id='live-clips'"),0);
 assert.equal(await value('select state from live_streams.clips where id=$1',[job.clip_id]),'processing');
 const completed=await finish(job);assert.equal(completed.result.state,'ready');
 await assert.rejects(storageProbe(job),/CLIP_LEASE_LOST/);
});
test('signing probe accepts only the observed empty-request transport metadata and remains rollback-only',async()=>{
 const id=await createSession();await createClip(id);const job=await claim();
 assert.equal(await storageProbe(job,{metadata:{mimetype:'application/json',contentLength:2}}),actors.host);
 assert.equal(await value("select count(*) from storage.objects where bucket_id='live-clips'"),0);
 for(const metadata of [{mimetype:'application/json',contentLength:3},{mimetype:'application/json',contentLength:'2'},
  {mimetype:'video/mp4',contentLength:2},{mimetype:'application/json',contentLength:2,size:2},{mimetype:'application/json'},[],2]){
  await assert.rejects(storageProbe(job,{metadata}),/INVALID_CLIP_OBJECT/);
 }
 await assert.rejects(storageProbe(job,{operation:'object.upload_signed',metadata:{mimetype:'application/json',contentLength:2}}),/INVALID_CLIP_OBJECT/);
});
test('signed upload preflight rejects absent operation, ordinary users, wrong versions and nonempty metadata',async()=>{
 const id=await createSession();await createClip(id);const job=await claim();
 for(const options of [{operation:''},{operation:'object.upload_signed'},{operation:'object.sign_upload_url_extra'},
  {role:'authenticated'},{role:'anon'},{version:randomUUID()},{metadata:{size:1}},{userMetadata:{sha256:'a'.repeat(64)}}]){
  await assert.rejects(storageProbe(job,options),/INVALID_CLIP_OBJECT/);
 }
 assert.equal(await value("select count(*) from storage.objects where bucket_id='live-clips'"),0);
});
test('signed upload preflight cannot change owner, session, lease or requested asset formats',async()=>{
 const id=await createSession();await createClip(id,'host',{...spec(),formats:['horizontal'],subtitles:[]});const job=await claim();
 for(const name of [job.output_prefix.replace(job.owner_id,actors.stranger)+'horizontal.mp4',
  job.output_prefix.replace(job.session_id,randomUUID())+'horizontal.mp4',job.output_prefix.replace(job.lease_id,randomUUID())+'horizontal.mp4']){
  await assert.rejects(storageProbe(job,{name}),/CLIP_LEASE_LOST/);
 }
 for(const asset of ['vertical.mp4','captions.vtt','other.mp4'])await assert.rejects(storageProbe(job,{name:job.output_prefix+asset}),/INVALID_CLIP_OBJECT/);
});
test('signed upload preflight rechecks revoked auth, paused runtime and lease expiry',async()=>{
 const id=await createSession();await createClip(id);const job=await claim();
 for(const mutation of ["update live_streams.clip_runtime set enabled=false",`delete from auth.sessions where id='${sessions.host}'`,
  `update live_streams.clip_jobs set lease_until=now()-interval '1 second' where id='${job.id}'`,
  `update live_streams.sessions set recording_enabled=false where id='${id}'`]){
  await db.exec('savepoint revoked');try{await db.exec(mutation);await assert.rejects(storageProbe(job),/CLIP_LEASE_LOST/);}finally{await db.exec('rollback to savepoint revoked;release savepoint revoked');}
 }
});
test('actual signed upload and object updates still require complete current-lease provenance',async()=>{
 const id=await createSession();await createClip(id);const job=await claim();
 await db.query("select set_config('request.jwt.claim.role','service_role',true),set_config('storage.operation','object.upload_signed',true)");
 await assert.rejects(storageProbe(job,{operation:'object.upload_signed',version:randomUUID(),metadata:{size:1024,mimetype:'video/mp4'}}),/INVALID_CLIP_OBJECT/);
 const metadata={live_clip_id:job.clip_id,live_clip_job_id:job.id,live_clip_lease_id:job.lease_id,sha256:'a'.repeat(64)};
 await db.query("insert into storage.objects(bucket_id,name,version,metadata,user_metadata) values('live-clips',$1,$2,$3,$4)",[job.output_prefix+'horizontal.mp4',randomUUID(),JSON.stringify({size:1024,mimetype:'video/mp4'}),JSON.stringify(metadata)]);
 assert.equal(await value("select owner_id from storage.objects where bucket_id='live-clips' and name=$1",[job.output_prefix+'horizontal.mp4']),actors.host);
 await db.exec('savepoint bad_update');try{
  await db.query("select set_config('storage.operation','object.sign_upload_url',true)");
  await assert.rejects(db.query("update storage.objects set version='1',metadata='{}',user_metadata='{}' where bucket_id='live-clips' and name=$1",[job.output_prefix+'horizontal.mp4']),/INVALID_CLIP_OBJECT/);
 }finally{await db.exec('rollback to savepoint bad_update;release savepoint bad_update');}
});
test('clip tables and worker functions are private, anonymous callers cannot read clips',async()=>{
 assert.equal(await value("select public from storage.buckets where id='live-clips'"),false);
 await assert.rejects(as('anon',null,'select public.live_clip_library()'),/permission denied/);
 await assert.rejects(as('authenticated','host','select * from live_streams.clips'),/permission denied/);
 await assert.rejects(as('authenticated','host','select public.live_claim_clip_jobs(1)'),/permission denied/);
 assert.deepEqual((await as('authenticated','host','select public.live_platform_connections()')).items,[]);
});
test('recording authority, viewer opt-in, limits and request idempotency are enforced',async()=>{
 const id=await createSession();
 await assert.rejects(createClip(id,'viewer'),/CLIP_ACCESS_DENIED/);
 const ctx=await as('authenticated','host','select public.live_clip_context($1)',[id]);assert.equal(ctx.can_clip,true);assert.ok(ctx.available_end_ms>250000);
 await command('host',id,null,'settings',{viewer_clipping:true});
 const request=randomUUID(),payload=spec();const one=await command('viewer',id,null,'create',payload,request),two=await command('viewer',id,null,'create',payload,request);
 assert.equal(one.clip_id,two.clip_id);assert.equal(two.duplicate,true);
 await assert.rejects(command('viewer',id,null,'create',{...payload,title:'Changed'},request),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(createClip(id,'host',{...spec(),start_ms:2000,end_ms:1000}),/INVALID_CLIP_RANGE/);
 await assert.rejects(createClip(id,'host',{...spec(),end_ms:900000}),/INVALID_CLIP_RANGE/);
 await assert.rejects(createClip(id,'host',{...spec(),subtitles:[{start_ms:0,end_ms:50000,text:'Invalid'}]}),/INVALID_CAPTIONS/);
 await db.query('update live_streams.sessions set recording_enabled=false where id=$1',[id]);await assert.rejects(createClip(id),/CLIP_ACCESS_DENIED/);
});
test('leases fence stale completions and ready requires exact stored object metadata',async()=>{
 const id=await createSession(),clip=await createClip(id),job=await claim();assert.equal(job.clip_id,clip);
 const checked=await service('select public.live_check_clip_job($1,$2)',[job.id,job.lease_id]);assert.equal(checked.ok,true);assert.equal(checked.job.output_prefix,job.output_prefix);
 assert.equal((await service('select public.live_finish_clip_job($1,$2,true,$3,null)',[job.id,randomUUID(),JSON.stringify({assets:[]})])).ok,false);
 await assert.rejects(service('select public.live_finish_clip_job($1,$2,true,$3,null)',[job.id,job.lease_id,JSON.stringify({assets:[],duration_ms:30000})]),/INVALID_CLIP_MANIFEST/);
 const completed=await finish(job);assert.equal(completed.result.state,'ready');
 assert.equal((await service('select public.live_finish_clip_job($1,$2,true,$3,null)',[job.id,job.lease_id,JSON.stringify(completed.manifest)])).duplicate,true);
 assert.equal((await as('authenticated','host','select public.live_clip_asset_access($1,$2)',[clip,'horizontal'])).object_path,job.output_prefix+'horizontal.mp4');
 await command('host',id,clip,'delete');
 await assert.rejects(as('authenticated','host','select public.live_clip_asset_access($1,$2)',[clip,'horizontal']),/CLIP_ASSET_ACCESS_DENIED/);
 await db.exec("update live_streams.clip_cleanup set available_at=now()-interval '1 second'");const cleanup=await service('select public.live_claim_clip_cleanup(20)');assert.equal(cleanup.items.length,4);
 await assert.rejects(service('select public.live_finish_clip_cleanup($1,$2,true,null)',[cleanup.items[0].id,cleanup.items[0].lease_id]),/CLIP_ERASURE_NOT_VERIFIED/);
});
test('approved ready clips publish once to real feed rows, then revocation blocks all references',async()=>{
 const id=await createSession(),clip=await createClip(id),job=await claim();await finish(job);
 const request=randomUUID(),payload={destination:'feed',format:'horizontal'};
 const first=await command('host',id,clip,'publish',payload,request),second=await command('host',id,clip,'publish',payload,request);
 assert.equal(first.post_id,second.post_id);assert.equal(await value('select count(*) from public.post_media where post_id=$1',[first.post_id]),1);
 const url=await value('select url from public.post_media where post_id=$1',[first.post_id]);assert.equal(url,'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/live-clips/'+job.output_prefix+'horizontal.mp4');assert.ok(!url.includes('?'));
 const allowed=await as('authenticated','viewer','select live_streams.clip_reference_access($1,$2,$3,$4,$5)',['live-clips',job.output_prefix+'horizontal.mp4','post',first.post_id,actors.viewer]).catch(()=>null);
 assert.equal(allowed,null,'private helper remains uncallable');
 await db.exec(`grant usage on schema live_streams to authenticated;grant execute on function live_streams.clip_reference_access(text,text,text,uuid,uuid) to authenticated;`);
 assert.equal((await as('authenticated','viewer','select live_streams.clip_reference_access($1,$2,$3,$4,$5)',['live-clips',job.output_prefix+'horizontal.mp4','post',first.post_id,actors.viewer])).allowed,true);
 await command('host',id,clip,'copyright',{status:'blocked',reason:'Synthetic rights removal'});
 assert.equal((await as('authenticated','viewer','select live_streams.clip_reference_access($1,$2,$3,$4,$5)',['live-clips',job.output_prefix+'horizontal.mp4','post',first.post_id,actors.viewer])).allowed,false);
});
test('viewer clips wait for moderation and unauthorized users cannot edit, approve or publish them',async()=>{
 const id=await createSession();await command('host',id,null,'settings',{viewer_clipping:true,review_required:true});
 const clip=await createClip(id,'viewer'),job=await claim();await finish(job);
 await assert.rejects(command('stranger',id,clip,'delete'),/CLIP_ACCESS_DENIED/);
 await assert.rejects(command('viewer',id,clip,'review',{decision:'approved',reason:'Self approval'}),/CLIP_MANAGE_ACCESS_DENIED/);
 await assert.rejects(command('viewer',id,clip,'publish',{destination:'feed',format:'horizontal'}),/CLIP_NOT_READY/);
 await command('host',id,clip,'review',{decision:'approved',reason:'Approved synthetic footage'});
 assert.equal((await command('viewer',id,clip,'publish',{destination:'feed',format:'horizontal'})).state,'published');
});
test('scheduled publication rechecks session and external shares never claim a platform posted',async()=>{
 const id=await createSession(),clip=await createClip(id),job=await claim();await finish(job);
 const scheduled=await command('host',id,clip,'publish',{destination:'feed',format:'horizontal',scheduled_at:new Date(Date.now()+60000).toISOString()});assert.equal(scheduled.state,'scheduled');
 const external=await command('host',id,clip,'share',{destination:'x',format:'vertical'});assert.equal(external.state,'export_required');
 await db.query("update live_streams.clip_publications set next_attempt_at=now()-interval '1 second',scheduled_at=now()-interval '1 second' where id=$1",[scheduled.publication_id]);
 await db.query('delete from auth.sessions where id=$1',[sessions.host]);
 assert.equal((await service('select public.live_process_clip_publications(20)')).failed,1);
 assert.equal(await value('select state from live_streams.clip_publications where id=$1',[scheduled.publication_id]),'pending');
 assert.equal(await value('select count(*) from public.posts'),0);
});
test('story, channel, community and replay-highlight publications create their exact destination rows',async()=>{
 const id=await createSession(),clip=await createClip(id),job=await claim();await finish(job);
 const story=await command('host',id,clip,'publish',{destination:'story',format:'vertical'});
 assert.equal(await value('select media_type from public.stories where id=$1',[story.story_id]),'video');
 assert.equal(await value('select duration_sec from public.stories where id=$1',[story.story_id]),30);
 const channel=randomUUID();await db.query("insert into public.channels(id,owner_id,name,audience,status) values($1,$2,'Synthetic channel','everyone','active')",[channel,actors.host]);
 await db.query("insert into public.channel_members(channel_id,user_id,role) values($1,$2,'owner') on conflict do nothing",[channel,actors.host]);
 const channelPost=await command('host',id,clip,'publish',{destination:'channel',format:'horizontal',target_id:channel});
 assert.equal(await value('select channel_id from public.channel_messages where id=$1',[channelPost.post_id]),channel);
 assert.equal(await value('select media_type from public.channel_messages where id=$1',[channelPost.post_id]),'video');
 const community=randomUUID();await db.query("insert into public.communities(id,name,emoji,owner_id,created_by,status,join_mode) values($1,'Synthetic community','video',$2,$2,'active','open')",[community,actors.host]);
 await db.query("insert into public.community_members(community_id,user_id,role,status) values($1,$2,'owner','active') on conflict do nothing",[community,actors.host]);
 const communityPost=await command('host',id,clip,'publish',{destination:'community',format:'horizontal',target_id:community});
 assert.equal(await value('select community_id from public.posts where id=$1',[communityPost.post_id]),community);
 const highlight=await command('host',id,clip,'publish',{destination:'highlight',format:'horizontal'});assert.equal(highlight.state,'published');
 assert.equal(await value("select count(*) from live_streams.clip_publications where clip_id=$1 and state='published'",[clip]),4);
 assert.equal((await as('authenticated','viewer','select public.live_clip_get($1)',[clip])).clip.id,clip);
 await db.query("update public.channel_members set role='viewer' where channel_id=$1 and user_id=$2",[channel,actors.host]);
 await assert.rejects(command('host',id,clip,'publish',{destination:'channel',format:'horizontal',target_id:channel}),/CHANNEL_POST_ACCESS_DENIED/);
 await db.query('delete from public.community_members where community_id=$1 and user_id=$2',[community,actors.host]);
 await assert.rejects(command('host',id,clip,'publish',{destination:'community',format:'horizontal',target_id:community}),/COMMUNITY_POST_ACCESS_DENIED/);
});
test('pagination and sorts stay bounded, cursor continuation contains no repeated clip',async()=>{
 const id=await createSession();
 for(let n=0;n<4;n++)await createClip(id,'host',{...spec(),title:`Clip ${n}`});
 const one=await as('authenticated','host','select public.live_clip_library($1,null,2,\'newest\')',[id]);assert.equal(one.items.length,2);assert.ok(one.next_cursor);
 const two=await as('authenticated','host','select public.live_clip_library($1,$2,2,\'newest\')',[id,JSON.stringify(one.next_cursor)]);assert.equal(two.items.length,2);
 assert.equal(new Set([...one.items,...two.items].map(c=>c.id)).size,4);
 assert.equal((await as('authenticated','host','select public.live_clip_library($1,null,1000,\'top\')',[id])).items.length,4);
 assert.equal((await as('authenticated','viewer','select public.live_clip_library($1)',[id])).items.length,0);
 await assert.rejects(as('authenticated','viewer','select public.live_admin_clips()'),/ADMIN_ACCESS_DENIED/);
});
test('storage writes require current lease proof, stamp uploader ownership, and cascades retain erasure work',async()=>{
 const id=await createSession(),clip=await createClip(id),job=await claim();
 await assert.rejects(as('postgres',null,"insert into storage.objects(bucket_id,name,metadata,user_metadata) values('live-clips',$1,'{}','{}')",[job.output_prefix+'horizontal.mp4']),/INVALID_CLIP_OBJECT/);
 await finish(job);
 assert.equal(await value("select owner_id from storage.objects where bucket_id='live-clips' and name=$1",[job.output_prefix+'horizontal.mp4']),actors.host);
 await assert.rejects(as('postgres',null,"update storage.objects set metadata=metadata||'{\"size\":5}'::jsonb where bucket_id='live-clips' and name=$1",[job.output_prefix+'horizontal.mp4']),/CLIP_LEASE_LOST/);
 await db.query('delete from live_streams.sessions where id=$1',[id]);
 assert.equal(await value('select count(*) from live_streams.clips where id=$1',[clip]),0);
 assert.equal(await value('select count(*) from live_streams.clip_cleanup where clip_id is null'),4);
});
test('private destinations and deleted publications never make a clip globally readable',async()=>{
 const id=await createSession(),clip=await createClip(id),job=await claim();await finish(job);
 const channel=randomUUID();await db.query("insert into public.channels(id,owner_id,name,audience,status) values($1,$2,'Private channel','invite','active')",[channel,actors.host]);
 await db.query("insert into public.channel_members(channel_id,user_id,role) values($1,$2,'owner') on conflict do nothing",[channel,actors.host]);
 await command('host',id,clip,'publish',{destination:'channel',format:'horizontal',target_id:channel});
 await assert.rejects(as('authenticated','viewer','select public.live_clip_get($1)',[clip]),/CLIP_NOT_AVAILABLE/);
 assert.equal((await as('authenticated','host','select public.live_clip_get($1)',[clip])).permissions.can_share_link,false);
 const feed=await command('host',id,clip,'publish',{destination:'feed',format:'horizontal'});
 assert.equal((await as('authenticated','viewer','select public.live_clip_get($1)',[clip])).clip.id,clip);
 await db.query('delete from public.posts where id=$1',[feed.post_id]);
 await assert.rejects(as('authenticated','viewer','select public.live_clip_get($1)',[clip]),/CLIP_NOT_AVAILABLE/);
});
test('worker pause prevents new renders while completed assets remain available to their owner',async()=>{
 const id=await createSession(),clip=await createClip(id),job=await claim();await finish(job);
 await service('select public.live_clip_configure($1,false,2)',['https://abcdefghijklmnopqrst.supabase.co']);
 assert.equal((await as('authenticated','host','select public.live_clip_context($1)',[id])).can_clip,false);
 await assert.rejects(createClip(id),/CLIP_PROCESSOR_NOT_READY/);
 assert.deepEqual((await service('select public.live_claim_clip_jobs(2)')).items,[]);
 assert.equal((await as('authenticated','host','select public.live_clip_asset_access($1,$2)',[clip,'horizontal'])).object_path,job.output_prefix+'horizontal.mp4');
});
test('moderation preview requires active authorized staff and audits blocked-media inspection',async()=>{
 const id=await createSession(),clip=await createClip(id),job=await claim();await finish(job);
 await command('host',id,clip,'copyright',{status:'blocked',reason:'Rights review pending'});
 await assert.rejects(as('authenticated','viewer','select public.live_clip_asset_access($1,$2)',[clip,'horizontal']),/CLIP_ASSET_ACCESS_DENIED/);
 await db.query("insert into public.admin_users(user_id,role,active) values($1,'trust_safety',true)",[actors.stranger]);
 assert.equal((await as('authenticated','stranger','select public.live_clip_asset_access($1,$2)',[clip,'horizontal'])).bucket,'live-clips');
 assert.equal(await value("select count(*) from live_streams.clip_audit where clip_id=$1 and action='admin_preview'",[clip]),1);
 await db.query("update public.admin_users set role='analyst' where user_id=$1",[actors.stranger]);
 await assert.rejects(as('authenticated','stranger','select public.live_clip_asset_access($1,$2)',[clip,'horizontal']),/ADMIN_ACCESS_DENIED/);
});
