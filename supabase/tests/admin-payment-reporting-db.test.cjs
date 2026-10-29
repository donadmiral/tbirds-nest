const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key,full_name text,username text,avatar_url text);
    create table chat_payments(id uuid primary key,sender_id uuid,recipient_id uuid,amount numeric,currency text,status text,tx_id text,note text,error text,listing_id uuid,created_at timestamptz,completed_at timestamptz);
    insert into profiles values ('10000000-0000-4000-8000-000000000001','Musa Test','musa',null);
    insert into chat_payments select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
      case when n=1 then 9007199254740993.01 else 1.25 end,
      case when n=2 then 'ZWG' else 'USD' end,
      case when n=3 then 'failed' else 'completed' end,'receipt-'||n,null,null,null,
      now()-interval '1 hour',now() from generate_series(1,205) n;`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261022211701_admin_payment_reporting_and_support.sql'),'utf8'));
});
after(async () => db.close());
test('payment pages cover all rows with stable ties and an enforced page ceiling', async () => {
  let before=null,id=null,seen=[];
  do {
    const page=(await db.query('select admin_payment_report($1,$2,$3,$4,$5) value',['all','',before,id,900])).rows[0].value;
    assert.ok(page.rows.length<=100); seen.push(...page.rows.map(r=>r.id));
    if(!page.has_more) break;
    before=page.next_cursor.created_at;id=page.next_cursor.id;
  } while(true);
  assert.equal(seen.length,205);assert.equal(new Set(seen).size,205);
});
test('global totals use exact decimals and keep currencies separate', async()=>{
  const result=(await db.query('select admin_payment_summary() value')).rows[0].value;
  assert.equal(result.status_counts.completed,204);
  assert.equal(result.volume_all.find(r=>r.currency==='USD').amount,'9007199254741245.51');
  assert.equal(result.volume_all.find(r=>r.currency==='ZWG').amount,'1.25');
  assert.equal(result.days.length,1);
});
test('search and invalid filters are handled server-side; regular users cannot read the report',async()=>{
  assert.equal((await db.query("select admin_payment_report('all','receipt-205') value")).rows[0].value.rows.length,1);
  await assert.rejects(db.query("select admin_payment_report('unexpected')"),/INVALID_FILTER/);
  await assert.rejects(db.query("select admin_payment_report('all','',now(),null)"),/INVALID_CURSOR/);
  for(const role of ['anon','authenticated']){
    await db.exec('set role '+role);
    await assert.rejects(db.query('select admin_payment_summary()'),/permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.equal((await db.query('select admin_payment_summary() value')).rows[0].value.completed_week,204);
  await db.exec('reset role');
});
