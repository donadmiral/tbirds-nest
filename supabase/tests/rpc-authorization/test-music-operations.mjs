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
before(async()=>{
 await loadDeployedMediaBaseline(db);
 for(const name of ['20261029224550_admin_operations_completion','20261029224812_account_storage_erasure','20261029224813_private_media_cutover_compatibility','20261029231321_account_erasure_admin_review_queue','20261029231440_bounded_media_delivery','20261030010250_account_erasure_admin_restore_guard'])await db.exec(await source(`supabase/migrations/${name}.sql`));
 if(process.env.MUSIC_FIXTURE_PREEXISTING==='1')for(const name of ['20261022211311_story_sound_rights','20261026063625_soundtrack_rights_and_post_audio'])await db.exec(await source(`supabase/migrations/${name}.sql`));
 try { await db.exec(await source('supabase/migrations/20261030153811_original_music_library_and_delivery.sql')); assert.equal(await value('select uploads_enabled from music_library.service_state'),false);await db.exec("select set_original_audio_service_ready(true,'Synthetic worker contract verified')"); } catch(error) { throw new Error(error.message); }
 await db.exec(await source('supabase/migrations/20261030203619_music_catalogue_operations_and_cleanup.sql'));
 for(const [name,id]of Object.entries(ids)){await db.query('insert into auth.users(id,email) values($1,$2)',[id,`music-${name}@example.test`]);await db.query("insert into public.profiles(id,username,full_name,email,profile_visibility) values($1,$2,$2,$3,'public') on conflict(id) do update set username=excluded.username,profile_visibility='public'",[id,`music_${name}`,`music-${name}@example.test`]);await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sessions[name],id]);}
});
after(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
const worker=randomUUID();
const service=(sql,args=[])=>actor(null,sql,args,'service_role');
async function enableCleanup(){
 await db.exec("update music_library.maintenance_worker set secret_digest=extensions.digest('pc_music_'||repeat('a',64),'sha256')");
 await service("select set_music_maintenance_ready(true,'Synthetic deployed worker')");
 assert.equal(await service("select validate_music_maintenance_worker('pc_music_'||repeat('a',64))"),true);
}
async function abandon(withObject=true){
 const r=await reserve();
 if(withObject)await db.query("insert into storage.objects(bucket_id,name,owner_id,owner,version,metadata) values('music-audio',$1,$2::text,$2::uuid,'abandoned-v1','{\"size\":88244}')",[r.path,ids.owner]);
 await db.query("update music_library.uploads set expires_at=clock_timestamp()-interval '25 hours' where id=$1",[r.id]);
 return r;
}
const claim=()=>service('select claim_music_upload_cleanup($1)',[worker]);
const check=id=>service('select check_music_upload_cleanup($1,$2)',[id,worker]);
const ack=id=>service('select ack_music_upload_cleanup($1,$2)',[id,worker]);
async function staff(){
 await db.query("insert into admin_users(user_id,role) values($1,'trust_safety')",[ids.viewer]);
 const args=[ids.viewer,sessions.viewer];
 await service("select admin_music_command($1,$2,'provider.save','{\"id\":\"fixture\",\"name\":\"Fixture provider\"}')",args);
 return args;
}
const manifest=(overrides={})=>({version:1,tracks:[{id:'track-1',revision:'v1',title:'Fixture music',artist:'Fixture artist',durationSec:180,assetRef:'catalogue/track-1',...overrides}]});

test('operations tables and privileged entry points deny ordinary accounts',async()=>{
 for(const table of ['maintenance_worker','cleanup_jobs','catalogue_imports','catalogue_tracks','usage_events']){
  assert.equal(await value('select relrowsecurity from pg_class where oid=$1::regclass',[`music_library.${table}`]),true);
  await assert.rejects(()=>actor('owner',`select count(*) from music_library.${table}`),/permission denied/);
 }
 for(const [sql,args]of [['select claim_music_upload_cleanup($1)',[worker]],['select admin_music_operations_snapshot($1,$2)',[ids.owner,sessions.owner]],['select admin_music_usage_report($1,$2,now(),now())',[ids.owner,sessions.owner]]])await assert.rejects(()=>actor('owner',sql,args),/permission denied/);
 await assert.rejects(()=>service('select admin_music_operations_snapshot($1,$2)',[ids.owner,sessions.owner]),/MUSIC_ADMIN_REQUIRED/);
});
test('maintenance starts disabled and accepts only its configured scoped credential',async()=>{
 await abandon();assert.equal(await claim(),null);
 await assert.rejects(()=>service("select set_music_maintenance_ready(true,'Ready for testing')"),/CREDENTIAL_REQUIRED/);
 await enableCleanup();assert.equal(await service("select validate_music_maintenance_worker('pc_music_'||repeat('b',64))"),false);
 assert.equal(await service("select validate_music_maintenance_worker('a service key')"),false);
 await service("select set_music_maintenance_ready(false,'Paused for inspection')");assert.equal(await claim(),null);
});
test('active reservations, grace period and published originals never enter abandoned cleanup',async()=>{
 await enableCleanup();const current=await reserve(),ready=await original(),grace=await reserve();
 await db.query("update music_library.uploads set expires_at=now()-interval '2 hours' where id=$1",[grace.id]);
 await db.query("update music_library.uploads set expires_at=now()-interval '10 days' where id=$1",[ready.id]);
 assert.equal(await claim(),null);
 assert.equal(await value('select status from music_library.uploads where id=$1',[current.id]),'reserved');
});
test('cleanup fences retries, Storage inserts and finalization before deleting bytes',async()=>{
 await enableCleanup();const r=await abandon();const j=await claim();assert.equal(j.id,r.id);
 assert.equal(await check(r.id),'delete');
 assert.equal(await actor('owner','select music_upload_permitted($1)',[r.path]),false);
 assert.equal(await actor('owner','select get_original_audio_upload($1)',[r.id]),null);
 await assert.rejects(()=>reserve(r.id),/AUDIO_UPLOAD_EXPIRED/);
 await assert.rejects(()=>service('select finish_original_audio_upload($1,$2,2,$3,$4)',[r.id,ids.owner,hash,'abandoned-v1']),/AUDIO_UPLOAD_EXPIRED/);
 assert.equal(await ack(r.id),false);
 assert.equal(await value('select status from music_library.uploads where id=$1',[r.id]),'purging');
 // Test fixture models a successful Storage API deletion. Production never
 // deletes storage.objects directly, because that would orphan stored bytes.
 await db.query("delete from storage.objects where bucket_id='music-audio' and name=$1",[r.path]);
 assert.equal(await ack(r.id),true);
 assert.equal(await value('select status from music_library.uploads where id=$1',[r.id]),'purged');
 await assert.rejects(()=>reserve(r.id),/AUDIO_UPLOAD_EXPIRED/);
});
test('missing abandoned objects complete without a Storage delete and retain a nonreusable request tombstone',async()=>{
 await enableCleanup();const r=await abandon(false);const j=await claim();assert.equal(j.objectId,null);assert.equal(await check(r.id),'absent');assert.equal(await ack(r.id),true);
 assert.equal(await value('select count(*)::int from music_library.uploads where id=$1',[r.id]),1);
 assert.equal(await claim(),null);
});
test('a changed object version or owner requires review and never releases quota',async()=>{
 for(const change of ['version','owner']){
  await enableCleanup();const r=await abandon();await claim();
  if(change==='version')await db.query("update storage.objects set version='replaced' where name=$1 and bucket_id='music-audio'",[r.path]);
  else await db.query("update storage.objects set owner_id=$1::text,owner=$1::uuid where name=$2 and bucket_id='music-audio'",[ids.viewer,r.path]);
  assert.equal(await check(r.id),'review');assert.equal(await ack(r.id),false);
  assert.equal(await value('select status from music_library.uploads where id=$1',[r.id]),'purging');
 }
});
test('leases exclude another worker and failed attempts back off before a new claim',async()=>{
 await enableCleanup();const r=await abandon();await claim();
 assert.equal(await service('select check_music_upload_cleanup($1,$2)',[r.id,randomUUID()]),'denied');
 assert.equal(await service('select claim_music_upload_cleanup($1)',[randomUUID()]),null);
 await service('select fail_music_upload_cleanup($1,$2)',[r.id,worker]);assert.equal(await claim(),null);
 await db.query("update music_library.cleanup_jobs set next_attempt_at=now()-interval '1 second' where upload_id=$1",[r.id]);
 assert.equal((await claim()).id,r.id);
});
test('expired lease safely resumes an already successful Storage delete',async()=>{
 await enableCleanup();const r=await abandon();await claim();
 await db.query("delete from storage.objects where bucket_id='music-audio' and name=$1",[r.path]);
 await db.query("update music_library.cleanup_jobs set lease_until=clock_timestamp()-interval '1 second' where upload_id=$1",[r.id]);
 const next=randomUUID();assert.equal((await service('select claim_music_upload_cleanup($1)',[next])).id,r.id);
 assert.equal(await ack(r.id),false);
 assert.equal(await service('select ack_music_upload_cleanup($1,$2)',[r.id,next]),true);
});
test('only verified Storage absence releases the retained allocation',async()=>{
 await enableCleanup();let first;
 for(let i=0;i<20;i++){const r=await abandon(false);first??=r;}
 await assert.rejects(()=>reserve(),/AUDIO_STORAGE_LIMIT/);const j=await claim();
 await assert.rejects(()=>reserve(),/AUDIO_STORAGE_LIMIT/);
 assert.equal(await ack(j.id),true);assert.equal((await reserve()).status,'reserved');
 assert.equal(await value("select count(*)::int from music_library.uploads where status='purged'"),1);
});
test('cleanup retains daily rate accounting and metadata for exact old-request rejection',async()=>{
 await enableCleanup();const r=await abandon(false);await claim();await ack(r.id);
 assert.equal(await value("select count(*)::int from music_library.uploads where owner_id=$1 and created_at>now()-interval '24 hours'",[ids.owner]),1);
 const fresh=await reserve();assert.notEqual(fresh.path,r.path);
});
test('catalogue imports are atomic, idempotent and never create playable sounds',async()=>{
 const admin=await staff(),id=randomUUID(),m=manifest();
 const call=data=>service('select admin_stage_music_catalogue($1,$2,$3,$4,$5)',[...admin,id,'fixture',JSON.stringify(data)]);
 const first=await call(m);assert.equal(first.added,1);assert.equal(first.catalogEnabled,false);assert.equal((await call(m)).replayed,true);
 assert.equal(await value('select count(*)::int from public.story_sounds'),0);
 assert.equal(await value('select count(*)::int from storage.objects'),0);
 await assert.rejects(()=>call(manifest({title:'Changed'})),/CATALOGUE_IMPORT_CONFLICT/);
 assert.equal((await actor('owner','select get_original_audio_capabilities()')).catalogEnabled,false);
});
test('catalogue revisions cannot mutate and invalid batches roll back their imports',async()=>{
 const admin=await staff();const call=m=>service('select admin_stage_music_catalogue($1,$2,$3,$4,$5)',[...admin,randomUUID(),'fixture',JSON.stringify(m)]);
 await call(manifest());await assert.rejects(()=>call(manifest({title:'Replace revision'})),/CATALOGUE_REVISION_IMMUTABLE/);
 await assert.rejects(()=>call({version:1,tracks:[...manifest({id:'new-valid'}).tracks,...manifest({id:'invalid',assetRef:'https://private.example/secret'}).tracks]}),/check constraint/);
 assert.equal(await value('select count(*)::int from music_library.catalogue_tracks'),1);
 assert.equal(await value('select count(*)::int from music_library.catalogue_imports'),1);
});
test('catalogue rejects duplicate tracks, oversized batches, unknown fields and unmatched rights drafts',async()=>{
 const admin=await staff();const call=m=>service('select admin_stage_music_catalogue($1,$2,$3,$4,$5)',[...admin,randomUUID(),'fixture',JSON.stringify(m)]);
 for(const [m,expected] of [[{version:1,tracks:[]},/BATCH_LIMIT/],[{version:1,tracks:Array(101).fill(manifest().tracks[0])},/BATCH_LIMIT/],[{version:1,tracks:Array(2).fill(manifest().tracks[0])},/DUPLICATE/],[manifest({secret:'not accepted'}),/INVALID_CATALOGUE_TRACK/],[manifest({licenseReference:'missing'}),/RIGHTS_DRAFT_REQUIRED/]])await assert.rejects(()=>call(m),expected);
});
test('staff staging and reports recheck current session authorization',async()=>{
 const admin=await staff();await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sessions.viewer]);
 await assert.rejects(()=>service('select admin_stage_music_catalogue($1,$2,$3,$4,$5)',[...admin,randomUUID(),'fixture',JSON.stringify(manifest())]),/MUSIC_ADMIN_REQUIRED/);
 await assert.rejects(()=>service("select admin_music_usage_report($1,$2,now()-interval '1 day',now())",admin),/MUSIC_ADMIN_REQUIRED/);
});
test('music delivery records one authorization per ticket and refuses revoked playback',async()=>{
 const t=await original();const tickets=await actor('owner',"select coalesce(jsonb_agg(t),'[]') from issue_content_media_delivery($1,null)t",[JSON.stringify([{kind:'sound',id:t.soundId}])]);const ticket=tickets[0];
 const redeem=()=>service('select resolve_media_delivery($1,$2,$3)',[ticket.token,ticket.bucket_id,ticket.object_path]);
 assert.ok(await redeem());assert.ok(await redeem());
 assert.equal(await value("select count(*)::int from music_library.usage_events where event_type='delivery_authorization'"),1);
 await actor('owner','select revoke_original_audio($1)',[t.soundId]);assert.equal(await redeem(),null);
 assert.equal(await value("select count(*)::int from music_library.usage_events where event_type='delivery_authorization'"),1);
});
test('attachment and export authorization events use server identity and do not claim listening time',async()=>{
 const t=await original(),book=await actor('owner',"select create_memory_book_design('Reported book','cream','postcard')");
 const selection={soundId:t.soundId,startSec:0,durationSec:2,volume:.5,originalVolume:1};
 await db.query("update auth.users set raw_app_meta_data='{\"music_territory\":\"US\",\"music_territory_verified_until\":\"2099-01-01T00:00:00Z\"}' where id=$1",[ids.owner]);
 await actor('owner','select save_memory_book_soundtrack($1,$2)',[book,JSON.stringify(selection)]);
 await actor('owner','select save_memory_book_soundtrack($1,$2)',[book,JSON.stringify(selection)]);
 await actor('owner',"select authorize_original_audio_export($1,'memory_album')",[t.soundId]);
 assert.equal(await value("select count(*)::int from music_library.usage_events where event_type='attachment'"),1);
 assert.equal(await value("select territory from music_library.usage_events where event_type='attachment'"),'US');
 await actor('owner','select save_memory_book_soundtrack($1,null)',[book]);
 assert.equal(await value("select count(*)::int from music_library.usage_events where event_type='detachment'"),1);
 const admin=await staff(),report=await service("select admin_music_usage_report($1,$2,now()-interval '1 day',now()+interval '1 day')",admin);
 assert.equal(report.metric,'server_operations_not_plays_or_royalties');assert.equal(report.rows.length,3);assert.equal(report.rows[0].operations,'1');
});
test('unverified territories stay unknown and reports reject reversed or unbounded windows',async()=>{
 const t=await original();await actor('owner',"select authorize_original_audio_export($1,'post')",[t.soundId]);
 const admin=await staff();const report=await service("select admin_music_usage_report($1,$2,now()-interval '1 day',now()+interval '1 day')",admin);assert.equal(report.rows[0].territory,'Unknown');
 await assert.rejects(()=>service("select admin_music_usage_report($1,$2,now(),now()-interval '1 day')",admin),/WINDOW_REQUIRED/);
 await assert.rejects(()=>service("select admin_music_usage_report($1,$2,now()-interval '32 days',now())",admin),/WINDOW_REQUIRED/);
});
test('account erasure still fences finalization and clears owned cleanup tombstones',async()=>{
 await enableCleanup();const r=await abandon(false);await claim();await ack(r.id);
 await db.query('delete from auth.users where id=$1',[ids.owner]);
 assert.equal(await value('select count(*)::int from music_library.uploads where id=$1',[r.id]),0);
 assert.equal(await value('select count(*)::int from music_library.cleanup_jobs where upload_id=$1',[r.id]),0);
});
test('deleting content records a detachment while erasing the sound deletes its private usage rows',async()=>{
 const t=await original(),book=await actor('owner',"select create_memory_book_design('Detached book','cream','postcard')");
 await actor('owner','select save_memory_book_soundtrack($1,$2)',[book,JSON.stringify({soundId:t.soundId,startSec:0,durationSec:2,volume:.7,originalVolume:1})]);
 await db.query('delete from memory_albums where id=$1',[book]);
 assert.equal(await value("select count(*)::int from music_library.usage_events where event_type='detachment' and sound_id=$1",[t.soundId]),1);
 await db.query('delete from story_sounds where id=$1',[t.soundId]);
 assert.equal(await value('select count(*)::int from music_library.usage_events where sound_id=$1',[t.soundId]),0);
});
