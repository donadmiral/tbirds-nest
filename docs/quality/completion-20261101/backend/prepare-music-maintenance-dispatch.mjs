// Offline source-bound preparation; no hosted mutation or activation.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {extensions} from '../../../../supabase/tests/rpc-authorization/live-schema-fixture.mjs';
import {loadQaMusicPrerequisiteBaseline} from '../../../../supabase/tests/rpc-authorization/qa-music-prerequisite-fixture.mjs';
const root=new URL('../../../../',import.meta.url),here=new URL('./',import.meta.url);
const requireFixture=createRequire(new URL('supabase/tests/rpc-authorization/package.json',root));
const {PGlite}=requireFixture('@electric-sql/pglite');
const read=p=>readFile(new URL(p,root),'utf8');
const write=(p,x)=>writeFile(new URL(p,here),typeof x==='string'?x:JSON.stringify(x,null,2)+'\n');
const sha=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
const sourcePath='supabase/migrations/20261101043002_music_maintenance_one_use_dispatch.sql';
const sourceSql=await read(sourcePath),migrationName='music_maintenance_one_use_dispatch';
const source={sourcePath,migrationName,sourceSha256:sha(sourceSql),sourceBytes:Buffer.byteLength(sourceSql)};
const music=JSON.parse(await read('docs/quality/completion-20261101/backend/music-migration-requests/index.json'));
const originalExpected=JSON.parse(await read('docs/quality/completion-20261101/backend/music-migration-requests/03_expected.json'));
const story=JSON.parse(await read('docs/quality/completion-20261101/backend/music-story-prerequisite-candidate.json'));
const baseSql=await read('docs/quality/completion-20261101/backend/music-migration-requests/03_postflight.sql');
const request={project_id:music.projectRef,name:migrationName,query:sourceSql};
const db=new PGlite({extensions});
try{
 await loadQaMusicPrerequisiteBaseline(db);
 const storySql=await read(story.sourcePath);assert.equal(sha(storySql),story.sourceSha256);await db.exec(storySql);
 await db.query('insert into supabase_migrations.schema_migrations values($1,$2,$3)',['fixture-story-prerequisite',story.migrationName,[storySql]]);
 for(const unit of music.requests){
  const sql=await read(unit.sourcePath);assert.equal(sha(sql),unit.sourceSha256);assert.equal(Buffer.byteLength(sql),unit.sourceBytes);await db.exec(sql);
  await db.query('insert into supabase_migrations.schema_migrations values($1,$2,$3)',[`fixture-music-${unit.order}`,unit.migrationName,[sql]]);
 }
 // The isolated fixture supplies only the provider API signature; it never sends HTTP.
 await db.exec("create or replace function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 5000)returns bigint language sql as $$select 1::bigint$$");
 const tableNames=async()=>(await db.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='music_library'and c.relkind='r'order by c.relname")).rows.map(x=>x.relname);
 const queryFor=async phase=>{
  const after=phase==='postflight',tables=await tableNames();
  const counts=`jsonb_build_object(${tables.map(t=>`${quote(t)},(select count(*) from music_library.${t})`).join(',')})`;
  const config=after?"(select jsonb_build_object('projectOrigin',project_origin,'workerSha256',worker_sha256,'verifiedAt',verified_at)from music_library.maintenance_dispatch where singleton)":"null";
  const extra=` 'maintenanceDispatchPresent',to_regclass('music_library.maintenance_dispatch')is not null,\n 'maintenanceRunsPresent',to_regclass('music_library.maintenance_runs')is not null,\n 'maintenanceDispatchConfiguration',${config},\n 'netHttpPostAvailable',to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)')is not null,\n 'netHttpPostExecutable',coalesce(has_function_privilege('postgres',to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)'),'EXECUTE'),false),\n 'maintenanceJournal',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'queryBytes',octet_length(array_to_string(statements,E'\\n')),'querySha256',encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex'))order by version),'[]'::jsonb)from supabase_migrations.schema_migrations where name=${quote(migrationName)}),\n`;
  let result=baseSql.replace('read-only postflight','read-only music maintenance '+phase).replace("'packageStage',3,'phase','postflight'",`'packageStage',${after?4:3},'phase',${quote(phase)}`);
  result=result.replace(/('musicTableCounts',)([\s\S]*?)(,'readiness',)/,`$1${counts}$3`);
  result=result.replace(" 'scope',",extra+" 'scope',");
  assert.equal(result.includes(extra),true);return result;
 };
 const preflightSql=await queryFor('preflight');
 const before=(await db.exec(preflightSql)).flatMap(r=>r.rows||[])[0].observation;
 assert.deepEqual(before.catalog,originalExpected.postflight.catalog);
 await db.exec(sourceSql);
 await db.query('insert into supabase_migrations.schema_migrations values($1,$2,$3)',['fixture-maintenance-dispatch',migrationName,[sourceSql]]);
 const postflightSql=await queryFor('postflight');
 const after=(await db.exec(postflightSql)).flatMap(r=>r.rows||[])[0].observation;
 const sourceBound={formatVersion:1,projectRef:music.projectRef,source,sourceSqlUnchanged:true,localFixtureOnly:true,
  prerequisiteBusinessSource:originalExpected.prerequisiteBusinessSource,prerequisiteStorySource:originalExpected.prerequisiteStorySource,
  allMigrationSources:originalExpected.allMigrationSources,expectedAudioBucket:originalExpected.expectedAudioBucket,
  preflight:{stage:3,catalog:before.catalog,tableCounts:before.musicTableCounts,readiness:before.readiness,dispatchPresent:false,runsPresent:false,dispatchConfiguration:null},
  postflight:{stage:4,catalog:after.catalog,tableCounts:after.musicTableCounts,readiness:after.readiness,dispatchPresent:true,runsPresent:true,dispatchConfiguration:{projectOrigin:null,workerSha256:null,verifiedAt:null}},
  scope:'Metadata installation only. No queue request, HTTP delivery, readiness change, original upload, account erasure or licensed catalogue activation is performed.'};
 for(const o of [before,after]){
  assert.equal(o.readOnly,true);assert.equal(o.executor,'postgres');assert.equal(o.musicPrivateTableAccess,0);assert.equal(o.musicPrivateFunctionAccess,0);assert.equal(o.musicPrivateSchemaAccess,0);assert.equal(o.musicTablesWithoutRls,0);
  assert.deepEqual(o.readiness,originalExpected.postflight.readiness);assert.equal(o.netHttpPostAvailable,true);assert.equal(o.netHttpPostExecutable,true);
 }
 assert.equal(before.maintenanceJournal.length,0);assert.equal(after.maintenanceJournal.length,1);assert.equal(after.maintenanceJournal[0].querySha256,source.sourceSha256);
 assert.equal(after.musicTableCounts.maintenance_dispatch,1);assert.equal(after.musicTableCounts.maintenance_runs,0);
 const expectedChanged=new Set(['function\u0000public.set_music_maintenance_ready(p_ready boolean, p_reason text)','function\u0000public.validate_music_maintenance_worker(p_token text)']);
 const beforeMap=new Map(before.catalog.map(r=>[r.k+'\0'+r.n,r.md5])),afterMap=new Map(after.catalog.map(r=>[r.k+'\0'+r.n,r.md5]));
 const changedExisting=[...beforeMap].filter(([key,value])=>afterMap.get(key)!==value).map(([key])=>key);
 assert.deepEqual(new Set(changedExisting),expectedChanged);
 await write('music-maintenance-dispatch-request.json',request);
 await write('music-maintenance-dispatch-preflight.sql',preflightSql);
 await write('music-maintenance-dispatch-postflight.sql',postflightSql);
 await write('music-maintenance-dispatch-expected.json',sourceBound);
 await write('music-maintenance-dispatch-local-preflight.json',{formatVersion:1,sourceBoundIsolatedFixture:true,observation:before});
 await write('music-maintenance-dispatch-local-postflight.json',{formatVersion:1,sourceBoundIsolatedFixture:true,observation:after});
 await write('music-maintenance-dispatch-candidate.json',{formatVersion:1,projectRef:music.projectRef,...source,requestPath:'docs/quality/completion-20261101/backend/music-maintenance-dispatch-request.json',requestSha256:sha(JSON.stringify(request,null,2)+'\n'),sourceInitialState:'disabled, unconfigured, no queued capability, no heartbeat, no reusable credential',changedExistingContracts:changedExisting,preflightCatalogRows:before.catalog.length,postflightCatalogRows:after.catalog.length,localProjectionExecuted:true,providerMutationSubmitted:false});
 console.log(JSON.stringify({sourceSha256:source.sourceSha256,sourceBytes:source.sourceBytes,preflightCatalogRows:before.catalog.length,postflightCatalogRows:after.catalog.length,changedExistingContracts:changedExisting,allChecksPassed:true}));
}finally{await db.close();}
