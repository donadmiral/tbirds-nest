const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const { fixture, migration, sql, id, OWNER, VIEWER, marketFilterPatch } = require('./feed-scale-fixture.cjs');
let db, real;
const exec = sql => real ? db.query(sql) : db.exec(sql);
async function rows(sql) {
 const statement = `select coalesce(jsonb_agg(q),'[]') result from (${sql})q;`;
 return real ? JSON.parse(await db.query(statement)) : (await db.query(statement)).rows[0].result;
}
const authenticate = async (user=VIEWER, session=id(900001)) => exec(`reset role;select set_config('request.jwt.claim.sub','${user}',false);
 select set_config('request.headers','{"x-client-info":"supabase-js/2 platinum-cache/1"}',false);
 select set_config('request.jwt.claims',jsonb_build_object('sub','${user}','role','authenticated','session_id','${session}','exp',floor(extract(epoch from now()))+3600)::text,false);set role authenticated;`);
const admin = () => exec('reset role;');
const stripCursor = list => list.map(({sort_key,...row})=>row);
async function expectError(statement, pattern) {
 const escaped = statement.replaceAll("'", "''");
 const result = await rows(`select pg_temp.prepared_expected_error('${escaped}') message`);
 assert.match(result[0].message || '', pattern);
}

before(async () => {
 real=!!process.env.PC_TEST_PSQL;
 if(real&&process.env.PGDATABASE!=='pc_scale_prepared_feed')throw Error('Use disposable pc_scale_prepared_feed.');
 db=real?new LocalPsqlSession():new PGlite();
 await exec('drop schema if exists prepared_feed cascade;drop schema if exists feed_ranking cascade;drop schema if exists post_counter_internal cascade;drop schema if exists auth cascade;drop schema public cascade;create schema public;drop role if exists prepared_feed_reader;');
 await exec(fixture);
 await exec(marketFilterPatch);
 await exec(`create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant execute on function auth.jwt() to authenticated,anon,service_role;
 update posts set created_at=created_at-interval '1 second' where id='${id(2)}';
 insert into posts(id,user_id,content,created_at,likes_count,comments_count,reposts_count,channel)
 select ('10000000-0000-4000-8000-'||lpad((30000+n)::text,12,'0'))::uuid,'${OWNER}','prepared fixture '||n,
 now()-make_interval(hours=>n,secs=>n),n%17,n%9,n%4,'home' from generate_series(1,230)n;
 insert into follows values('${VIEWER}','${OWNER}');`);
 await exec(migration);
 if (process.env.PREPARED_FEED_NARROW === '1') {
  for(const file of ['20261102092828_indexed_feed_rank_frontier.sql','20261102175247_feed_catalog_inline_visibility.sql','20261102180219_feed_frontier_defer_partial_scoring.sql','20261105045938_deterministic_feed_author_ties.sql']) await exec(sql(file));
 }
 if (process.env.PREPARED_FEED_STAGED === '1') {
  const fs=require('node:fs'),path=require('node:path');
  for(const {name:file} of require('../ops/prepared-feed-staged-20261105/manifest.json').stages) {
   await exec(fs.readFileSync(path.join(__dirname,'../ops/prepared-feed-staged-20261105',file),'utf8'));
  }
 } else await exec(sql('20261105044917_prepared_feed_snapshots.sql'));
 if (process.env.PREPARED_FEED_NARROW === '1') {
  await exec(sql('20261105051142_prepared_feed_narrow_ranking.sql'));
  await exec(sql('20261105051152_prepared_feed_single_snapshot_rank.sql'));
  await exec(`do $$begin execute replace(pg_get_functiondef('public.get_feed(text,double precision,uuid,integer)'::regprocedure),
   'FUNCTION public.get_feed(','FUNCTION public.get_feed_before_bounded(');end$$;`);
  await exec(sql('20261105051338_prepared_feed_bounded_hydration.sql'));
  await exec(sql('20261105051457_prepared_feed_client_capability_gate.sql'));
  await exec(sql('20261105052419_feed_catalog_point_visibility.sql'));
  await exec(sql('20261105052732_amortized_feed_frontier_scoring.sql'));
  await exec(sql('20261105155522_prepared_frontier_final_proof.sql'));
  await exec(sql('20261105160752_prepared_mass_integer_seek.sql'));
  await exec('select configure_indexed_feed_v1(true);');
 }
 await exec(`create function pg_temp.prepared_expected_error(statement text) returns text language plpgsql security invoker as $$
 begin execute statement; return null; exception when others then return SQLSTATE||': '||SQLERRM; end $$;`);
 await authenticate();
});
after(async()=>{if(db){await admin();await db.close();}});

test('disabled wrapper preserves exact canonical cards and does not enqueue',async()=>{
 await exec('begin;');
 assert.deepEqual(await rows("select * from get_feed('for_you',null,null,20)"),await rows("select * from prepared_feed.canonical('for_you',null,null,20)"));
 await exec('commit;');
 await admin();assert.equal((await rows('select count(*) n from prepared_feed.demand'))[0].n,0);await authenticate();
});
test('cold read queues only its verified account and worker prepares bounded IDs without bearer URLs',async()=>{
 await admin();await exec('select configure_prepared_feed_v1(true);');await authenticate();
 const cold=await rows("select * from get_feed('for_you',null,null,20)");assert.equal(cold.length,20);
 await admin();assert.equal((await rows('select count(*) n from prepared_feed.demand'))[0].n,1);
 assert.deepEqual((await rows('select drain_prepared_feed_v1(1) result'))[0].result,{prepared:1,failed:0,enabled:true});
 const saved=(await rows('select viewer_id,cardinality(ids) n,claims from prepared_feed.snapshots join prepared_feed.demand using(viewer_id,scope,mode,revision)'))[0];
 assert.equal(saved.viewer_id,VIEWER);assert.equal(saved.n,200);assert.equal(saved.claims.sub,VIEWER);assert.equal(Object.hasOwn(saved.claims,'access_token'),false);
 await authenticate();
 const warm=await rows("select * from get_feed('for_you',null,null,20)");assert.equal(warm.length,20);assert.ok(warm.every(p=>p.sort_key<-4000000000000000));
 assert.deepEqual(stripCursor(warm),stripCursor(cold));
});
test('worker uses authenticated RLS and restores the dispatcher identity',async()=>{
 await admin();await exec(`create policy prepared_test_visibility on posts as restrictive for select to authenticated using(content<>'RLS sentinel');
 insert into posts(id,user_id,content,created_at,likes_count)values('${id(700001)}','${OWNER}','RLS sentinel',now()-interval '1 hour',999999);
 update prepared_feed.demand set available_at=now();
 select set_config('request.jwt.claim.sub','${id(777)}',false);`);
 const result=(await rows('select drain_prepared_feed_v1(1) result'))[0].result;assert.equal(result.failed,0);
 assert.equal((await rows('select auth.uid() id'))[0].id,id(777));
 assert.equal((await rows(`select count(*) n from prepared_feed.snapshots where '${id(700001)}'=any(ids)`))[0].n,0);
 await exec(`delete from posts where id='${id(700001)}';drop policy prepared_test_visibility on posts;`);await authenticate();
});
test('account and session changes cannot read another prepared snapshot or invoke the worker',async()=>{
 const warm=await rows("select * from get_feed('for_you',null,null,3)");
 await authenticate(id(102));assert.equal((await rows('select count(*) n from prepared_feed.snapshots'))[0].n,0);
 await expectError(`select * from get_feed('for_you',${warm[0].sort_key},'${warm[0].post_id}',3)`,/PREPARED_FEED_CURSOR_EXPIRED/);
 await expectError('select drain_prepared_feed_v1(1)',/permission denied/);
 await expectError("select prepared_feed.rank('{}','for_you')",/permission denied/);
 await authenticate(VIEWER,id(900002));const next=await rows("select * from get_feed('for_you',null,null,3)");assert.ok(next.every(p=>p.sort_key>-4000000000000000));await authenticate();
});
test('pagination retains its immutable snapshot when a newer head is prepared',async()=>{
 const first=await rows("select * from get_feed('for_you',null,null,12)");const cursor=first.at(-1);
 const before=await rows(`select * from get_feed('for_you',${cursor.sort_key},'${cursor.post_id}',12)`);
 await admin();await exec(`update posts set likes_count=likes_count+10000 where id='${id(30220)}';update prepared_feed.demand set available_at=now() where viewer_id='${VIEWER}';select drain_prepared_feed_v1(4);`);await authenticate();
 const after=await rows(`select * from get_feed('for_you',${cursor.sort_key},'${cursor.post_id}',12)`);
 assert.deepEqual(after.map(p=>[p.post_id,p.sort_key]),before.map(p=>[p.post_id,p.sort_key]));
 assert.equal(first.some(p=>after.some(q=>p.post_id===q.post_id)),false);
});
test('a page straddling the prepared boundary continues into the canonical tail',async()=>{
 await admin();const saved=(await rows(`select cursor_serial,ids from prepared_feed.snapshots where viewer_id='${VIEWER}' order by created_at desc limit 1`))[0];await authenticate();
 const cursor=-4000000000000000-saved.cursor_serial*256-195;
 const page=await rows(`select * from get_feed('for_you',${cursor},'${saved.ids[194]}',20)`);
 assert.equal(page.length,20);assert.equal(new Set(page.map(p=>p.post_id)).size,20);
 assert.ok(page.slice(0,5).every(p=>p.sort_key<-4000000000000000));
 assert.ok(page.slice(5).every(p=>p.sort_key>-4000000000000000));
});
test('current hidden, blocked, private and deleted access wins over cached ranking',async()=>{
 const page=await rows("select * from get_feed('for_you',null,null,20)");const target=page[3].post_id;
 for(const [change,undo]of[
  [`insert into hidden_posts values('${VIEWER}','${target}')`,`delete from hidden_posts where user_id='${VIEWER}'`],
  [`insert into blocked_users values('${OWNER}','${VIEWER}')`,`delete from blocked_users where blocker_id='${OWNER}'`],
  [`update posts set audience='mentioned' where id='${target}'`,`update posts set audience='everyone' where id='${target}'`],
 ]){
  await admin();await exec(change);await authenticate();
  const next=await rows(`select * from get_feed('for_you',${page[0].sort_key},'${page[0].post_id}',20)`);assert.equal(next.some(p=>p.post_id===target),false);
  await admin();await exec(undo);await authenticate();
 }
 await admin();await exec(`delete from posts where id='${target}'`);await authenticate();
 assert.equal((await rows(`select * from get_feed('for_you',${page[0].sort_key},'${page[0].post_id}',20)`)).some(p=>p.post_id===target),false);
});
test('stale preference revisions and expired prepared cursors never silently mix generations',async()=>{
 await admin();await exec(`update prepared_feed.demand set available_at=now() where viewer_id='${VIEWER}';select drain_prepared_feed_v1(4);`);await authenticate();
 const page=await rows("select * from get_feed('for_you',null,null,3)");assert.ok(page[0].sort_key<-4000000000000000);
 await admin();await exec(`update prepared_feed.demand set revision=revision+1 where viewer_id='${VIEWER}'`);await authenticate();
 const stale=await rows("select * from get_feed('for_you',null,null,3)");assert.ok(stale[0].sort_key>-4000000000000000);
 await admin();await exec(`update prepared_feed.snapshots set fresh_until=now()-interval '1 second',expires_at=now()-interval '1 second' where viewer_id='${VIEWER}'`);await authenticate();
 await expectError(`select * from get_feed('for_you',${page[0].sort_key},'${page[0].post_id}',3)`,/PREPARED_FEED_CURSOR_EXPIRED/);
});
test('expired claims and anonymous calls cannot queue work, and job batches are bounded',async()=>{
 await admin();await exec(`delete from prepared_feed.demand;select set_config('request.jwt.claims',jsonb_build_object('sub','${VIEWER}','role','authenticated','exp',0)::text,false);set role authenticated;`);
 await rows("select * from get_feed('for_you',null,null,2)");await admin();assert.equal((await rows('select count(*) n from prepared_feed.demand'))[0].n,0);
 await expectError('select drain_prepared_feed_v1(5)',/INVALID_PREPARED_FEED_BATCH/);
 await exec('set role anon;');await expectError("select * from get_feed('for_you',null,null,2)",/permission denied/);await authenticate();
});

const narrowOnly={skip:process.env.PREPARED_FEED_NARROW!=='1'};
async function ranked(mode){
 await admin();await exec('set role prepared_feed_reader;');
 const result=(await rows(`select prepared_feed.rank(auth.jwt(),'${mode}') result`))[0].result;
 await authenticate();return result;
}
async function canonicalIds(mode){
 const expected=[];let cursor=null;
 for(let n=0;n<4;n++){
  const page=await rows(`select post_id id,sort_key key from prepared_feed.canonical('${mode}',${cursor?cursor.key:'null'},${cursor?`'${cursor.id}'`:'null'},50)`);
  expected.push(...page);if(page.length<50)break;cursor=page.at(-1);
 }
 return expected;
}
async function boundaryFixture(check, equalScores=false){
 await admin();await exec('begin;');
 try{
  await exec(`truncate posts cascade;delete from follows;
   insert into posts(id,user_id,content,created_at,likes_count,channel)
   select ('10000000-0000-4000-8000-'||lpad((970000+n)::text,12,'0'))::uuid,
    ('10000000-0000-4000-8000-'||lpad((200+n)::text,12,'0'))::uuid,
    'Boundary proof',now()-interval '1 hour',${equalScores?'1':'n'},'home' from generate_series(1,80)n;`);
  let definition=(await rows("select pg_get_functiondef('prepared_feed.select_page(text,double precision,uuid,integer)'::regprocedure) definition"))[0].definition;
  definition=definition.replace('maximum_candidates constant integer:=10000','maximum_candidates constant integer:=64');
  // Remove only the conservative float padding in this test variant to put
  // the remaining raw bound exactly on the last selected score.
  if(equalScores)definition=definition.replaceAll('*(1.0+1e-12)','');
  await exec(definition);await exec('set role prepared_feed_reader;');
  await check();
 }finally{await exec('rollback;');await authenticate();}
}
test('final fetched boundary proves exact winners before the canonical fallback',narrowOnly,async()=>{
 await boundaryFixture(async()=>{
  const page=(await rows("select prepared_feed.select_page('for_you',null,null,20) result"))[0].result;
  const expected=(await rows("select prepared_feed.exact_ids('for_you') result"))[0].result.slice(0,20);
  assert.equal(page.fallback,false);assert.equal(page.candidates,64);
  assert.deepEqual(page.ids,expected.map(r=>r.id));assert.deepEqual(page.keys,expected.map(r=>r.key));
 });
});
test('an unproven final boundary still falls back without another fetch',narrowOnly,async()=>{
 await boundaryFixture(async()=>{
  const page=(await rows("select prepared_feed.select_page('for_you',null,null,80) result"))[0].result;
  assert.equal(page.fallback,true);assert.equal(page.reason,'proof_budget');assert.equal(page.candidates,64);
 });
});
test('a remaining bound equal to the selected score cannot pass the strict proof',narrowOnly,async()=>{
 await boundaryFixture(async()=>{
  const page=(await rows("select prepared_feed.select_page('for_you',null,null,1) result"))[0].result;
  assert.equal(page.fallback,true);assert.equal(page.reason,'proof_budget');assert.equal(page.candidates,64);
 },true);
});
test('integer mass keys preserve half-unit and UUID cursor order without rounding',narrowOnly,async()=>{
 await boundaryFixture(async()=>{
  await admin();await exec('update feed_ranking.catalog set mass=3.5;');
  assert.equal((await rows('select count(*) n from feed_ranking.catalog where mass_units=7'))[0].n,80);
  await expectError('update feed_ranking.catalog set mass=3.25',/23514/);
  await expectError('update feed_ranking.catalog set mass=1e40',/22003/);
  await exec('set role prepared_feed_reader;');
  const cursor=(await rows('select mass,post_id from feed_ranking.catalog order by mass desc,post_id desc offset 12 limit 1'))[0];
  const numeric=await rows(`select post_id,mass from feed_ranking.catalog where (mass,post_id)<(${cursor.mass},'${cursor.post_id}'::uuid) order by mass desc,post_id desc limit 64`);
  const integer=await rows(`select post_id,mass from feed_ranking.catalog where (mass_units,post_id)<((${cursor.mass}::numeric*2)::bigint,'${cursor.post_id}'::uuid) order by mass_units desc,post_id desc limit 64`);
  assert.equal(numeric.length,64);assert.deepEqual(integer,numeric);
 });
});
test('generic integer mass continuation uses the index below catalog visibility',narrowOnly,async()=>{
 await admin();await exec('begin;');
 try{
  await exec("set local plan_cache_mode=force_generic_plan;set local enable_seqscan=off;set local enable_bitmapscan=off;set role prepared_feed_reader;");
  const cursor=(await rows('select bucket::text bucket,mass,post_id from feed_ranking.catalog order by mass desc,post_id desc offset 5 limit 1'))[0];
  await exec(`prepare prepared_mass_seek_test(date,timestamptz,numeric,uuid) as
   select c.post_id,c.mass from feed_ranking.catalog c where c.bucket=$1 and c.created_at>$2
    and (c.mass_units,c.post_id)<(($3*2)::bigint,$4) order by c.mass_units desc,c.post_id desc limit 64;`);
  const statement=`explain(format json) execute prepared_mass_seek_test('${cursor.bucket}','-infinity',${cursor.mass},'${cursor.post_id}')`;
  const plan=real?JSON.parse(await db.query(statement)):(await db.query(statement)).rows[0]['QUERY PLAN'];
  const indexConditions=[];
  function visit(node){if(!node||typeof node!=='object')return;if(node['Index Cond'])indexConditions.push(node['Index Cond']);for(const value of Object.values(node))visit(value);}
  visit(plan);assert.ok(indexConditions.some(condition=>condition.includes('mass_units')&&condition.includes('ROW(')),JSON.stringify(indexConditions));
  await exec('deallocate prepared_mass_seek_test;');
 }finally{await exec('rollback;');await authenticate();}
});
test('integer mass traversal retains definer-visible incoming blocks',narrowOnly,async()=>{
 await admin();await exec('begin;');
 try{
  await exec(`alter table blocked_users enable row level security;
   create policy incoming_block_test on blocked_users for select to authenticated using(blocker_id=auth.uid());
   insert into blocked_users values('${OWNER}','${VIEWER}') on conflict do nothing;`);
  await authenticate();assert.equal((await rows(`select count(*) n from blocked_users where blocker_id='${OWNER}'`))[0].n,0);
  await admin();await exec('set role prepared_feed_reader;');
  assert.equal((await rows(`select count(*) n from feed_ranking.catalog where user_id='${OWNER}'`))[0].n,0);
  const page=(await rows("select prepared_feed.select_page('for_you',null,null,200) result"))[0].result;
  assert.equal(page.fallback,false);
  await admin();
  const blockedIds=new Set((await rows(`select id from posts where user_id='${OWNER}'`)).map(row=>row.id));
  assert.equal(page.ids.some(post=>blockedIds.has(post)),false);
 }finally{await exec('rollback;');await authenticate();}
});
test('prepared fixture retains the exact hosted marketplace exclusion',narrowOnly,async()=>{
 await admin();
 assert.equal((await rows("select md5(prosrc) hash from pg_proc where oid='prepared_feed.exact_ids(text)'::regprocedure"))[0].hash,'87b8bd662fea0977374107296aa01a97');
 await authenticate();await exec('begin;');
 try{
  const target=(await ranked('for_you'))[0].id;
  await admin();await exec(`insert into post_products(id,post_id,link_url) values('${id(980001)}','${target}','/market/${id(980002)}?from=feed');`);
  await authenticate();
  assert.equal((await ranked('for_you')).some(p=>p.id===target),false);
  assert.deepEqual(await ranked('for_you'),await canonicalIds('for_you'));
 }finally{await exec('rollback;');await authenticate();}
});
test('one narrow200 pass equals canonical pages across all modes and both frontier settings',narrowOnly,async()=>{
 await admin();await exec(`update posts set channel='innovation' where likes_count%3=0;
 insert into trending_snapshot select 'post',id,row_number()over(order by likes_count desc,id)::int from posts where likes_count>10 on conflict do nothing;`);
 await authenticate();await exec('begin;');
 try{
  for(const enabled of [true,false]){
   await admin();await exec(`select configure_indexed_feed_v1(${enabled});`);await authenticate();
   for(const mode of ['for_you','innovation','following','trending'])assert.deepEqual(await ranked(mode),await canonicalIds(mode),`${mode} enabled=${enabled}`);
  }
 }finally{await exec('rollback;');await authenticate();}
});
test('same-author tied scores across50/64/200 preserve deterministic full-window ordering',narrowOnly,async()=>{
 await admin();await exec(`insert into posts(id,user_id,content,created_at,likes_count,channel)
 select ('10000000-0000-4000-8000-'||lpad((800000+n)::text,12,'0'))::uuid,'${id(102)}','tied boundary',now()-interval '1 day',999,'home' from generate_series(1,240)n;`);
 await authenticate();await exec('begin;');
 try{assert.deepEqual(await ranked('for_you'),await canonicalIds('for_you'));}
 finally{await exec('rollback;');await authenticate();}
});
test('snapshot worker builds IDs without calling card hydration and preserves restricted owner',narrowOnly,async()=>{
 await admin();
 assert.equal((await rows("select pg_get_userbyid(proowner) owner from pg_proc where oid='prepared_feed.rank(jsonb,text)'::regprocedure"))[0].owner,'prepared_feed_reader');
 const saved=(await rows("select pg_get_functiondef(oid) definition,pg_get_function_result(oid) result from pg_proc where oid='public.get_feed_rows_by_ids_v1(uuid[])'::regprocedure"))[0];
 await authenticate();await exec("select prepared_feed.request('for_you');");await admin();
 await exec(`create or replace function public.get_feed_rows_by_ids_v1(p_ids uuid[]) returns ${saved.result} language plpgsql stable security invoker set search_path=public as $$begin raise exception 'CARD_HYDRATION_MUST_NOT_RUN_IN_WORKER';end$$;`);
 try{
  const result=(await rows('select drain_prepared_feed_v1(1) result'))[0].result;
  assert.equal(result.failed,0);assert.equal(result.prepared,1);
 }finally{await exec(saved.definition);await authenticate();}
});
test('narrow selector is worker-only and revalidates private blocked and deleted rows',narrowOnly,async()=>{
 await expectError("select prepared_feed.select_page('for_you',null,null,200)",/permission denied/);
 await expectError("select prepared_feed.exact_ids('for_you')",/permission denied/);
 const first=(await ranked('for_you'))[0];
 await admin();await exec(`update posts set audience='mentioned' where id='${first.id}'`);
 assert.equal((await ranked('for_you')).some(p=>p.id===first.id),false);
 await admin();await exec(`update posts set audience='everyone' where id='${first.id}';insert into blocked_users values('${id(102)}','${VIEWER}') on conflict do nothing;`);
 assert.equal((await ranked('for_you')).some(p=>Number(p.id.slice(-12))>800000),false);
 await admin();await exec(`delete from blocked_users where blocker_id='${id(102)}';delete from posts where id='${first.id}';`);
 assert.equal((await ranked('for_you')).some(p=>p.id===first.id),false);
});

async function freshSnapshot(){
 await admin();await exec('delete from prepared_feed.demand;select configure_prepared_feed_v1(true);');
 await authenticate();await exec("select prepared_feed.request('for_you');");await admin();await exec('select drain_prepared_feed_v1(1);');
 const saved=(await rows(`select cursor_serial,ids from prepared_feed.snapshots where viewer_id='${VIEWER}' order by created_at desc,id desc limit 1`))[0];
 await authenticate();return saved;
}
async function trackHydration(run){
 await admin();const saved=(await rows("select pg_get_functiondef(oid) definition,pg_get_function_result(oid) result from pg_proc where oid='public.get_feed_rows_by_ids_v1(uuid[])'::regprocedure"))[0];
 await exec(saved.definition.replace('FUNCTION public.get_feed_rows_by_ids_v1(','FUNCTION prepared_feed.test_card_reader('));
 await exec(`grant execute on function prepared_feed.test_card_reader(uuid[]) to authenticated;
 create or replace function public.get_feed_rows_by_ids_v1(p_ids uuid[]) returns ${saved.result} language plpgsql stable security invoker set search_path=public as $$begin
 perform set_config('prepared_feed.test_windows',coalesce(current_setting('prepared_feed.test_windows',true),'')||','||cardinality(p_ids),false);
 return query select * from prepared_feed.test_card_reader(p_ids);end$$;
 select set_config('prepared_feed.test_windows','',false);`);
 await authenticate();
 try{const result=await run();const windows=(await rows("select current_setting('prepared_feed.test_windows',true) sizes"))[0].sizes.split(',').filter(Boolean).map(Number);return{result,windows};}
 finally{await admin();await exec(saved.definition+';drop function prepared_feed.test_card_reader(uuid[]);');await authenticate();}
}
test('warm20 hydrates exactly20 IDs and refills current hidden/private/deleted rows without changing order',narrowOnly,async()=>{
 const saved=await freshSnapshot();await exec('begin;');
 try{
  const plain=await rows("select * from get_feed_before_bounded('for_you',null,null,20)");
  const tracked=await trackHydration(()=>rows("select * from get_feed('for_you',null,null,20)"));
  assert.deepEqual(tracked.result,plain);assert.deepEqual(tracked.windows,[20]);
  await expectError("select * from get_feed('for_you',null,null,-1)",/2201W: LIMIT must not be negative/);
  await admin();
  await exec(`insert into hidden_posts select '${VIEWER}',unnest(array[${saved.ids.slice(1,21).map(v=>`'${v}'::uuid`).join(',')}]) on conflict do nothing;
   update posts set audience='mentioned' where id=any(array[${saved.ids.slice(21,40).map(v=>`'${v}'::uuid`).join(',')}]);
   delete from posts where id=any(array[${saved.ids.slice(40,45).map(v=>`'${v}'::uuid`).join(',')}]);`);await authenticate();
  const args=`'for_you',${-4000000000000000-saved.cursor_serial*256-1},'${saved.ids[0]}',20`;
  const expected=await rows(`select * from get_feed_before_bounded(${args})`);
  const refilled=await trackHydration(()=>rows(`select * from get_feed(${args})`));
  assert.deepEqual(refilled.result,expected);assert.equal(refilled.result.length,20);
  assert.ok(refilled.windows.length>=3);assert.ok(refilled.windows.every(n=>n<=20));assert.ok(refilled.windows.reduce((a,b)=>a+b,0)<=200);
 }finally{await exec('rollback;');await authenticate();}
});
test('bounded hydration preserves canonical tail refill when final snapshot rows are private',narrowOnly,async()=>{
 const saved=await freshSnapshot();await exec('begin;');
 try{
  await admin();await exec(`update posts set audience='mentioned' where id=any(array[${saved.ids.slice(194,199).map(v=>`'${v}'::uuid`).join(',')}]);`);await authenticate();
  const args=`'for_you',${-4000000000000000-saved.cursor_serial*256-194},'${saved.ids[193]}',20`;
  const expected=await rows(`select * from get_feed_before_bounded(${args})`);
  const actual=await rows(`select * from get_feed(${args})`);
  assert.deepEqual(actual,expected);assert.equal(actual.length,20);assert.equal(new Set(actual.map(v=>v.post_id)).size,20);
  assert.ok(actual.some(v=>v.sort_key>-4000000000000000));
 }finally{await exec('rollback;');await authenticate();}
});

test('legacy clients stay canonical without queueing and exact capability enables prepared cursors',narrowOnly,async()=>{
 await admin();await exec('delete from prepared_feed.demand;select configure_prepared_feed_v1(true);');await authenticate();await exec('begin;');
 try{
  const canonical=await rows("select * from prepared_feed.canonical('for_you',null,null,20)");
  for(const info of ['', 'supabase-js/2', 'platinum-cache/10', 'xplatinum-cache/1', 'platinum-cache/1-extra']){
   await exec(`select set_config('request.headers',jsonb_build_object('x-client-info','${info}')::text,false);`);
   assert.deepEqual(await rows("select * from get_feed('for_you',null,null,20)"),canonical,info);
   assert.deepEqual(await rows(`select * from get_feed('for_you',-4000000000000257,'${id(999999)}',20)`),canonical,info);
  }
  await admin();assert.equal((await rows('select count(*) n from prepared_feed.demand'))[0].n,0);
  await authenticate();await exec(`select set_config('request.headers','{"x-client-info":"supabase-js/2,platinum-cache/1,PlatinumCircles-nest-mobile"}',false);`);await rows("select * from get_feed('for_you',null,null,20)");await admin();
  assert.equal((await rows('select count(*) n from prepared_feed.demand'))[0].n,1);
  await exec('select drain_prepared_feed_v1(1);');await authenticate();
  assert.ok((await rows("select sort_key from get_feed('for_you',null,null,20)")).every(r=>r.sort_key<-4000000000000000));
 }finally{await exec('rollback;');await authenticate();}
});

if (process.env.PREPARED_FEED_NARROW === '1') test('catalog authorization uses a point lookup while retaining its canonical fallback',async()=>{
 await authenticate();
 const policy=(await rows("select pg_get_expr(polqual,polrelid) expression from pg_policy where polrelid='feed_ranking.catalog'::regclass and polname='feed_catalog_visible'"))[0].expression;
 assert.match(policy,/p\.id = catalog\.post_id/);
 assert.match(policy,/get_feed_visibility\(ARRAY\[catalog\.post_id\]\)/);
 const statement="explain(format json) select * from feed_ranking.catalog where post_id='"+id(1)+"'";
 const plan=real?JSON.parse(await db.query(statement)):(await db.query(statement)).rows[0]['QUERY PLAN'];
 const nodes=[];const visit=value=>{if(!value||typeof value!=='object')return;if(value['Relation Name'])nodes.push(value);for(const child of Object.values(value))if(Array.isArray(child))child.forEach(visit);else visit(child);};visit(plan);
 assert.ok(nodes.some(node=>node['Relation Name']==='posts'&&String(node['Index Cond']).includes('catalog.post_id')), 'Post visibility must use the catalog ID as its index condition');
});
