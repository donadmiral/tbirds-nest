const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const { fixture, migration: feedMigration, sql, id, P1, P2, VIEWER } = require('./feed-scale-fixture.cjs');
const { migration: deltaMigration } = require('./engagement-counter-fixture.cjs');
let db,real;
const exec=async q=>real?db.query(q):db.exec(q);
async function value(q){return real?JSON.parse(await db.query(`select to_jsonb(q) from (${q})q;`)):(await db.query(q)).rows[0];}
async function exact(){return value(`select * from get_post_engagement_counts_v1(array['${P1}']::uuid[])`);}
async function canonical(){
 const r=await value(`select count(*)::integer n from posts p where
   (select coalesce(sum(likes_count),0) from post_counter_internal.shards s where s.post_id=p.id)<>(select count(*) from post_likes where post_id=p.id)
   or (select coalesce(sum(comments_count),0) from post_counter_internal.shards s where s.post_id=p.id)<>(select count(*) from post_comments where post_id=p.id)
   or (select coalesce(sum(reposts_count),0) from post_counter_internal.shards s where s.post_id=p.id)<>(select count(*) from post_reposts where post_id=p.id)
   or (select coalesce(sum(bookmarks_count),0) from post_counter_internal.shards s where s.post_id=p.id)<>(select count(*) from post_bookmarks where post_id=p.id)`);
 assert.equal(r.n,0);
}
before(async()=>{
 real=!!process.env.PC_TEST_PSQL;
 if(real&&process.env.PGDATABASE!=='pc_scale_distributed_counters')throw Error('Use disposable pc_scale_distributed_counters.');
 db=real?new LocalPsqlSession():new PGlite();
 await exec('drop schema if exists post_counter_internal cascade;drop schema if exists auth cascade;drop schema public cascade;create schema public;');
 await exec(fixture);await exec(deltaMigration);await exec(feedMigration);
 await exec(sql('20261102090626_distributed_post_counters.sql'));
 await exec(`set request.jwt.claim.sub='${VIEWER}';`);
});
after(async()=>{await db?.close();});
test('disabled cutover preserves synchronous columns while exact shards remain reconciled',async()=>{
 assert.equal((await exact()).likes_count,1);
 await exec(`insert into post_likes(post_id,user_id) values('${P1}','${id(106)}');`);
 assert.equal((await exact()).likes_count,2);
 assert.equal((await value(`select likes_count from posts where id='${P1}'`)).likes_count,2);
 await exec(`delete from post_likes where user_id='${id(106)}';`);
 await canonical();
});
test('enabled writes keep exact mutation/reader counts and flush one coalesced legacy snapshot',async()=>{
 await exec('select configure_distributed_post_counters_v1(true);truncate counter_write_log;');
 const before=(await exact()).likes_count;
 await exec(`insert into post_likes(post_id,user_id) select '${P1}',id from members where id>='${id(110)}' and id<'${id(310)}';`);
 assert.equal((await exact()).likes_count,before+200);
 assert.equal((await value('select count(*)::int n from counter_write_log')).n,0);
 const pending=await value('select count(*)::int n from post_counter_internal.dirty');
 assert.ok(pending.n>1&&pending.n<=64);
 await exec('select flush_post_engagement_snapshots_v1(1000);');
 assert.equal((await value(`select likes_count from posts where id='${P1}'`)).likes_count,before+200);
 assert.equal((await value('select count(*)::int n from counter_write_log')).n,1);
 await exec(`set request.jwt.claim.sub='${id(311)}';`);
 const toggle=await value(`select toggle_post_like('${P1}') result`);
 assert.equal(toggle.result.likes_count,before+201);assert.equal(toggle.result.liked,true);
 const off=await value(`select toggle_post_like('${P1}') result`);
 assert.equal(off.result.likes_count,before+200);assert.equal(off.result.liked,false);
 await exec(`set request.jwt.claim.sub='${VIEWER}';`);await canonical();
});
test('deletes, reassignment, duplicate retries and zero-delta edits remain exact',async()=>{
 await exec(`insert into post_likes(post_id,user_id) values('${P1}','${id(400)}') on conflict do nothing;
 insert into post_likes(post_id,user_id) values('${P1}','${id(400)}') on conflict do nothing;
 update post_likes set post_id='${P2}',user_id='${id(401)}' where post_id='${P1}' and user_id='${id(400)}';
 delete from post_likes where user_id='${id(401)}';
 update post_comments set body='Edited without changing count';`);
 await canonical();
});
test('stalled worker activates synchronous compatibility fallback and explicit rollback drains exactly',async()=>{
 await exec("update post_counter_internal.settings set last_flush_at=now()-interval '6 seconds';");
 await exec(`insert into post_likes(post_id,user_id) values('${P1}','${id(500)}');`);
 assert.equal((await value(`select likes_count from posts where id='${P1}'`)).likes_count,(await exact()).likes_count);
 assert.equal((await value('select post_counter_status_v1() result')).result.synchronous_fallback,true);
 await exec('select configure_distributed_post_counters_v1(false);');
 assert.equal((await value('select count(*)::int n from post_counter_internal.dirty')).n,0);
 await canonical();
});
test('counter readers preserve RLS and canonical access and reject anonymous or oversized requests',async()=>{
 await exec(`insert into blocked_users values('${id(100)}','${VIEWER}');set role authenticated;`);
 assert.deepEqual(await value(`select count(*)::int n from get_post_engagement_counts_v1(array['${P1}']::uuid[])`),{n:0});
 await exec(`reset role;delete from blocked_users;do $$begin
   begin perform get_post_engagement_counts_v1(array_fill('${P1}'::uuid,array[101]));raise exception 'accepted oversized';
   exception when invalid_parameter_value then null;end;
   begin set local role anon;perform get_post_engagement_counts_v1('{}');raise exception 'accepted anonymous';
   exception when insufficient_privilege then reset role;end;
 end$$;`);
 const acl=await value("select has_table_privilege('authenticated','post_counter_internal.shards','select') allowed");
 assert.equal(acl.allowed,false);
});
test('independent real transactions on distinct viral shards do not wait on the parent post', {skip:!process.env.PC_TEST_PSQL},async()=>{
 const a=new LocalPsqlSession(),b=new LocalPsqlSession();
 try{
   await exec('select configure_distributed_post_counters_v1(true);');
   const pair=await value(`select min(id::text) a,max(id::text) b from members where id>='${id(600)}' and id<'${id(620)}'`);
   let userA=pair.a,userB=pair.b;
   const different=await value(`select id::text id from members where id>'${userA}' and post_counter_internal.shard_for(id)<>post_counter_internal.shard_for('${userA}') limit 1`);
   userB=different.id;
   await a.query(`set statement_timeout='3s';begin;insert into post_likes(post_id,user_id) values('${P1}','${userA}');`);
   await b.query(`set statement_timeout='3s';begin;insert into post_likes(post_id,user_id) values('${P1}','${userB}');commit;`);
   await a.query('rollback;');
   await canonical();
   assert.equal((await value(`select count(*)::int n from post_likes where post_id='${P1}' and user_id='${userA}'`)).n,0);
   assert.equal((await value(`select count(*)::int n from post_likes where post_id='${P1}' and user_id='${userB}'`)).n,1);
 }finally{await Promise.all([a.close(),b.close()]);}
});
test('late transaction after a snapshot drain retains a durable marker for the next drain', {skip:!process.env.PC_TEST_PSQL},async()=>{
 const worker=new LocalPsqlSession(),writer=new LocalPsqlSession();
 try{
   await exec('select configure_distributed_post_counters_v1(true);');
   const user=id(700);
   await exec(`insert into post_likes(post_id,user_id) values('${P1}','${user}');`);
   await worker.query('begin;select flush_post_engagement_snapshots_v1(1000);');
   await writer.query("set statement_timeout='5s';begin;");
   const pending=writer.query(`insert into post_reposts(post_id,user_id) values('${P1}','${user}');commit;`);
   await worker.query('commit;');await pending;
   assert.ok((await value('select count(*)::int n from post_counter_internal.dirty')).n>0);
   await exec('select flush_post_engagement_snapshots_v1(1000);');
   assert.equal((await value(`select reposts_count from posts where id='${P1}'`)).reposts_count,(await exact()).reposts_count);
   await canonical();
 }finally{await Promise.all([worker.close(),writer.close()]);}
});
