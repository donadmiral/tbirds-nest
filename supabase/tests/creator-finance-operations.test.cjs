const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE || path.join(__dirname,'rpc-authorization/node_modules/@electric-sql/pglite'));
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const K='20000000-0000-4000-8000-000000000001',W='30000000-0000-4000-8000-000000000001',W2='30000000-0000-4000-8000-000000000002';
let db;
async function call(role,user,sql,args=[]) {
  await db.exec('begin');try {await db.exec(`set local role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);
  const rows=(await db.query(sql,args)).rows;await db.exec('commit');return Object.values(rows[0]||{})[0];}catch(e){await db.exec('rollback');throw e;}
}
test.beforeEach(async()=>{
  db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
    alter default privileges grant all on tables to service_role;insert into auth.users values('${A}'),('${B}');`);
  await db.exec(`alter table auth.users add column deleted_at timestamptz;alter table auth.users add column banned_until timestamptz;
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz,aal text);
    create table public.admin_users(user_id uuid primary key,role text,active boolean);
    create table public.admin_audit_log(id uuid default gen_random_uuid(),admin_id uuid,action text,target_kind text,target_id text,reason text,before jsonb,after jsonb);
    create function public.triniti_admin_session_check(p_user_id uuid,p_session_id uuid) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id join public.admin_users a on a.user_id=s.user_id
        where s.id=p_session_id and s.user_id=p_user_id and (s.not_after is null or s.not_after>now()) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) and a.active);$$;
    revoke all on function public.triniti_admin_session_check(uuid,uuid) from public,anon,authenticated;
    grant execute on function public.triniti_admin_session_check(uuid,uuid) to service_role;
    insert into auth.sessions values('${W}','${B}',null,'aal2');insert into public.admin_users values('${B}','finance_admin',true);`);
  for(const f of ['20261022173111_creator_monetization_foundation.sql','20261022211313_creator_finance_operations.sql','20261022211400_creator_product_entitlements.sql','20261022211649_creator_finance_review.sql','20261023190254_creator_finance_dispatch_and_refund_guards.sql']) await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',f),'utf8'));
});
test.afterEach(async()=>db.close());
async function prepare() {
  // Synthetic capability fixture only. Production's current bank contract
  // deliberately cannot dispatch a new legacy partner payout.
  await db.exec("create or replace function creator_finance.provider_dispatch_ready() returns boolean language sql immutable security definer set search_path='' as $$select true;$$");
  await db.exec("update creator_finance.program set environment='test'");
  for(const id of [A,B]) { await call('authenticated',id,'select public.creator_register_interest($1)',[id]);await db.query("update creator_finance.enrollments set status='approved',accepted_terms_version='test',accepted_terms_at=now() where user_id=$1",[id]); }
  await db.exec("update creator_finance.providers set payouts_enabled=true,contract_version='crisp-payout-v1',currencies=array['USD']");
  await db.query("insert into creator_finance.payout_accounts values($1,'intobank','ready','INTOBANK:123456789',now())",[A]);
  await call('service_role',null,'select creator_finance.record_funded_earning($1,\'USD\',\'10000\',\'synthetic-receipt\',\'source\')',[A]);
  await call('service_role',null,'select creator_finance.move_earning($1,\'USD\',\'10000\',\'pending\',\'available\',\'synthetic-release\',\'release\')',[A]);
  return call('authenticated',A,'select public.creator_request_payout($1,\'USD\',\'2500\',$2)',[A,K]);
}
const claim=w=>call('service_role',null,"select public.creator_claim_payouts($1,5,'test')",[w]);
const begin=(id,w=W)=>call('service_role',null,'select public.creator_begin_payout_dispatch($1,$2)',[id,w]);
const finish=(id,outcome=null,w=W)=>call('service_role',null,'select public.creator_finish_payout_attempt($1,$2,$3,$4)',[id,w,outcome,outcome?null:'PAYOUT_PROVIDER_UNCONFIRMED']);
function receipt(id,status='completed'){return {payout_id:id,provider_id:'intobank',environment:'test',event_id:'provider-event:'+status,reference:'provider-receipt',account_reference:'INTOBANK:123456789',currency:'USD',amount_minor:'2500',status};}
test('live readiness cannot be enabled by a provider flag and base functions are inaccessible',async()=>{
  await db.exec("update creator_finance.providers set payouts_enabled=true,contract_version='crisp-payout-v1',currencies=array['USD']");
  const snap=await call('authenticated',A,'select public.creator_monetization_snapshot()');assert.equal(snap.environment,'live');assert.equal(snap.provider.payouts_enabled,false);
  await assert.rejects(()=>call('authenticated',A,"select public.creator_request_payout($1,'USD','1',$2)",[A,K]),/PAYOUT_PROVIDER_NOT_READY/);
  await assert.rejects(()=>call('authenticated',A,"select creator_finance.request_payout_base($1,'USD','1',$2)",[A,K]),/permission denied/);
  await assert.rejects(()=>call('authenticated',A,"select public.creator_claim_payouts($1,5,'test')",[W]),/permission denied/);
  await assert.rejects(()=>call('service_role',null,"select public.creator_claim_payouts($1,5,'live')",[W]),/INVALID_WORKER_REQUEST/);
  await db.exec("update creator_finance.program set environment='test'");
  assert.equal((await call('authenticated',A,'select public.creator_monetization_snapshot()')).provider.payouts_enabled,false);
  await assert.rejects(()=>call('authenticated',A,"select public.creator_request_payout($1,'USD','1',$2)",[A,K]),/PAYOUT_PROVIDER_NOT_READY/);
});
test('leases exclude other workers, dispatch intent is single-use, timeout preserves reserved money',async()=>{
  const id=await prepare();assert.equal((await claim(W)).length,1);assert.deepEqual(await claim(W2),[]);
  assert.equal(await begin(id,W2),false);assert.equal(await begin(id),true);assert.equal(await begin(id),false);
  assert.equal(await finish(id),'unknown');
  assert.equal((await db.query("select amount_minor::text amount from creator_finance.balances where user_id=$1 and bucket='reserved'",[A])).rows[0].amount,'2500');
  await db.exec("update creator_finance.payouts set next_attempt_at=now()-interval '1 minute'");
  const recovered=await claim(W2);assert.equal(recovered[0].dispatch_started,true);assert.equal(recovered[0].status,'unknown');
  assert.equal(await begin(id,W2),false);await assert.rejects(()=>finish(id,receipt(id),W),/STALE_PAYOUT_LEASE/);
  assert.equal(await finish(id,receipt(id),W2),'completed');
  assert.equal((await db.query("select amount_minor::text amount from creator_finance.balances where user_id=$1 and bucket='paid'",[A])).rows[0].amount,'2500');
  assert.deepEqual(await claim(W),[]);
});
test('late pending receipts cannot regress unknown or conflict with earlier submitted receipt',async()=>{
  const id=await prepare();await claim(W);await begin(id);assert.equal(await finish(id,receipt(id,'submitted')),'submitted');
  await db.exec("update creator_finance.payouts set next_attempt_at=now()-interval '1 minute'");await claim(W);
  assert.equal(await finish(id,receipt(id,'unknown')),'unknown');
  await db.exec("update creator_finance.payouts set next_attempt_at=now()-interval '1 minute'");await claim(W);
  assert.equal(await finish(id,receipt(id,'submitted')),'unknown');
});
test('cross-environment and amount mismatches cannot settle and environment cannot change after money activity',async()=>{
  const id=await prepare();await claim(W);await begin(id);
  await assert.rejects(()=>finish(id,{...receipt(id),environment:'live'}),/RECEIPT_MISMATCH/);
  await assert.rejects(()=>finish(id,{...receipt(id),amount_minor:'2501'}),/RECEIPT_MISMATCH/);
  await assert.rejects(()=>db.exec("update creator_finance.program set environment='live'"),/FINANCE_ENVIRONMENT_HAS_ACTIVITY/);
});
test('revoked creator or payout destination prevents first dispatch',async()=>{
  const id=await prepare();await claim(W);await db.exec("update creator_finance.payout_accounts set status='restricted'");assert.equal(await begin(id),false);
  assert.equal(await finish(id),'requested');assert.equal((await db.query('select dispatch_started_at from creator_finance.payouts')).rows[0].dispatch_started_at,null);
});
test('pausing new payouts never stops reconciliation of previously dispatched money',async()=>{
  const id=await prepare();await claim(W);await begin(id);await finish(id);
  await db.exec("update creator_finance.providers set payouts_enabled=false;update creator_finance.payouts set next_attempt_at=now()-interval '1 minute'");
  const recovered=await claim(W2);assert.equal(recovered.length,1);assert.equal(recovered[0].dispatch_started,true);
  assert.equal(await finish(id,receipt(id),W2),'completed');assert.deepEqual(await claim(W),[]);
});
test('deleted or banned creators cannot start a new provider dispatch',async()=>{
  const id=await prepare();await claim(W);await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[A]);
  assert.equal(await begin(id),false);await db.query('update auth.users set banned_until=null,deleted_at=now() where id=$1',[A]);assert.equal(await begin(id),false);
});
test('statement uses stable seek pagination, preserves amounts and never crosses accounts',async()=>{
  await prepare();const first=await call('authenticated',A,'select public.creator_statement($1,2)',[A]);assert.equal(first.entries.length,2);assert.equal(first.environment,'test');assert.ok(first.next_cursor);
  const next=await call('authenticated',A,'select public.creator_statement($1,2,$2,$3)',[A,first.next_cursor.created_at,first.next_cursor.id]);assert.equal(next.entries.length,1);assert.equal(next.next_cursor,null);
  assert.equal(new Set([...first.entries,...next.entries].map(x=>x.id)).size,3);assert.equal(typeof first.entries[0].amount_minor,'string');
  assert.deepEqual((await call('authenticated',B,'select public.creator_statement($1,2)',[B])).entries,[]);
  await assert.rejects(()=>call('authenticated',B,'select public.creator_statement($1,2)',[A]),/ACCOUNT_CHANGED/);
  await assert.rejects(()=>call('authenticated',A,'select public.creator_statement($1,101)',[A]),/INVALID_PAGE/);
});
test('approved revenue economics are immutable and cannot be edited by clients or services',async()=>{
  const p=await call('authenticated',A,'select public.creator_revenue_policy()');assert.equal(p.version,'2026-10-v1');assert.deepEqual(Object.fromEntries(p.shares.map(x=>[x.kind,x.creator_bps])),{ads:5500,gift:7000,marketplace:9500,sponsorship:9000,subscription:9000,tip:10000});
  await assert.rejects(()=>db.exec("update creator_finance.revenue_policies set creator_bps=0"),/FINANCE_RECORD_IMMUTABLE/);
  await assert.rejects(()=>call('service_role',null,'select * from creator_finance.revenue_policies'),/permission denied/);
});
test('finance review requires active native MFA session and correct staff role',async()=>{
  const read=()=>call('service_role',null,'select public.creator_finance_admin_snapshot($1,$2)',[B,W]);assert.ok(await read());
  await assert.rejects(()=>call('authenticated',B,'select public.creator_finance_admin_snapshot($1,$2)',[B,W]),/permission denied/);
  await db.exec("update auth.sessions set aal='aal1'");await assert.rejects(read,/MFA_REQUIRED/);await db.exec("update auth.sessions set aal='aal2'");
  await db.exec("update public.admin_users set role='market_reviewer'");await assert.rejects(read,/ACTIVE_FINANCE_SESSION_REQUIRED/);await db.exec("update public.admin_users set role='finance_admin'");
  await db.exec("update auth.sessions set not_after=now()-interval '1 minute'");await assert.rejects(read,/ACTIVE_FINANCE_SESSION_REQUIRED/);
});
test('review saves exactly one audit and command receipt; stale or conflicting reviews cannot overwrite',async()=>{
  await call('authenticated',A,'select public.creator_register_interest($1)',[A]);
  await db.query("update creator_finance.enrollments set status='applied',accepted_terms_version='v1',accepted_terms_at=now() where user_id=$1",[A]);
  const timestamp=(await db.query('select updated_at from creator_finance.enrollments where user_id=$1',[A])).rows[0].updated_at;
  const review=(key=K,status='approved')=>call('service_role',null,'select public.creator_finance_review($1,$2,$3,$4,$5,$6,$7)',[B,W,key,A,timestamp,status,'Reviewed current eligibility evidence.']);
  assert.equal((await review()).status,'approved');assert.equal((await review()).status,'approved');
  assert.equal((await db.query('select count(*)::int n from public.admin_audit_log')).rows[0].n,1);
  await assert.rejects(()=>review(K,'rejected'),/IDEMPOTENCY_CONFLICT/);await assert.rejects(()=>review(W2,'rejected'),/CREATOR_REVIEW_CHANGED/);
  await assert.rejects(()=>call('service_role',null,'select public.creator_finance_review($1,$2,$3,$1,now(),\'approved\',\'self\')',[B,W,K]),/SELF_REVIEW_FORBIDDEN/);
});
