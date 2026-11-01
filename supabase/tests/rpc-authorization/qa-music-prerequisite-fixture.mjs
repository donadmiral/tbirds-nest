// Recreate the exact inspected QA story/book baseline. Only isolated PGlite.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {source} from './deployed-media-baseline.mjs';
import {loadBusinessAuthBaseline} from './business-auth-fixture.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export async function loadQaMusicPrerequisiteBaseline(db){
 await loadBusinessAuthBaseline(db,true,true,{qaLegacyBookColumns:true});
 await db.exec(await source('supabase/migrations/20261029054043_memory_book_visual_presentation.sql'));
 // Existing QA migration 20261028151016 placed this column at position 9.
 // The fresh production baseline omits it until music; that is a different path.
 const creative=JSON.parse(await source('supabase/tests/rpc-authorization/memory-creative-reader-baseline-20261031.json'));
 for(const f of creative.functions){assert.equal(createHash('md5').update(f.definition).digest('hex'),f.definition_md5);await db.exec(f.definition);}
 for(const name of ['20261031001826_memory_book_creative_presentation','20261031012445_memory_book_creative_mutations','20261031012805_memory_book_creative_public_contracts'])await db.exec(await source(`supabase/migrations/${name}.sql`));
 const legacy=JSON.parse(await source('docs/quality/completion-20261101/backend/music-qa-existing-story-and-book-baseline.json')).observation;
 for(const f of legacy.functions){
  assert.equal(createHash('md5').update(f.definition).digest('hex'),f.definitionMd5);await db.exec(f.definition);
  await db.exec(`revoke all on function ${f.signature}from public,anon,authenticated,service_role;grant execute on function ${f.signature}to service_role;`);
  if(f.signature.startsWith('public.publish_story_v2'))await db.exec(`revoke all on function ${f.signature}from service_role;grant execute on function ${f.signature}to authenticated;grant execute on function ${f.signature}to service_role;`);
 }
 const business=JSON.parse(await source('supabase/ops/qa/business-auth-staged-20261031/candidate.json'));
 for(const unit of business.stages.slice(0,7)){const sql=await source(unit.path);assert.equal(hash(sql),unit.sha256);await db.exec(sql);}
 const activation=JSON.parse(await source('docs/quality/completion-20261101/backend/business-stage8-storage-repair-candidate.json'));
 await db.exec("create role supabase_storage_admin;create type storage.buckettype as enum('STANDARD','ANALYTICS','VECTOR')");
 for(const table of activation.excludedProviderMetadata){
  const columns=table.columns.map(c=>`"${c.name}" ${c.type}${c.notNull?' not null':''}`).join(',');
  await db.exec(`create table storage.${table.name}(${columns});alter table storage.${table.name} enable row level security;alter table storage.${table.name} owner to supabase_storage_admin;`);
  if(table.name!=='migrations')await db.exec(`grant select on storage.${table.name} to service_role;grant select on storage.${table.name} to anon;grant select on storage.${table.name} to authenticated;`);
 }
 const activationSql=await source(activation.sourcePath);assert.equal(hash(activationSql),activation.sourceSha256);await db.exec(activationSql);
 await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])');
 await db.query('insert into supabase_migrations.schema_migrations values($1,$2,$3)',['fixture-repaired-stage8','qa_business_auth_08_activate_storage_surfaces_20261101',[activationSql]]);
}
