const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||path.join(__dirname,'../../supabase/tests/rpc-authorization/node_modules/@electric-sql/pglite'));const ts=require(process.env.TYPESCRIPT_MODULE||'typescript');
const mod={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'payoutContract.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(mod,mod.exports);
const {payoutPayload}=mod.exports;
test('payout payload carries the same durable reference into command and instruction',()=>{
  const x=payoutPayload({partner_reference:'creator-1',amount:'90071992547409.91',institution_code:'intobank',account_number:'123 456',currency:'usd'});
  assert.equal(x.key,'creator-1');assert.equal(x.payload.reference,x.key);assert.equal(x.payload.amount,'90071992547409.91');assert.equal(x.payload.account_number,'123456');
  for(const amount of ['1e4','1.001','-1','0','90071992547409.92',NaN,Infinity])assert.throws(()=>payoutPayload({partner_reference:'creator-1',amount}));
});
let db;const P='10000000-0000-4000-8000-000000000001',OTHER='10000000-0000-4000-8000-000000000002',I='20000000-0000-4000-8000-000000000001',R='30000000-0000-4000-8000-000000000001';
test.beforeEach(async()=>{db=new PGlite();await db.exec(`
  create role anon;create role authenticated;create role service_role;
  create schema triniti_network_private;create schema triniti_payment_private;
  create table public.crisp_partners(id uuid primary key,status text,environment text);
  create table public.crisp_institutions(id uuid primary key,code text);
  create table public.crisp_beneficiaries(id uuid primary key,institution_id uuid,account_number text);
  create table triniti_network_private.instructions(id uuid primary key,partner_id uuid,partner_reference text,beneficiary_id uuid,direction text,status text,
    journal_id uuid,settlement_model text,confirmed_at timestamptz,settlement_ref bigint,credited_at timestamptz,credit_confirmed_at timestamptz,reservation_id uuid,amount numeric,fee numeric,currency text);
  create table triniti_payment_private.commands(actor_id uuid,operation text,request_key text,result jsonb);
  create table triniti_payment_private.reservations(instrument_id uuid,status text);
  create function triniti_network_private.instruction_json(i triniti_network_private.instructions) returns jsonb language sql as $$select to_jsonb(i)$$;
  insert into crisp_partners values('${P}','active','test'),('${OTHER}','active','test');
  insert into crisp_institutions values('${R}','INTOBANK');insert into crisp_beneficiaries values('${R}','${R}','123456');
  insert into triniti_network_private.instructions(id,partner_id,partner_reference,beneficiary_id,direction,status,reservation_id,amount,fee,currency)
    values('${I}','${P}','creator-1','${R}','outbound','submitted','${R}',123.45,0,'USD');
  insert into triniti_payment_private.reservations values('${R}','held');
`);await db.exec(fs.readFileSync(path.join(__dirname,'legacy-receipt.sql'),'utf8'));});
test.afterEach(async()=>db.close());
async function read(partner=P,id=I,key='creator-1'){return (await db.query('select public.crisp_partner_payout_receipt($1,$2,$3) as r',[partner,id,key])).rows[0].r;}
test('partner ownership and both supplied identifiers must match',async()=>{
  assert.equal((await read()).found,true);assert.equal((await read(OTHER)).found,false);assert.equal((await read(P,I,'wrong-key')).found,false);
  const r=await read();assert.equal(r.amount_minor,'12345');assert.equal(r.fee_minor,'0');assert.equal(r.environment,'test');assert.equal(r.simulation,true);
  assert.equal(r.finality.recipient_credited,false);assert.equal(r.finality.confirmed_not_sent,false);
  await db.exec('set role authenticated');await assert.rejects(()=>read(),/permission denied/);await db.exec('reset role');
});
test('legacy instruction without reference recovers only through exact partner command',async()=>{
  await db.exec(`update triniti_network_private.instructions set partner_reference=null;insert into triniti_payment_private.commands values('${P}','network_partner_payout','creator-1','{"instruction_id":"${I}"}');`);
  const r=await read(P,null);assert.equal(r.found,true);assert.equal(r.partner_reference,'creator-1');assert.equal((await read(OTHER,null)).found,false);
});
test('same bank payout requires posted journal and confirmation before recipient credit',async()=>{
  await db.exec("update triniti_network_private.instructions set settlement_model='same_bank',status='settled',confirmed_at=now()");assert.equal((await read()).finality.recipient_credited,false);
  await db.exec(`update triniti_network_private.instructions set journal_id='${R}'`);assert.equal((await read()).finality.recipient_credited,true);
});
test('prefunded settlement cannot masquerade as recipient credit',async()=>{
  await db.exec(`update triniti_network_private.instructions set settlement_model='prefunded',status='settled',journal_id='${R}',settlement_ref=1,confirmed_at=now()`);assert.equal((await read()).finality.recipient_credited,false);
  await db.exec("update triniti_network_private.instructions set credited_at=now()");assert.equal((await read()).finality.recipient_credited,false);
  await db.exec("update triniti_network_private.instructions set credit_confirmed_at=now()");assert.equal((await read()).finality.recipient_credited,true);
  await db.exec("update triniti_network_private.instructions set status='returned'");assert.equal((await read()).finality.recipient_credited,false);
});
test('not-sent proof requires released reservation and no posted journal or settlement',async()=>{
  await db.exec("update triniti_network_private.instructions set status='rejected'");assert.equal((await read()).finality.confirmed_not_sent,false);
  await db.exec("update triniti_payment_private.reservations set status='released'");assert.equal((await read()).finality.confirmed_not_sent,true);
  await db.exec(`update triniti_network_private.instructions set journal_id='${R}'`);assert.equal((await read()).finality.confirmed_not_sent,false);
});
