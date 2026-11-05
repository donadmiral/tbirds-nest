import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {loadDeployedMediaBaseline,source} from './deployed-media-baseline.mjs';
const db=new PGlite({extensions}),actors={host:randomUUID(),viewer:randomUUID()},sessions={host:randomUUID(),viewer:randomUUID()};
const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
async function as(role,name,sql,args=[]){await db.exec('savepoint req');try{
 await db.exec(`set local role ${role}`);const claims={sub:actors[name]||null,role,session_id:sessions[name]||null,is_anonymous:false};
 await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[claims.sub||'',role,JSON.stringify(claims)]);
 const result=await value(sql,args);await db.exec('reset role;release savepoint req');return result;
 }catch(error){await db.exec('rollback to savepoint req;release savepoint req');throw new Error(error.message);}}
const command=(session,clip,action,payload)=>as('authenticated','host','select public.live_clip_command($1,$2,$3,$4,$5)',[session,clip,action,JSON.stringify(payload),randomUUID()]);
const issue=(kind,id)=>as('authenticated','viewer',"select coalesce(jsonb_agg(t),'[]'::jsonb) from public.issue_content_media_delivery($1,null)t",[JSON.stringify([{kind,id}])]);
const issueVersioned=(kind,id)=>as('authenticated','viewer',"select coalesce(jsonb_agg(t),'[]'::jsonb) from public.issue_content_media_delivery_v2($1,null)t",[JSON.stringify([{kind,id}])]);
const redeem=t=>as('service_role',null,'select public.resolve_media_delivery($1,$2,$3)',[t.token,t.bucket_id,t.object_path]);
async function ready(){
 const {session_id:s}=await as('authenticated','host','select public.live_command($1,null,$2,$3)',['create',JSON.stringify({title:'Delivery fixture',topic:'news',recording_enabled:true}),randomUUID()]);
 await db.query("update live_streams.sessions set state='live',started_at=now()-interval '5 minutes' where id=$1",[s]);
 await db.query("update live_streams.provider_sessions set playback_path='live/'||session_id||'/'||instance_id||'/master.m3u8' where session_id=$1",[s]);
 const {clip_id:c}=await command(s,null,'create',{title:'Delivery clip',caption:'',tags:[],start_ms:0,end_ms:30000,cover_ms:0,formats:['horizontal'],watermark:true,brand_text:'',burn_captions:false,subtitles:[]});
 const j=(await as('service_role',null,'select public.live_claim_clip_jobs(1)')).items[0];
 const assets=[{name:'horizontal.mp4',bytes:1024,content_type:'video/mp4',sha256:'a'.repeat(64),width:1280,height:720,duration_ms:30000,format:'horizontal'},{name:'thumbnail.jpg',bytes:100,content_type:'image/jpeg',sha256:'b'.repeat(64)}];
 for(const a of assets)await db.query("insert into storage.objects(bucket_id,name,version,metadata,user_metadata) values('live-clips',$1,$2,$3,$4)",[j.output_prefix+a.name,randomUUID(),JSON.stringify({size:a.bytes,mimetype:a.content_type,eTag:'verified-clip-'+a.name}),JSON.stringify({live_clip_id:c,live_clip_job_id:j.id,live_clip_lease_id:j.lease_id,sha256:a.sha256})]);
 await as('service_role',null,'select public.live_finish_clip_job($1,$2,true,$3,null)',[j.id,j.lease_id,JSON.stringify({assets,duration_ms:30000,width:1280,height:720})]);
 return{s,c,j};
}
before(async()=>{
 await loadDeployedMediaBaseline(db);await db.exec('alter table auth.users add column if not exists is_anonymous boolean default false;');
 for(const name of ['20261102163428_production_content_media_tickets','20261103000609_live_portable_control_plane','20261103002857_live_clips_and_distribution','20261103002832_live_clip_content_delivery',
 '20261102071532_durable_media_processing_v1','20261102090521_adaptive_media_renditions_v2','20261102100428_media_broker_scoped_credentials_v2',
 '20261105044918_adaptive_media_admission_backfill_v2','20261105152331_adaptive_media_batch_readiness','20261105153608_published_live_clip_renditions','20261105180908_content_media_ticket_versions_v2']){
  try{await db.exec(await source(`supabase/migrations/${name}.sql`));}catch(error){throw new Error(name+': '+error.message);}
 }
 await db.exec("update media_delivery.prerequisite_settings set enabled=true;update live_streams.clip_runtime set project_origin='https://abcdefghijklmnopqrst.supabase.co',enabled=true;");
 for(const [name,id]of Object.entries(actors)){
  await db.query('insert into auth.users(id,email) values($1,$2)',[id,`clipdelivery-${name}@example.test`]);
  await db.query("insert into public.profiles(id,username,email,full_name,profile_visibility,account_type) values($1,$2,$3,$2,'public','personal') on conflict(id) do update set username=excluded.username,profile_visibility='public',account_type='personal'",[id,`clipdelivery_${name}`,`clipdelivery-${name}@example.test`]);
  await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sessions[name],id]);
 }
});
after(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
test('ordinary post tickets continue to use existing provenance and revocation',async()=>{
 const p=`${actors.host}/${randomUUID()}.mp4`,url='https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/post-media/'+p;
 await db.query("insert into storage.objects(bucket_id,name,version,owner,owner_id) values('post-media',$1,$2,$3::uuid,$3::text)",[p,randomUUID(),actors.host]);
 const id=await value("insert into public.posts(user_id,body,scope,audience,media_url) values($1,'Existing media','global','everyone',$2) returning id",[actors.host,url]);
 const tickets=await issue('post',id);assert.equal(tickets.length,1);assert.equal((await redeem(tickets[0])).path,p);
 await db.query("update public.posts set audience='followers' where id=$1",[id]);assert.equal(await redeem(tickets[0]),null);
});
test('published clips issue private content tickets and copyright revokes existing tickets',async()=>{
 const {s,c}=await ready(),p=await command(s,c,'publish',{destination:'feed',format:'horizontal'});
 const tickets=await issue('post',p.post_id);assert.ok(tickets.some(t=>t.object_path.endsWith('/horizontal.mp4')));assert.ok(tickets.every(t=>t.bucket_id==='live-clips'));
 for(const t of tickets)assert.ok(await redeem(t));
 await command(s,c,'copyright',{status:'blocked',reason:'Synthetic rights test'});
 for(const t of tickets)assert.equal(await redeem(t),null);
});
test('versioned issuance preserves published-clip authority and returns exact issued source versions',async()=>{
 const {s,c}=await ready(),p=await command(s,c,'publish',{destination:'feed',format:'horizontal'});
 const tickets=await issueVersioned('post',p.post_id);assert.ok(tickets.length);assert.ok(tickets.every(t=>t.bucket_id==='live-clips'));
 for(const t of tickets){
  assert.equal(t.object_version,await value("select object_version from media_delivery.tickets where token_digest=extensions.digest($1,'sha256')",[t.token]));
  assert.equal((await redeem(t)).version,t.object_version);
 }
 await command(s,c,'copyright',{status:'blocked',reason:'Synthetic versioned delivery rights test'});
 assert.equal((await issueVersioned('post',p.post_id)).length,0);for(const t of tickets)assert.equal(await redeem(t),null);
});
test('post audience changes and forged reuse in another post cannot authorize clip bytes',async()=>{
 const {s,c}=await ready(),p=await command(s,c,'publish',{destination:'feed',format:'horizontal'}),tickets=await issue('post',p.post_id);
 await db.query("update public.posts set audience='followers' where id=$1",[p.post_id]);assert.equal(await redeem(tickets[0]),null);
 const url=await value('select media_url from public.posts where id=$1',[p.post_id]);
 const forged=await value("insert into public.posts(user_id,body,scope,audience,media_url) values($1,'Forged reuse','global','everyone',$2) returning id",[actors.viewer,url]);
 assert.equal((await issue('post',forged)).length,0);
});
test('channel clip delivery uses channel membership and revokes when membership is removed',async()=>{
 const {s,c}=await ready(),channel=await value("insert into public.channels(owner_id,name,audience) values($1,'Private fixture','invited') returning id",[actors.host]);
 await db.query("insert into public.channel_members(channel_id,user_id,role) values($1,$2,'owner'),($1,$3,'member')",[channel,actors.host,actors.viewer]);
 const p=await command(s,c,'publish',{destination:'channel',target_id:channel,format:'horizontal'}),tickets=await issue('channel_message',p.post_id);
 assert.equal(tickets.length,1);assert.ok(await redeem(tickets[0]));
 await db.query('delete from public.channel_members where channel_id=$1 and user_id=$2',[channel,actors.viewer]);assert.equal(await redeem(tickets[0]),null);
});

async function encodePublishedClip() {
 await db.exec("set constraints all deferred;update media_renditions.settings set admission_enabled=true,worker_enabled=true,delivery_enabled=true,gateway_origin='https://media.fixture.test'");
 const {s,c,j}=await ready();
 assert.equal(await value("select count(*)::int from media_renditions.jobs where source_bucket='live-clips'"),0,'Unpublished clips do not enter the generic encoder');
 const published=await command(s,c,'publish',{destination:'feed',format:'horizontal'});
 // The actual command writes publication before destination, so deferred
 // admission must run only after its current destination exists.
 await db.exec('set constraints all immediate');
 assert.equal(await value("select count(*)::int from media_renditions.jobs where source_bucket='live-clips'"),1,'Deferred publication admits the completed destination without a scan');
 const backfill=await as('service_role',null,'select public.backfill_media_renditions_v2(null,100,false)');
 const work=await as('service_role',null,'select public.claim_media_rendition_v2()');
 assert.equal(work.source_bucket,'live-clips'); assert.equal(work.source_path,j.output_prefix+'horizontal.mp4');
 const assets=[{name:'master.m3u8',mime:'application/vnd.apple.mpegurl',playlist:'#EXTM3U\nr0/index.m3u8\n'},
 {name:'r0/index.m3u8',mime:'application/vnd.apple.mpegurl',playlist:'#EXTM3U\nseg00000.ts\n#EXT-X-ENDLIST\n'},
 {name:'r0/seg00000.ts',mime:'video/mp2t'},{name:'fallback.mp4',mime:'video/mp4'}].map(a=>({...a,bytes:100,sha256:'c'.repeat(64)}));
 assert.equal(await as('service_role',null,'select public.register_media_rendition_assets_v2($1,$2,$3,$4)',[work.job_id,work.lease_id,work.attempt,JSON.stringify(assets)]),true);
 for(const a of assets)await db.query("insert into storage.objects(bucket_id,name,version,metadata,user_metadata) values('adaptive-media',$1,$2,$3,$4)",
 [work.output_prefix+a.name,randomUUID(),JSON.stringify({size:100,eTag:'rendition-'+a.name}),JSON.stringify({processing_lease_id:work.lease_id,sha256:a.sha256})]);
 assert.equal(await as('service_role',null,'select public.finish_media_rendition_v2($1,$2,$3,\'ready\',$4)',[work.job_id,work.lease_id,work.attempt,JSON.stringify({width:1280,height:720,duration:30})]),true);
 const tickets=await issue('post',published.post_id),ticket=tickets.find(t=>t.object_path.endsWith('/horizontal.mp4'));
 const readiness=()=>as('service_role',null,'select public.media_playback_readiness_v2($1)',[JSON.stringify([{token:ticket.token,bucket:ticket.bucket_id,path:ticket.object_path}])]);
 return {s,c,published,work,ticket,readiness,backfill};
}
test('published clip HLS uses the actual content-ticket ACL and immediately rejects audience or copyright revocation',async()=>{
 const h=await encodePublishedClip();
 assert.equal((await h.readiness()).items[0].hls,true);
 await db.query("update public.posts set audience='followers' where id=$1",[h.published.post_id]);
 assert.equal(await redeem(h.ticket),null);assert.equal((await h.readiness()).items[0].hls,false);
 await db.query("update public.posts set audience='everyone' where id=$1",[h.published.post_id]);
 assert.equal((await h.readiness()).items[0].hls,true);
 await command(h.s,h.c,'copyright',{status:'blocked',reason:'Synthetic adaptive rights test'});
 assert.equal(await redeem(h.ticket),null);assert.equal((await h.readiness()).items[0].hls,false);
});
test('removing the exact published clip reference invalidates an already issued HLS ticket',async()=>{
 const h=await encodePublishedClip();assert.equal((await h.readiness()).items[0].hls,true);
 await db.query('delete from public.post_media where post_id=$1',[h.published.post_id]);
 await db.query('update public.posts set media_url=null where id=$1',[h.published.post_id]);
 assert.equal((await h.readiness()).items[0].hls,false);
});
