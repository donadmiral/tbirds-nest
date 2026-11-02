const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const { PGlite } = require('./rpc-authorization/node_modules/@electric-sql/pglite');
const { fixture, migration: feedMigration, sql, captured, id, P1, P2, OWNER, VIEWER } = require('./feed-scale-fixture.cjs');
const { migration: deltaMigration } = require('./engagement-counter-fixture.cjs');
let db, real;
const exec = async q => real ? db.query(q) : db.exec(q);
async function value(q) { return real ? JSON.parse(await db.query(`select to_jsonb(q) from (${q})q;`)) : (await db.query(q)).rows[0]; }
async function counts(post = P1) { return value(`select * from get_post_engagement_counts_v1(array['${post}']::uuid[])`); }
const video = (viewer, session, duration, post = P1) => `set request.jwt.claim.sub='${viewer}';select record_video_view('${post}','${viewer}','${session}',${duration});`;
const share = (event, post = P1) => `select record_post_share_v1('${post}','${event}') n`;
before(async () => {
  real = !!process.env.PC_TEST_PSQL;
  if (real && process.env.PGDATABASE !== 'pc_scale_unique_reach') throw Error('Use disposable pc_scale_unique_reach.');
  db = real ? new LocalPsqlSession() : new PGlite();
  await exec('drop schema if exists post_counter_internal cascade;drop schema if exists auth cascade;drop schema public cascade;create schema public;');
  await exec(fixture); await exec(deltaMigration); await exec(feedMigration);
  await exec(sql('20261102090626_distributed_post_counters.sql'));
  await exec(`create table post_video_views(id uuid primary key default gen_random_uuid(),post_id uuid not null references posts on delete cascade,
    viewer_id uuid references profiles on delete cascade,session_id text not null,duration_sec integer not null,viewed_at timestamptz default now(),unique(post_id,session_id));
    ${captured('bump_post_views')}
    ${captured('record_video_view')}
    ${captured('increment_share_count')}
    create trigger trg_post_seen_views after insert on post_seen for each row execute function bump_post_views();
    create trigger zz_sync_count_exact after insert or delete on post_seen for each row execute function sync_post_counter_exact();
    insert into post_seen values('${P1}','${VIEWER}'),('${P1}','${OWNER}');
    insert into post_video_views(post_id,viewer_id,session_id,duration_sec) values
      ('${P1}','${VIEWER}','prior-overlap',8),('${P1}','${id(102)}','prior-video',4),('${P1}','${id(103)}','prior-short',2);
    update posts set shares_count=9 where id='${P1}';`);
  await exec(sql('20261102094217_distributed_unique_views_and_share_events.sql'));
  await exec(`set request.jwt.claim.sub='${VIEWER}';`);
});
after(async () => { await db?.close(); });
test('backfill keeps historical shares and canonical unique non-author seen/video union', async () => {
  const c = await counts(); assert.equal(c.views_count, 2); assert.equal(c.shares_count, 9);
  assert.equal((await value(`select views_count from posts where id='${P1}'`)).views_count, 2);
  assert.equal((await value('select count(*)::integer n from post_video_views')).n, 3);
});
test('video then seen, seen then video, repeated sessions and author views count once', async () => {
  const start = (await counts()).views_count;
  await exec(video(id(200), 'video-first', 2)); assert.equal((await counts()).views_count, start);
  await exec(video(id(200), 'video-first', 3)); assert.equal((await counts()).views_count, start + 1);
  await exec(`insert into post_seen values('${P1}','${id(200)}') on conflict do nothing;`);
  await exec(video(id(200), 'second-session', 9));
  await exec(video(id(200), 'video-first', 1));
  assert.equal((await counts()).views_count, start + 1);
  assert.equal((await value("select duration_sec from post_video_views where session_id='video-first'")).duration_sec, 3);
  await exec(`insert into post_seen values('${P1}','${id(201)}');`);
  await exec(video(id(201), 'seen-first', 7)); assert.equal((await counts()).views_count, start + 2);
  await exec(video(OWNER, 'author-session', 9)); assert.equal((await counts()).views_count, start + 2);
  await exec(`set request.jwt.claim.sub='${VIEWER}';`);
});
test('deleting one source preserves the other and deleting the last source removes only that viewer', async () => {
  const start = (await counts()).views_count;
  await exec(`delete from post_seen where post_id='${P1}' and user_id='${id(201)}';`);
  assert.equal((await counts()).views_count, start);
  await exec("delete from post_video_views where session_id='seen-first';");
  assert.equal((await counts()).views_count, start - 1);
  await exec(`insert into post_seen values('${P2}','${id(203)}');update post_seen set post_id='${P1}' where post_id='${P2}' and user_id='${id(203)}';`);
  assert.equal((await counts()).views_count, start);
  assert.equal((await counts(P2)).views_count, 0);
});
test('share event retries are idempotent, old RPC remains compatible and event removal reconciles', async () => {
  const start = (await counts()).shares_count;
  assert.equal((await value(share(id(9001)))).n, start + 1);
  assert.equal((await value(share(id(9001)))).n, start + 1);
  assert.equal((await value(share(id(9002)))).n, start + 2);
  await exec(`select increment_share_count('${P1}');`);
  assert.equal((await counts()).shares_count, start + 3);
  await exec(`delete from post_counter_internal.share_events where event_id='${id(9002)}';`);
  assert.equal((await counts()).shares_count, start + 2);
  await exec(`do $$begin begin perform record_post_share_v1('${P2}','${id(9001)}');raise exception 'accepted duplicate on another post';
    exception when invalid_parameter_value then null;end;end$$;`);
  assert.equal((await counts(P2)).shares_count, 0);
});
test('distributed views and share writes avoid the parent counter and snapshot worker preserves all six counters', async () => {
  const start = await counts();
  await exec('select configure_distributed_post_counters_v1(true);truncate counter_write_log;');
  await exec(`insert into post_seen select '${P1}',id from members where id>='${id(300)}' and id<'${id(500)}';`);
  await exec(share(id(9003)) + ';');
  assert.equal((await counts()).views_count, start.views_count + 200);
  assert.equal((await counts()).shares_count, start.shares_count + 1);
  assert.equal((await value('select count(*)::integer n from counter_write_log')).n, 0);
  await exec('select flush_post_engagement_snapshots_v1(1000);');
  assert.equal((await value(`select views_count from posts where id='${P1}'`)).views_count, start.views_count + 200);
  assert.equal((await value(`select shares_count from posts where id='${P1}'`)).shares_count, start.shares_count + 1);
  assert.equal((await value('select count(*)::integer n from counter_write_log')).n, 1);
  await exec("update post_counter_internal.settings set last_flush_at=clock_timestamp()-interval '6 seconds';");
  await exec(`insert into post_seen values('${P1}','${id(501)}');`);
  assert.equal((await value(`select views_count from posts where id='${P1}'`)).views_count, (await counts()).views_count);
  await exec('select configure_distributed_post_counters_v1(false);');
  assert.equal((await value('select count(*)::integer n from post_counter_internal.dirty')).n, 0);
});
test('viewer spoofing, inaccessible posts, foreign sessions and anonymous calls cannot change counters', async () => {
  const start = await counts();
  await exec(`do $$begin
    begin perform record_video_view('${P1}','${id(900)}','spoof',9);raise exception 'accepted spoof';exception when insufficient_privilege then null;end;
    begin perform record_video_view('${P1}','${VIEWER}','video-first',9);raise exception 'accepted foreign session';exception when insufficient_privilege then null;end;
    begin set local role anon;perform record_post_share_v1('${P1}','${id(9004)}');raise exception 'accepted anonymous share';exception when insufficient_privilege then reset role;end;
    begin set local role anon;perform record_video_view('${P1}','${VIEWER}','anon',9);raise exception 'accepted anonymous view';exception when insufficient_privilege then reset role;end;
  end$$;
  insert into blocked_users values('${OWNER}','${VIEWER}');
  do $$begin begin perform record_post_share_v1('${P1}','${id(9004)}');raise exception 'accepted blocked share';exception when insufficient_privilege then null;end;end$$;
  delete from blocked_users;`);
  assert.deepEqual(await counts(), start);
});
test('simultaneous video and seen for one viewer publish one exact unique view', { skip: !process.env.PC_TEST_PSQL }, async () => {
  const a = new LocalPsqlSession(), b = new LocalPsqlSession();
  try {
    await exec('select configure_distributed_post_counters_v1(true);');
    const start = (await counts()).views_count;
    await a.query(`set statement_timeout='5s';begin;${video(id(700), 'concurrent-union', 5)}`);
    const pending = b.query(`set statement_timeout='5s';begin;insert into post_seen values('${P1}','${id(700)}');commit;`);
    await a.query('commit;'); await pending;
    assert.equal((await counts()).views_count, start + 1);
    const row = await value(`select seen_count,video_count from post_counter_internal.viewers where post_id='${P1}' and viewer_key='u:${id(700)}'`);
    assert.deepEqual(row, { seen_count: 1, video_count: 1 });
  } finally { await Promise.all([a.close(), b.close()]); }
});
