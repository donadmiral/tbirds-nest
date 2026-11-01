// Offline preparation; compares captured QA definitions with tested source.
import assert from 'node:assert/strict';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {extensions} from '../../../../supabase/tests/rpc-authorization/live-schema-fixture.mjs';
import {loadBusinessAuthBaseline} from '../../../../supabase/tests/rpc-authorization/business-auth-fixture.mjs';
const root=new URL('../../../../',import.meta.url),here=new URL('./',import.meta.url);
const {PGlite}=createRequire(new URL('supabase/tests/rpc-authorization/package.json',root))('@electric-sql/pglite');
const captured=JSON.parse(await readFile(new URL('music-story-prerequisite-hosted-baseline.json',here),'utf8')).observation;
const db=new PGlite({extensions});
try{
 await loadBusinessAuthBaseline(db,true,true);await db.exec('set search_path=pg_catalog');
 const wanted=(await db.query(`select p.oid::regprocedure::text as signature,pg_get_functiondef(p.oid)as definition,md5(pg_get_functiondef(p.oid))as "definitionMd5",pg_get_userbyid(p.proowner)as owner,p.proacl::text as acl,p.proconfig as config,p.prosecdef as "securityDefiner"from pg_proc p where p.oid=any($1::regprocedure[])order by p.proname`,[captured.functions.map(f=>f.signature)])).rows;
 const changes=[];
 for(const expected of wanted){
  const before=captured.functions.find(f=>f.signature===expected.signature);assert.ok(before);
  assert.equal(createHash('md5').update(before.definition).digest('hex'),before.definitionMd5);
  if(before.definitionMd5!==expected.definitionMd5)changes.push({before,after:{...expected,acl:before.acl}});
 }
 const result={formatVersion:1,projectRef:'uaulhuelcfkjwojtymmw',capturedAt:captured.observedAt,sourceFixture:'loadBusinessAuthBaseline(db,true,true)',functionsReviewed:wanted.length,changedFunctions:changes,unchangedFunctions:wanted.filter(f=>!changes.some(c=>c.before.signature===f.signature)).map(f=>f.signature),captured};
 await writeFile(new URL('music-story-prerequisite-comparison.json',here),JSON.stringify(result,null,2)+'\n');
 const sourcePath='supabase/ops/qa/20261101044417_qa_story_music_prerequisite.sql';
 const migrationName='qa_story_music_prerequisite_20261101';
 const digest=s=>createHash('sha256').update(s).digest('hex');
 const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
 const projection=`select p.oid::regprocedure::text as signature,md5(pg_get_functiondef(p.oid))as "definitionMd5",pg_get_userbyid(p.proowner)as owner,p.proacl::text as acl,p.proconfig as config,p.prosecdef as "securityDefiner"from pg_proc p where p.oid=any(array[${captured.functions.map(f=>quote(f.signature)).join(',')}]::regprocedure[])order by p.proname`;
 const beforeFunctions=captured.functions.map(({definition,...rest})=>rest);
 const afterFunctions=beforeFunctions.map(f=>({...f,definitionMd5:changes.find(c=>c.before.signature===f.signature)?.after.definitionMd5||f.definitionMd5}));
 assert.equal(changes.length,1);assert.equal(changes[0].before.signature,'public.publish_story_v2(uuid,uuid,jsonb)');
 const guard=`do $preflight$ begin
 if current_user<>'postgres' then raise exception 'STORY_MUSIC_POSTGRES_REQUIRED';end if;
 if to_regnamespace('music_library')is not null then raise exception 'STORY_MUSIC_ALREADY_ADVANCED';end if;
 if (select jsonb_agg(to_jsonb(f)order by f.signature)from(${projection})f)is distinct from ${quote(JSON.stringify([...beforeFunctions].sort((a,b)=>a.signature.localeCompare(b.signature))))}::jsonb then raise exception 'STORY_MUSIC_SOURCE_OR_ACL_DRIFT';end if;
 if (select count(*)from supabase_migrations.schema_migrations where name='qa_business_auth_08_activate_storage_surfaces_20261101'and cardinality(statements)=1 and octet_length(array_to_string(statements,E'\\n'))=16058 and encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex')='d60f5b0e782295d770bb1cf0a4ec066c275b3a90fe0b26364c4226ac55f7b55d')<>1 then raise exception 'STORY_MUSIC_BUSINESS_ACTIVATION_REQUIRED';end if;
 if not exists(select 1 from pg_attribute where attrelid='public.memory_albums'::regclass and attnum=9 and attname='soundtrack'and atttypid='jsonb'::regtype and not attnotnull and not attisdropped)then raise exception 'STORY_MUSIC_BOOK_BASELINE_DRIFT';end if;
 if exists(select 1 from public.story_sounds)or exists(select 1 from public.stories where audio_url is not null)
 or exists(select 1 from public.memory_albums where soundtrack is not null)
 or exists(select 1 from public.post_media pm where to_jsonb(pm)->'soundtrack'is not null and to_jsonb(pm)->'soundtrack'<>'null'::jsonb)then raise exception 'STORY_MUSIC_EXISTING_AUDIO_REVIEW';end if;
end $preflight$;`;
 const migration=`-- QA-only prerequisite from the current tested visual publication source.
-- Only publish_story_v2 changes. Existing trigger/policy bodies and execution
-- privileges remain intact. The unchanged music migration runs next, disabled.
-- No historical audio exists in the reviewed QA baseline; reject any new audio
-- before changing the legacy publisher. No content, identity or Storage write.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
set local search_path=pg_catalog;
lock table public.stories,public.story_sounds,public.memory_albums,public.post_media in share row exclusive mode;
${guard}
${changes[0].after.definition};
do $postcondition$ begin
 if (select jsonb_agg(to_jsonb(f)order by f.signature)from(${projection})f)is distinct from ${quote(JSON.stringify([...afterFunctions].sort((a,b)=>a.signature.localeCompare(b.signature))))}::jsonb then raise exception 'STORY_MUSIC_POSTCONDITION_FAILED';end if;
end $postcondition$;
notify pgrst,'reload schema';
commit;
`;
 try{await rename(new URL('supabase/migrations/20261101044417_qa_story_music_prerequisite.sql',root),new URL(sourcePath,root));}catch(error){if(error.code!=='ENOENT')throw error;}
 await writeFile(new URL(sourcePath,root),migration);
 const request={project_id:'uaulhuelcfkjwojtymmw',name:migrationName,query:migration};
 await writeFile(new URL('music-story-prerequisite-request.json',here),JSON.stringify(request,null,2)+'\n');
 const observe=`-- Exact read-only QA story prerequisite observation; no app RPC invocation.
begin read only;set local search_path=pg_catalog;set local statement_timeout='15s';
select jsonb_build_object('observedAt',clock_timestamp(),'executor',current_user,'readOnly',current_setting('transaction_read_only')='on',
 'functions',(select jsonb_agg(to_jsonb(f)order by f.signature)from(${projection})f),
 'musicSchemaAbsent',to_regnamespace('music_library')is null,
 'legacyAudioCounts',jsonb_build_object('sounds',(select count(*)from public.story_sounds),'storiesWithAudio',(select count(*)from public.stories where audio_url is not null),'booksWithSoundtrack',(select count(*)from public.memory_albums where soundtrack is not null),'postsWithSoundtrack',(select count(*)from public.post_media pm where to_jsonb(pm)->'soundtrack'is not null and to_jsonb(pm)->'soundtrack'<>'null'::jsonb)),
 'bookSoundtrackPosition',(select attnum from pg_attribute where attrelid='public.memory_albums'::regclass and attname='soundtrack'and atttypid='jsonb'::regtype and not attnotnull and not attisdropped),
 'businessJournal',(select coalesce(jsonb_agg(jsonb_build_object('name',name,'statementCount',cardinality(statements),'queryBytes',octet_length(array_to_string(statements,E'\\n')),'querySha256',encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex'))),'[]'::jsonb)from supabase_migrations.schema_migrations where name like 'qa_business_auth_08_%'),
 'journal',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'queryBytes',octet_length(array_to_string(statements,E'\\n')),'querySha256',encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex'))),'[]'::jsonb)from supabase_migrations.schema_migrations where name=${quote(migrationName)}),
 'otherActiveOrOpenClientTransactions',(select count(*)from pg_stat_activity where pid<>pg_backend_pid()and backend_type='client backend'and state in('active','idle in transaction','idle in transaction (aborted)')),
 'preparedTransactions',(select count(*)from pg_prepared_xacts)
)as observation;rollback;
`;
 await writeFile(new URL('music-story-prerequisite-observation.sql',here),observe);
 await writeFile(new URL('music-story-prerequisite-candidate.json',here),JSON.stringify({formatVersion:1,projectRef:'uaulhuelcfkjwojtymmw',migrationName,sourcePath,sourceSha256:digest(migration),sourceBytes:Buffer.byteLength(migration),sourceCreatedBy:'Pinned supabase@2.122.0 migration new; moved to QA-only ops',beforeFunctions:[...beforeFunctions].sort((a,b)=>a.signature.localeCompare(b.signature)),afterFunctions:[...afterFunctions].sort((a,b)=>a.signature.localeCompare(b.signature)),changedFunctions:changes.map(c=>c.before.signature),unchangedFunctionCount:8,existingPrivilegesRetained:true,existingTriggersAndPolicyUntouched:true,existingTablesAndRowsUntouched:true,actualMusicMigrationsUnchanged:true,prerequisiteBusinessJournal:{name:'qa_business_auth_08_activate_storage_surfaces_20261101',statementCount:1,queryBytes:16058,querySha256:'d60f5b0e782295d770bb1cf0a4ec066c275b3a90fe0b26364c4226ac55f7b55d'},capturedAt:captured.observedAt,hostedMutationMade:false},null,2)+'\n');
 console.log(JSON.stringify({functionsReviewed:wanted.length,changed:changes.map(c=>({signature:c.before.signature,before:c.before.definitionMd5,after:c.after.definitionMd5})),unchanged:result.unchangedFunctions}));
}finally{await db.close();}
