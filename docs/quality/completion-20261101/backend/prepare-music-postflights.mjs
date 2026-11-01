// Offline source-bound QA preparation. No hosted request, mutation or activation.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {extensions} from '../../../../supabase/tests/rpc-authorization/live-schema-fixture.mjs';
import {loadQaMusicPrerequisiteBaseline} from '../../../../supabase/tests/rpc-authorization/qa-music-prerequisite-fixture.mjs';

const root=new URL('../../../../',import.meta.url),here=new URL('./music-migration-requests/',import.meta.url);
const requireFixture=createRequire(new URL('supabase/tests/rpc-authorization/package.json',root));
const {PGlite}=requireFixture('@electric-sql/pglite');
const read=p=>readFile(new URL(p,root),'utf8');
const sha=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
const write=(name,value)=>writeFile(new URL(name,here),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
const manifest=JSON.parse(await read('docs/quality/completion-20261101/backend/music-migration-requests/index.json'));
const business=JSON.parse(await read('supabase/ops/qa/business-auth-staged-20261031/candidate.json'));
const activation=JSON.parse(await read('docs/quality/completion-20261101/backend/business-stage8-storage-repair-candidate.json'));
const businessActivation={...business.stages[7],path:activation.sourcePath,sha256:activation.sourceSha256,bytes:activation.sourceBytes,migrationName:'qa_business_auth_08_activate_storage_surfaces_20261101'};
const storyPrerequisite=JSON.parse(await read('docs/quality/completion-20261101/backend/music-story-prerequisite-candidate.json'));
const db=new PGlite({extensions});

const schemas="('public','music_library','media_delivery','account_erasure','business_auth')";
const relationSchemas="('public','music_library','storage')";
const inventory=`
select 'schema'::text k,nspname::text n,jsonb_build_array(pg_get_userbyid(nspowner),nspacl::text) v from pg_namespace where nspname='music_library'
union all select 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',jsonb_build_array(pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),p.proacl::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ${schemas} and p.prokind='f'
union all select 'relation',n.nspname||'.'||c.relname,jsonb_build_array(c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner),c.relacl::text) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${relationSchemas} and c.relkind in('r','p','v','m','f','S')
union all select 'column',n.nspname||'.'||c.relname||'.'||a.attnum::text,jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname in ${relationSchemas} and c.relkind in('r','p') and a.attnum>0 and not a.attisdropped
union all select 'constraint',n.nspname||'.'||c.relname||'.'||t.conname,to_jsonb(pg_get_constraintdef(t.oid)) from pg_constraint t join pg_class c on c.oid=t.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${relationSchemas} and t.contype<>'n'
union all select 'index',n.nspname||'.'||c.relname,to_jsonb(pg_get_indexdef(c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${relationSchemas} and c.relkind in('i','I')
union all select 'sequence',n.nspname||'.'||c.relname,jsonb_build_array(format_type(s.seqtypid,null),s.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache,s.seqcycle) from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='music_library'
union all select 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ${relationSchemas}
union all select 'policy',n.nspname||'.'||c.relname||'.'||p.polname,jsonb_build_array(p.polpermissive,p.polcmd,(select jsonb_agg(r.rolname order by r.rolname) from pg_roles r where r.oid=any(p.polroles)),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${relationSchemas}
`;
const catalog=async()=>{
 await db.exec("set search_path=pg_catalog");
 const rows=(await db.query(`with inventory as (${inventory}) select k,n,md5(v::text) as md5 from inventory order by k,n`)).rows;
 assert.equal(new Set(rows.map(r=>r.k+'\0'+r.n)).size,rows.length);
 return rows;
};
const tableNames=async()=>(await db.query("select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='music_library' and c.relkind='r' order by c.relname")).rows.map(x=>x.name);
const flagsFor=stage=>stage===0?"'{}'::jsonb":`jsonb_build_object('uploadsEnabled',(select uploads_enabled from music_library.service_state where singleton)${stage>=2?",'maintenanceEnabled',(select enabled from music_library.maintenance_worker where singleton),'maintenanceCredentialConfigured',(select secret_digest is not null from music_library.maintenance_worker where singleton),'maintenanceLastSeen',(select last_seen_at from music_library.maintenance_worker where singleton)":""}${stage>=3?",'catalogueIngestionEnabled',(select ingestion_enabled from music_library.catalogue_service where singleton),'cataloguePlaybackEnabled',(select playback_enabled from music_library.catalogue_service where singleton)":""})`;
const expectedFlags=stage=>stage===0?{}:{uploadsEnabled:false,...(stage>=2?{maintenanceEnabled:false,maintenanceCredentialConfigured:false,maintenanceLastSeen:null}:{}),...(stage>=3?{catalogueIngestionEnabled:false,cataloguePlaybackEnabled:false}:{})};
const stageTables=[];
async function initializeFixture(target){
 await loadQaMusicPrerequisiteBaseline(target);
 const sql=await read(storyPrerequisite.sourcePath);assert.equal(sha(sql),storyPrerequisite.sourceSha256);assert.equal(Buffer.byteLength(sql),storyPrerequisite.sourceBytes);await target.exec(sql);
 await target.query('insert into supabase_migrations.schema_migrations values($1,$2,$3)',['fixture-story-prerequisite',storyPrerequisite.migrationName,[sql]]);
}
try{
 await mkdir(here,{recursive:true});
 await initializeFixture(db);
 const snapshots=[await catalog()];stageTables.push(await tableNames());
 for(const unit of manifest.requests){
  const sql=await read(unit.sourcePath),request=JSON.parse(await read(unit.requestPath));
  assert.equal(sha(sql),unit.sourceSha256);assert.equal(Buffer.byteLength(sql),unit.sourceBytes);assert.equal(request.query,sql);
  await db.exec(sql);snapshots.push(await catalog());stageTables.push(await tableNames());
 }
 const maps=snapshots.map(rows=>new Map(rows.map(r=>[r.k+'\0'+r.n,r])));
 const changedKeys=new Set();
 const changes=[];
 for(let i=1;i<maps.length;i++){
  const delta=[];
  for(const key of new Set([...maps[i-1].keys(),...maps[i].keys()]))if(maps[i-1].get(key)?.md5!==maps[i].get(key)?.md5){
   changedKeys.add(key);delta.push({before:maps[i-1].get(key)||null,after:maps[i].get(key)||null});
  }
  changes.push(delta);
 }
 // Bind required existing Auth/media/privacy and creative-reader contracts too.
 for(const row of snapshots[0])if(row.k==='function'&&(
  row.n.startsWith('business_auth.')||
  /^(public\.(business_session_allowed|business_auth_request_guard|get_memory_book_creative_capabilities|save_memory_book_creative_presentation|create_memory_book_creative_presentation)|media_delivery\.require_session|account_erasure\.(assert_writable|guard_actor_write|review_reason))\(/.test(row.n)
 ))changedKeys.add(row.k+'\0'+row.n);
 const keys=[...changedKeys].sort().map(key=>{const [k,n]=key.split('\0');return{k,n};});
 const keyValues=keys.map(({k,n})=>`(${quote(k)},${quote(n)})`).join(',\n');
 const expectedRows=snapshots.map(rows=>rows.filter(r=>changedKeys.has(r.k+'\0'+r.n)));
 const makeQuery=(stage,phase,unit)=>{
  const tables=stageTables[stage];
  const counts=tables.length?`jsonb_build_object(${tables.map(t=>`${quote(t)},(select count(*) from music_library.${t})`).join(',')})`:"'{}'::jsonb";
  return `-- Source-bound read-only ${phase}; no app RPC invocation, credential value or data write.\nbegin read only;\nset local search_path=pg_catalog;\nset local lock_timeout='3s';\nset local statement_timeout='20s';\nwith inventory as (${inventory}), selected_keys(k,n) as (values ${keyValues})\nselect jsonb_build_object(\n 'observedAt',clock_timestamp(),'executor',current_user,'readOnly',current_setting('transaction_read_only')='on',\n 'packageStage',${stage},'phase',${quote(phase)},\n 'catalog',(select coalesce(jsonb_agg(jsonb_build_object('k',i.k,'n',i.n,'md5',md5(i.v::text)) order by i.k,i.n),'[]'::jsonb) from inventory i where exists(select 1 from selected_keys s where(s.k,s.n)=(i.k,i.n)) or i.n like 'music_library.%' or(i.k='schema' and i.n='music_library')),\n 'musicSchemaPresent',to_regnamespace('music_library') is not null,\n 'musicPrivateTableAccess',(select count(*) from pg_class c cross join(values('anon'),('authenticated'),('service_role'))r(role) where c.relnamespace=to_regnamespace('music_library') and c.relkind='r' and has_table_privilege(r.role,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),\n 'musicPrivateFunctionAccess',(select count(*) from pg_proc p cross join(values('anon'),('authenticated'),('service_role'))r(role) where p.pronamespace=to_regnamespace('music_library') and has_function_privilege(r.role,p.oid,'EXECUTE')),\n 'musicPrivateSchemaAccess',(select count(*) from pg_namespace n cross join(values('anon'),('authenticated'),('service_role'))r(role) where n.nspname='music_library' and has_schema_privilege(r.role,n.oid,'USAGE')),\n 'musicTablesWithoutRls',(select count(*) from pg_class c where c.relnamespace=to_regnamespace('music_library') and c.relkind='r' and not c.relrowsecurity),\n 'musicTableCounts',${counts},'readiness',${flagsFor(stage)},\n 'audioBucket',(select to_jsonb(b) from(select id,name,public,file_size_limit,allowed_mime_types from storage.buckets where id='music-audio')b),\n 'stage8Journal',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'queryBytes',octet_length(array_to_string(statements,E'\\n')),'querySha256',encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex')) order by version),'[]'::jsonb) from supabase_migrations.schema_migrations where name like 'qa_business_auth_08_%'),\n 'storyPrerequisiteJournal',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'queryBytes',octet_length(array_to_string(statements,E'\\n')),'querySha256',encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex')) order by version),'[]'::jsonb) from supabase_migrations.schema_migrations where name=${quote(storyPrerequisite.migrationName)}),\n 'musicJournal',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'queryBytes',octet_length(array_to_string(statements,E'\\n')),'querySha256',encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex')) order by version),'[]'::jsonb) from supabase_migrations.schema_migrations where name in (${manifest.requests.map(u=>quote(u.migrationName)).join(',')})),\n 'otherActiveOrOpenClientTransactions',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and backend_type='client backend' and state in('active','idle in transaction','idle in transaction (aborted)')),\n 'preparedTransactions',(select count(*) from pg_prepared_xacts),\n 'scope','Catalog and disabled initial-state acceptance only. No member/business identity, upload, erase, provider, delivery or licensing acceptance is implied.'\n)as observation;\nrollback;\n`;
 };
 // Test the exact generated read-only projections at all four isolated states.
 const fixtureChecks=[];
 for(const unit of manifest.requests)await db.query('insert into supabase_migrations.schema_migrations values($1,$2,$3)',[`fixture-music-${unit.order}`,unit.migrationName,[await read(unit.sourcePath)]]);
 for(const unit of manifest.requests){
  const prefix=String(unit.order).padStart(2,'0'),beforeStage=unit.order-1,afterStage=unit.order;
  const preflightSql=makeQuery(beforeStage,'preflight',unit),postflightSql=makeQuery(afterStage,'postflight',unit);
  await write(`${prefix}_preflight.sql`,preflightSql);await write(`${prefix}_postflight.sql`,postflightSql);
  const expected={formatVersion:1,projectRef:manifest.projectRef,source:unit,sourceSqlUnchanged:true,localFixtureOnly:true,
   prerequisiteBusinessSource:businessActivation,prerequisiteStorySource:{migrationName:storyPrerequisite.migrationName,sourcePath:storyPrerequisite.sourcePath,sourceSha256:storyPrerequisite.sourceSha256,sourceBytes:storyPrerequisite.sourceBytes},allMigrationSources:manifest.requests.map(({order,migrationName,sourceSha256,sourceBytes})=>({order,migrationName,sourceSha256,sourceBytes})),
   preflight:{stage:beforeStage,catalog:expectedRows[beforeStage],tableCounts:Object.fromEntries(stageTables[beforeStage].map(t=>[t,['service_state','maintenance_worker','catalogue_service'].includes(t)?1:0])),readiness:expectedFlags(beforeStage)},
   postflight:{stage:afterStage,catalog:expectedRows[afterStage],tableCounts:Object.fromEntries(stageTables[afterStage].map(t=>[t,['service_state','maintenance_worker','catalogue_service'].includes(t)?1:0])),readiness:expectedFlags(afterStage)},
   changedObjects:changes[unit.order-1],
   expectedAudioBucket:afterStage>0?(await db.query("select id,name,public,file_size_limit,allowed_mime_types from storage.buckets where id='music-audio'")).rows[0]:null,
   preflightPath:`docs/quality/completion-20261101/backend/music-migration-requests/${prefix}_preflight.sql`,
   postflightPath:`docs/quality/completion-20261101/backend/music-migration-requests/${prefix}_postflight.sql`,
   scope:'Exact reviewed migration bytes against QA creative-before-music baseline. All initial readiness flags remain disabled. This is not a hosted installation or identity/provider acceptance receipt.'};
  await write(`${prefix}_expected.json`,expected);
  unit.preflightPath=expected.preflightPath;unit.postflightPath=expected.postflightPath;unit.expectedPath=`docs/quality/completion-20261101/backend/music-migration-requests/${prefix}_expected.json`;
 }
 const finalQuery=makeQuery(3,'postflight',manifest.requests[2]);
 const final=(await db.exec(finalQuery)).flatMap(r=>r.rows||[])[0].observation;
 assert.deepEqual(final.catalog,expectedRows[3]);assert.deepEqual(final.readiness,expectedFlags(3));
 assert.equal(final.musicPrivateTableAccess,0);assert.equal(final.musicPrivateFunctionAccess,0);assert.equal(final.musicTablesWithoutRls,0);
 assert.equal(final.musicJournal.length,3);assert.equal(final.storyPrerequisiteJournal.length,1);assert.equal(final.storyPrerequisiteJournal[0].querySha256,storyPrerequisite.sourceSha256);
 await write('local-final-projection.json',{formatVersion:1,sourceBoundIsolatedFixture:true,observation:final});
 const verifyDb=new PGlite({extensions});
 try{
  await initializeFixture(verifyDb);
  for(const unit of manifest.requests){
   const prefix=String(unit.order).padStart(2,'0');
   for(const phase of ['preflight','postflight']){
    if(phase==='postflight'){
     const sql=await read(unit.sourcePath);await verifyDb.exec(sql);
     await verifyDb.query('insert into supabase_migrations.schema_migrations values($1,$2,$3)',[`fixture-music-${unit.order}`,unit.migrationName,[sql]]);
    }
    const stage=phase==='preflight'?unit.order-1:unit.order;
    const result=(await verifyDb.exec(makeQuery(stage,phase,unit))).flatMap(r=>r.rows||[])[0].observation;
    assert.deepEqual(result.catalog,expectedRows[stage]);assert.deepEqual(result.readiness,expectedFlags(stage));
    assert.equal(result.musicSchemaPresent,stage>0);assert.equal(result.musicPrivateTableAccess,0);assert.equal(result.musicPrivateFunctionAccess,0);assert.equal(result.musicPrivateSchemaAccess,0);assert.equal(result.musicTablesWithoutRls,0);
    assert.equal(result.musicJournal.length,stage);assert.equal(result.readOnly,true);assert.equal(result.storyPrerequisiteJournal.length,1);assert.equal(result.storyPrerequisiteJournal[0].querySha256,storyPrerequisite.sourceSha256);
    await write(`${prefix}_local-${phase}.json`,{formatVersion:1,sourceBoundIsolatedFixture:true,observation:result});
    fixtureChecks.push({migrationOrder:unit.order,phase,stage,actualGeneratedSqlExecuted:true,catalogRows:result.catalog.length,allChecksPassed:true});
   }
  }
 }finally{await verifyDb.close();}
 manifest.verifierPath='docs/quality/completion-20261101/backend/verify-music-observation.py';
 manifest.generatorPath='docs/quality/completion-20261101/backend/prepare-music-postflights.mjs';
 manifest.businessActivationPrerequisite=businessActivation;
 manifest.storyPublisherPrerequisite={migrationName:storyPrerequisite.migrationName,sourcePath:storyPrerequisite.sourcePath,sourceSha256:storyPrerequisite.sourceSha256,sourceBytes:storyPrerequisite.sourceBytes};
 manifest.generatedCatalogMethod='Exact before/after catalog deltas from unchanged migrations, with the inspected QA legacy soundtrack column/resolver, creative books, repaired business activation and guarded current publisher installed first; unchanged Auth/media/privacy prerequisites included. Catalog values are hashed in PostgreSQL to preserve canonical serialization.';
 manifest.localVerification={allChecksPassed:true,fixtureChecks,changedObjectCounts:changes.map(x=>x.length),catalogCounts:expectedRows.map(x=>x.length)};
 await write('index.json',manifest);
 console.log(JSON.stringify(manifest.localVerification));
}finally{await db.close();}
