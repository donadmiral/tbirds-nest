const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const { fixture, migration, sql, id, OWNER, VIEWER } = require('./feed-scale-fixture.cjs');
let db, real;
const exec = sql => real ? db.query(sql) : db.exec(sql);
async function rows(sql) {
 const statement = `select coalesce(jsonb_agg(q),'[]') result from (${sql})q;`;
 return real ? JSON.parse(await db.query(statement)) : (await db.query(statement)).rows[0].result;
}
const authenticate = async (user=VIEWER, session=id(900001)) => exec(`reset role;select set_config('request.jwt.claim.sub','${user}',false);
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
 await exec(`create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant execute on function auth.jwt() to authenticated,anon,service_role;
 update posts set created_at=created_at-interval '1 second' where id='${id(2)}';
 insert into posts(id,user_id,content,created_at,likes_count,comments_count,reposts_count,channel)
 select ('10000000-0000-4000-8000-'||lpad((30000+n)::text,12,'0'))::uuid,'${OWNER}','prepared fixture '||n,
 now()-make_interval(hours=>n,secs=>n),n%17,n%9,n%4,'home' from generate_series(1,230)n;
 insert into follows values('${VIEWER}','${OWNER}');`);
 await exec(migration);
 await exec(sql('20261105044917_prepared_feed_snapshots.sql'));
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
