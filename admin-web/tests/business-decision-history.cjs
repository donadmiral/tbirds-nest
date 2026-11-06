const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {runPage} = require('./helpers/reportingFixture.cjs');
const {PGlite} = require(process.env.PGLITE_MODULE || path.join(__dirname,'../../supabase/tests/rpc-authorization/node_modules/@electric-sql/pglite/dist/index.cjs'));
const route='admin-web/app/businesses/page.tsx';
const uuid = n => '10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const stamp='2026-11-06T11:11:11.000009+00:00';
const fixture = n => ({id:uuid(n), company_name:'Company '+n, desired_username:'user'+n, status:'approved', decided_at:stamp, decision_reason:null});

test('staff history preserves micros and adjacent desks, unauthorized staff cannot issue the cross-account read',async()=>{
  const page=await runPage(route,{role:'market_reviewer',search:{page:'4',applications:'3'},rpc:{
    admin_business_decision_page:()=>Array.from({length:26},(_,n)=>fixture(50-n)),
  }});
  assert.equal(page.outcome,'rendered',page.error);
  const older=page.controls.find(x=>x.text==='Older decisions');assert.ok(older);
  const search=Object.fromEntries(new URL(older.href,'https://local.test').searchParams);
  assert.deepEqual(search,{page:'4',applications:'3',beforeDecision:stamp,decisionId:uuid(26)});
  assert.ok(page.text.includes('Company 26'));assert.ok(!page.text.includes('Company 25'));
  let cursor;
  const last=await runPage(route,{role:'market_reviewer',search,rpc:{admin_business_decision_page:body=>{cursor=body;return [fixture(25)];}}});
  assert.equal(last.outcome,'rendered',last.error);
  assert.deepEqual(cursor,{p_before_at:stamp,p_before_id:uuid(26)});
  assert.ok(last.controls.some(x=>x.text==='Newest decisions'));assert.ok(!last.controls.some(x=>x.text==='Older decisions'));
  for(const role of [null,'jobs_reviewer','support_agent']){
    const denied=await runPage(route,{role,search});
    assert.notEqual(denied.outcome,'rendered');
    assert.equal(denied.calls.some(c=>c.path.endsWith('/admin_business_decision_page')),false);
  }
});
test('database walk preserves tied instants, microseconds and undated business decisions',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create table public.business_applications(id uuid primary key,company_name text,desired_username text,status text,decision_reason text,decided_at timestamptz);
      alter table public.business_applications enable row level security;grant select on public.business_applications to service_role;
      insert into public.business_applications select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'company','u','approved',null,
        case when n<32 then '${stamp}'::timestamptz when n<46 then '${stamp}'::timestamptz-interval '1 microsecond' end from generate_series(1,75)n;
      insert into public.business_applications values(gen_random_uuid(),'waiting','u','submitted',null,null);`);
    await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261106233940_business_decision_history.sql'),'utf8'));
    for(const role of ['authenticated','anon']){
      await db.exec('set role '+role);
      await assert.rejects(db.query('select * from public.admin_business_decision_page(null,null)'),/permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const expected=(await db.query("select id from public.business_applications where status <> 'submitted' order by decided_at desc nulls last,id desc")).rows.map(row=>row.id);
    let cursor, pages=0;const seen=[];
    for(;;){
      const result=(await db.query('select to_jsonb(d) as row from public.admin_business_decision_page($1,$2) d',[cursor?.decided_at??null,cursor?.id??null])).rows.map(r=>r.row);
      assert.ok(result.length<=26);
      seen.push(...result.slice(0,25).map(row=>row.id));pages++;
      if(result.length<=25)break;
      cursor=result[24];
      if(pages===1){
        await db.exec("reset role;insert into public.business_applications values(gen_random_uuid(),'new','n','approved',null,now());set role service_role;");
      }
      assert.ok(pages<5);
    }
    assert.equal(pages,3);assert.deepEqual(seen,expected);
  } finally {await db.close();}
});
