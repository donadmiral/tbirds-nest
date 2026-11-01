import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {source} from './deployed-media-baseline.mjs';
import {loadQaMusicPrerequisiteBaseline} from './qa-music-prerequisite-fixture.mjs';
const candidate=JSON.parse(await source('docs/quality/completion-20261101/backend/music-story-prerequisite-candidate.json'));
const sql=await source(candidate.sourcePath);assert.equal(createHash('sha256').update(sql).digest('hex'),candidate.sourceSha256);
const db=new PGlite({extensions}),q=async(query,args=[])=>(await db.query(query,args)).rows;
const value=async(query,args=[])=>Object.values((await q(query,args))[0]||{})[0];
const catalog=()=>q("select p.oid::regprocedure::text as signature,md5(pg_get_functiondef(p.oid))as hash,p.proacl::text as acl from pg_proc p where p.oid=any($1::regprocedure[])order by signature",[candidate.beforeFunctions.map(f=>f.signature)]);
before(async()=>{await loadQaMusicPrerequisiteBaseline(db);await db.exec('set search_path=pg_catalog');});after(()=>db.close());
async function rejects(mutation,pattern){const before=await catalog();await db.exec(`begin;${mutation};`);await assert.rejects(db.exec(sql),pattern);await db.exec('rollback');assert.deepEqual(await catalog(),before);}
test('the actual read-only preflight projection matches the inspected old body and empty target journal',async()=>{
 const observation=(await db.exec(await source('docs/quality/completion-20261101/backend/music-story-prerequisite-observation.sql'))).flatMap(result=>result.rows||[])[0].observation;
 assert.equal(observation.readOnly,true);assert.deepEqual(observation.journal,[]);assert.deepEqual(observation.functions,candidate.beforeFunctions);
 if(process.env.QA_STORY_PREREQUISITE_OUTPUT)await writeFile(process.env.QA_STORY_PREREQUISITE_OUTPUT.replace('-observation.json','-preflight-observation.json'),JSON.stringify({formatVersion:1,sourceBoundIsolatedFixture:true,observation},null,2)+'\n');
});
test('unknown publisher body fails before replacement',()=>rejects("create or replace function public.publish_story_v2(p_expected_user uuid,p_request_id uuid,p_story jsonb)returns uuid language plpgsql security definer set search_path=''as $$begin return null;end$$",/STORY_MUSIC_SOURCE_OR_ACL_DRIFT/));
test('execution privilege drift fails instead of replacing unreviewed access',()=>rejects('grant execute on function public.publish_story_v2(uuid,uuid,jsonb)to anon',/STORY_MUSIC_SOURCE_OR_ACL_DRIFT/));
test('a changed companion function cannot be hidden by the single publisher repair',()=>rejects("create or replace function public.mark_story_reshared(p_story_id uuid)returns void language plpgsql security definer set search_path=''as $$begin return;end$$",/STORY_MUSIC_SOURCE_OR_ACL_DRIFT/));
test('unverified business activation journal is rejected',()=>rejects("update supabase_migrations.schema_migrations set name='unverified_activation'",/STORY_MUSIC_BUSINESS_ACTIVATION_REQUIRED/));
test('an already advanced music schema prevents a late legacy replacement',()=>rejects('create schema music_library',/STORY_MUSIC_ALREADY_ADVANCED/));
test('a new legacy audio row blocks the transition without deleting or rewriting it',()=>rejects("insert into auth.users(id,email)values('11111111-1111-4111-8111-111111111111','story-prerequisite@example.invalid');insert into public.story_sounds(owner_id,title,url,duration_sec,source)values('11111111-1111-4111-8111-111111111111','Synthetic existing audio','https://example.invalid/audio.wav',2,'original')",/STORY_MUSIC_EXISTING_AUDIO_REVIEW/));
test('the inspected legacy book column position is a mandatory precondition',()=>rejects('alter table public.memory_albums rename column soundtrack to changed_legacy_column',/STORY_MUSIC_BOOK_BASELINE_DRIFT/));
test('failure after replacement rolls back the exact function body and privileges',async()=>{const before=await catalog();const altered=sql.replace("notify pgrst,'reload schema';","select 1/0;\nnotify pgrst,'reload schema';");await assert.rejects(db.exec(altered),/division by zero/);await db.exec('rollback');assert.deepEqual(await catalog(),before);});
test('only the current tested publisher body changes and its existing privileges remain exact',async()=>{
 const before=await catalog();await db.exec(sql);const after=await catalog();
 assert.equal(before.filter((row,i)=>row.hash!==after[i].hash).length,1);assert.deepEqual(before.map(row=>[row.signature,row.acl]),after.map(row=>[row.signature,row.acl]));
 assert.equal(await value("select md5(pg_get_functiondef('public.publish_story_v2(uuid,uuid,jsonb)'::regprocedure))"),candidate.afterFunctions.find(f=>f.signature==='public.publish_story_v2(uuid,uuid,jsonb)').definitionMd5);
 await db.query('insert into supabase_migrations.schema_migrations values($1,$2,$3)',['fixture-story-prerequisite',candidate.migrationName,[sql]]);
 const observation=(await db.exec(await source('docs/quality/completion-20261101/backend/music-story-prerequisite-observation.sql'))).flatMap(result=>result.rows||[])[0].observation;
 assert.equal(observation.readOnly,true);assert.equal(observation.journal[0].querySha256,candidate.sourceSha256);assert.equal(observation.bookSoundtrackPosition,9);
 if(process.env.QA_STORY_PREREQUISITE_OUTPUT)await writeFile(process.env.QA_STORY_PREREQUISITE_OUTPUT,JSON.stringify({formatVersion:1,sourceBoundIsolatedFixture:true,observation},null,2)+'\n');
});
test('a late duplicate cannot roll the publisher back or alter a prior installation',async()=>{const before=await catalog();await assert.rejects(db.exec(sql),/STORY_MUSIC_SOURCE_OR_ACL_DRIFT/);await db.exec('rollback');assert.deepEqual(await catalog(),before);});
test('the unchanged three music migrations apply to the actual QA legacy-column and creative-book order',async()=>{
 for(const name of ['20261030153811_original_music_library_and_delivery','20261030203619_music_catalogue_operations_and_cleanup','20261030204339_licensed_catalogue_pipeline'])await db.exec(await source(`supabase/migrations/${name}.sql`));
 assert.equal(await value('select uploads_enabled from music_library.service_state'),false);assert.equal(await value('select enabled from music_library.maintenance_worker'),false);
 assert.equal(await value('select ingestion_enabled or playback_enabled from music_library.catalogue_service'),false);assert.equal(await value('select count(*)::int from music_library.catalogue_grants'),0);
 assert.equal(await value("select attnum from pg_attribute where attrelid='public.memory_albums'::regclass and attname='soundtrack'"),9);
});
