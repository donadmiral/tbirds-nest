import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test} from 'node:test';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {loadDeployedMediaBaseline,source} from './deployed-media-baseline.mjs';

const db=new PGlite({extensions});
const sql=await source('supabase/migrations/20261101043002_music_maintenance_one_use_dispatch.sql');
const origin='https://uaulhuelcfkjwojtymmw.supabase.co',workerHash='a'.repeat(64);
const q=async(query,args=[])=>(await db.query(query,args)).rows;
const value=async(query,args=[])=>Object.values((await q(query,args))[0]||{})[0];
const netFunction=`create or replace function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 5000)returns bigint language plpgsql as $$declare result bigint;begin insert into net.http_request_queue(url,body,headers,timeout_ms)values(http_post.url,http_post.body,http_post.headers,http_post.timeout_milliseconds)returning id into result;return result;end$$;`;
const configure=()=>q('select music_library.configure_maintenance_dispatch($1,$2)',[origin,workerHash]);
const enable=async()=>{await configure();await q("select public.set_music_maintenance_ready(true,'Synthetic exact worker verification')");};
const enqueue=()=>value('select music_library.enqueue_maintenance_run()');
const token=()=>value("select substring(headers->>'Authorization' from 8)from net.http_request_queue order by id desc limit 1");
async function as(role,query,args=[],jwtRole=role){
 await db.exec('savepoint actor');
 try{
  await db.exec(`set local role ${role}`);
  await q("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.role',$2,true)",[JSON.stringify({role:jwtRole}),jwtRole]);
  const result=await value(query,args);await db.exec('reset role;release savepoint actor');return result;
 }catch(error){await db.exec('rollback to savepoint actor;release savepoint actor');throw error;}
}
const consume=t=>as('service_role','select public.validate_music_maintenance_worker($1)',[t]);
const initialGuardChecks=[];
before(async()=>{
 await loadDeployedMediaBaseline(db);
 for(const name of ['20261029224550_admin_operations_completion','20261029224812_account_storage_erasure','20261029224813_private_media_cutover_compatibility','20261029231321_account_erasure_admin_review_queue','20261029231440_bounded_media_delivery','20261030010250_account_erasure_admin_restore_guard','20261030153811_original_music_library_and_delivery','20261030203619_music_catalogue_operations_and_cleanup','20261030204339_licensed_catalogue_pipeline'])await db.exec(await source(`supabase/migrations/${name}.sql`));
 await db.exec(`alter table net.http_request_queue add column url text,add column body jsonb,add column headers jsonb,add column timeout_ms integer;create sequence net.fixture_requests;alter table net.http_request_queue alter column id set default nextval('net.fixture_requests');grant usage on schema net to public;grant all on net.http_request_queue to public;${netFunction}`);
 for(const [name,mutation,error]of [
  ['enabled worker',"update music_library.maintenance_worker set enabled=true",/MUSIC_DISPATCH_LEGACY_WORKER_REVIEW/],
  ['reusable digest',"update music_library.maintenance_worker set secret_digest=extensions.digest('synthetic','sha256')",/MUSIC_DISPATCH_LEGACY_WORKER_REVIEW/],
  ['previous heartbeat',"update music_library.maintenance_worker set last_seen_at=clock_timestamp()",/MUSIC_DISPATCH_LEGACY_WORKER_REVIEW/],
  ['public validator grant','grant execute on function public.validate_music_maintenance_worker(text)to anon',/MUSIC_DISPATCH_EXISTING_RPC_ACL_DRIFT/],
  ['changed validator body',"create or replace function public.validate_music_maintenance_worker(p_token text)returns boolean language plpgsql security definer set search_path=''as $$begin return true;end$$",/MUSIC_DISPATCH_EXISTING_RPC_BODY_DRIFT/],
 ]){
  await db.exec(`begin;${mutation};`);await assert.rejects(db.exec(sql),error);await db.exec('rollback');
  assert.equal(await value("select to_regclass('music_library.maintenance_runs')is null"),true);
  initialGuardChecks.push(name);
 }
 await db.exec(sql);
});
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));after(()=>db.close());

test('installation rejects active, credentialed, previously used or drifted workers before DDL',()=>{
 assert.deepEqual(initialGuardChecks,['enabled worker','reusable digest','previous heartbeat','public validator grant','changed validator body']);
});
test('installation stays disabled with no reusable credential, capability, queue request or heartbeat',async()=>{
 assert.deepEqual((await q('select enabled,secret_digest,last_seen_at from music_library.maintenance_worker'))[0],{enabled:false,secret_digest:null,last_seen_at:null});
 assert.deepEqual((await q('select project_origin,worker_sha256,verified_at from music_library.maintenance_dispatch'))[0],{project_origin:null,worker_sha256:null,verified_at:null});
 assert.equal(await enqueue(),null);assert.equal(await value('select count(*)::int from music_library.maintenance_runs'),0);assert.equal(await value('select count(*)::int from net.http_request_queue'),0);
 assert.equal(await consume('pc_music_'+'a'.repeat(64)),false);
 assert.equal(await value('select uploads_enabled from music_library.service_state'),false);
 assert.deepEqual((await q('select ingestion_enabled,playback_enabled from music_library.catalogue_service'))[0],{ingestion_enabled:false,playback_enabled:false});
});
test('private tables and operator functions deny anon, members and service role while validation is service-only',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  for(const table of ['maintenance_dispatch','maintenance_runs']){
   assert.equal(await value(`select has_table_privilege($1,'music_library.${table}','select,insert,update,delete,truncate,references,trigger')`,[role]),false);
   assert.equal(await value(`select relrowsecurity from pg_class where oid='music_library.${table}'::regclass`),true);
   await assert.rejects(as(role,`select count(*)from music_library.${table}`),/permission denied/);
  }
  for(const query of ['select music_library.enqueue_maintenance_run()',"select music_library.configure_maintenance_dispatch('https://example.supabase.co',repeat('a',64))",'select music_library.cleanup_maintenance_runs(1)'])await assert.rejects(as(role,query),/permission denied/);
  if(role!=='service_role'){
   await assert.rejects(as(role,'select public.validate_music_maintenance_worker($1)',['pc_music_'+'a'.repeat(64)]),/permission denied/);
   await assert.rejects(as(role,"select public.set_music_maintenance_ready(true,'Synthetic activation')"),/permission denied/);
  }
 }
});
test('configuration requires a paused worker and valid public origin/source identity without enabling readiness',async()=>{
 await assert.rejects(as('postgres',"select public.set_music_maintenance_ready(true,'Verified deployment')"),/MUSIC_MAINTENANCE_VERIFIED_DISPATCH_REQUIRED/);
 for(const [url,hash]of [[null,workerHash],['http://example.supabase.co',workerHash],['https://evil.example',workerHash],[origin,null],[origin,'not-a-hash']])await assert.rejects(as('postgres','select music_library.configure_maintenance_dispatch($1,$2)',[url,hash]),/MUSIC_DISPATCH_VERIFIED_SOURCE_REQUIRED/);
 await configure();assert.equal(await value('select enabled from music_library.maintenance_worker'),false);
 await q("select public.set_music_maintenance_ready(true,'Synthetic exact worker verification')");
 await assert.rejects(as('postgres','select music_library.configure_maintenance_dispatch($1,$2)',[origin,workerHash]),/MUSIC_DISPATCH_PAUSE_BEFORE_CONFIGURE/);
});
test('readable queue carries only one short-lived capability for the fixed maintenance endpoint',async()=>{
 await enable();const id=await enqueue(),t=await token();assert.equal(typeof id,'number');assert.match(t,/^pc_music_[a-f0-9]{64}$/);
 const queue=(await q('select url,body,headers,timeout_ms from net.http_request_queue where id=$1',[id]))[0];
 assert.equal(queue.url,origin+'/functions/v1/music-maintenance');assert.deepEqual(queue.body,{});assert.deepEqual(queue.headers,{'Content-Type':'application/json',Authorization:'Bearer '+t});assert.equal(queue.timeout_ms,50000);
 assert.equal(await as('authenticated','select count(*)::int from net.http_request_queue'),1);
 const run=(await q("select purpose,state,request_id,encode(token_digest,'hex')as digest,extract(epoch from expires_at-created_at)*1000 as lifetime_ms from music_library.maintenance_runs"))[0];
 assert.equal(run.purpose,'music-maintenance');assert.equal(run.state,'queued');assert.equal(run.request_id,id);assert.equal(run.digest,createHash('sha256').update(t).digest('hex'));assert.equal(Number(run.lifetime_ms),120000);
 assert.equal(await value("select count(*)::int from information_schema.columns where table_schema='music_library'and table_name in('maintenance_dispatch','maintenance_runs')and column_name in('token','secret','credential','service_role_key')"),0);
 assert.equal(await value('select secret_digest is null from music_library.maintenance_worker'),true);
});
test('atomic validation consumes one capability once and records a heartbeat without accepting wrong credentials',async()=>{
 await enable();await enqueue();const t=await token();
 for(const candidate of [null,'',t.slice(0,-1),'pc_music_'+'0'.repeat(64),'service-role-fixture'])assert.equal(await consume(candidate),false);
 assert.equal(await as('service_role','select public.validate_music_maintenance_worker($1)',[t],'authenticated'),false);
 assert.equal(await consume(t),true);assert.equal(await consume(t),false);
 assert.equal(await value('select last_seen_at is not null from music_library.maintenance_worker'),true);
 assert.equal(await value("select count(*)::int from music_library.maintenance_runs where state='claimed'and claimed_at is not null"),1);
});
test('expired capabilities cannot be consumed or renew the heartbeat',async()=>{
 await enable();await enqueue();const t=await token();
 await q("update music_library.maintenance_runs set created_at=statement_timestamp()-interval '3 minutes',expires_at=statement_timestamp()-interval '1 minute'");
 assert.equal(await consume(t),false);assert.equal(await value('select last_seen_at from music_library.maintenance_worker'),null);
});
test('pause revokes queued capabilities and a changed source revision cannot revive old tokens',async()=>{
 await enable();await enqueue();const old=await token();
 await q("select public.set_music_maintenance_ready(false,'Pause source replacement')");
 assert.equal(await consume(old),false);assert.equal(await value('select state from music_library.maintenance_runs'),'revoked');
 await configure();await q("select public.set_music_maintenance_ready(true,'Synthetic replacement verification')");
 await enqueue();const next=await token();assert.notEqual(next,old);assert.equal(await consume(old),false);assert.equal(await consume(next),true);
});
test('a token bound to a different dispatch revision or purpose cannot run another scope',async()=>{
 await enable();await enqueue();const t=await token();
 await q('update music_library.maintenance_runs set dispatch_revision=gen_random_uuid()');assert.equal(await consume(t),false);
 await assert.rejects(as('postgres',"update music_library.maintenance_runs set purpose='unrelated-worker'"),/violates check constraint/);
});
test('enqueue retry returns the original request before and after consumption within the schedule window',async()=>{
 await enable();const first=await enqueue(),t=await token();assert.equal(await enqueue(),first);assert.equal(await consume(t),true);assert.equal(await enqueue(),first);
 assert.equal(await value('select count(*)::int from net.http_request_queue'),1);assert.equal(await value('select count(*)::int from music_library.maintenance_runs'),1);
 await q("update music_library.maintenance_runs set created_at=statement_timestamp()-interval '6 minutes',expires_at=statement_timestamp()-interval '4 minutes',claimed_at=statement_timestamp()-interval '5 minutes'");
 const next=await enqueue();assert.notEqual(next,first);assert.notEqual(await token(),t);assert.equal(await value('select count(*)::int from net.http_request_queue'),2);
});
test('a queue error rolls back its request, leaves a sanitized failed receipt and permits a fresh retry',async()=>{
 await enable();await db.exec(`create or replace function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 5000)returns bigint language plpgsql as $$begin insert into net.http_request_queue(url,body,headers,timeout_ms)values(http_post.url,http_post.body,http_post.headers,http_post.timeout_milliseconds);raise exception 'Synthetic sensitive error that must not be retained';end$$;`);
 assert.equal(await enqueue(),null);assert.equal(await value('select count(*)::int from net.http_request_queue'),0);
 assert.deepEqual((await q('select state,error_code,request_id from music_library.maintenance_runs'))[0],{state:'failed',error_code:'P0001',request_id:null});
 await db.exec(netFunction);assert.equal(typeof await enqueue(),'number');assert.equal(await value('select count(*)::int from net.http_request_queue'),1);assert.equal(await consume(await token()),true);
});
test('bounded retention removes only old capability receipts and preserves recent receipts and media',async()=>{
 await enable();await enqueue();
 const mediaBefore=await value('select count(*)::int from music_library.uploads');
 await q("update music_library.maintenance_runs set created_at=statement_timestamp()-interval '8 days',expires_at=statement_timestamp()-interval '8 days'+interval '2 minutes'");
 await enqueue();assert.equal(await value('select count(*)::int from music_library.maintenance_runs'),1);
 await q("insert into music_library.maintenance_runs(dispatch_revision,token_digest,state,created_at,expires_at)select revision,extensions.digest('old-'||n,'sha256'),'failed',statement_timestamp()-interval '8 days',statement_timestamp()-interval '8 days'+interval '2 minutes'from music_library.maintenance_dispatch cross join generate_series(1,3)n");
 assert.equal(await value('select music_library.cleanup_maintenance_runs(2)'),2);assert.equal(await value('select count(*)::int from music_library.maintenance_runs'),2);
 assert.equal(await value('select count(*)::int from music_library.uploads'),mediaBefore);
 for(const n of [null,0,501])await assert.rejects(as('postgres','select music_library.cleanup_maintenance_runs($1)',[n]),/MUSIC_DISPATCH_RETENTION_LIMIT/);
});
test('legacy credential setup refuses execution and scheduling contains no bearer or Vault lookup',async()=>{
 const retired=await source('supabase/ops/setup-music-maintenance-credential.sql');
 await assert.rejects(as('postgres',retired),/MUSIC_REUSABLE_WORKER_CREDENTIAL_RETIRED/);
 const cron=await source('supabase/ops/install-music-maintenance-cron.sql');
 assert.ok(cron.includes('select music_library.enqueue_maintenance_run();'));assert.ok(cron.includes('MUSIC_EXISTING_CRON_REVIEW_REQUIRED'));
 assert.doesNotMatch(cron,/vault\.|decrypted_secret|Authorization|net\.http_post/);
});
test('the actual cron operation requires readiness, is idempotent and refuses an unrelated existing job',async()=>{
 await db.exec(`create schema cron;create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text,username text default current_user,database text default current_database());
 create function cron.schedule(job_name text,job_schedule text,job_command text)returns bigint language plpgsql as $$declare result bigint;begin insert into cron.job(jobname,schedule,command)values(job_name,job_schedule,job_command)on conflict(jobname)do update set schedule=excluded.schedule,command=excluded.command returning jobid into result;return result;end$$;`);
 // Execute every actual operation statement inside this suite's rollback; only
 // the script's outer transaction wrapper is supplied by the test lifecycle.
 const ops=(await source('supabase/ops/install-music-maintenance-cron.sql')).replace(/^begin;\n/m,'').replace(/^commit;\n?/m,'');
 await assert.rejects(as('postgres',ops),/MUSIC_VERIFIED_DISPATCH_READINESS_REQUIRED/);assert.equal(await value('select count(*)::int from cron.job'),0);
 await enable();await db.exec(ops);const first=(await q('select * from cron.job'))[0];await db.exec(ops);
 assert.equal(await value('select count(*)::int from cron.job'),1);assert.equal(await value('select jobid from cron.job'),first.jobid);
 assert.equal(first.command,'select music_library.enqueue_maintenance_run();');assert.equal(first.schedule,'*/5 * * * *');assert.equal(first.username,'postgres');
 await q("update cron.job set command='select 123'");await assert.rejects(as('postgres',ops),/MUSIC_EXISTING_CRON_REVIEW_REQUIRED/);assert.equal(await value('select command from cron.job'),'select 123');
});
