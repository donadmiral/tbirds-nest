const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const K = '20000000-0000-4000-8000-000000000001';
const q = value => "'" + value.replaceAll("'", "''") + "'";
let db;
async function as(role, uid, sql) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid || '']);
    const result = await db.query(sql);
    await db.exec('commit');
    return result.rows;
  } catch (e) { await db.exec('rollback'); throw e; }
}
async function scalar(role, uid, sql) { return Object.values((await as(role, uid, sql))[0])[0]; }
async function interest(uid=A) { return scalar('authenticated', uid, `select public.creator_register_interest(${q(uid)})`); }
async function approve(uid=A) {
  await interest(uid);
  await db.query("update creator_finance.enrollments set status='approved',accepted_terms_version='test-only',accepted_terms_at=now() where user_id=$1",[uid]);
}
async function credit(amount='10000', key='source-1',uid=A) {
  await scalar('service_role',null,`select creator_finance.record_funded_earning(${q(uid)},'USD',${q(amount)},'synthetic-funded-receipt',${q(key)})`);
}
async function available(amount='10000',key='release-1',uid=A) {
  await scalar('service_role',null,`select creator_finance.move_earning(${q(uid)},'USD',${q(amount)},'pending','available','synthetic-release',${q(key)})`);
}
async function setupPayout() {
  await approve(); await credit(); await available();
  // Explicitly synthetic capability setup for transaction tests only.
  await db.exec("update creator_finance.providers set payouts_enabled=true,contract_version='synthetic-only',currencies=array['USD'] where id='intobank'");
  await db.query("insert into creator_finance.payout_accounts(user_id,provider_id,status,external_account_ref,verified_at) values($1,'intobank','ready','test-destination',now())",[A]);
}
async function request(amount='2500',key=K) { return scalar('authenticated',A,`select public.creator_request_payout(${q(A)},'USD',${q(amount)},${q(key)})`); }
async function outcome(id,status,event='test-event',amount='2500',account='test-destination',reference='test-provider-reference') {
  return scalar('service_role',null,`select creator_finance.reconcile_payout(${q(id)},'intobank',${q(event)},${q(reference)},${q(account)},'USD',${q(amount)},${q(status)})`);
}
async function balances() { return (await db.query("select bucket,amount_minor::text as amount from creator_finance.balances where user_id=$1 order by bucket",[A])).rows; }

test.beforeEach(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,service_role; grant execute on function auth.uid() to authenticated,service_role;
    alter default privileges grant all on tables to service_role;
    insert into auth.users values('${A}'),('${B}');`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261022173111_creator_monetization_foundation.sql'),'utf8'));
});
test.afterEach(async () => { await db.close(); });

test('unauthenticated and missing-user access fails, private tables and money writes are not client APIs',async()=>{
  await assert.rejects(()=>as('anon',null,'select public.creator_monetization_snapshot()'),/permission denied/);
  await assert.rejects(()=>as('authenticated',null,'select public.creator_monetization_snapshot()'),/AUTH_REQUIRED/);
  await assert.rejects(()=>as('authenticated',A,'select * from creator_finance.balances'),/permission denied/);
  await assert.rejects(()=>as('service_role',null,'select * from creator_finance.balances'),/permission denied/);
  await assert.rejects(()=>as('authenticated',A,`select creator_finance.record_funded_earning('${A}','USD','100','fake','fake')`),/permission denied/);
  await assert.rejects(()=>as('authenticated',A,`select creator_finance.reconcile_payout('${K}','intobank','fake','fake','fake','USD','100','completed')`),/permission denied/);
});
test('caller-bound interest is idempotent and cannot cross accounts; snapshot has truthful disabled defaults',async()=>{
  assert.equal(await interest(),'interested'); assert.equal(await interest(),'interested');
  await assert.rejects(()=>as('authenticated',A,`select public.creator_register_interest('${B}')`),/ACCOUNT_CHANGED/);
  const a=await scalar('authenticated',A,'select public.creator_monetization_snapshot()');
  const b=await scalar('authenticated',B,'select public.creator_monetization_snapshot()');
  assert.equal(a.enrollment.status,'interested'); assert.equal(b.enrollment.status,'not_enrolled');
  assert.equal(a.provider.id,'intobank'); assert.equal(a.provider.payouts_enabled,false); assert.deepEqual(a.balances,[]);
  await assert.rejects(()=>as('authenticated',A,`select public.creator_apply('${A}','made-up')`),/ENROLLMENT_CLOSED/);
});
test('application requires the current server terms and never self-approves',async()=>{
  await assert.rejects(()=>db.exec("update creator_finance.program set enrollment_open=true,terms_version='v1',terms_url=null"),/check constraint/);
  await interest(); await db.exec("update creator_finance.program set enrollment_open=true,terms_version='v1',terms_url='https://example.test/terms'");
  await assert.rejects(()=>as('authenticated',A,`select public.creator_apply('${A}','v0')`),/TERMS_CHANGED/);
  assert.equal(await scalar('authenticated',A,`select public.creator_apply('${A}','v1')`),'applied');
  assert.equal(await interest(),'applied');
});
test('funded earnings are immutable, idempotent and currency-safe decimal strings',async()=>{
  await approve(); await credit('9007199254740993'); await credit('9007199254740993');
  await assert.rejects(()=>credit('9007199254740992'),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(()=>credit('9007199254740993','different-key-same-funding'),/FUNDING_REFERENCE_ALREADY_RECORDED/);
  await assert.rejects(()=>scalar('service_role',null,`select creator_finance.record_funded_earning('${A}','EUR','100','x','eur')`),/UNSUPPORTED_CURRENCY/);
  await assert.rejects(()=>credit('1.01','decimal'),/INVALID_AMOUNT/);
  await assert.rejects(()=>credit('-1','negative'),/INVALID_AMOUNT/);
  const snapshot=await scalar('authenticated',A,'select public.creator_monetization_snapshot()');
  assert.equal(snapshot.balances[0].amount_minor,'9007199254740993');
  await assert.rejects(()=>db.exec("update creator_finance.ledger set amount_minor=1"),/FINANCE_RECORD_IMMUTABLE/);
  await assert.rejects(()=>db.exec("delete from creator_finance.ledger"),/FINANCE_RECORD_IMMUTABLE/);
});
test('payout cannot reserve funds until both provider and account are ready',async()=>{
  await approve(); await credit(); await available();
  await assert.rejects(()=>request(),/PAYOUT_PROVIDER_NOT_READY/);
  await db.exec("update creator_finance.providers set payouts_enabled=true,contract_version='synthetic',currencies=array['USD']");
  await assert.rejects(()=>request(),/PAYOUT_ACCOUNT_NOT_READY/);
  assert.equal((await db.query('select count(*)::int as n from creator_finance.payouts')).rows[0].n,0);
});
test('payout reserves once and retries preserve original payload and provider',async()=>{
  await setupPayout(); const id=await request(); assert.equal(await request(),id);
  await assert.rejects(()=>request('2501'),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(()=>as('authenticated',B,`select public.creator_request_payout('${A}','USD','2500','${K}')`),/ACCOUNT_CHANGED/);
  assert.deepEqual(await balances(),[{bucket:'available',amount:'7500'},{bucket:'pending',amount:'0'},{bucket:'reserved',amount:'2500'}]);
  await assert.rejects(()=>request('8000','20000000-0000-4000-8000-000000000002'),/INSUFFICIENT_BALANCE/);
  assert.equal((await db.query('select count(*)::int as n from creator_finance.payouts')).rows[0].n,1);
});
test('unknown does not release money and only a matching canonical receipt completes once',async()=>{
  await setupPayout(); const id=await request();
  assert.equal(await outcome(id,'unknown'),'unknown');
  await assert.rejects(()=>outcome(id,'completed','wrong-amount','2501'),/RECEIPT_MISMATCH/);
  await assert.rejects(()=>outcome(id,'completed','wrong-account','2500','other'),/RECEIPT_MISMATCH/);
  await assert.rejects(()=>outcome(id,'submitted','stale'),/STALE_PAYOUT_EVENT/);
  assert.equal((await balances()).find(x=>x.bucket==='reserved').amount,'2500');
  assert.equal(await outcome(id,'completed','settled'),'completed');
  assert.equal(await outcome(id,'completed','settled'),'completed');
  assert.equal(await outcome(id,'completed','settled-duplicate'),'completed');
  await assert.rejects(()=>outcome(id,'rejected','contradiction'),/FINAL_PAYOUT_CONFLICT/);
  assert.equal((await balances()).find(x=>x.bucket==='paid').amount,'2500');
  assert.equal((await balances()).find(x=>x.bucket==='reserved').amount,'0');
});
test('confirmed no-movement rejection releases reserved funds exactly once',async()=>{
  await setupPayout(); const id=await request();
  assert.equal(await outcome(id,'rejected'),'rejected'); assert.equal(await outcome(id,'rejected'),'rejected');
  assert.equal((await balances()).find(x=>x.bucket==='available').amount,'10000');
  await assert.rejects(()=>outcome(id,'completed','test-event'),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(()=>db.exec('delete from creator_finance.receipts'),/FINANCE_RECORD_IMMUTABLE/);
});
test('earnings transition guards prevent borrowing, arbitrary paid credits and cross-currency movement',async()=>{
  await approve(); await credit();
  await assert.rejects(()=>scalar('service_role',null,`select creator_finance.move_earning('${A}','USD','100','pending','paid','fake','bad')`),/INVALID_EARNING_TRANSITION/);
  await assert.rejects(()=>available('10001'),/INSUFFICIENT_BALANCE/);
  await available();
  await scalar('service_role',null,`select creator_finance.move_earning('${A}','USD','400','available','withheld','review','hold')`);
  await scalar('service_role',null,`select creator_finance.move_earning('${A}','USD','400','withheld','reversed','confirmed-reversal','reverse')`);
  assert.equal((await balances()).find(x=>x.bucket==='reversed').amount,'400');
});

test('interest-only account deletion does not get blocked by enrollment',async()=>{ await interest(); await db.query('delete from auth.users where id=$1',[A]); assert.equal((await db.query('select count(*)::int as n from creator_finance.enrollments')).rows[0].n,0); });
