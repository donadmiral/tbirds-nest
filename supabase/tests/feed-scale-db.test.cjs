const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const { fixture, migration, sql, id, P2, OWNER, VIEWER } = require('./feed-scale-fixture.cjs');
let db, real;
const query = async sql => real ? db.query(sql) : (await db.query(sql)).rows;
const exec = async sql => real ? db.query(sql) : db.exec(sql);
async function rows(sql) {
  const wrapped = `select coalesce(jsonb_agg(q),'[]') as result from (${sql}) q;`;
  return real ? JSON.parse(await query(wrapped)) : (await query(wrapped))[0].result;
}
before(async () => {
  real = !!process.env.PC_TEST_PSQL;
  if (real && process.env.PGDATABASE !== 'pc_scale_feed_rank') throw Error('Use disposable pc_scale_feed_rank.');
  db = real ? new LocalPsqlSession() : new PGlite();
  await exec('drop schema if exists feed_ranking cascade;drop schema if exists post_counter_internal cascade;drop schema if exists auth cascade;drop schema public cascade;create schema public;');
  await exec(fixture);
  await exec(`update posts set created_at=created_at-interval '1 second' where id='${P2}';
    insert into posts(id,user_id,content,body,created_at,likes_count,comments_count,reposts_count,channel)
    select ('10000000-0000-4000-8000-'||lpad((30000+n)::text,12,'0'))::uuid,
      ('10000000-0000-4000-8000-'||lpad((100+n%53)::text,12,'0'))::uuid,
      'post '||n,repeat('wide article ',500),now()-make_interval(hours=>n%1000,secs=>n),
      n%117,n%19,n%9,case when n%4=0 then 'innovation' else 'home' end
    from generate_series(1,2000)n;
    insert into follows values('${VIEWER}','${OWNER}');
    insert into post_seen select id,'${VIEWER}' from posts where likes_count%13=0;
    insert into trending_snapshot select 'post',id,row_number()over(order by likes_count desc,id)::int from posts where likes_count>100;
    insert into post_media values('${id(90000)}','${id(30001)}','https://example.invalid/photo.jpg','image',640,480,0,false,'Photograph','{"crop":"original"}');
    do $$ declare d text;begin d:=pg_get_functiondef('get_feed(text,double precision,uuid,integer)'::regprocedure);
      execute replace(d,'FUNCTION public.get_feed(','FUNCTION public.get_feed_before_scale(');end$$;
    set request.jwt.claim.sub='${VIEWER}';`);
  await exec(migration);
  await exec(sql('20261102092828_indexed_feed_rank_frontier.sql'));
  await exec('select configure_indexed_feed_v1(true);');
  await exec('begin;set role authenticated;');
});
after(async () => { if (db) { await exec('rollback;reset role;'); await db.close(); } });
for (const mode of ['for_you', 'innovation', 'trending', 'following']) test(`narrow ${mode} ranking and page cursors exactly match the original cards`, async () => {
  const old = await rows(`select * from get_feed_before_scale('${mode}',null,null,30)`);
  const current = await rows(`select * from get_feed('${mode}',null,null,30)`);
  assert.deepEqual(current, old);
  const cursor = old.at(-1);
  if (cursor) assert.deepEqual(await rows(`select * from get_feed('${mode}',${cursor.sort_key},'${cursor.post_id}',30)`),
    await rows(`select * from get_feed_before_scale('${mode}',${cursor.sort_key},'${cursor.post_id}',30)`));
});
test('history restores full cards by IDs without reranking or losing recipes', async () => {
  const before = await rows("select * from get_feed_before_scale('following',null,null,50)");
  const chosen = before.slice(0,17);
  const current = await rows(`select * from get_feed_rows_by_ids_v1(array[${chosen.map(p=>`'${p.post_id}'`).join(',')}]::uuid[])`);
  assert.deepEqual(new Map(current.map(p=>[p.post_id,p])),new Map(chosen.map(p=>[p.post_id,p])));
  const media = await rows(`select * from get_feed_rows_by_ids_v1(array['${id(30001)}']::uuid[])`);
  assert.equal(media[0].media[0].url,'https://example.invalid/photo.jpg');
});
test('history honors live revocation, hidden rows, mute and deletion', async () => {
  const p=id(30002), author=id(102);
  await exec('reset role;');
  for (const [change,undo] of [
    [`insert into hidden_posts values('${VIEWER}','${p}')`,`delete from hidden_posts`],
    [`insert into muted_authors values('${VIEWER}','${author}')`,`delete from muted_authors`],
    [`insert into blocked_users values('${author}','${VIEWER}')`,`delete from blocked_users`],
    [`update posts set audience='mentioned' where id='${p}'`,`update posts set audience='everyone' where id='${p}'`],
  ]) {
    await exec(change+';set role authenticated;');
    assert.deepEqual(await rows(`select * from get_feed_rows_by_ids_v1(array['${p}']::uuid[])`),[]);
    await exec('reset role;'+undo+';');
  }
  await exec('set role authenticated;');
  assert.deepEqual(await rows('select * from get_feed_rows_by_ids_v1(array[]::uuid[])'),[]);
});
test('oversized and anonymous history calls fail closed without private schema grants', async () => {
  // Use server-side exception blocks so a rejected call does not abort the suite's transaction.
  await exec(`reset role;do $$begin
    begin perform get_feed_rows_by_ids_v1(array_fill('${id(30001)}'::uuid,array[101]));raise exception 'accepted oversized';
    exception when invalid_parameter_value then null;end;
    begin set local role anon;perform get_feed_rows_by_ids_v1('{}');raise exception 'accepted anonymous';
    exception when insufficient_privilege then reset role;end;
  end$$;set role authenticated;`);
});
test('indexed score bounds prove the same winners without scanning the long tail',async()=>{
  await exec(`reset role;insert into posts(id,user_id,content,created_at)
    select ('10000000-0000-4000-8000-'||lpad((200000+n)::text,12,'0'))::uuid,
      ('10000000-0000-4000-8000-'||lpad((100+n%53)::text,12,'0'))::uuid,'Older low engagement post',now()-interval '40 days'-make_interval(secs=>n)
    from generate_series(1,20000)n;analyze posts;analyze feed_ranking.catalog;set role authenticated;`);
  const [proof]=await rows("select feed_ranking.select_page('for_you',null,null,30) result");
  assert.equal(proof.result.fallback,false,JSON.stringify(proof.result));
  assert.ok(proof.result.candidates<2000,`ranked ${proof.result.candidates} of 22002 posts`);
  assert.deepEqual(await rows("select * from get_feed('for_you',null,null,30)"),
    await rows("select * from get_feed_before_scale('for_you',null,null,30)"));
  console.log(JSON.stringify({synthetic_posts:22002,ranked_candidates:proof.result.candidates,days:proof.result.days,exact:true}));
});
test('future timestamps retain the canonical fallback and the current result',async()=>{
  await exec(`reset role;insert into posts(id,user_id,content,created_at) values('${id(400001)}','${OWNER}','Future fixture',now()+interval '1 minute');set role authenticated;`);
  const [proof]=await rows("select feed_ranking.select_page('for_you',null,null,20) result");
  assert.equal(proof.result.fallback,true);assert.equal(proof.result.reason,'future_timestamp');
  assert.deepEqual(await rows("select * from get_feed('for_you',null,null,20)"),
    await rows("select * from get_feed_before_scale('for_you',null,null,20)"));
  await exec(`reset role;delete from posts where id='${id(400001)}';set role authenticated;`);
});
