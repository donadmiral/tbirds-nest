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
 await db.exec(await source('supabase/migrations/20261030204339_licensed_catalogue_pipeline.sql'));
 for(const [name,id]of Object.entries(ids)){await db.query('insert into auth.users(id,email) values($1,$2)',[id,`music-${name}@example.test`]);await db.query("insert into public.profiles(id,username,full_name,email,profile_visibility) values($1,$2,$2,$3,'public') on conflict(id) do update set username=excluded.username,profile_visibility='public'",[id,`music_${name}`,`music-${name}@example.test`]);await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sessions[name],id]);}
});
after(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
const service=(sql,args=[])=>actor(null,sql,args,'service_role');
const providerToken='pc_catalogue_'+'c'.repeat(64);
async function prepare(options={}){
 await db.query("insert into admin_users(user_id,role) values($1,'trust_safety')",[ids.viewer]);
 await service("select admin_music_command($1,$2,'provider.save','{\"id\":\"fixture\",\"name\":\"Fixture provider\"}')",[ids.viewer,sessions.viewer]);
 const track={id:'provider-track',revision:'v1',title:'Fixture licensed audio',artist:'Fixture artist',durationSec:2,sha256:hash};
 await service('select admin_stage_music_catalogue($1,$2,$3,$4,$5)',[ids.viewer,sessions.viewer,randomUUID(),'fixture',JSON.stringify({version:1,tracks:[track]})]);
 const trackId=await value('select id from music_library.catalogue_tracks');
 const grant=randomUUID();
 await db.query(`insert into music_library.catalogue_grants(id,provider_id,reference,revision,licensor,evidence_ref,evidence_sha256,territories,permitted_uses,starts_at,ends_at,hosting_allowed,export_allowed,max_excerpt_sec,reviewed_by)
 values($1,'fixture','synthetic-reviewed-contract','v1','Fixture licensor','fixture://signed-contract',$2,$3,$4,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',true,$5,2,$6)`,[grant,hash,options.territories??['US'],options.uses??['story','post','memory_album'],options.exportAllowed??false,ids.viewer]);
 await db.query('update music_library.catalogue_tracks set grant_id=$1 where id=$2',[grant,trackId]);
 await db.query("insert into music_library.catalogue_credentials(provider_id,secret_digest,enabled) values('fixture',extensions.digest($1,'sha256'),true)",[providerToken]);
 await db.exec("update music_library.providers set status='licensed' where id='fixture'; update music_library.catalogue_service set ingestion_enabled=true,playback_enabled=true");
 await db.query("update auth.users set raw_app_meta_data='{\"music_territory\":\"US\",\"music_territory_verified_until\":\"2099-01-01T00:00:00Z\"}' where id=$1",[ids.owner]);
 return{trackId,grant};
}
const reserveCatalog=(trackId,token=providerToken)=>service('select reserve_catalogue_audio($1,$2,88244,$3,$4,$5)',[token,trackId,'audio/wav',hash,base]);
async function verified(options={}){
 const t=await prepare(options),r=await reserveCatalog(t.trackId);
 await db.query("insert into storage.objects(bucket_id,name,version,metadata) values('music-audio',$1,'catalogue-v1','{\"size\":88244,\"mimetype\":\"audio/wav\"}')",[r.path]);
 const soundId=await service('select finish_catalogue_audio($1,$2,2,$3,$4)',[providerToken,t.trackId,hash,'catalogue-v1']);
 return{...t,...r,soundId};
}
test('catalogue deploys entirely disabled with no credentials or grants and private storage',async()=>{
 assert.equal(await value('select ingestion_enabled or playback_enabled from music_library.catalogue_service'),false);
 assert.equal(await value('select count(*)::int from music_library.catalogue_credentials'),0);assert.equal(await value('select count(*)::int from music_library.catalogue_grants'),0);
 assert.equal((await actor('owner','select get_original_audio_capabilities()')).version,2);assert.equal((await actor('owner','select get_original_audio_capabilities()')).catalogEnabled,false);
 await assert.rejects(()=>reserveCatalog(randomUUID()),/CATALOGUE_INGESTION_UNAVAILABLE/);
 assert.equal(await value("select public from storage.buckets where id='music-audio'"),false);
});
test('app and anonymous callers cannot provision licences, ingest or read provider credentials',async()=>{
 for(const table of ['catalogue_service','catalogue_credentials','catalogue_grants','catalogue_assets']){
  assert.equal(await value('select relrowsecurity from pg_class where oid=$1::regclass',[`music_library.${table}`]),true);
  await assert.rejects(()=>actor('owner',`select count(*) from music_library.${table}`),/permission denied/);
 }
 await assert.rejects(()=>actor('owner','select reserve_catalogue_audio($1,$2,88244,$3,$4,$5)',[providerToken,randomUUID(),'audio/wav',hash,base]),/permission denied/);
 await assert.rejects(()=>actor(null,"select authorize_music_audio_export($1,'post')",[randomUUID()],'anon'),/permission denied/);
});
test('verified platform catalogue stays separate from private originals and requires verified territory',async()=>{
 const t=await verified();assert.equal(await value('select owner_id from story_sounds where id=$1',[t.soundId]),null);
 assert.equal(await actor('owner',"select sound_rights_allow($1,'story')",[t.soundId]),true);
 assert.equal(await actor('viewer',"select sound_rights_allow($1,'story')",[t.soundId]),false);
 assert.equal(await actor('viewer','select count(*)::int from story_sounds where id=$1',[t.soundId]),0);
 assert.equal(await actor('owner','select music_upload_permitted($1)',[t.path]),false);
 assert.equal(await actor('owner',"select count(*)::int from storage.objects where bucket_id='music-audio' and name=$1",[t.path]),0);
});
test('provider credentials cannot ingest an unreviewed track or a different provider',async()=>{
 const t=await prepare();await assert.rejects(()=>reserveCatalog(t.trackId,'pc_catalogue_'+'d'.repeat(64)),/INGESTION_UNAVAILABLE/);
 await db.query('update music_library.catalogue_tracks set grant_id=null where id=$1',[t.trackId]);
 await assert.rejects(()=>reserveCatalog(t.trackId),/SIGNED_GRANT_REQUIRED/);
});
test('ingest retries preserve identity and finalization verifies metadata and object version',async()=>{
 const t=await prepare(),r=await reserveCatalog(t.trackId);assert.equal((await reserveCatalog(t.trackId)).path,r.path);
 await db.query("insert into storage.objects(bucket_id,name,version,metadata) values('music-audio',$1,'v1','{\"size\":88244}')",[r.path]);
 for(const [duration,digest,version]of [[8,hash,'v1'],[2,'b'.repeat(64),'v1'],[2,hash,'changed']])await assert.rejects(()=>service('select finish_catalogue_audio($1,$2,$3,$4,$5)',[providerToken,t.trackId,duration,digest,version]),/VALIDATION_FAILED|OBJECT_CHANGED/);
 const first=await service('select finish_catalogue_audio($1,$2,2,$3,$4)',[providerToken,t.trackId,hash,'v1']);
 assert.equal(await service('select finish_catalogue_audio($1,$2,2,$3,$4)',[providerToken,t.trackId,hash,'v1']),first);
 assert.equal((await reserveCatalog(t.trackId)).soundId,first);
});
test('catalogue ingestion rechecks grant revocation before finalization',async()=>{
 const t=await prepare(),r=await reserveCatalog(t.trackId);await db.query("insert into storage.objects(bucket_id,name,version,metadata) values('music-audio',$1,'v1','{\"size\":88244}')",[r.path]);
 await db.query('update music_library.catalogue_grants set revoked_at=clock_timestamp() where id=$1',[t.grant]);
 await assert.rejects(()=>service('select finish_catalogue_audio($1,$2,2,$3,$4)',[providerToken,t.trackId,hash,'v1']),/SIGNED_GRANT_REQUIRED/);
 assert.equal(await value('select count(*)::int from story_sounds'),0);
});
test('licence records are versioned and revocation cannot be cleared',async()=>{
 const t=await prepare();await assert.rejects(()=>actor(null,"update music_library.catalogue_grants set territories=array['*'] where id=$1",[t.grant],'postgres'),/GRANT_IMMUTABLE/);
 await db.query('update music_library.catalogue_grants set revoked_at=clock_timestamp() where id=$1',[t.grant]);
 await assert.rejects(()=>actor(null,'update music_library.catalogue_grants set revoked_at=null where id=$1',[t.grant],'postgres'),/GRANT_IMMUTABLE/);
});
test('catalogue library search and exact fetch expose only rights-allowed verified recordings',async()=>{
 const t=await verified(),list=name=>actor(name,"select coalesce(jsonb_agg(s),'[]') from list_playable_sounds('post','Fixture',40)s");
 assert.equal((await list('owner'))[0].source,'library');assert.deepEqual(await list('viewer'),[]);
 assert.equal(await actor('owner',"select source from get_playable_sound($1,'post')",[t.soundId]),'library');
 await db.exec('update music_library.catalogue_service set playback_enabled=false');assert.deepEqual(await list('owner'),[]);
});
test('soundtrack attachment checks actual allowed use and validates excerpt ranges',async()=>{
 const t=await verified({uses:['story']});const selection={soundId:t.soundId,startSec:0,durationSec:2,volume:.7,originalVolume:1};
 assert.equal((await actor('owner',"select validate_soundtrack($1,'story')",[JSON.stringify(selection)])).soundId,t.soundId);
 await assert.rejects(()=>actor('owner',"select validate_soundtrack($1,'post')",[JSON.stringify(selection)]),/SOUND_REUSE_NOT_ALLOWED/);
 await assert.rejects(()=>actor('owner',"select validate_soundtrack($1,'story')",[JSON.stringify({...selection,startSec:1})]),/INVALID_SOUNDTRACK_RANGE/);
});
test('catalogue stories and memory books retain private rights-checked soundtrack delivery',async()=>{
 const t=await verified(),story=await actor('owner','select publish_story_v2($1,$2,$3)',[ids.owner,randomUUID(),JSON.stringify({media_type:'text',audience:'everyone',caption:'Catalogue fixture',text_background:{colors:['#112233']},audio_draft:{kind:'sound',soundId:t.soundId,startSec:0,durationSec:2}})]);
 assert.equal(await value('select audio_source from stories where id=$1',[story]),'library');
 const book=await actor('owner',"select create_memory_book_design('Catalogue book','cream','postcard')");
 await actor('owner','select save_memory_book_soundtrack($1,$2)',[book,JSON.stringify({soundId:t.soundId,startSec:0,durationSec:2,volume:.7,originalVolume:1})]);
 const tickets=await actor('owner',"select coalesce(jsonb_agg(t),'[]') from issue_content_media_delivery($1,null)t",[JSON.stringify([{kind:'memory_album',id:book}])]);
 const ticket=tickets.find(x=>x.bucket_id==='music-audio');assert.ok(ticket);
 assert.ok(await service('select resolve_media_delivery($1,$2,$3)',[ticket.token,ticket.bucket_id,ticket.object_path]));
});
test('catalogue grants revoke warmed delivery and record distinct server authorizations',async()=>{
 const t=await verified(),tickets=await actor('owner',"select coalesce(jsonb_agg(t),'[]') from issue_content_media_delivery($1,null)t",[JSON.stringify([{kind:'sound',id:t.soundId}])]);const ticket=tickets[0];assert.ok(ticket);
 const redeem=()=>service('select resolve_media_delivery($1,$2,$3)',[ticket.token,ticket.bucket_id,ticket.object_path]);
 assert.ok(await redeem());assert.ok(await redeem());assert.equal(await value("select count(*)::int from music_library.usage_events where event_type='delivery_authorization' and provider_id='fixture'"),1);
 await db.query('update music_library.catalogue_grants set revoked_at=clock_timestamp() where id=$1',[t.grant]);assert.equal(await redeem(),null);
});
test('changed Storage version and stale territory stop current catalogue playback',async()=>{
 const t=await verified();
 await assert.rejects(()=>actor(null,"update storage.objects set version='replaced' where name=$1 and bucket_id='music-audio'",[t.path],'postgres'),/CATALOGUE_STORAGE_IMMUTABLE/);
 // Simulate an out-of-band privileged corruption after proving the normal write guard.
 await db.exec('alter table storage.objects disable trigger music_catalogue_storage_write');
 await db.query("update storage.objects set version='replaced' where name=$1 and bucket_id='music-audio'",[t.path]);assert.equal(await actor('owner',"select sound_rights_allow($1,'story')",[t.soundId]),false);
 await db.query("update storage.objects set version='catalogue-v1' where name=$1 and bucket_id='music-audio'",[t.path]);
 await db.exec('alter table storage.objects enable trigger music_catalogue_storage_write');
 await db.query("update auth.users set raw_app_meta_data='{\"music_territory\":\"US\",\"music_territory_verified_until\":\"2000-01-01\"}' where id=$1",[ids.owner]);
 assert.equal(await actor('owner',"select sound_rights_allow($1,'story')",[t.soundId]),false);
});
test('generic export preserves original owner rules and requires separate catalogue download rights',async()=>{
 const t=await verified();await assert.rejects(()=>actor('owner',"select authorize_music_audio_export($1,'post')",[t.soundId]),/AUDIO_EXPORT_RIGHTS_REQUIRED/);
 const o=await original(true);assert.equal((await actor('owner',"select authorize_music_audio_export($1,'post')",[o.soundId])).source,'original');
 await assert.rejects(()=>actor('viewer',"select authorize_music_audio_export($1,'post')",[o.soundId]),/AUDIO_EXPORT_RIGHTS_REQUIRED/);
});
test('rights-approved catalogue export returns the bounded track and loses access on revocation',async()=>{
 const t=await verified({exportAllowed:true});const result=await actor('owner',"select authorize_music_audio_export($1,'post')",[t.soundId]);assert.equal(result.source,'library');assert.equal(result.id,t.soundId);assert.equal(result.max_excerpt_sec,2);
 await db.query('update music_library.catalogue_grants set revoked_at=clock_timestamp() where id=$1',[t.grant]);
 await assert.rejects(()=>actor('owner',"select authorize_music_audio_export($1,'post')",[t.soundId]),/AUDIO_EXPORT_RIGHTS_REQUIRED/);
});
test('catalogue platform sounds cannot create ownerless originals and remain outside personal erasure',async()=>{
 const t=await verified();await assert.rejects(()=>actor(null,"update story_sounds set source='original' where id=$1",[t.soundId],'postgres'),/original_audio_requires_owner/);
 await db.query('delete from auth.users where id=$1',[ids.owner]);assert.equal(await value('select count(*)::int from story_sounds where id=$1',[t.soundId]),1);
});
async function cleanupReady(){
 await db.exec("update music_library.maintenance_worker set secret_digest=extensions.digest('pc_music_'||repeat('a',64),'sha256')");
 await service("select set_music_maintenance_ready(true,'Synthetic deployed worker')");
 await service("select validate_music_maintenance_worker('pc_music_'||repeat('a',64))");
}
test('abandoned catalogue reservations are fenced and release quota only after Storage deletion',async()=>{
 const t=await prepare(),r=await reserveCatalog(t.trackId),worker=randomUUID();
 await db.query("insert into storage.objects(bucket_id,name,version,metadata)values('music-audio',$1,'abandoned-v1','{\"size\":88244}')",[r.path]);
 await db.query("update music_library.catalogue_assets set last_attempt_at=clock_timestamp()-interval '49 hours' where track_id=$1",[t.trackId]);await cleanupReady();
 const job=await service('select claim_catalogue_upload_cleanup($1)',[worker]);assert.equal(job.id,t.trackId);assert.equal(job.kind,'catalogue');
 await assert.rejects(()=>reserveCatalog(t.trackId),/ASSET_EXPIRED/);
 assert.equal(await service('select ack_catalogue_upload_cleanup($1,$2)',[t.trackId,worker]),false);
 await db.query("delete from storage.objects where bucket_id='music-audio' and name=$1",[r.path]);
 assert.equal(await service('select ack_catalogue_upload_cleanup($1,$2)',[t.trackId,worker]),true);
 // A delayed privileged upload cannot recreate a cleaned path.
 await assert.rejects(()=>actor(null,"insert into storage.objects(bucket_id,name,version,metadata)values('music-audio',$1,'late','{\"size\":88244}')",[r.path],'postgres'),/CATALOGUE_STORAGE_IMMUTABLE/);
 assert.equal(await value('select status from music_library.catalogue_assets where track_id=$1',[t.trackId]),'purged');
});
test('recent catalogue uploads and verified library recordings never enter cleanup',async()=>{
 const t=await verified();await cleanupReady();
 await db.query("update music_library.catalogue_assets set last_attempt_at=clock_timestamp()-interval '10 days' where track_id=$1",[t.trackId]);
 assert.equal(await service('select claim_catalogue_upload_cleanup($1)',[randomUUID()]),null);
});
test('catalogue cleanup lease expires safely, rejects other workers and backs off errors',async()=>{
 const t=await prepare();await reserveCatalog(t.trackId);await db.query("update music_library.catalogue_assets set last_attempt_at=clock_timestamp()-interval '49 hours' where track_id=$1",[t.trackId]);await cleanupReady();
 const worker=randomUUID();await service('select claim_catalogue_upload_cleanup($1)',[worker]);
 assert.equal(await service('select check_catalogue_upload_cleanup($1,$2)',[t.trackId,randomUUID()]),'denied');
 await service('select fail_catalogue_upload_cleanup($1,$2)',[t.trackId,worker]);assert.equal(await service('select claim_catalogue_upload_cleanup($1)',[worker]),null);
 await db.query("update music_library.catalogue_cleanup_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where track_id=$1",[t.trackId]);
 const next=randomUUID();await service('select claim_catalogue_upload_cleanup($1)',[next]);
 assert.equal(await service('select ack_catalogue_upload_cleanup($1,$2)',[t.trackId,next]),true);
});
test('Storage service writes also require an unexpired reserved catalogue path and correct byte size',async()=>{
 const t=await prepare(),r=await reserveCatalog(t.trackId);
 for(const [path,size]of [[r.path,999],['catalogue/fixture/unreserved/file.wav',88244]])await assert.rejects(()=>actor(null,"insert into storage.objects(bucket_id,name,version,metadata)values('music-audio',$1,'v1',$2)",[path,JSON.stringify({size})],'postgres'),/STORAGE_SIZE_MISMATCH|STORAGE_IMMUTABLE/);
 await db.query("update music_library.catalogue_assets set last_attempt_at=clock_timestamp()-interval '49 hours' where track_id=$1",[t.trackId]);
 await assert.rejects(()=>actor(null,"insert into storage.objects(bucket_id,name,version,metadata)values('music-audio',$1,'late','{\"size\":88244}')",[r.path],'postgres'),/STORAGE_IMMUTABLE/);
});
test('infinite or malformed territorial verification cannot authorize catalogue playback',async()=>{
 const t=await verified();for(const expiry of ['infinity','not-a-date','2000-01-01']){
  await db.query('update auth.users set raw_app_meta_data=$1 where id=$2',[JSON.stringify({music_territory:'US',music_territory_verified_until:expiry}),ids.owner]);
  assert.equal(await actor('owner',"select sound_rights_allow($1,'story')",[t.soundId]),false);
 }
});
test('admin readiness shows real catalogue switches and separate cleanup counters',async()=>{
 const t=await prepare();const read=()=>service('select admin_music_operations_snapshot($1,$2)',[ids.viewer,sessions.viewer]);
 let snapshot=await read();assert.equal(snapshot.version,2);assert.equal(snapshot.catalogueService.ingestionEnabled,true);assert.equal(snapshot.catalogEnabled,true);assert.equal(snapshot.catalogueCleanup.pending,0);
 await db.exec('update music_library.catalogue_service set playback_enabled=false');snapshot=await read();assert.equal(snapshot.catalogEnabled,false);
 assert.equal(snapshot.catalogue[0].id,t.trackId);assert.equal(snapshot.catalogue[0].asset_status,'not_uploaded');
});
test('cleanup restores provider capacity after twenty failed pushes without reusing old paths',async()=>{
 const t=await prepare();const entries=Array.from({length:20},(_,i)=>({id:`extra-${i}`,revision:'v1',title:`Fixture ${i}`,artist:'Fixture artist',durationSec:2,sha256:hash}));
 await service('select admin_stage_music_catalogue($1,$2,$3,$4,$5)',[ids.viewer,sessions.viewer,randomUUID(),'fixture',JSON.stringify({version:1,tracks:entries})]);
 await db.query('update music_library.catalogue_tracks set grant_id=$1',[t.grant]);
 const tracks=(await db.query('select id from music_library.catalogue_tracks order by id')).rows.map(row=>row.id);
 for(const id of tracks.slice(0,20))await reserveCatalog(id);
 await assert.rejects(()=>reserveCatalog(tracks[20]),/CATALOGUE_STORAGE_LIMIT/);
 await db.exec("update music_library.catalogue_assets set last_attempt_at=clock_timestamp()-interval '49 hours'");await cleanupReady();
 const worker=randomUUID(),job=await service('select claim_catalogue_upload_cleanup($1)',[worker]);
 assert.equal(await service('select ack_catalogue_upload_cleanup($1,$2)',[job.id,worker]),true);
 assert.equal((await reserveCatalog(tracks[20])).status,'reserved');
 await assert.rejects(()=>reserveCatalog(job.id),/ASSET_EXPIRED/);
});
