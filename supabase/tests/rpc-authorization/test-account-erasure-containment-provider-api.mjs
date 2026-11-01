import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test}from'node:test';
import {randomUUID,createHash}from'node:crypto';
import {PGlite}from'@electric-sql/pglite';
import {extensions}from'./live-schema-fixture.mjs';
import {loadBusinessAuthBaseline}from'./business-auth-fixture.mjs';
import {source}from'./deployed-media-baseline.mjs';
const db=new PGlite({extensions});
const sql=await source('supabase/ops/qa/20261101050940_qa_account_erasure_containment_provider_api.sql');
const cronBody=await source('supabase/tests/rpc-authorization/account-erasure-legacy-cron.sql');
const token='pc_erase_'+'a'.repeat(64);
const q=async(s,a=[])=>(await db.query(s,a)).rows;
const v=async(s,a=[])=>Object.values((await q(s,a))[0]||{})[0];
const cronApi=`create or replace function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null)returns void language plpgsql as $$begin update cron.job j set active=coalesce(alter_job.active,j.active)where j.jobid=alter_job.job_id;end$$;`;
let definitions;
async function reset(){
 await db.exec('rollback');
 for(const f of definitions){await db.exec(f.definition);await db.exec(`revoke all on function ${f.signature}from public,anon,authenticated,service_role;grant execute on function ${f.signature}to ${f.role};`);}
 await db.exec(cronApi);
 await db.exec("delete from account_erasure.jobs;delete from cron.job;delete from account_erasure.worker;insert into account_erasure.worker(singleton)values(true);");
 await q("update account_erasure.worker set secret_digest=extensions.digest($1,'sha256'),last_seen_at=clock_timestamp()",[token]);
 await q("insert into cron.job(jobid,jobname,schedule,command,username,active)values(701,'platinum-account-storage-erasure','* * * * *',$1,'postgres',true),(702,'unrelated-fixture','*/5 * * * *','select 1','postgres',true)",[cronBody]);
}
async function reject(pattern){await assert.rejects(db.exec(sql),pattern);await db.exec('rollback');}
const state=()=>q("select c.active,c.command,w.secret_digest is not null as configured,w.last_seen_at is not null as heartbeat from cron.job c cross join account_erasure.worker w where c.jobname='platinum-account-storage-erasure'");
before(async()=>{
 await loadBusinessAuthBaseline(db,true,true);
 await db.exec('create schema cron;create table cron.job(jobid bigint primary key,jobname text,schedule text,command text,username text,active boolean);');
 definitions=(await q(`select signature,pg_get_functiondef(to_regprocedure(signature))as definition,role from(values('public.validate_account_erasure_worker(text)','service_role'),('public.claim_account_erasure(uuid)','service_role'),('public.request_account_erasure(uuid,text)','authenticated'),('public.triniti_admin_erasure_review(uuid,uuid,uuid,text,uuid,text,text,text,text)','service_role'))s(signature,role)`));
 assert.equal(createHash('md5').update(cronBody).digest('hex'),'d0c0f30abe2c07bdab2eed11ab48e761');
});
beforeEach(reset);afterEach(()=>db.exec('rollback'));after(()=>db.close());

test('the actual transaction contains only the exact named cron and invalidates the reusable capability',async()=>{
 const before=await q('select (select count(*)from auth.users)::int auth,(select count(*)from storage.objects)::int objects,(select count(*)from vault.secrets)::int vault');
 assert.equal(await v('select public.validate_account_erasure_worker($1)',[token]),true);
 await db.exec(sql);
 assert.deepEqual(await state(),[{active:false,command:cronBody,configured:false,heartbeat:false}]);
 assert.equal(await v('select active from cron.job where jobid=702'),true);
 assert.equal(await v('select public.validate_account_erasure_worker($1)',[token]),false);
 assert.deepEqual(await q('select (select count(*)from auth.users)::int auth,(select count(*)from storage.objects)::int objects,(select count(*)from vault.secrets)::int vault'),before);
});
test('pending authorized jobs cause refusal and remain byte-identical',async()=>{
 const id=randomUUID();await q("insert into account_erasure.jobs(id,user_id,receipt_digest,state)values($1,$2,extensions.digest('fixture','sha256'),'queued')",[id,randomUUID()]);
 const before=await q('select to_jsonb(j)as job from account_erasure.jobs j');
 await reject(/ERASURE_CONTAINMENT_REVIEW_PENDING_JOBS/);
 assert.deepEqual(await q('select to_jsonb(j)as job from account_erasure.jobs j'),before);
 assert.equal((await state())[0].active,true);assert.equal((await state())[0].configured,true);
});
test('an active authorized lease is preserved and never interrupted',async()=>{
 await q("insert into account_erasure.jobs(id,user_id,receipt_digest,state,lease_token,lease_until)values($1,$2,extensions.digest('fixture','sha256'),'erasing',$3,clock_timestamp()+interval '5 minutes')",[randomUUID(),randomUUID(),randomUUID()]);
 const before=await q('select to_jsonb(j)as job from account_erasure.jobs j');await reject(/ERASURE_CONTAINMENT_REVIEW_PENDING_JOBS/);
 assert.deepEqual(await q('select to_jsonb(j)as job from account_erasure.jobs j'),before);
});
test('a changed or extra legacy schedule is refused without disabling any job',async()=>{
 await q("update cron.job set command='select 2'where jobid=701");await reject(/ERASURE_CONTAINMENT_CRON_CONTRACT_CHANGED/);assert.equal(await v('select active from cron.job where jobid=701'),true);
 await reset();await q("insert into cron.job values(703,'different-erasure','* * * * *',$1,'postgres',true)",[cronBody]);await reject(/ERASURE_CONTAINMENT_CRON_CONTRACT_CHANGED/);
 assert.equal(await v('select count(*)::int from cron.job where active'),3);
});
test('duplicate target names and unexpected schedule owners are refused',async()=>{
 await q("insert into cron.job values(703,'platinum-account-storage-erasure','* * * * *',$1,'other',true)",[cronBody]);await reject(/ERASURE_CONTAINMENT_CRON_CONTRACT_CHANGED/);
 await reset();await q("update cron.job set username='other'where jobid=701");await reject(/ERASURE_CONTAINMENT_CRON_CONTRACT_CHANGED/);
});
test('changed validator body or any extra execute grant fails the exact contract guard',async()=>{
 await db.exec("create or replace function public.validate_account_erasure_worker(p_token text)returns boolean language plpgsql stable security definer set search_path=''as $$begin return true;end$$");
 await reject(/ERASURE_CONTAINMENT_RPC_CONTRACT_CHANGED/);assert.equal((await state())[0].configured,true);
 await reset();await db.exec('grant execute on function public.validate_account_erasure_worker(text)to anon');await reject(/ERASURE_CONTAINMENT_RPC_CONTRACT_CHANGED/);
});
test('already contained and absent provider API states cannot be silently replayed',async()=>{
 await db.exec(sql);await reject(/ERASURE_CONTAINMENT_WORKER_STATE_CHANGED/);assert.equal((await state())[0].configured,false);
 await reset();await db.exec('drop function cron.alter_job(bigint,text,text,text,text,boolean)');await reject(/ERASURE_CONTAINMENT_CRON_API_REQUIRED/);assert.equal((await state())[0].active,true);
});
test('provider API failure rolls the whole transaction back before credential invalidation',async()=>{
 await db.exec("create or replace function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null)returns void language plpgsql as $$begin raise exception 'fixture provider refusal';end$$");
 await reject(/fixture provider refusal/);assert.equal((await state())[0].configured,true);assert.equal((await state())[0].active,true);
});
test('a no-op provider update fails the postcondition and rolls credential state back',async()=>{
 await db.exec("create or replace function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null)returns void language plpgsql as $$begin return;end$$");
 await reject(/ERASURE_CONTAINMENT_POSTCONDITION_FAILED/);assert.equal((await state())[0].configured,true);assert.equal((await state())[0].heartbeat,true);
});
test('a late no-job claim cannot restore a retired capability or readiness',async()=>{
 await db.exec(sql);assert.equal(await v('select public.claim_account_erasure($1)',[randomUUID()]),null);
 assert.equal((await state())[0].heartbeat,true);assert.equal((await state())[0].configured,false);assert.equal((await state())[0].active,false);
 assert.equal(await v('select public.validate_account_erasure_worker($1)',[token]),false);
 assert.equal(await v("select exists(select 1 from account_erasure.worker where secret_digest is not null and last_seen_at>clock_timestamp()-interval '15 minutes')"),false);
});

// This final isolated case reproduces the hosted provider-owned table boundary.
test('SELECT-only provider cron table rejects the original direct row lock and accepts the supported API correction',async()=>{
 await db.exec(cronApi.replace('language plpgsql as','language plpgsql security definer set search_path=\'\' as'));
 await db.exec("create role fixture_cron_owner;alter table cron.job owner to fixture_cron_owner;alter function cron.alter_job(bigint,text,text,text,text,boolean)owner to fixture_cron_owner;grant usage on schema cron to fixture_cron_owner,postgres;revoke all on cron.job from public,postgres;grant select on cron.job to postgres;revoke all on function cron.alter_job(bigint,text,text,text,text,boolean)from public;grant execute on function cron.alter_job(bigint,text,text,text,text,boolean)to postgres;create role fixture_super superuser;set session authorization fixture_super;alter role postgres rename to fixture_bootstrap;create role postgres;grant usage on schema cron,account_erasure,extensions to postgres;grant select on cron.job to postgres;grant execute on function cron.alter_job(bigint,text,text,text,text,boolean)to postgres;alter table account_erasure.worker owner to postgres;alter table account_erasure.jobs owner to postgres;alter function public.validate_account_erasure_worker(text)owner to postgres;alter function public.claim_account_erasure(uuid)owner to postgres;alter function public.request_account_erasure(uuid,text)owner to postgres;alter function public.triniti_admin_erasure_review(uuid,uuid,uuid,text,uuid,text,text,text,text)owner to postgres;set role postgres;");
 assert.equal(await v("select has_table_privilege('postgres','cron.job','SELECT')"),true);
 assert.equal(await v("select has_table_privilege('postgres','cron.job','UPDATE')"),false);
 const failedOriginal=await source('supabase/migrations/20261101050506_account_erasure_legacy_dispatch_containment.sql');
 await assert.rejects(db.exec(failedOriginal),/permission denied for table job/);await db.exec('rollback');
 assert.equal((await state())[0].active,true);assert.equal((await state())[0].configured,true);
 await db.exec(sql);assert.equal((await state())[0].active,false);assert.equal((await state())[0].configured,false);
 assert.equal(await v('select active from cron.job where jobid=702'),true);
});
