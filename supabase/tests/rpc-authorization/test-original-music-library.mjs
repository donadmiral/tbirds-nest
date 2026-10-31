import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions } from './live-schema-fixture.mjs';
import { loadDeployedMediaBaseline, source } from './deployed-media-baseline.mjs';
const db=new PGlite({extensions});
const ids={owner:randomUUID(),viewer:randomUUID()},sessions={owner:randomUUID(),viewer:randomUUID()};
const base='https://example.supabase.co',hash='a'.repeat(64);
const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
async function actor(name,sql,args=[],role='authenticated',extra={}) {
 await db.exec('savepoint request');
 try {await db.exec(`set local role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[ids[name]||'',role,JSON.stringify({sub:ids[name],session_id:sessions[name],role,iss:base+'/auth/v1',...extra})]);const result=await value(sql,args);await db.exec('reset role;release savepoint request');return result;}
 catch(error){await db.exec('rollback to savepoint request;release savepoint request');throw error;}
}
const reserve=(request=randomUUID(),reuse=false)=>actor('owner','select public.reserve_original_audio($1,$2,$3,$4,$5,$6,$7,$8)',[request,ids.owner,'Synthetic original','audio/wav',88244,hash,reuse,true]);
async function original(reuse=false){const reservation=await reserve(randomUUID(),reuse),version=randomUUID();await db.query("insert into storage.objects(bucket_id,name,owner_id,owner,version,metadata) values('music-audio',$1,$2::text,$2::uuid,$3,$4)",[reservation.path,ids.owner,version,JSON.stringify({size:88244,mimetype:'audio/wav'})]);const soundId=await actor(null,'select public.finish_original_audio_upload($1,$2,2,$3,$4)',[reservation.id,ids.owner,hash,version],'service_role');return {...reservation,version,soundId};}
// Previously verified synthetic rows let the quota cases exercise real RPCs at
// their boundaries without allocating large media files or bypassing the quota
// inside the tested request. The object, sound and reservation remain linked.
async function seedVerifiedAudio(count,bytes=88244,status='ready',ageDays=2){
 await db.query(`with seed as materialized (
  select gen_random_uuid() request_id,gen_random_uuid() object_id,gen_random_uuid() sound_id
  from generate_series(1,$1::integer)
 ), objects as (
  insert into storage.objects(id,bucket_id,name,owner_id,owner,version,metadata)
  select object_id,'music-audio',$2::text||'/'||request_id::text||'.wav',$2::text,$2::uuid,'quota-v1',
   jsonb_build_object('size',$3::integer,'mimetype','audio/wav') from seed returning id
 ), sounds as (
  insert into public.story_sounds(id,owner_id,title,url,duration_sec,source,rights_status,rights_attested_at,asset_sha256,max_excerpt_sec,permitted_uses)
  select sound_id,$2::uuid,'Synthetic verified original','https://example.supabase.co/storage/v1/object/public/music-audio/'||$2::text||'/'||request_id::text||'.wav',
   2,'original','creator_attested',now(),$4,2,array['story','post','memory_album'] from seed returning id
 )
 insert into music_library.uploads(id,owner_id,object_path,origin,title,mime,byte_size,sha256,rights_attested_at,sound_id,object_id,object_version,verified_duration,status,created_at,expires_at)
 select s.request_id,$2::uuid,$2::text||'/'||s.request_id::text||'.wav','https://example.supabase.co','Synthetic verified original','audio/wav',$3::integer,$4,now(),
  s.sound_id,s.object_id,'quota-v1',2,$5,now()-make_interval(days=>$6::integer),now()-make_interval(days=>$6::integer)+interval '24 hours'
 from seed s join objects o on o.id=s.object_id join sounds a on a.id=s.sound_id`,[count,ids.owner,bytes,hash,status,ageDays]);
}
before(async()=>{
 await loadDeployedMediaBaseline(db);
 for(const name of ['20261029224550_admin_operations_completion','20261029224812_account_storage_erasure','20261029224813_private_media_cutover_compatibility','20261029231321_account_erasure_admin_review_queue','20261029231440_bounded_media_delivery','20261030010250_account_erasure_admin_restore_guard'])await db.exec(await source(`supabase/migrations/${name}.sql`));
 if(process.env.MUSIC_FIXTURE_PREEXISTING==='1')for(const name of ['20261022211311_story_sound_rights','20261026063625_soundtrack_rights_and_post_audio'])await db.exec(await source(`supabase/migrations/${name}.sql`));
 try { await db.exec(await source('supabase/migrations/20261030153811_original_music_library_and_delivery.sql')); assert.equal(await value('select uploads_enabled from music_library.service_state'),false);await db.exec("select set_original_audio_service_ready(true,'Synthetic worker contract verified')"); } catch(error) { throw new Error(error.message); }
 if(process.env.MUSIC_PIPELINE_FIXTURE==='1')for(const name of ['20261030203619_music_catalogue_operations_and_cleanup','20261030204339_licensed_catalogue_pipeline'])await db.exec(await source(`supabase/migrations/${name}.sql`));
 for(const [name,id]of Object.entries(ids)){await db.query('insert into auth.users(id,email) values($1,$2)',[id,`music-${name}@example.test`]);await db.query("insert into public.profiles(id,username,full_name,email,profile_visibility) values($1,$2,$2,$3,'public') on conflict(id) do update set username=excluded.username,profile_visibility='public'",[id,`music_${name}`,`music-${name}@example.test`]);await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sessions[name],id]);}
});
after(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
test('private storage and no direct object reads or mutations by the app',async()=>{
 const t=await original();assert.equal(await value("select public from storage.buckets where id='music-audio'"),false);
 assert.equal(await actor('owner',"select count(*) from storage.objects where bucket_id='music-audio' and name=$1",[t.path]),0);
 await assert.rejects(()=>actor('owner',"update music_library.uploads set reuse_allowed=true"),/permission denied/);
 await assert.rejects(()=>actor('owner','select public.finish_original_audio_upload($1,$2,2,$3,$4)',[t.id,ids.owner,hash,t.version]),/permission denied/);
});
test('reservation is account-bound, limited and retry-idempotent',async()=>{
 const id=randomUUID(),a=await reserve(id),b=await reserve(id);assert.equal(a.path,b.path);
 await assert.rejects(()=>actor('viewer','select public.reserve_original_audio($1,$2,$3,$4,$5,$6,false,true)',[id,ids.owner,'Test','audio/wav',88244,hash]),/ACCOUNT_CHANGED/);
 await assert.rejects(()=>actor('owner','select public.reserve_original_audio($1,$2,$3,$4,$5,$6,false,true)',[id,ids.owner,'Test','audio/wav',88245,hash]),/AUDIO_UPLOAD_CONFLICT/);
 assert.equal(await actor('viewer','select public.get_original_audio_upload($1)',[id]),null);
});
test('finalization requires matching bytes, owner, object version and bounds',async()=>{
 const t=await reserve();await db.query("insert into storage.objects(bucket_id,name,owner_id,version,metadata) values('music-audio',$1,$2,'v1','{\"size\":88244}')",[t.path,ids.owner]);
 for(const [duration,digest,version]of [[0,hash,'v1'],[601,hash,'v1'],[2,'b'.repeat(64),'v1'],[2,hash,'replaced']])await assert.rejects(()=>actor(null,'select public.finish_original_audio_upload($1,$2,$3,$4,$5)',[t.id,ids.owner,duration,digest,version],'service_role'),/AUDIO_VALIDATION_FAILED|AUDIO_OBJECT_CHANGED/);
 const one=await actor(null,'select public.finish_original_audio_upload($1,$2,2,$3,$4)',[t.id,ids.owner,hash,'v1'],'service_role');const two=await actor(null,'select public.finish_original_audio_upload($1,$2,2,$3,$4)',[t.id,ids.owner,hash,'v1'],'service_role');assert.equal(one,two);
});
test('private originals are owner-only and require explicit reuse consent',async()=>{
 const t=await original();assert.equal(await actor('owner',"select sound_rights_allow($1,'post')",[t.soundId]),true);assert.equal(await actor('viewer',"select sound_rights_allow($1,'post')",[t.soundId]),false);
 await actor('owner','select set_original_audio_reuse($1,true)',[t.soundId]);assert.equal(await actor('viewer',"select sound_rights_allow($1,'post')",[t.soundId]),true);
 await actor('owner','select set_original_audio_reuse($1,false)',[t.soundId]);assert.equal(await actor('viewer',"select sound_rights_allow($1,'post')",[t.soundId]),false);
});
test('direct sound metadata reads bind to current rights and preserve owner access',async()=>{
 const t=await original(),read=name=>actor(name,'select count(*)::int from story_sounds where id=$1',[t.soundId]);
 assert.equal(await read('owner'),1);assert.equal(await read('viewer'),0);
 await actor('owner','select set_original_audio_reuse($1,true)',[t.soundId]);assert.equal(await read('viewer'),1);
 await actor('owner','select set_original_audio_reuse($1,false)',[t.soundId]);assert.equal(await read('viewer'),0);
 await actor('owner','select revoke_original_audio($1)',[t.soundId]);assert.equal(await read('owner'),1);assert.equal(await read('viewer'),0);
});
test('direct metadata rejects expired owner and viewer sessions and unapproved business identities',async()=>{
 const t=await original(true),read=name=>actor(name,'select count(*)::int from story_sounds where id=$1',[t.soundId]);
 for(const name of ['owner','viewer']){
  assert.equal(await read(name),1);
  await db.query("update auth.sessions set not_after=now()-interval '1 minute' where id=$1",[sessions[name]]);
  await assert.rejects(()=>read(name),/SESSION|AUTH/);
  await db.query('update auth.sessions set not_after=null where id=$1',[sessions[name]]);
  await db.query("update profiles set account_type='business' where id=$1",[ids[name]]);
  await assert.rejects(()=>read(name),/BUSINESS_SESSION_REQUIRED/);
  await db.exec("create function public.business_session_allowed() returns boolean language sql as 'select false'");
  await assert.rejects(()=>read(name),/BUSINESS_SESSION_REQUIRED/);
  await db.exec("create or replace function public.business_session_allowed() returns boolean language sql as 'select true'");
  assert.equal(await read(name),1);
  await db.exec('drop function public.business_session_allowed()');
  await db.query("update profiles set account_type='personal' where id=$1",[ids[name]]);
 }
});
test('favorites persist per user and revoked sounds cannot be saved',async()=>{
 const t=await original(true);await actor('viewer','select set_sound_favorite($1,true)',[t.soundId]);assert.deepEqual(await actor('viewer','select list_sound_favorites()'),[t.soundId]);assert.deepEqual(await actor('owner','select list_sound_favorites()'),[]);
 await actor('owner','select revoke_original_audio($1)',[t.soundId]);await assert.rejects(()=>actor('viewer','select set_sound_favorite($1,true)',[t.soundId]),/SOUND_UNAVAILABLE/);
});
test('sound delivery denies strangers and revocation invalidates warmed capabilities',async()=>{
 const t=await original();const issue=name=>actor(name,"select coalesce(jsonb_agg(t),'[]') from issue_content_media_delivery($1,null) t",[JSON.stringify([{kind:'sound',id:t.soundId}])]);
 assert.deepEqual(await issue('viewer'),[]);const tickets=await issue('owner');assert.equal(tickets.length,1);const ticket=tickets[0];
 const redeem=()=>actor(null,'select resolve_media_delivery($1,$2,$3)',[ticket.token,ticket.bucket_id,ticket.object_path],'service_role');assert.ok(await redeem());
 await actor('owner','select revoke_original_audio($1)',[t.soundId]);assert.equal(await redeem(),null);
});
test('catalogue license metadata cannot activate unlicensed playback',async()=>{
 const t=await original(true);await db.query("update story_sounds set rights_status='licensed',license_ref='pending',licensor='sample',catalog_provider='sample' where id=$1",[t.soundId]);assert.equal(await actor('owner',"select sound_rights_allow($1,'story')",[t.soundId]),false);
 await assert.rejects(()=>actor('owner',"insert into music_library.providers(id,name) values('sample','Sample')"),/permission denied/);
});
test('erasure workflow recognizes the private music bucket',async()=>{
 const candidates=(await db.query("select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='account_erasure' and p.prosrc like '%application-cvs%'")).rows;assert.ok(candidates.some(row=>row.prosrc.includes("'music-audio'")));
});
test('verified story audio publishes once and keeps its trim with the original request hash',async()=>{
 const t=await original(),request=randomUUID();const payload={media_type:'text',audience:'everyone',caption:'Original audio',text_background:{colors:['#112233']},audio_draft:{kind:'sound',soundId:t.soundId,startSec:1,durationSec:1,title:'Untrusted client title'}};
 const publish=()=>actor('owner','select publish_story_v2($1,$2,$3)',[ids.owner,request,JSON.stringify(payload)]);
 const one=await publish(),two=await publish();assert.equal(one,two);
 const story=(await db.query('select audio_sound_id,audio_title,audio_duration_sec,media_transform from stories where id=$1',[one])).rows[0];assert.equal(story.audio_sound_id,t.soundId);assert.equal(story.audio_title,'Synthetic original');assert.equal(story.audio_duration_sec,1);assert.equal(story.media_transform.audioStartSec,1);const reader=await actor('viewer','select media_transform from get_user_stories($1) where id=$2',[ids.owner,one]);assert.equal(reader.audioSoundId,t.soundId);
 const visible=await actor('viewer',"select coalesce(jsonb_agg(m),'[]') from content_media_manifest($1) m",[JSON.stringify([{kind:'story',id:one}])]);assert.ok(visible.some(row=>row.media_url.includes('/music-audio/')));
 await assert.rejects(()=>actor('viewer','select publish_story_v2($1,$2,$3)',[ids.viewer,randomUUID(),JSON.stringify(payload)]),/VERIFIED_ORIGINAL_AUDIO_REQUIRED/);
});
test('book soundtrack persists, respects ownership and verifies export permission',async()=>{
 const t=await original(),album=await actor('owner',"select create_memory_book_design('Original music book','cream','postcard')");
 const selection={soundId:t.soundId,startSec:0,durationSec:2,volume:.5,originalVolume:1};
 await actor('owner','select save_memory_book_soundtrack($1,$2)',[album,JSON.stringify(selection)]);const book=await actor('owner','select get_memory_book($1)',[album]);assert.deepEqual(book.soundtrack,selection);
 await assert.rejects(()=>actor('viewer','select save_memory_book_soundtrack($1,null)',[album]),/BOOK_NOT_OWNED/);
 assert.equal((await actor('owner',"select authorize_original_audio_export($1,'memory_album')",[t.soundId])).id,t.soundId);
 await actor('owner','select set_original_audio_reuse($1,true)',[t.soundId]);await assert.rejects(()=>actor('viewer',"select authorize_original_audio_export($1,'memory_album')",[t.soundId]),/AUDIO_EXPORT_RIGHTS_REQUIRED/);
});
test('retained story audio follows the memory book audience and revocation without granting reuse',async()=>{
 const t=await original(),album=await actor('owner',"select create_memory_book_design('Retained original','cream','postcard')");
 const story=await actor('owner','select publish_story_v2($1,$2,$3)',[ids.owner,randomUUID(),JSON.stringify({media_type:'text',audience:'followers',caption:'Original memory',media_transform:null,text_background:{colors:['#112233']},audio_draft:{kind:'sound',soundId:t.soundId,startSec:1,durationSec:1}})]);
 const page=await actor('owner',"select add_memory_page($1,null,'polaroid',$2)",[story,album]);
 await db.query("update stories set expires_at=now()-interval '1 day' where id=$1",[story]);
 await db.query("update memory_albums set audience='only_me' where id=$1",[album]);
 assert.equal((await actor('viewer','select get_memory_book($1)',[album])).can_view,false);
 assert.equal(await actor('viewer',"select sound_rights_allow($1,'memory_album')",[t.soundId]),false);
 await db.query("update memory_albums set audience='profile' where id=$1",[album]);
 const book=await actor('viewer','select get_memory_book($1)',[album]);assert.equal(book.can_view,true);assert.equal(book.pages[0].id,page);assert.equal(book.pages[0].audio_sound_id,t.soundId);assert.equal(book.pages[0].audio_duration_sec,1);assert.equal(book.pages[0].media_transform.audioStartSec,1);assert.ok(book.pages[0].audio_url.includes('/music-audio/'));
 const tickets=await actor('viewer',"select coalesce(jsonb_agg(t),'[]') from issue_content_media_delivery($1,null) t",[JSON.stringify([{kind:'memory_album',id:album}])]);const audio=tickets.find(row=>row.bucket_id==='music-audio');assert.ok(audio);
 const redeem=()=>actor(null,'select resolve_media_delivery($1,$2,$3)',[audio.token,audio.bucket_id,audio.object_path],'service_role');assert.ok(await redeem());
 await assert.rejects(()=>actor('viewer',"select validate_soundtrack($1,'memory_album')",[JSON.stringify({soundId:t.soundId,startSec:0,durationSec:1,volume:1,originalVolume:1})]),/SOUND_REUSE_NOT_ALLOWED/);
 await actor('owner','select revoke_original_audio($1)',[t.soundId]);assert.equal(await redeem(),null);assert.equal((await actor('viewer','select get_memory_book($1)',[album])).pages[0].audio_url,null);
});
test('catalogue configuration and staff previews deny ordinary callers',async()=>{
 await assert.rejects(()=>actor('owner','select admin_music_snapshot($1,$2)',[ids.owner,sessions.owner]),/permission denied/);
 await assert.rejects(()=>actor(null,'select admin_music_snapshot($1,$2)',[ids.owner,sessions.owner],'service_role'),/MUSIC_ADMIN_REQUIRED/);
 await assert.rejects(()=>actor(null,"select admin_music_command($1,$2,'provider.save','{\"id\":\"sample\",\"name\":\"Sample\"}')",[ids.owner,sessions.owner],'service_role'),/MUSIC_ADMIN_REQUIRED/);
});
test('an indeterminate admin session cannot read or change music administration',async()=>{
 await db.query("insert into admin_users(user_id,role) values($1,'trust_safety')",[ids.viewer]);
 await db.exec('create or replace function public.triniti_admin_session_check(p_user_id uuid,p_session_id uuid) returns boolean language sql as $$select null::boolean$$');
 await assert.rejects(()=>actor(null,'select admin_music_snapshot($1,$2)',[ids.viewer,sessions.viewer],'service_role'),/MUSIC_ADMIN_REQUIRED/);
 await assert.rejects(()=>actor(null,"select admin_music_command($1,$2,'provider.save','{\"id\":\"sample\",\"name\":\"Sample\"}')",[ids.viewer,sessions.viewer],'service_role'),/MUSIC_ADMIN_REQUIRED/);
});

test('business original audio fails closed until its actual Auth session is approved',async()=>{
 await db.query("update public.profiles set account_type='business' where id=$1",[ids.owner]);
 await assert.rejects(()=>reserve(),/BUSINESS_SESSION_REQUIRED/);
 await db.exec("create function public.business_session_allowed() returns boolean language sql as 'select false'");
 await assert.rejects(()=>reserve(),/BUSINESS_SESSION_REQUIRED/);
 await db.exec("create or replace function public.business_session_allowed() returns boolean language sql as 'select true'");
 assert.equal((await reserve()).status,'reserved');
});
test('private post soundtrack is playable by its audience but cannot be reused by that audience',async()=>{
 const t=await original(),post=randomUUID(),media=randomUUID(),path=`${ids.owner}/${media}.jpg`,url=`${base}/storage/v1/object/public/post-media/${path}`;
 await db.query("insert into storage.objects(bucket_id,name,owner_id,owner,version) values('post-media',$1,$2::text,$2::uuid,'visual-v1')",[path,ids.owner]);
 await actor('owner',"insert into posts(id,user_id,body,audience) values($1,$2,'Original soundtrack','followers') returning id",[post,ids.owner]);
 const selection={soundId:t.soundId,startSec:0,durationSec:2,volume:.5,originalVolume:1};
 await actor('owner',"insert into post_media(id,post_id,url,media_type,sort_order,is_sensitive,edit) values($1,$2,$3,'image',0,false,$4) returning id",[media,post,url,JSON.stringify({soundtrack:selection})]);
 assert.equal(await actor('viewer',"select sound_rights_allow($1,'post')",[t.soundId]),false);
 await actor('owner',"update posts set audience='everyone' where id=$1 returning id",[post]);
 assert.equal(await actor('viewer',"select sound_rights_allow($1,'post')",[t.soundId]),true);
 await assert.rejects(()=>actor('viewer',"select validate_soundtrack($1,'post')",[JSON.stringify(selection)]),/SOUND_REUSE_NOT_ALLOWED/);
 await actor('owner','select revoke_original_audio($1)',[t.soundId]);assert.equal(await actor('viewer',"select sound_rights_allow($1,'post')",[t.soundId]),false);
});
test('staff can prepare licensed-provider metadata and review original bytes without activating catalogue playback',async()=>{
 const t=await original();await db.query("insert into admin_users(user_id,role) values($1,'trust_safety')",[ids.viewer]);
 const command=(action,payload)=>actor(null,'select admin_music_command($1,$2,$3,$4)',[ids.viewer,sessions.viewer,action,JSON.stringify(payload)],'service_role');
 await command('provider.save',{id:'test-provider',name:'Synthetic provider'});
 const draft={providerId:'test-provider',reference:'contract-draft',licensor:'Synthetic rights holder',territories:['US','GB'],uses:['story','post','memory_album'],startsAt:'2027-01-01T00:00:00Z',endsAt:'2028-01-01T00:00:00Z',exportAllowed:true,evidence:'Pending signed contract'};
 const one=await command('license.draft',draft),two=await command('license.draft',draft);assert.equal(one.id,two.id);
 const snapshot=await actor(null,'select admin_music_snapshot($1,$2)',[ids.viewer,sessions.viewer],'service_role');assert.equal(snapshot.catalogEnabled,false);assert.equal(snapshot.licenses[0].status,'awaiting_license');
 await assert.rejects(()=>command('license.activate',{id:one.id}),/MUSIC_COMMAND_NOT_SUPPORTED/);
 await assert.rejects(()=>command('license.draft',{...draft,endsAt:'2026-01-01T00:00:00Z'}),/check constraint/);
 const object=await actor(null,'select admin_original_audio_object($1,$2,$3)',[ids.viewer,sessions.viewer,t.soundId],'service_role');assert.equal(object.path,t.path);
 await command('sound.revoke',{soundId:t.soundId,reason:'Synthetic moderation review'});assert.equal(await actor('owner',"select sound_rights_allow($1,'story')",[t.soundId]),false);
 await db.query('update admin_users set active=false where user_id=$1',[ids.viewer]);await assert.rejects(()=>command('provider.save',{id:'another',name:'Another'}),/MUSIC_ADMIN_REQUIRED/);
});
test('account erasure queues the original object, denies false acknowledgements and erases audio metadata after Storage deletion',async()=>{
 const t=await original(true);await actor('viewer','select set_sound_favorite($1,true)',[t.soundId]);
 await db.exec("update account_erasure.worker set last_seen_at=clock_timestamp(),secret_digest=extensions.digest('test-worker','sha256')");
 const job=randomUUID(),worker=randomUUID(),token=randomBytes(32).toString('hex');
 const request=await actor('owner','select request_account_erasure($1,$2)',[job,token]);assert.equal(request.filesTotal,1);
 await assert.rejects(()=>actor(null,'select finish_original_audio_upload($1,$2,2,$3,$4)',[t.id,ids.owner,hash,t.version],'service_role'),/ACCOUNT_ERASURE_IN_PROGRESS/);
 const claim=await actor(null,'select claim_account_erasure($1)',[worker],'service_role');assert.equal(claim.objects[0].bucket,'music-audio');
 const object=await value("select id from storage.objects where bucket_id='music-audio' and name=$1",[t.path]);
 assert.equal(await actor(null,'select ack_account_erasure_object($1,$2,$3)',[job,worker,object],'service_role'),false);
 await db.query('delete from storage.objects where id=$1',[object]);
 assert.equal(await actor(null,'select ack_account_erasure_object($1,$2,$3)',[job,worker,object],'service_role'),true);
 await actor(null,'select prepare_account_erasure_identity($1,$2)',[job,worker],'service_role');
 await db.query("update account_erasure.jobs set cache_until=clock_timestamp()-interval '1 second' where id=$1",[job]);
 assert.equal(await actor(null,'select prepare_account_erasure_identity($1,$2)',[job,worker],'service_role'),'ready');
 await db.query('delete from auth.users where id=$1',[ids.owner]);
 assert.equal(await value('select count(*)::int from music_library.uploads where owner_id=$1',[ids.owner]),0);
 assert.deepEqual(await actor('viewer','select list_sound_favorites()'),[]);
 assert.equal(await value('select count(*)::int from music_library.events where actor_id=$1 or sound_id=$2',[ids.owner,t.soundId]),0);
});

test('upload readiness is explicit and cannot be enabled by an application caller',async()=>{
 assert.equal((await actor('owner','select get_original_audio_capabilities()')).uploadsEnabled,true);
 await actor(null,"select set_original_audio_service_ready(false,'Synthetic maintenance window')",[],'service_role');
 assert.equal((await actor('owner','select get_original_audio_capabilities()')).uploadsEnabled,false);
 await assert.rejects(()=>reserve(),/ORIGINAL_AUDIO_SERVICE_NOT_READY/);
 await assert.rejects(()=>actor('owner',"select set_original_audio_service_ready(true,'Unauthorized activation')"),/permission denied/);
});
test('original list metadata requires a current Auth session and the business session contract',async()=>{
 await original(true);
 const list=()=>actor('viewer',"select coalesce(jsonb_agg(s),'[]') from list_playable_sounds('story','',40)s");
 assert.equal((await list()).length,1);
 await db.query("update auth.sessions set not_after=now()-interval '1 minute' where id=$1",[sessions.viewer]);
 await assert.rejects(list,/SESSION|AUTH/);
 await db.query('update auth.sessions set not_after=null where id=$1',[sessions.viewer]);
 await db.query("update profiles set account_type='business' where id=$1",[ids.viewer]);
 await assert.rejects(list,/BUSINESS_SESSION_REQUIRED/);
 await db.exec("create function public.business_session_allowed() returns boolean language sql as 'select false'");
 await assert.rejects(list,/BUSINESS_SESSION_REQUIRED/);
 await db.exec("create or replace function public.business_session_allowed() returns boolean language sql as 'select true'");
 assert.equal((await list()).length,1);
});

test('legacy sound publication is retired and new write tables carry erasure fences',async()=>{
 await assert.rejects(()=>actor('owner','select publish_story_sound($1,true)',[randomUUID()]),/ORIGINAL_AUDIO_UPLOAD_REQUIRED/);
 await assert.rejects(()=>actor('owner',"select resolve_story_soundtrack('{}')"),/permission denied/);
 assert.equal(await value("select has_function_privilege('authenticated','public.resolve_story_soundtrack(jsonb)','execute')"),false);
 assert.equal(await value("select has_function_privilege('service_role','public.resolve_story_soundtrack(jsonb)','execute')"),true);
 const guarded=await value("select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='music_library' and t.tgname='account_erasure_actor_write'");assert.equal(guarded,process.env.MUSIC_PIPELINE_FIXTURE==='1'?16:6);
});

test('expired reservations retain capacity beyond the daily window and exact retry reuses its slot',async()=>{
 const rows=[];for(let i=0;i<20;i++)rows.push(await reserve());
 await db.query("update music_library.uploads set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where owner_id=$1",[ids.owner]);
 assert.equal(await value('select count(*)::int from music_library.uploads where owner_id=$1',[ids.owner]),20);
 assert.equal(await actor('owner','select get_original_audio_upload($1)',[rows[0].id]),null);
 await assert.rejects(()=>reserve(),/AUDIO_STORAGE_LIMIT/);
 const retry=await reserve(rows[0].id);assert.equal(retry.path,rows[0].path);
 assert.equal(await value('select count(*)::int from music_library.uploads where owner_id=$1',[ids.owner]),20);
 assert.ok(await actor('owner','select get_original_audio_upload($1)',[rows[0].id]));
 await assert.rejects(()=>reserve(),/AUDIO_STORAGE_LIMIT/);
});

test('underdeclared unverified files consume full bucket capacity before finalization',async()=>{
 const tiny=()=>actor('owner','select reserve_original_audio($1,$2,$3,$4,44,$5,false,true)',[randomUUID(),ids.owner,'Synthetic tiny declaration','audio/wav',hash]);
 const first=await tiny();
 // This is a synthetic Storage metadata insertion under the real RLS policy,
 // not a claim that a hosted upload or 50 MiB of actual audio was transferred.
 await actor('owner',"insert into storage.objects(bucket_id,name,owner_id,owner,version,metadata) values('music-audio',$1,$2::text,$2::uuid,'oversized-v1','{\"size\":52428800,\"mimetype\":\"audio/wav\"}')",[first.path,ids.owner]);
 for(let i=1;i<20;i++)await tiny();
 assert.equal(await value('select sum(byte_size)::int from music_library.uploads where owner_id=$1',[ids.owner]),880);
 await assert.rejects(tiny,/AUDIO_STORAGE_LIMIT/);
 await assert.rejects(()=>actor(null,'select finish_original_audio_upload($1,$2,2,$3,$4)',[first.id,ids.owner,hash,'oversized-v1'],'service_role'),/AUDIO_OBJECT_CHANGED/);
 assert.equal(await value('select status from music_library.uploads where id=$1',[first.id]),'reserved');
 await assert.rejects(tiny,/AUDIO_STORAGE_LIMIT/);
});

test('verified byte size releases only unused capacity and remains accounted after revocation',async()=>{
 const rows=[];for(let i=0;i<20;i++)rows.push(await reserve());
 await assert.rejects(()=>reserve(),/AUDIO_STORAGE_LIMIT/);
 const first=rows[0];
 await db.query("insert into storage.objects(bucket_id,name,owner_id,owner,version,metadata) values('music-audio',$1,$2::text,$2::uuid,'verified-v1','{\"size\":88244,\"mimetype\":\"audio/wav\"}')",[first.path,ids.owner]);
 const sound=await actor(null,'select finish_original_audio_upload($1,$2,2,$3,$4)',[first.id,ids.owner,hash,'verified-v1'],'service_role');
 await actor('owner','select revoke_original_audio($1)',[sound]);
 assert.equal((await reserve()).status,'reserved');
 await assert.rejects(()=>reserve(),/AUDIO_STORAGE_LIMIT/);
 assert.equal(await value('select count(*)::int from music_library.uploads where owner_id=$1',[ids.owner]),21);
});

test('revoking old verified audio cannot release the bytes still retained in Storage',async()=>{
 await seedVerifiedAudio(20,52428800,'ready',2);
 const rows=(await db.query('select sound_id from music_library.uploads where owner_id=$1',[ids.owner])).rows;
 for(const row of rows)await actor('owner','select revoke_original_audio($1)',[row.sound_id]);
 assert.equal(await value("select count(*)::int from music_library.uploads where owner_id=$1 and status='revoked'",[ids.owner]),20);
 assert.equal(await value("select count(*)::int from storage.objects where bucket_id='music-audio' and owner_id=$1",[ids.owner]),20);
 await assert.rejects(()=>reserve(),/AUDIO_STORAGE_LIMIT/);
});

test('a revoked unverified reservation keeps its full capacity charge',async()=>{
 for(let i=0;i<20;i++)await reserve();
 await db.query("update music_library.uploads set status='revoked',created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where owner_id=$1",[ids.owner]);
 assert.equal(await value('select count(*)::int from music_library.uploads where owner_id=$1 and object_id is null',[ids.owner]),20);
 await assert.rejects(()=>reserve(),/AUDIO_STORAGE_LIMIT/);
});

test('the retained record cap includes old verified originals even when byte capacity remains',async()=>{
 await seedVerifiedAudio(999,88244,'ready',2);
 assert.equal((await reserve()).status,'reserved');
 assert.equal(await value('select count(*)::int from music_library.uploads where owner_id=$1',[ids.owner]),1000);
 await assert.rejects(()=>reserve(),/AUDIO_STORAGE_LIMIT/);
});

test('the daily upload rate limit remains separate from retained storage capacity',async()=>{
 await seedVerifiedAudio(100,88244,'ready',0);
 await assert.rejects(()=>reserve(),error=>error.message==='AUDIO_UPLOAD_LIMIT');
 await db.query("update music_library.uploads set created_at=now()-interval '2 days' where owner_id=$1",[ids.owner]);
 assert.equal((await reserve()).status,'reserved');
});

test('a second stale allocation cannot consume the last slot twice and another owner has its own budget',async()=>{
 for(let i=0;i<19;i++)await reserve();
 const winning=await reserve();await assert.rejects(()=>reserve(),/AUDIO_STORAGE_LIMIT/);
 assert.equal((await reserve(winning.id)).path,winning.path);
 assert.equal(await value('select count(*)::int from music_library.uploads where owner_id=$1',[ids.owner]),20);
 const other=await actor('viewer','select reserve_original_audio($1,$2,$3,$4,88244,$5,false,true)',[randomUUID(),ids.viewer,'Other owner original','audio/wav',hash]);
 assert.equal(other.status,'reserved');
 // PGlite has one connection. The production RPC's existing owner advisory
 // lock serializes allocations; this case verifies ordered winning/stale state.
});

test('erasure queues expired unfinished original objects without a published sound',async()=>{
 const pending=await reserve();
 await db.query("insert into storage.objects(bucket_id,name,owner_id,owner,version,metadata) values('music-audio',$1,$2::text,$2::uuid,'expired-v1','{\"size\":88244,\"mimetype\":\"audio/wav\"}')",[pending.path,ids.owner]);
 await db.query("update music_library.uploads set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",[pending.id]);
 assert.equal(await value('select sound_id from music_library.uploads where id=$1',[pending.id]),null);
 await db.exec("update account_erasure.worker set last_seen_at=clock_timestamp(),secret_digest=extensions.digest('test-worker','sha256')");
 const job=randomUUID(),worker=randomUUID(),token=randomBytes(32).toString('hex');
 const request=await actor('owner','select request_account_erasure($1,$2)',[job,token]);assert.equal(request.filesTotal,1);
 const claim=await actor(null,'select claim_account_erasure($1)',[worker],'service_role');
 assert.equal(claim.objects.length,1);assert.equal(claim.objects[0].bucket,'music-audio');assert.equal(claim.objects[0].path,pending.path);
});
