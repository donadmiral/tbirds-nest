const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const { fixture, migration, sql, id, P1, P2, OWNER, VIEWER } = require('./feed-scale-fixture.cjs');

const tieMigration = sql('20261105045938_deterministic_feed_author_ties.sql');
const oldOrder = 'row_number() over (partition by b.user_id order by b.raw_score desc)';
const newOrder = 'row_number() over (partition by b.user_id order by b.raw_score desc, b.id desc)';
const oldGuard = `   -- The legacy query has no tie breaker inside its author window. Keep that
   -- exact plan for equal raw scores rather than introducing a new tie policy.
   if has_tie then return jsonb_build_object('fallback',true,'candidates',cardinality(candidates),'reason','legacy_tie');end if;`;
const newGuard = '   -- Equal author scores now use the same UUID-desc order in both paths.';
let db, real, original, initialProof;
const exec = statement => real ? db.query(statement) : db.exec(statement);
async function rows(statement) {
  const wrapped = `select coalesce(jsonb_agg(q),'[]') result from (${statement}) q;`;
  return real ? JSON.parse(await db.query(wrapped)) : (await db.query(wrapped)).rows[0].result;
}
const definitions = () => rows(`select p.proname, p.prosrc, pg_get_functiondef(p.oid) definition,
  p.proowner, p.proacl, p.prosecdef, p.provolatile, p.proconfig, p.prolang,
  pg_get_function_result(p.oid) result_type, pg_get_function_arguments(p.oid) arguments
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='feed_ranking' and p.proname in ('fallback','score','select_page') order by p.proname`);

before(async () => {
  real = !!process.env.PC_TEST_PSQL;
  if (real && process.env.PGDATABASE !== 'pc_scale_feed_ties') throw Error('Use disposable pc_scale_feed_ties.');
  db = real ? new LocalPsqlSession() : new PGlite();
  await exec('drop schema if exists feed_ranking cascade;drop schema if exists post_counter_internal cascade;drop schema if exists auth cascade;drop schema public cascade;create schema public;');
  await exec(fixture);
  await exec(migration);
  for (const name of ['20261102092828_indexed_feed_rank_frontier.sql',
    '20261102175247_feed_catalog_inline_visibility.sql', '20261102180219_feed_frontier_defer_partial_scoring.sql']) await exec(sql(name));
  original = await definitions();
  const canonical = original.find(row => row.proname === 'fallback');
  await exec(canonical.definition.replace('FUNCTION feed_ranking.fallback(', 'FUNCTION feed_ranking.legacy_fallback('));
  await exec(`set request.jwt.claim.sub='${VIEWER}';set role authenticated;`);
  initialProof = (await rows("select feed_ranking.select_page('for_you',null,null,20) result"))[0].result;
  await exec('reset role;');
  await exec(tieMigration);
  await exec('select configure_indexed_feed_v1(true);begin;set role authenticated;');
});
beforeEach(async () => { await exec('savepoint tie_case;'); });
afterEach(async () => { await exec('rollback to savepoint tie_case;release savepoint tie_case;'); });
after(async () => { if (db) { await exec('rollback;reset role;'); await db.close(); } });

test('the original equal-timestamp fixture uses indexed ranking with deterministic diversity slots', async () => {
  assert.equal(initialProof.fallback, true);
  assert.equal(initialProof.reason, 'legacy_tie');
  const [proof] = await rows("select feed_ranking.select_page('for_you',null,null,20) result");
  assert.equal(proof.result.fallback, false);
  assert.equal(proof.result.candidates, 2);
  assert.deepEqual(proof.result.ids, [P2, P1]);
  const scores = await rows(`select * from feed_ranking.score(array['${P1}','${P2}']::uuid[],'for_you') order by id desc`);
  assert.equal(scores[0].raw_score, scores[1].raw_score);
  assert.ok(Math.abs(scores[1].sort_key / scores[0].sort_key - 0.55) < 1e-12);
  assert.deepEqual(await rows("select * from get_feed('for_you',null,null,20)"),
    await rows("select * from feed_ranking.fallback('for_you',null,null,20)"));
});

test('only author peer ordering and the obsolete bailout change, preserving complete function contracts', async () => {
  const current = await definitions();
  for (let i = 0; i < original.length; i++) {
    const { prosrc: beforeSource, definition: beforeDefinition, ...beforeContract } = original[i];
    const { prosrc: afterSource, definition: afterDefinition, ...afterContract } = current[i];
    assert.deepEqual(afterContract, beforeContract);
    assert.equal(afterSource, beforeSource.replace(oldOrder, newOrder).replace(oldGuard, newGuard));
  }
  const [rights] = await rows(`select
    has_function_privilege('anon','feed_ranking.fallback(text,double precision,uuid,integer)','execute') anonymous,
    has_function_privilege('authenticated','feed_ranking.score(uuid[],text)','execute') authenticated`);
  assert.equal(rights.anonymous, false);
  assert.equal(rights.authenticated, true);
});

test('untied first and cursor pages retain exact legacy cards in every feed mode', async () => {
  await exec(`reset role;update posts set created_at=created_at-interval '1 second' where id='${P2}';
    insert into posts(id,user_id,content,body,created_at,likes_count,comments_count,reposts_count,channel)
    select ('10000000-0000-4000-8000-'||lpad((30000+n)::text,12,'0'))::uuid,
      ('10000000-0000-4000-8000-'||lpad((100+n%53)::text,12,'0'))::uuid,
      'post '||n,repeat('wide article ',200),now()-make_interval(hours=>n%1000,secs=>n),
      n%117,n%19,n%9,case when n%4=0 then 'innovation' else 'home' end
    from generate_series(1,1000)n;
    insert into follows values('${VIEWER}','${OWNER}');
    insert into post_seen select id,'${VIEWER}' from posts where likes_count%13=0;
    insert into trending_snapshot select 'post',id,row_number()over(order by likes_count desc,id)::int from posts where likes_count>100;
    set role authenticated;`);
  for (const mode of ['for_you', 'innovation', 'trending', 'following']) {
    const legacy = await rows(`select * from feed_ranking.legacy_fallback('${mode}',null,null,30)`);
    assert.deepEqual(await rows(`select * from get_feed('${mode}',null,null,30)`), legacy, mode);
    const last = legacy.at(-1);
    assert.ok(last, mode);
    assert.deepEqual(await rows(`select * from get_feed('${mode}',${last.sort_key},'${last.post_id}',30)`),
      await rows(`select * from feed_ranking.legacy_fallback('${mode}',${last.sort_key},'${last.post_id}',30)`), mode + ' cursor');
  }
});

test('same-author peers across the 64-candidate frontier and page cursors have no omissions or duplicates', async () => {
  await exec(`reset role;
    insert into posts(id,user_id,content,created_at,likes_count,channel)
    select ('10000000-0000-4000-8000-'||lpad((40000+n)::text,12,'0'))::uuid,
      '${id(102)}','Equal author score '||n,now()-interval '1 hour',500,'innovation'
    from generate_series(1,130)n;set role authenticated;`);
  for (const mode of ['for_you', 'innovation']) {
    const seen = [], expectedCount = mode === 'for_you' ? 132 : 130;
    let cursor = 'null,null';
    for (let page = 0; page < 9; page++) {
      const actual = await rows(`select * from get_feed('${mode}',${cursor},20)`);
      assert.deepEqual(actual, await rows(`select * from feed_ranking.fallback('${mode}',${cursor},20)`), mode + ' page ' + page);
      const [proof] = await rows(`select feed_ranking.select_page('${mode}',${cursor},20) result`);
      assert.equal(proof.result.fallback, false, JSON.stringify(proof.result));
      if (!actual.length) break;
      seen.push(...actual.map(post => post.post_id));
      const last = actual.at(-1);
      cursor = `${last.sort_key},'${last.post_id}'`;
    }
    assert.equal(seen.length, expectedCount);
    assert.equal(new Set(seen).size, expectedCount);
    assert.deepEqual(seen.filter(post => post >= id(40001)), Array.from({ length: 130 }, (_, n) => id(40130 - n)));
  }
});

test('privacy changes immediately alter both indexed winners and diversity positions', async () => {
  for (const [change, undo] of [
    [`insert into hidden_posts values('${VIEWER}','${P2}')`, 'delete from hidden_posts'],
    [`update posts set audience='mentioned' where id='${P2}'`, `update posts set audience='everyone' where id='${P2}'`],
    [`create policy tie_authority on posts as restrictive for select to authenticated using(id<>'${P2}')`, 'drop policy tie_authority on posts'],
  ]) {
    await exec('reset role;' + change + ';set role authenticated;');
    const actual = await rows("select * from get_feed('for_you',null,null,20)");
    assert.deepEqual(actual.map(post => post.post_id), [P1]);
    assert.deepEqual(actual, await rows("select * from feed_ranking.fallback('for_you',null,null,20)"));
    await exec('reset role;' + undo + ';set role authenticated;');
  }
  await exec(`reset role;insert into muted_authors values('${VIEWER}','${OWNER}');set role authenticated;`);
  assert.deepEqual(await rows("select * from get_feed('for_you',null,null,20)"), []);
});

test('an unknown frontier definition aborts the migration and rolls back both earlier function replacements', async () => {
  await exec('reset role;');
  for (const row of original) await exec(row.definition);
  const frontier = original.find(row => row.proname === 'select_page');
  await exec(frontier.definition.replace(frontier.prosrc, frontier.prosrc + '\n-- Unreviewed change\n'));
  const attempt = tieMigration.slice(tieMigration.indexOf('do $migration$'), tieMigration.indexOf('notify pgrst'));
  await exec(`do $test$ begin
    begin execute $attempt$${attempt}$attempt$;
      raise exception 'Unexpected migration success';
    exception when others then
      if sqlerrm <> 'FEED_AUTHOR_TIE_FRONTIER_REQUIRES_REVIEW' then raise;end if;
    end;
  end $test$;`);
  const current = await definitions();
  for (const name of ['fallback', 'score']) assert.equal(current.find(row => row.proname === name).prosrc,
    original.find(row => row.proname === name).prosrc);
});
