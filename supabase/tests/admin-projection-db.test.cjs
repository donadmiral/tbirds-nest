const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {LocalPsqlSession}=require('./local-psql-session.cjs');
const {PGlite}=require('./rpc-authorization/node_modules/@electric-sql/pglite');
const migration=name=>fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8');
let db,real;
const exec=async q=>real?db.query(q):db.exec(q);
const value=async q=>real?JSON.parse(await db.query(`select to_jsonb(q) from(${q})q;`)):(await db.query(q)).rows[0];
async function equivalent(asOf='2026-11-02T01:02:03.456Z'){
 for(const scope of ['dashboard','analytics']){
  const v=await value(`select admin_overview_summary_before_projection_v1('${asOf}','${scope}') old,
    admin_overview_summary('${asOf}','${scope}') current`);
  assert.deepEqual(v.current,v.old,scope+' '+asOf);
 }
}
before(async()=>{
 real=!!process.env.PC_TEST_PSQL;
 if(real&&process.env.PGDATABASE!=='pc_scale_admin_projection')throw Error('Use disposable pc_scale_admin_projection.');
 db=real?new LocalPsqlSession():new PGlite();
 await exec(`drop schema if exists admin_reporting cascade;drop schema public cascade;create schema public;
 do $$begin
  if not exists(select 1 from pg_roles where rolname='anon')then create role anon;end if;
  if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated;end if;
  if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role;end if;
 end$$;
 create table profiles(id uuid primary key,account_type text,is_verified boolean,verified_tier text,created_at timestamptz,last_seen timestamptz,location text);
 create table post_reports(id uuid primary key default gen_random_uuid(),created_at timestamptz);
 create table listing_reports(like post_reports including all);create table user_reports(like post_reports including all);
 create table verification_applications(id uuid primary key default gen_random_uuid(),created_at timestamptz,status text);
 insert into profiles
 select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  case when n%5=0 then 'business' else 'personal' end,n%3<>0,
  (array['official','business','public_figure',null])[n%4+1],
  '2026-11-02T01:02:03.456Z'::timestamptz-make_interval(days=>n%80),
  case when n%6<>0 then '2026-11-02T01:02:03.456Z'::timestamptz-make_interval(days=>n%80)+make_interval(days=>n%36) end,
  (array[E' New\tYork ','new york','İSTANBUL','i̇stanbul','ΟΣ','ος','Paris','PARIS',' ',null,'Nairobi'])[n%11+1]
 from generate_series(1,12001)n;
 insert into post_reports(created_at) select '2026-11-02T01:02:03.456Z'::timestamptz-make_interval(days=>n%34) from generate_series(1,5001)n;
 insert into listing_reports select * from post_reports;insert into user_reports select * from post_reports;
 insert into verification_applications(created_at,status)
 select created_at,(array['submitted','under_review','approved','rejected'])[row_number()over()::int%4+1] from post_reports;
 insert into post_reports(created_at) select '2026-11-02T01:02:03.456Z'::timestamptz-make_interval(days=>d)+i*interval '1 millisecond'
 from unnest(array[7,14,30])d cross join generate_series(-1,1)i;
 insert into post_reports(created_at) values('2026-11-05T12:00:00Z');`);
 await exec(migration('20261102062128_admin_overview_aggregates.sql'));
 await exec(migration('20261102090641_maintained_admin_reporting.sql'));
 await exec('select configure_admin_reporting_v1(true);');
});
after(async()=>await db?.close());
test('maintained reporting exactly matches all legacy metrics above old row limits',async()=>{await equivalent();});
test('arbitrary as-of edges, future events and UTC semantics remain exact',async()=>{
 for(const date of ['2026-11-02T00:00:00Z','2026-10-25T01:59:59.999Z','2026-11-10T22:30:20.123Z'])await equivalent(date);
 await exec("set timezone='America/New_York';");await equivalent();await exec("set timezone='UTC';");
});
test('profile changes, deletes, long Unicode labels and status transitions update exactly in the source transaction',async()=>{
 await exec(`update profiles set is_verified=not is_verified,account_type='business',verified_tier='official',
  location=case when id::text like '%1' then repeat('é',2000) else E'\uFEFF İSTANBUL \t' end,
  last_seen=created_at+interval '28 days 0.0008 seconds' where id::text like '%1';
 delete from profiles where id::text like '%2';
 update post_reports set created_at=created_at+interval '9 days' where extract(day from created_at)::int%3=0;
 update verification_applications set status='approved' where status='under_review';
 delete from user_reports where created_at<'2026-10-05';`);
 await equivalent();
});
test('sub-minute heartbeats avoid aggregate cell writes while the exact active edge advances',async()=>{
 await exec(`insert into profiles values('20000000-0000-4000-8000-000000020000','personal',false,null,
  '2026-08-01','2026-11-02T00:57:03.400Z','Paris');
 create table fixture_cell_writes(n integer);
 create function fixture_cell_write()returns trigger language plpgsql as $$begin insert into fixture_cell_writes values(1);return null;end$$;
 create trigger fixture_cell_write after insert or update or delete on admin_reporting.cells for each row execute function fixture_cell_write();
 update profiles set last_seen='2026-11-02T00:57:03.500Z' where id='20000000-0000-4000-8000-000000020000';`);
 assert.equal((await value('select count(*)::int n from fixture_cell_writes')).n,0);
 await equivalent();
 await exec('drop trigger fixture_cell_write on admin_reporting.cells;drop table fixture_cell_writes;');
});
test('rolled-back source changes never leave reporting drift and ordinary roles cannot call reports',async()=>{
 await exec(`begin;update profiles set location='Rolled back city';rollback;`);await equivalent();
 const acl=await value(`select has_function_privilege('authenticated','admin_overview_summary(timestamptz,text)','execute') member,
  has_function_privilege('service_role','admin_overview_summary(timestamptz,text)','execute') service,
  has_table_privilege('authenticated','admin_reporting.cells','select') raw`);
 assert.deepEqual(acl,{member:false,service:true,raw:false});
});
test('independent real profile transactions update separate reporting shards without a global lock',{skip:!process.env.PC_TEST_PSQL},async()=>{
 const a=new LocalPsqlSession(),b=new LocalPsqlSession();
 try{
  const pair=await value(`select id::text a,(select p2.id::text from profiles p2 where
    get_byte(decode(md5(p2.id::text),'hex'),0)<>get_byte(decode(md5(p.id::text),'hex'),0) limit 1)b from profiles p limit 1`);
  await a.query(`set statement_timeout='3s';begin;update profiles set location='Concurrent' where id='${pair.a}';`);
  await b.query(`set statement_timeout='3s';begin;update profiles set location='Concurrent' where id='${pair.b}';commit;`);
  await a.query('commit;');await equivalent();
 }finally{await Promise.all([a.close(),b.close()]);}
});
