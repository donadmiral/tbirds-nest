import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions } from './live-schema-fixture.mjs';
import { loadDeployedMediaBaseline, source } from './deployed-media-baseline.mjs';
const db = new PGlite({ extensions });
const rows = async (sql,args=[]) => (await db.query(sql,args)).rows;
const value = async (sql,args=[]) => Object.values((await rows(sql,args))[0]||{})[0];
const user = randomUUID(), other = randomUUID(), session = randomUUID();
const receipt = () => ({id:randomUUID(),token:randomBytes(32).toString('hex')});
async function as(role,subject,sql,args=[],claims={}) {
  await db.exec('savepoint request');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",
      [subject||'',role,JSON.stringify({sub:subject,role,session_id:session,...claims})]);
    const result = await value(sql,args);
    await db.exec('reset role');
    await db.exec("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");
    await db.exec('release savepoint request'); return result;
  } catch(error) { await db.exec('rollback to savepoint request; release savepoint request'); throw error; }
}
const service = (sql,args=[]) => as('service_role',null,sql,args);
const request = r => as('authenticated',user,'select public.request_account_erasure($1,$2)',[r.id,r.token]);
const status = r => as('anon',null,'select public.account_erasure_status($1,$2)',[r.id,r.token]);
const claim = worker => service('select public.claim_account_erasure($1)',[worker]);
const prepare = (r,w) => service('select public.prepare_account_erasure_identity($1,$2)',[r.id,w]);
const finish = (r,w,error=null) => service('select public.finish_account_erasure($1,$2,$3)',[r.id,w,error]);
async function rejectedWrite(action,pattern) {
  await db.exec('savepoint denied_write');
  try { await assert.rejects(action,pattern); }
  finally { await db.exec('rollback to savepoint denied_write; release savepoint denied_write'); }
}
let migration, baseline;
before(async()=>{
  baseline=await loadDeployedMediaBaseline(db);
  assert.equal(await value("select md5(pg_get_functiondef('public.delete_user_account(uuid)'::regprocedure))"),'2216cc828cb339debeeed40865d72d78');
  migration=await source('supabase/migrations/20261029224812_account_storage_erasure.sql');
  await db.exec(migration);
  await db.exec("select set_config('request.jwt.claim.role','service_role',false),set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)");
  for(const [id,name] of [[user,'erasure_user'],[other,'erasure_other']]) {
    await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${name}@example.test`]);
    await db.query('insert into public.profiles(id,username,full_name,email) values($1,$2,$2,$3) on conflict(id) do update set username=excluded.username',[id,name,`${name}@example.test`]);
  }
  await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[session,user]);
  await db.exec("update account_erasure.worker set last_seen_at=clock_timestamp(),secret_digest=extensions.digest('test-worker','sha256')");
});
beforeEach(()=>db.exec('begin'));
afterEach(()=>db.exec('rollback'));
after(()=>db.close());
async function object(owner=user,path=`${owner}/photo.jpg`,bucket='post-media') {
  return await value('insert into storage.objects(bucket_id,name,owner,owner_id,version) values($1,$2,$3,$4,$5) returning id', [bucket,path,owner,owner,randomUUID()]);
}
test('migration applies over the exact 25 deployed units and four repairs; only API worker may erase Storage',async()=>{
  assert.deepEqual(baseline,{units:25,repairs:4});
  assert.doesNotMatch(migration,/delete\s+from\s+storage\.objects/i);
  assert.doesNotMatch(await value("select pg_get_functiondef('account_erasure.erase_app_records(uuid)'::regprocedure)"),/delete\s+from\s+auth\.users/i);
  assert.equal(await value("select public from storage.buckets where id='post-media'"),true);
  assert.equal(await value("select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','creator_finance','marketplace_ops') and c.relkind='r' and not exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='account_erasure_actor_write')"),0);
});
test('app roles cannot access private receipts or worker contracts, and old deletion is explicitly refused',async()=>{
  for(const role of ['anon','authenticated']) {
    await assert.rejects(as(role,user,'select public.claim_account_erasure($1)',[randomUUID()]),/permission denied/);
    await assert.rejects(as(role,user,'select count(*) from account_erasure.jobs'),/permission denied/);
  }
  await assert.rejects(as('authenticated',user,'select public.delete_user_account($1)',[user]),/ACCOUNT_ERASURE_REQUIRED/);
  assert.equal(await value('select count(*)::int from auth.users where id=$1',[user]),1);
});
test('requires a real current session, nonanonymous user and live worker before accepting work',async()=>{
  const r=receipt();
  await assert.rejects(as('authenticated',user,'select public.request_account_erasure($1,$2)',[r.id,r.token],{session_id:randomUUID()}),/SESSION_REQUIRED/);
  await assert.rejects(as('authenticated',user,'select public.request_account_erasure($1,$2)',[r.id,r.token],{is_anonymous:true}),/AUTH_REQUIRED/);
  await db.exec("update account_erasure.worker set last_seen_at=now()-interval '1 day'");
  await assert.rejects(request(r),/TEMPORARILY_UNAVAILABLE/);
  assert.equal(await value('select banned_until from auth.users where id=$1',[user]),null);
});
test('acceptance is idempotent, receipt-scoped, bans login and fences stale JWT writes without deleting data',async()=>{
  const id=await object(),r=receipt(); const accepted=await request(r);
  assert.equal(accepted.state,'queued'); assert.equal(accepted.filesTotal,1);
  assert.deepEqual(await request(r),accepted);
  assert.equal((await status(r)).state,'queued');
  assert.equal(await status({...r,token:randomBytes(32).toString('hex')}),null);
  assert.equal(await value('select count(*)::int from storage.objects where id=$1',[id]),1);
  assert.equal(await value('select count(*)::int from auth.sessions where user_id=$1',[user]),0);
  await assert.rejects(as('authenticated',user,"update public.profiles set bio='late write' where id=$1 returning id",[user]),/ACCOUNT_ERASURE_IN_PROGRESS/);
  await rejectedWrite(()=>object(),/ACCOUNT_ERASURE_IN_PROGRESS/);
  await assert.rejects(as('authenticated',other,'select public.request_account_erasure($1,$2)',[r.id,r.token]),/REQUEST_CONFLICT/);
});
test('metadata remains until API deletion; a false success never permits Auth deletion',async()=>{
  const id=await object(),r=receipt(),w=randomUUID(); await request(r); const job=await claim(w);
  assert.equal(job.id,r.id); assert.equal(job.objects[0].id,id);
  assert.equal(await service('select public.check_account_erasure_object($1,$2,$3)',[r.id,w,id]),'delete');
  assert.equal(await service('select public.ack_account_erasure_object($1,$2,$3)',[r.id,w,id]),false);
  assert.equal(await prepare(r,w),'more');
  assert.equal(await finish(r,w,'storage_not_erased'),true);
  assert.equal((await status(r)).state,'retry');
  assert.equal(await value('select count(*)::int from auth.users where id=$1',[user]),1);
});
test('lease takeover fences stale workers; byte deletion and Auth deletion are acknowledged independently',async()=>{
  const id=await object(),r=receipt(),w=randomUUID(),w2=randomUUID(); await request(r); await claim(w);
  await db.exec("update account_erasure.jobs set lease_until=now()-interval '1 second'");
  await claim(w2);
  assert.equal(await service('select public.check_account_erasure_object($1,$2,$3)',[r.id,w,id]),'stale');
  assert.equal(await finish(r,w,'storage_unavailable'),false);
  // Hosted API deletion is simulated only in this isolated database. The
  // worker HTTP suite verifies the actual outbound Storage API contract.
  await db.query('delete from storage.objects where id=$1',[id]);
  assert.equal(await service('select public.check_account_erasure_object($1,$2,$3)',[r.id,w2,id]),'absent');
  assert.equal(await service('select public.ack_account_erasure_object($1,$2,$3)',[r.id,w2,id]),true);
  assert.equal(await prepare(r,w2),'cache_wait','CDN invalidation must finish before identity deletion');
  await db.query("update account_erasure.jobs set cache_until=clock_timestamp()-interval '1 second' where id=$1",[r.id]);
  assert.equal(await prepare(r,w2),'ready');
  assert.equal(await finish(r,w2),false,'Auth still exists');
  assert.equal(await value('select count(*)::int from auth.users where id=$1',[user]),1);
  await db.query('delete from auth.users where id=$1',[user]);
  assert.equal(await finish(r,w2),true);
  const done=await status(r); assert.equal(done.state,'completed'); assert.equal(done.filesErased,1);
  assert.equal(await value('select user_id from account_erasure.jobs where id=$1',[r.id]),null);
  assert.equal(await value('select count(*)::int from account_erasure.objects where job_id=$1',[r.id]),0);
});
test('reserved paths cannot be replaced after deletion, including by a background writer',async()=>{
  const id=await object(),r=receipt(); await request(r);
  await rejectedWrite(()=>db.query('update storage.objects set version=$1 where id=$2',[randomUUID(),id]),/IN_PROGRESS|RESERVED/);
  await db.query('delete from storage.objects where id=$1',[id]);
  await rejectedWrite(()=>object(other,`${user}/photo.jpg`),/RESERVED/);
});
test('unknown ownership and shared accounts are review cases, never inferred deletion rights',async()=>{
  await object(null,`${user}/legacy.jpg`); const r=receipt();
  const accepted=await request(r); assert.equal(accepted.state,'retention_review'); assert.equal(accepted.reason,'ownership_review');
  assert.equal(await claim(randomUUID()),null);
});
test('staff accounts require review without deleting authority or Auth records',async()=>{
  await db.query("insert into public.admin_users(user_id,role) values($1,'super_admin')",[user]);
  const accepted=await request(receipt()); assert.equal(accepted.state,'retention_review'); assert.equal(accepted.reason,'managed_account');
  assert.equal(await value('select count(*)::int from public.admin_users where user_id=$1',[user]),1);
});
test('financial balances force review and the original payment preservation trigger stays intact',async()=>{
  const before=await value("select md5(pg_get_functiondef('public.preserve_chat_payment_record()'::regprocedure))");
  await db.query("insert into creator_finance.balances(user_id,currency,bucket,amount_minor) values($1,'USD','available',100)",[user]);
  const accepted=await request(receipt()); assert.equal(accepted.state,'retention_review'); assert.equal(accepted.reason,'financial_records');
  assert.equal(await value("select md5(pg_get_functiondef('public.preserve_chat_payment_record()'::regprocedure))"),before);
  assert.equal(await value('select amount_minor::int from creator_finance.balances where user_id=$1',[user]),100);
});
test('completed technical receipts expire after 30 days; active review records do not',async()=>{
  const r=receipt(),w=randomUUID(); await request(r); await claim(w); assert.equal(await prepare(r,w),'ready');
  await db.query('delete from auth.users where id=$1',[user]); await finish(r,w);
  await db.exec("update account_erasure.jobs set completed_at=now()-interval '31 days'");
  await claim(randomUUID()); assert.equal(await status(r),null);
});
