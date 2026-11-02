const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const root = path.resolve(__dirname, '../..');
const sql = file => fs.readFileSync(path.join(root, file), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner = id(1), viewer = id(2), other = id(3), post = id(101), privatePost = id(102), hiddenPost = id(103);
const enabled = !!process.env.PC_TEST_PSQL;
if (enabled && process.env.PGDATABASE !== 'pc_scale_feed') throw Error('Feed fixture requires the disposable pc_scale_feed database.');
let db;
const claim = user => `set request.jwt.claim.sub='${user}';`;
const expire = "update feed_live.pending set due_at=clock_timestamp()-interval '1 second';";
async function prepare() {
  db = new LocalPsqlSession();
  await db.query('set jit=off; ' + sql('supabase/tests/feed-live-fixture.sql'));
  const captured = sql('supabase/migrations/00000000000151_capture_functions.sql');
  for (const name of ['can_view_post','can_view_profile']) {
    const start = captured.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`), end = captured.indexOf('\nCREATE OR REPLACE FUNCTION', start + 1);
    assert.ok(start >= 0 && end > start); await db.query(captured.slice(start, end));
  }
  await db.query(`
    alter table public.posts enable row level security;
    create policy fixture_posts on public.posts for select to authenticated using(public.can_view_post(id) and rls_allowed);
    alter table public.profiles enable row level security;
    create policy fixture_profiles on public.profiles for select to authenticated using(public.can_view_profile(id));
    alter table public.post_comments enable row level security;
    create policy fixture_comments on public.post_comments for select to authenticated using(public.can_view_post(post_id) and not hidden);
    ${sql('supabase/migrations/20261022211411_feed_snapshot_visibility.sql')}
    ${sql('supabase/migrations/20261102070343_feed_live_broadcast.sql')}
    insert into profiles(id,full_name,username) values('${owner}','Owner','owner'),('${viewer}','Viewer','viewer'),('${other}','Other','other');
    insert into posts(id,user_id,content) values('${post}','${owner}','Visible content'),('${privatePost}','${other}','Private content'),('${hiddenPost}','${owner}','RLS hidden');
    update profiles set profile_visibility='private' where id='${other}';
    update posts set rls_allowed=false where id='${hiddenPost}';
    ${claim(viewer)}
  `);
}
test('feed Broadcast SQL: capability, ACL, bounded state, coalescing, failures and heartbeat exclusion', { skip: !enabled }, async () => {
  try {
    await prepare();
    assert.equal(await db.query("select get_feed_live_capability()->>'enabled';"), 'false');
    assert.equal(await db.query('select count(*) from feed_live.pending;'), '0', 'disabled trigger path must not enqueue');
    await db.query("select drain_feed_live(1000);select configure_feed_live(true);");
    assert.equal(await db.query("select get_feed_live_capability()->>'enabled';"), 'true');
    await db.query(`insert into post_likes values('${post}','${viewer}'); update posts set likes_count=1,shares_count=null where id='${post}';
      insert into post_comments(id,post_id,user_id,body,created_at) values('${id(201)}','${post}','${viewer}','Authorized preview',now()-interval '2 seconds'),('${id(202)}','${post}','${owner}','Hidden preview',now());
      update post_comments set hidden=true where id='${id(202)}';`);
    const state = JSON.parse(await db.query(`set role authenticated;select coalesce(jsonb_agg(x),'[]') from get_feed_live_state(array['${post}','${privatePost}','${hiddenPost}']::uuid[]) x;reset role;`));
    assert.equal(state.length,1);assert.equal(state[0].post_id,post);assert.equal(state[0].viewer_liked,true);assert.equal(state[0].likes_count,1);assert.equal(state[0].shares_count,0);assert.equal(state[0].comment_body,'Authorized preview');
    await db.query(`insert into blocked_users values('${viewer}','${owner}');`);
    assert.equal(await db.query(`set role authenticated;select count(*) from get_feed_live_state(array['${post}']::uuid[]);reset role;`),'0');
    await db.query(`delete from blocked_users where blocker_id='${viewer}' and blocked_id='${owner}';`);
    await db.query(`insert into realtime.messages(topic,payload) values('feed:post:${post}','{}'),('feed:post:${privatePost}','{}'),('feed:post:${hiddenPost}','{}'),('unrelated:room','{}');`);
    assert.equal(await db.query('set role authenticated;select count(*) from realtime.messages;reset role;'), '2', 'broad other policy must not leak feed topics');
    assert.equal(await db.query("set request.jwt.claim.sub='';set role anon;select count(*) from realtime.messages;reset role;"), '1', 'broad anonymous policy can read only unrelated topics');
    await db.query(`do $$ begin
      begin set local role anon;insert into realtime.messages(topic,payload) values('feed:recovery:v1','{}');raise exception 'anonymous recovery forgery accepted';
      exception when insufficient_privilege then reset role;end;
    end $$;${claim(viewer)}`);
    assert.equal(await db.query(`set role authenticated;select can_receive_feed_live('feed:viewer:${viewer}'),can_receive_feed_live('feed:viewer:${other}');reset role;`),'t|f');
    await db.query(`do $$ begin
      begin set local role authenticated;insert into realtime.messages(topic,payload) values('feed:head:v1','{}');raise exception 'forged feed send accepted';
      exception when insufficient_privilege then reset role;end;
      begin perform get_feed_live_state(array_fill('${post}'::uuid,array[25]));raise exception 'oversized state request accepted';
      exception when invalid_parameter_value then null;end;
    end $$;`);
    await db.query('truncate feed_live.pending,fixture_broadcasts;');
    await db.query(`update profiles set last_seen=now() where id='${owner}';`);
    assert.equal(await db.query('select count(*) from feed_live.pending;'),'0','profile heartbeats must not invalidate feeds');
    await db.query(`update profiles set profile_visibility='private' where id='${owner}';`);
    assert.equal(await db.query("select string_agg(kind,',' order by kind) from feed_live.pending;"),'author,viewer');
    await db.query(`update profiles set profile_visibility='public' where id='${owner}';truncate feed_live.pending;`);
    await db.query(`do $$ begin for i in 1..2000 loop perform feed_live.enqueue('post','${post}');end loop;end $$;`);
    const rows=Number(await db.query('select count(*) from feed_live.pending;'));assert.ok(rows<=2,'one row per two-second bucket, not per interaction');
    await db.query(expire + 'select drain_feed_live(1000);');
    assert.equal(await db.query('select count(*) from fixture_broadcasts;'),'1','expired buckets for one post coalesce in one drain');
    const emitted=JSON.parse(await db.query('select row_to_json(x) from fixture_broadcasts x limit 1;'));
    assert.equal(emitted.private,true);assert.deepEqual(emitted.payload,{post_id:post});assert.equal(emitted.event,'invalidate');
    await db.query(`select feed_live.enqueue('post','${post}');${expire}set fixture.fail_send='on';select drain_feed_live(1000);set fixture.fail_send='off';`);
    assert.equal(await db.query('select count(*) from feed_live.pending;'),'1');assert.equal(await db.query("select get_feed_live_capability()->>'enabled';"),'false');
    await db.query(expire+'select drain_feed_live(1000);');assert.equal(await db.query('select count(*) from feed_live.pending;'),'0');
    await db.query(`select feed_live.enqueue('post','${post}');update feed_live.pending set queued_at=now()-interval '30 seconds';`);
    assert.equal(await db.query("select get_feed_live_capability()->>'enabled';"),'false','old backlog must not advertise healthy delivery');
    const degraded=JSON.parse(await db.query(`set role authenticated;select to_jsonb(x) from get_feed_live_state(array['${post}']::uuid[]) x;reset role;`));
    assert.equal(degraded.delivery_healthy,false,'authorized state remains available for bounded degraded recovery');
  } finally { await db?.close(); }
});

test('feed Broadcast SQL: stopped workers have bounded recovery shards and late outage commits still resync', { skip: !enabled }, async () => {
  let writer;
  try {
    await prepare(); writer = new LocalPsqlSession();
    await db.query("select drain_feed_live(1000);select configure_feed_live(true);update feed_live.settings set last_drain_at=now()-interval '1 hour';");
    await db.query(`update posts set likes_count=likes_count+1 where id='${post}';`);
    const generation = await db.query('select recovery_generation from feed_live.settings;');
    const transition = await db.query('select xmin::text from feed_live.settings;');
    // Each statement is a separate canonical transaction, not one DO block.
    await db.query(Array.from({ length: 1200 }, () => `update posts set likes_count=likes_count+1 where id='${post}';`).join('\n'));
    assert.equal(await db.query('select recovery_generation from feed_live.settings;'), generation);
    assert.equal(await db.query('select xmin::text from feed_live.settings;'), transition, 'normal outage activity never rewrites the settings singleton');
    assert.equal(await db.query("select count(*) from feed_live.pending where kind<>'recovery';"), '0');
    const markers = Number(await db.query('select count(*) from feed_live.pending;'));
    assert.ok(markers > 1 && markers <= 1024, 'one fixed marker per shard, independent of outage length');
    assert.equal(await db.query("select get_feed_live_capability()->>'enabled';"), 'false');
    assert.equal(await db.query(`select likes_count from posts where id='${post}';`), '1201', 'canonical writes continue during an outage');
    await db.query('select drain_feed_live(1000);select drain_feed_live(1000);');
    assert.equal(await db.query("select get_feed_live_capability()->>'enabled';"), 'true');
    const hints = JSON.parse(await db.query('select jsonb_agg(x) from fixture_broadcasts x;'));
    assert.ok(hints.length >= 1 && hints.length <= 2);
    hints.forEach(hint => { assert.deepEqual(hint.payload, {}); assert.equal(hint.event, 'resync'); assert.equal(hint.topic, 'feed:recovery:v1'); assert.equal(hint.private, true); });

    // Establish a committed outage transition before holding a later writer.
    await db.query(`truncate fixture_broadcasts;update feed_live.settings set last_drain_at=now()-interval '1 hour';update posts set likes_count=likes_count+1 where id='${post}';`);
    await writer.query(`begin;update posts set likes_count=likes_count+1 where id='${post}';`);
    await db.query('select drain_feed_live(1000);');
    assert.equal(await db.query('select count(*) from fixture_broadcasts;'), '1');
    await writer.query('commit;'); await db.query('select drain_feed_live(1000);');
    assert.equal(await db.query('select count(*) from fixture_broadcasts;'), '2', 'a final transaction committed after recovery still emits a new resync');
    await db.query(`update feed_live.settings set last_drain_at=now()-interval '1 hour';update posts set likes_count=likes_count+1 where id='${post}';select drain_feed_live(1000);truncate fixture_broadcasts;`);
    await writer.query(`begin;update feed_live.settings set last_drain_at=now()-interval '1 hour';update posts set likes_count=likes_count+1 where id='${post}';rollback;`);
    await db.query('select drain_feed_live(1000);');
    assert.equal(await db.query('select count(*) from fixture_broadcasts;'), '0', 'rolled-back outage activity never emits');
  } finally { await Promise.all([db, writer].filter(Boolean).map(session => session.close())); }
});

test('feed Broadcast SQL: late commits, slow send and rollback keep the final bucket without blocking current writes', { skip: !enabled }, async () => {
  let writer, drain, gate;
  try {
    await prepare();
    writer=new LocalPsqlSession();drain=new LocalPsqlSession();gate=new LocalPsqlSession();
    await db.query('select drain_feed_live(1000);select configure_feed_live(true);truncate feed_live.pending,fixture_broadcasts;');
    await db.query(`insert into feed_live.pending(topic,bucket,subject_id,kind,due_at) values('feed:post:${post}',-1,'${post}','post',now()-interval '1 second');`);
    await gate.query('select pg_advisory_lock(742001);');
    const drainPid=await drain.query('select pg_backend_pid();');
    const draining=drain.query("set fixture.slow_send='on';select drain_feed_live(1000);");
    for(let attempt=0;attempt<100;attempt++) {
      if(await db.query(`select cardinality(pg_blocking_pids(${drainPid}))>0;`)==='t') break;
      if(attempt===99)assert.fail('drain never reached the slow sender');
    }
    await writer.query(`begin;set local statement_timeout='1000ms';update public.posts set likes_count=likes_count+1 where id='${post}';commit;`);
    assert.equal(await db.query('select count(*) from feed_live.pending;'),'2','new bucket was accepted while the old send was blocked');
    await gate.query('select pg_advisory_unlock(742001);');await draining;
    assert.equal(await db.query('select count(*) from feed_live.pending;'),'1','the current bucket survives the previous drain');
    await db.query(expire+'select drain_feed_live(1000);');assert.equal(await db.query('select count(*) from fixture_broadcasts;'),'2');
    await writer.query(`begin;update public.posts set likes_count=likes_count+1 where id='${post}';${expire}`);
    await db.query('select drain_feed_live(1000);');
    await writer.query('commit;');await db.query('select drain_feed_live(1000);');
    assert.equal(await db.query('select count(*) from fixture_broadcasts;'),'3','a transaction committed after a drain must still emit');
    await writer.query(`begin;update public.posts set likes_count=likes_count+1 where id='${post}';rollback;`);
    await db.query(expire+'select drain_feed_live(1000);');assert.equal(await db.query('select count(*) from fixture_broadcasts;'),'3','rollback cannot publish an invalidation');
  } finally { await Promise.all([db,writer,drain,gate].filter(Boolean).map(session=>session.close())); }
});

test('feed Broadcast SQL: a writer waiting behind recovery uses safe lock order and creates a fresh recovery generation', { skip: !enabled }, async () => {
  let writer, drain, gate;
  try {
    await prepare(); writer = new LocalPsqlSession(); drain = new LocalPsqlSession(); gate = new LocalPsqlSession();
    await db.query('select drain_feed_live(1000);select configure_feed_live(true);');
    const writerPid = await writer.query('select pg_backend_pid();'), drainPid = await drain.query('select pg_backend_pid();');
    for (const previouslyRecovering of [false, true]) {
      await db.query(`truncate feed_live.pending,fixture_broadcasts;update feed_live.settings set recovery_required=${previouslyRecovering},recovery_generation=5,last_drain_at=now()-interval '1 hour';`);
      const shard = await writer.query('begin;set local statement_timeout=\'3s\';select txid_current()%1024;');
      await db.query(`insert into feed_live.pending(topic,bucket,kind,due_at) values('feed:recovery:${shard}',0,'recovery',now()-interval '1 second');`);
      await gate.query('select pg_advisory_lock(742001);');
      const draining = drain.query("set fixture.slow_send='on';select drain_feed_live(1000);");
      for (let i = 0; i < 100; i++) {
        if (await db.query(`select cardinality(pg_blocking_pids(${drainPid}))>0;`) === 't') break;
        if (i === 99) assert.fail('drain did not reach sender gate');
      }
      const writing = writer.query(`update posts set likes_count=likes_count+1 where id='${post}';commit;`);
      for (let i = 0; i < 100; i++) {
        if (await db.query(`select cardinality(pg_blocking_pids(${writerPid}))>0;`) === 't') break;
        if (i === 99) assert.fail('writer did not wait on its bounded recovery shard');
      }
      await gate.query('select pg_advisory_unlock(742001);'); await Promise.all([draining, writing]);
      assert.equal(await db.query('select recovery_generation from feed_live.settings;'), '6', 'a late writer cannot rely on the recovery flag it read before waiting');
      assert.equal(await db.query("select get_feed_live_capability()->>'enabled';"), 'false');
      await db.query('select drain_feed_live(1000);');
      assert.equal(await db.query('select count(*) from fixture_broadcasts;'), '2');
      assert.equal(await db.query("select get_feed_live_capability()->>'enabled';"), 'true');
    }
  } finally { await Promise.all([db, writer, drain, gate].filter(Boolean).map(session => session.close())); }
});
