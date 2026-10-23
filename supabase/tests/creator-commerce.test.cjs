const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||path.join(__dirname,'rpc-authorization/node_modules/@electric-sql/pglite'));
const C='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002',X='10000000-0000-4000-8000-000000000003';
const P='20000000-0000-4000-8000-000000000001',K='30000000-0000-4000-8000-000000000001',K2='30000000-0000-4000-8000-000000000002';
let db;
async function call(role,user,sql,args=[]) {
  await db.exec('begin');try{await db.exec(`set local role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);const rows=(await db.query(sql,args)).rows;await db.exec('commit');return Object.values(rows[0]||{})[0];}catch(e){await db.exec('rollback');throw e;}
}
test.beforeEach(async()=>{
  db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
    alter default privileges grant all on tables to service_role;insert into auth.users(id) values('${C}'),('${B}'),('${X}');`);
  for(const f of ['20261022173111_creator_monetization_foundation.sql','20261022211313_creator_finance_operations.sql','20261022211400_creator_product_entitlements.sql','20261023190254_creator_finance_dispatch_and_refund_guards.sql']) await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',f),'utf8'));
  await call('authenticated',C,'select public.creator_register_interest($1)',[C]);
  await db.query("update creator_finance.enrollments set status='approved',accepted_terms_version='v1',accepted_terms_at=now() where user_id=$1",[C]);
});
test.afterEach(async()=>db.close());
const product=(kind='subscription',amount='1001',id=P)=>call('authenticated',C,'select public.creator_save_product($1,$2,$3,$4,$5,$6,true)',[C,id,kind,'Example',amount,kind==='subscription'?30:null]);
const order=(key=K,amount='1001')=>call('authenticated',B,'select public.creator_create_order($1,$2,$3,$4)',[B,P,amount,key]);
const settle=(id,event='capture-1',amount='1001',deductions='1')=>call('service_role',null,"select creator_finance.settle_order($1,$2,$3,$4,'USD',$5,$6,'test')",[id,B,'provider:'+id,event,amount,deductions]);
const refund=(id,amount,event='refund-1')=>call('service_role',null,"select creator_finance.refund_order($1,$2,$3,$4,'test')",[id,'provider:'+id,event,amount]);
const access=(user=B)=>call('authenticated',user,'select public.creator_has_active_subscription($1,$2)',[C,user]);
const balance=bucket=>db.query('select amount_minor::text value from creator_finance.balances where user_id=$1 and bucket=$2',[C,bucket]).then(r=>r.rows[0]?.value||'0');
async function ready(){await db.exec("update creator_finance.program set environment='test';update creator_finance.commerce_config set sandbox_enabled=true");}
test('commerce is disabled by default and all money/entitlement writes deny clients',async()=>{
  const cap=await call('authenticated',B,'select public.creator_commerce_capabilities()');assert.equal(cap.purchases_enabled,false);assert.equal(cap.recurring_enabled,false);
  await product();await assert.rejects(order,/PURCHASES_NOT_ENABLED/);
  for(const table of ['products','orders','commerce_receipts','allocations','receivables','subscription_periods'])await assert.rejects(()=>call('authenticated',B,`select * from creator_finance.${table}`),/permission denied/);
  await assert.rejects(()=>call('authenticated',B,"select creator_finance.settle_order($1,$2,'ref','event','USD','1001','1','test')",[K,B]),/permission denied/);
  await assert.rejects(()=>call('service_role',null,"select creator_finance.allocate_revenue($1,'tip',100,0,'fabricated')",[C]),/permission denied/);
  await db.exec('update creator_finance.commerce_config set sandbox_enabled=true');assert.equal((await call('authenticated',B,'select public.creator_commerce_capabilities()')).purchases_enabled,false);
});
test('orders freeze price and creator; retries are exact and cannot cross accounts',async()=>{
  await ready();await product();await assert.rejects(()=>order(K,'1000'),/PRICE_CHANGED/);
  const id=await order();assert.equal(await order(),id);await product('subscription','2000');assert.equal(await order(),id);
  await assert.rejects(()=>order(K,'2000'),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(()=>call('authenticated',X,'select public.creator_create_order($1,$2,$3,$4)',[B,P,'2000',K2]),/ACCOUNT_CHANGED/);
  await assert.rejects(()=>call('authenticated',C,'select public.creator_create_order($1,$2,$3,$4)',[C,P,'2000',K2]),/SELF_PURCHASE_FORBIDDEN/);
  await assert.rejects(()=>call('authenticated',X,"select public.creator_save_product($1,$2,'subscription','Hijack','100',30,true)",[X,P]),/CREATOR_NOT_APPROVED/);
  await assert.rejects(()=>db.exec("update creator_finance.program set environment='live'"),/FINANCE_ENVIRONMENT_HAS_ACTIVITY/);
});
test('one verified capture atomically books exact economics and grants caller-bound access',async()=>{
  await ready();await product();const id=await order();assert.equal(await access(),false);
  assert.equal(await settle(id),'paid');assert.equal(await settle(id),'paid');assert.equal(await access(),true);assert.equal(await access(X),false);
  assert.equal(await call('authenticated',X,'select public.creator_has_active_subscription($1,$2)',[C,B]),false);
  assert.equal(await balance('pending'),'900');
  const a=(await db.query('select gross_minor::text gross,deductions_minor::text deductions,creator_minor::text creator,platform_minor::text platform from creator_finance.allocations')).rows;
  assert.deepEqual(a,[{gross:'1001',deductions:'1',creator:'900',platform:'100'}]);
  assert.equal((await db.query('select count(*)::int n from creator_finance.subscription_periods')).rows[0].n,1);
  await assert.rejects(()=>settle(id,'capture-1','1002'),/RECEIPT_MISMATCH/);
  await assert.rejects(()=>settle(id,'capture-1','1001','2'),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(()=>db.exec('update creator_finance.allocations set creator_minor=0,platform_minor=1000'),/FINANCE_RECORD_IMMUTABLE/);
  await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[B]);assert.equal(await access(),false);
  await assert.rejects(order,/AUTH_REQUIRED/);
});
test('full refund revokes access; cumulative partial refunds conserve every minor unit',async()=>{
  await ready();await product();const id=await order();await settle(id);
  assert.equal(await refund(id,'500'),'partially_refunded');assert.equal(await balance('pending'),'451');assert.equal(await access(),true);
  assert.equal(await refund(id,'500'),'partially_refunded');await assert.rejects(()=>refund(id,'499','stale-refund'),/INVALID_REFUND/);
  assert.equal(await refund(id,'1001','refund-2'),'refunded');assert.equal(await balance('pending'),'0');assert.equal(await balance('reversed'),'900');assert.equal(await access(),false);
  assert.equal((await db.query('select count(*)::int n from creator_finance.commerce_receipts')).rows[0].n,3);
});
test('refund after payout preserves paid history and offsets future earnings instead of negative balances',async()=>{
  await ready();await product();const id=await order();await settle(id);
  await db.query("select creator_finance.move($1,'USD',900,'pending','available','release','release')",[C]);
  await db.query("select creator_finance.move($1,'USD',900,'available','reserved','reserve','reserve')",[C]);
  await db.query("select creator_finance.move($1,'USD',900,'reserved','paid','complete','complete')",[C]);
  await refund(id,'1001');assert.equal(await balance('paid'),'900');assert.equal((await db.query('select amount_minor::text n from creator_finance.receivables')).rows[0].n,'900');
  await assert.rejects(()=>call('authenticated',C,"select public.creator_request_payout($1,'USD','1',$2)",[C,K2]),/OUTSTANDING_REFUND_BALANCE/);
  const next=await order(K2);await settle(next,'capture-2');assert.equal(await balance('pending'),'0');assert.equal(await balance('reversed'),'900');
  assert.equal((await db.query('select amount_minor::text n from creator_finance.receivables')).rows[0].n,'0');
  assert.equal((await db.query('select sum(amount_minor)::text n from creator_finance.receivable_events')).rows[0].n,'0');
});
test('refund safely cancels a reservation before its first dispatch instead of paying refunded earnings',async()=>{
  // Simulate a future approved adapter; current production capability is false.
  await db.exec("create or replace function creator_finance.provider_dispatch_ready() returns boolean language sql immutable security definer set search_path='' as $$select true;$$");
  await ready();await product();const id=await order();await settle(id);
  await db.query("select creator_finance.move($1,'USD',900,'pending','available','release','release')",[C]);
  await db.exec("update creator_finance.providers set payouts_enabled=true,contract_version='crisp-payout-v1',currencies=array['USD']");
  await db.query("insert into creator_finance.payout_accounts values($1,'intobank','ready','INTOBANK:123456789',now())",[C]);
  const payout=await call('authenticated',C,"select public.creator_request_payout($1,'USD','900',$2)",[C,K2]);
  await refund(id,'1001','x'.repeat(240));
  assert.equal((await db.query('select status from creator_finance.payouts where id=$1',[payout])).rows[0].status,'rejected');
  assert.equal(await balance('reserved'),'0');assert.equal(await balance('available'),'0');assert.equal(await balance('reversed'),'900');
  assert.equal((await db.query('select count(*)::int n from creator_finance.receivables')).rows[0].n,0);
});
test('tips have no deduction and failed allocation rolls back all order and access changes',async()=>{
  await ready();await product('tip','1001');const id=await order();await assert.rejects(()=>settle(id),/INVALID_REVENUE/);
  assert.equal((await db.query('select state from creator_finance.orders')).rows[0].state,'pending');assert.equal(await balance('pending'),'0');
  await settle(id,'tip-capture','1001','0');assert.equal(await balance('pending'),'1001');assert.equal(await access(),false);
  const snapshot=await call('authenticated',B,'select public.creator_commerce_snapshot($1)',[B]);assert.equal(snapshot.purchases.length,1);assert.equal(snapshot.subscriptions.length,0);
  assert.equal((await call('authenticated',X,'select public.creator_commerce_snapshot($1)',[X])).purchases.length,0);
  await assert.rejects(()=>call('authenticated',X,'select public.creator_commerce_snapshot($1)',[B]),/ACCOUNT_CHANGED/);
});
test('repeated purchases extend prepaid access; refunded periods do not authorize a gap',async()=>{
  await ready();await product();const first=await order();await settle(first);const second=await order(K2);await settle(second,'capture-2');
  const periods=(await db.query('select starts_at,ends_at from creator_finance.subscription_periods order by starts_at')).rows;assert.equal(+periods[0].ends_at,+periods[1].starts_at);
  await refund(first,'1001');assert.equal(await access(),false);
  await db.exec("update creator_finance.subscription_periods set starts_at=starts_at-interval '31 days',ends_at=ends_at-interval '31 days'");assert.equal(await access(),true);
});
test('forward guard migration replay preserves recorded orders, allocations, access and money',async()=>{
  await ready();await product();const id=await order();await settle(id);
  const tables=['orders','allocations','ledger','balances','commerce_receipts','subscription_periods'];
  const snapshot=async()=>{const rows=[];for(const table of tables)rows.push((await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') as data from creator_finance.${table} t`)).rows[0].data);return rows;};
  const before=await snapshot();
  await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261023190254_creator_finance_dispatch_and_refund_guards.sql'),'utf8'));
  assert.deepEqual(await snapshot(),before);assert.equal(await access(),true);
});
