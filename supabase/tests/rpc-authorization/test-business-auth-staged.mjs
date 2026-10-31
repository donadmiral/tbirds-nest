import assert from 'node:assert/strict';
import {before,after,test as nodeTest} from 'node:test';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {source} from './deployed-media-baseline.mjs';
import {loadBusinessAuthBaseline} from './business-auth-fixture.mjs';
import {readCatalog,publishedNames} from './business-staged-catalog.mjs';
import {splitSql} from './business-staged-sql.mjs';

const directory='supabase/ops/qa/business-auth-staged-20261031';
const manifest=JSON.parse(await source(`${directory}/candidate.json`));
const original=await source(manifest.original.path),hash=v=>createHash('sha256').update(v).digest('hex');
assert.equal(hash(original),manifest.original.sha256);
const sql=await Promise.all(manifest.stages.map(async stage=>{const text=await source(stage.path);assert.equal(hash(text),stage.sha256);assert.equal(Buffer.byteLength(text),stage.bytes);return text;}));
const privateCount=manifest.stages.length-1;
const db=new PGlite({extensions}),reference=new PGlite({extensions});
const personal='75424db7-dad1-465d-b381-60efcc91de45',business='e45ecfa4-6bf2-4f90-83c1-a8fb7bf5054a',session='eceb9741-97c4-459c-9799-8871da981613';
let beforeRows,registered=0;const passed=[];
const test=(name,fn)=>{registered++;nodeTest(name,async()=>{await fn();passed.push(name);});};
const scalar=async(target,query,args=[])=>Object.values((await target.query(query,args)).rows[0]||{})[0];
const rows=target=>target.query('select jsonb_build_object(\'users\',(select jsonb_agg(to_jsonb(u) order by id) from auth.users u),\'profiles\',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),\'sessions\',(select jsonb_agg(to_jsonb(s) order by id) from auth.sessions s),\'buckets\',(select jsonb_agg(to_jsonb(b) order by id) from storage.buckets b),\'objects\',(select jsonb_agg(to_jsonb(o) order by id) from storage.objects o)) data').then(r=>r.rows[0].data);
async function fixture(target){
 await loadBusinessAuthBaseline(target,true,true);
 // Include the already-installed notification and creative contracts. Their
 // dynamic lookup must not observe a partially published business guard.
 const calls=JSON.parse(await source('supabase/tests/rpc-authorization/notification-call-baseline-20261031.json'));
 for(const f of calls.functions)await target.exec(f.definition);
 for(const definition of calls.triggers){const name=/CREATE TRIGGER (\w+)/.exec(definition)[1];await target.exec(`drop trigger if exists ${name} on public.call_sessions;${definition}`);}
 for(const name of ['20261031004936_notification_preferences_and_call_push_authorization','20261031005240_notification_call_dispatch_deduplication','20261031010104_notification_dispatch_current_authorization'])await target.exec(await source(`supabase/migrations/${name}.sql`));
 await target.exec(await source('supabase/migrations/20261029054043_memory_book_visual_presentation.sql'));
 const readers=JSON.parse(await source('supabase/tests/rpc-authorization/memory-creative-reader-baseline-20261031.json'));
 for(const f of readers.functions)await target.exec(f.definition);
 for(const name of ['20261031001826_memory_book_creative_presentation','20261031012445_memory_book_creative_mutations','20261031012805_memory_book_creative_public_contracts'])await target.exec(await source(`supabase/migrations/${name}.sql`));
 await target.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[personal,'staged-personal@example.invalid',business,'staged-business@example.invalid']);
 await target.query("update public.profiles set username=case when id=$1 then 'staged_personal' else 'staged_business' end,account_type=case when id=$1 then 'personal' else 'business' end where id in($1,$2)",[personal,business]);
 await target.query("insert into auth.sessions(id,user_id,aal,created_at) values($1,$2,'aal1',clock_timestamp())",[session,personal]);
}
async function rejectWithoutChange(index,mutation,pattern){
 const before=await readCatalog(db);
 await db.exec(`begin;${mutation}`);
 await assert.rejects(db.exec(sql[index]),pattern);
 await db.exec('rollback');assert.deepEqual(await readCatalog(db),before);
}
async function privateState(stage){
 assert.equal((await readCatalog(db)).fingerprint,stage.expectedAfterFingerprint);
 assert.equal(await scalar(db,"select obj_description('business_auth'::regnamespace,'pg_namespace')"),`business-auth:${manifest.original.sha256}:stage-${stage.number}`);
 assert.equal(await scalar(db,"select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1)",[publishedNames]),0);
 assert.equal(await scalar(db,"select count(*)::int from pg_trigger where not tgisinternal and tgname like 'business_auth_%'"),0);
 assert.equal(await scalar(db,"select count(*)::int from pg_policy where polname='business_session_required'"),0);
 assert.equal(await scalar(db,"select count(*)::int from pg_db_role_setting s cross join lateral unnest(s.setconfig) c where c like 'pgrst.db_pre_request=%' and c<>'pgrst.db_pre_request='"),0);
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await scalar(db,"select has_schema_privilege($1,'business_auth','usage')",[role]),false);
  assert.equal(await scalar(db,"select count(*)::int from pg_class where relnamespace='business_auth'::regnamespace and relkind='r' and (not relrowsecurity or has_table_privilege($1,oid,'select,insert,update,delete'))",[role]),0);
  assert.equal(await scalar(db,"select count(*)::int from pg_proc where pronamespace='business_auth'::regnamespace and has_function_privilege($1,oid,'execute')",[role]),0);
  await db.exec(`begin;set local role ${role}`);await assert.rejects(db.query('select count(*) from business_auth.accounts'),/permission denied/);await db.exec('rollback');
 }
 // Personal caller behavior remains usable even after the private guard has
 // been staged; the published name does not exist until activation.
 await db.exec('begin;set local role authenticated');
 await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',$2,true)",[personal,JSON.stringify({sub:personal,session_id:session,role:'authenticated',is_anonymous:false})]);
 assert.deepEqual(await scalar(db,'select public.get_memory_book_creative_capabilities()'),{version:1,supported:true});
 assert.equal((await scalar(db,"select public.set_notification_preference('all',false)")).all,false);
 await db.exec('rollback');
}
before(async()=>{await fixture(db);await fixture(reference);beforeRows=await rows(db);});
after(async()=>{
 if(passed.length===registered&&process.env.BUSINESS_AUTH_STAGED_GATE_OUTPUT)await writeFile(process.env.BUSINESS_AUTH_STAGED_GATE_OUTPUT,JSON.stringify({candidate:`${directory}/candidate.json`,candidateSha256:hash(await source(`${directory}/candidate.json`)),testsPassed:passed.length,tests:passed,allPassed:true,localOnly:true,scope:'Actual QA SQL contracts in PGlite; exact original/staged catalog comparison, interrupted private stages, drift and rollback. No hosted installation or token issuance is inferred.'},null,2)+'\n');
 await db.close();await reference.close();
});
test('every substantive original statement is mapped once, transaction boundaries are explicit and both cleanup approval classifications remain',()=>{
 const split=splitSql(original);assert.equal(split.statements.map(s=>s.sql).join('')+split.trailing,original);
 assert.deepEqual(manifest.originalStatements.filter(s=>s.requiresDestructiveConfirmation).map(s=>s.index),[29,39]);
 assert.deepEqual(manifest.stages.filter(s=>s.requiresDestructiveConfirmation).map(s=>s.number),[4,7]);
 assert.ok(manifest.stages[3].bytes<8000);
 assert.deepEqual([0,1,2,...manifest.stages.flatMap(s=>s.originalStatementIndices),51].sort((a,b)=>a-b),split.statements.map(s=>s.index));
 for(const stage of manifest.stages)for(const index of stage.originalStatementIndices){
  const originalText=split.statements[index].sql;
  const expected=manifest.originalStatements[index].stagedPrivateSignature?originalText.replace(/create function public\./,'create function business_auth.'):originalText;
  assert.ok(sql[stage.number-1].includes(expected),`Original statement ${index} changed beyond its reviewed private CREATE header`);
 }
});
test('a missing predecessor aborts without creating any business objects',async()=>{await rejectWithoutChange(1,'',/BUSINESS_AUTH_STAGE_ORDER/);assert.equal(await scalar(db,"select to_regnamespace('business_auth')"),null);});
for(let index=0;index<privateCount;index++){
 const stage=manifest.stages[index];
 test(`stage ${stage.number} commits only inaccessible private objects and leaves personal creative/preferences usable`,async()=>{await db.exec(sql[index]);await privateState(stage);});
 test(`stage ${stage.number+1} rejects wrong ordering, table/ACL drift and unexpected staged data before any change`,async()=>{
  const next=index+1;
  await rejectWithoutChange(next,"comment on schema business_auth is 'unexpected-stage'",/BUSINESS_AUTH_STAGE_ORDER/);
  await rejectWithoutChange(next,'alter table business_auth.accounts disable row level security',/BUSINESS_AUTH_STAGED_CATALOG_DRIFT/);
  await rejectWithoutChange(next,'alter table business_auth.accounts add column unreviewed text',/BUSINESS_AUTH_STAGED_CATALOG_DRIFT/);
  await rejectWithoutChange(next,'alter table business_auth.accounts alter column created_at drop not null',/BUSINESS_AUTH_STAGED_CATALOG_DRIFT/);
  await rejectWithoutChange(next,'grant select on business_auth.accounts to authenticated',/BUSINESS_AUTH_STAGED_CATALOG_DRIFT/);
  await rejectWithoutChange(next,`insert into business_auth.accounts(business_id) values('${business}')`,/BUSINESS_AUTH_STAGED_DATA_REVIEW/);
 });
}
test('a staged function body, execute grant, custom hook or public-name appearance is rejected',async()=>{
 for(const mutation of [
  "create or replace function business_auth.business_session_allowed() returns boolean language sql stable security definer set search_path='' as $$select true$$",
  'grant execute on function business_auth.business_session_allowed() to service_role',
  "alter role authenticator set pgrst.db_pre_request='public.unreviewed_guard'",
  "create function public.business_session_allowed() returns boolean language sql as $$select true$$",
 ])await rejectWithoutChange(privateCount,mutation,/BUSINESS_AUTH_STAGED_CATALOG_DRIFT/);
});
test('a newly issued business Auth session holds final activation without deleting or invalidating it',async()=>{
 await rejectWithoutChange(privateCount,`insert into auth.sessions(id,user_id,created_at) values('77ef46bd-ef86-4839-b09d-2a46113042a0','${business}',clock_timestamp())`,/BUSINESS_AUTH_EXISTING_SESSIONS_CUTOVER_REQUIRED/);
 await privateState(manifest.stages[privateCount-1]);
});
test('a late activation error rolls back moved public functions, triggers, policies, hook and grants together',async()=>{
 const before=await readCatalog(db);
 const failing=sql[privateCount].replace('comment on schema business_auth is null;','select 1/0;\ncomment on schema business_auth is null;');
 await assert.rejects(db.exec(failing),/division by zero/);await db.exec('rollback');
 assert.deepEqual(await readCatalog(db),before);await privateState(manifest.stages[privateCount-1]);
});
test('final activation exactly matches the original catalog and preserves existing Auth/profile/media rows',async()=>{
 await db.exec(sql[privateCount]);await reference.exec(original);
 assert.deepEqual(await readCatalog(db),await readCatalog(reference));
 assert.deepEqual(await rows(db),beforeRows);
 assert.equal(await scalar(db,"select obj_description('business_auth'::regnamespace,'pg_namespace')"),null);
 assert.equal(await scalar(db,'select count(*)::int from business_auth.accounts'),1);
 assert.equal(await scalar(db,'select business_id from business_auth.accounts'),business);
 assert.equal(await scalar(db,"select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and c.relrowsecurity and (n.nspname in('public','creator_finance','marketplace_ops','storage') or(n.nspname='realtime' and c.relname='messages')) and not exists(select 1 from pg_policy p where p.polrelid=c.oid and p.polname='business_session_required')"),0);
});
