#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createSession, source, manifest, sourceCommit, outputReport } = require('./local-capacity-db.cjs');
const { runWorkload, distribution } = require('./bounded-workload.cjs');
const { fixture, id } = require('../../supabase/tests/feed-scale-fixture.cjs');
const migrations = [
  'supabase/migrations/20261102090625_exact_feed_hydration_and_narrow_ranking.sql',
  'supabase/migrations/20261102092828_indexed_feed_rank_frontier.sql',
  'supabase/migrations/20261102175247_feed_catalog_inline_visibility.sql',
  'supabase/migrations/20261102180219_feed_frontier_defer_partial_scoring.sql',
  'supabase/migrations/20261105045938_deterministic_feed_author_ties.sql',
  'supabase/migrations/20261105044917_prepared_feed_snapshots.sql',
  'supabase/migrations/20261105051142_prepared_feed_narrow_ranking.sql',
  'supabase/migrations/20261105051152_prepared_feed_single_snapshot_rank.sql',
  'supabase/migrations/20261105051338_prepared_feed_bounded_hydration.sql',
  'supabase/migrations/20261105051457_prepared_feed_client_capability_gate.sql',
  'supabase/migrations/20261105052419_feed_catalog_point_visibility.sql',
];
const ACTORS = 16, POSTS = 25000, WORKERS = 8;
const actors = Array.from({ length: ACTORS }, (_, i) => id(100 + i));
const privatePosts = new Map(actors.map((actor, i) => [id(900000 + i), actor]));
function authenticate(actor, session = actor) {
  // All values come from deterministic, local fixture IDs.
  return `reset role;select set_config('request.jwt.claim.sub','${actor}',false) is not null;
    select set_config('request.headers','{"x-client-info":"supabase-js/2 platinum-cache/1"}',false) is not null;
    select set_config('request.jwt.claims',jsonb_build_object('sub','${actor}','role','authenticated',
      'session_id','${session}','exp',floor(extract(epoch from now()))+3600)::text,false) is not null;set role authenticated;`;
}
const feedSql = "select coalesce(jsonb_agg(r),'[]') from get_feed('for_you',null,null,20) r";
async function readFeed(db, actor) {
  // SET/SELECT command results are discarded before measuring the real RPC.
  await db.query(authenticate(actor));
  const raw = await db.query(feedSql);
  return { rows: JSON.parse(raw), bytes: Buffer.byteLength(raw) };
}
function validateCards(rows, actor, requirePrepared = false) {
  assert.equal(rows.length, 20);
  assert.equal(new Set(rows.map(row => row.post_id)).size, rows.length);
  assert.ok(rows.some(row => privatePosts.get(row.post_id) === actor), 'Owner-only sentinel must remain visible to its owner');
  for (const row of rows) {
    assert.ok(!privatePosts.has(row.post_id) || privatePosts.get(row.post_id) === actor, 'Cross-account private card');
    assert.ok(Array.isArray(row.media), 'The RPC must hydrate complete media arrays');
    if (requirePrepared) assert.ok(row.sort_key < -4000000000000000, 'The read must use prepared ranking');
  }
}

async function run(output = process.argv[2]) {
  if (process.env.PGDATABASE !== 'pc_scale_foundation_feed') throw Error('Use disposable pc_scale_foundation_feed');
  const admin = createSession(), maintenance = createSession();
  let workers = [], timer, maintenanceRun, maintenanceFailure;
  const report = { version: 1, kind: 'isolated-prepared-feed-load', sourceCommit: sourceCommit(), measuredAt: new Date().toISOString(),
    posts: POSTS, authenticatedActors: ACTORS, workers: WORKERS, providerCalls: 0,
    clientCapability: 'platinum-cache/1',
    sourceFiles: manifest([...migrations, 'supabase/tests/feed-scale-fixture.cjs', 'supabase/tests/engagement-counter-fixture.cjs',
      'tools/performance/production-read-indexes.sql', 'tools/performance/production-read-indexes-20261105.json']),
    productionCapacityEstablished: false, passed: false, phase: 'setup', phaseTimings: [] };
  const began = performance.now();
  function checkpoint(phase, details = {}) {
    report.phase = phase;
    report.phaseTimings.push({ phase, elapsedMs: performance.now() - began, ...details });
    if (output) outputReport(report, output);
  }
  try {
    checkpoint('fixture_setup');
    // Cancel expensive setup/background work inside PostgreSQL before the
    // client watchdog. A closed psql process alone need not stop its query.
    await admin.query("set statement_timeout='30s';");
    await maintenance.query("set statement_timeout='30s';");
    await admin.query("set client_min_messages='warning';drop schema if exists prepared_feed,feed_ranking,post_counter_internal,auth,public cascade;create schema public");
    await admin.query(fixture);
    await admin.query(`create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      grant execute on function auth.jwt() to authenticated,anon,service_role;
      insert into posts(id,user_id,content,body,created_at,likes_count,comments_count,reposts_count,channel)
      select ('10000000-0000-4000-8000-'||lpad((30000+n)::text,12,'0'))::uuid,
        ('10000000-0000-4000-8000-'||lpad((100+n%1000)::text,12,'0'))::uuid,
        'Capacity fixture '||n,repeat('bounded article ',120),now()-make_interval(hours=>n%1000,secs=>n),
        n%117,n%19,n%9,case when n%4=0 then 'innovation' else 'home' end
      from generate_series(1,${POSTS}) n;
      insert into post_media(id,post_id,url,media_type,width,height,sort_order,is_sensitive,alt_text,edit)
      select ('10000000-0000-4000-8000-'||lpad((100000+n)::text,12,'0'))::uuid,
        ('10000000-0000-4000-8000-'||lpad((30000+n)::text,12,'0'))::uuid,
        'https://example.invalid/capacity/'||n||'.jpg','image',640,480,0,false,'Fixture','{}'
      from generate_series(1,${POSTS}) n where n%3=0;
      insert into follows select a.id,p.id from profiles a cross join profiles p
      where a.id in (${actors.map(actor => `'${actor}'`).join(',')}) and p.id in (select id from profiles order by id limit 100)
        and a.id<>p.id;
      insert into posts(id,user_id,content,audience,created_at,likes_count)
      values ${[...privatePosts].map(([post, actor]) => `('${post}','${actor}','Owner-only capacity sentinel','mentioned',now()-interval '2 minutes',999999)`).join(',')};`);
    await admin.query(source('tools/performance/production-read-indexes.sql'));
    for (const file of migrations) await admin.query(source(file));
    await admin.query('select configure_indexed_feed_v1(true);analyze;');
    report.equalTimestampFixture = await admin.json(`select a.created_at=b.created_at from posts a cross join posts b where a.id='${id(1)}' and b.id='${id(2)}'`);
    assert.equal(report.equalTimestampFixture, true, 'Keep the original tied fixture that exposed the slow fallback');
    report.totalPosts = Number(await admin.query('select count(*) from posts'));
    report.readIndexes = await admin.json("select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',indexname,'definition',indexdef) order by schemaname,tablename,indexname) from pg_indexes where schemaname in ('public','feed_ranking','prepared_feed')");
    report.database = await admin.json("select jsonb_build_object('version',version(),'local_socket',inet_server_addr() is null,'max_connections',current_setting('max_connections'),'shared_buffers',current_setting('shared_buffers'),'work_mem',current_setting('work_mem'),'database_bytes',pg_database_size(current_database()))");
    assert.equal(report.database.local_socket, true);
    checkpoint('initial_frontier');
    for (let n = 0; n < WORKERS; n++) { const db = createSession(); workers.push(db); await db.query("set statement_timeout='3s';"); }
    await workers[0].query(authenticate(actors[0]));
    report.initialFrontier = await workers[0].json("select feed_ranking.select_page('for_you',null,null,20)");
    assert.equal(report.initialFrontier.fallback, false, 'Equal timestamps must use the bounded frontier after the tie migration');
    report.initialFrontier = { candidates: report.initialFrontier.candidates, days: report.initialFrontier.days, fallback: false };
    checkpoint('unprepared_reads');
    const cold = [];
    for (let i = 0; i < ACTORS; i++) {
      const at = performance.now(), result = await readFeed(workers[i % WORKERS], actors[i]);
      validateCards(result.rows, actors[i]); cold.push(performance.now() - at);
    }
    report.unpreparedFirstReadsMs = distribution(cold);
    checkpoint('enqueue_preparation');
    await admin.query('select configure_prepared_feed_v1(true);');
    for (let i = 0; i < ACTORS; i++) await readFeed(workers[i % WORKERS], actors[i]);
    const prepStart = performance.now(); let prepared = 0;
    for (let batch = 0; batch < ACTORS; batch++) {
      checkpoint('prepare_batch', { batch, completedSnapshots: prepared });
      const drain = await maintenance.json('select drain_prepared_feed_v1(4)');
      assert.equal(drain.failed, 0); prepared += drain.prepared;
      if (prepared >= ACTORS) break;
    }
    assert.equal(prepared, ACTORS);
    report.initialPreparation = { snapshots: prepared, elapsedMs: performance.now() - prepStart };
    checkpoint('prepared_readback');
    for (let i = 0; i < ACTORS; i++) validateCards((await readFeed(workers[i % WORKERS], actors[i])).rows, actors[i], true);

    // A reader must remain responsive while another connection owns the worker's demand lock.
    checkpoint('worker_lock_read');
    await admin.query(`begin;select viewer_id from prepared_feed.demand where viewer_id='${actors[0]}' for update;`);
    try {
      const at = performance.now();
      validateCards((await readFeed(workers[0], actors[0])).rows, actors[0], true);
      report.workerLockReadMs = performance.now() - at;
      assert.ok(report.workerLockReadMs < 500, 'Demand lock must not delay the client read');
    } finally { await admin.query('rollback'); }

    // Keep the actual bounded worker running across the 60-second soak and TTL rollover.
    let drainedDuringLoad = 0;
    timer = setInterval(() => {
      if (maintenanceRun) return;
      maintenanceRun = maintenance.json('select drain_prepared_feed_v1(4)').then(row => {
        if (row.failed) throw Error('Prepared worker failed');
        drainedDuringLoad += row.prepared;
      }).catch(error => { maintenanceFailure = error; }).finally(() => { maintenanceRun = null; });
    }, 5000);
    const operation = async ({ workerId, sequence }) => {
      if (maintenanceFailure) throw maintenanceFailure;
      const actor = actors[sequence % ACTORS];
      const result = await readFeed(workers[workerId], actor);
      validateCards(result.rows, actor, true);
      return { bytes: result.bytes };
    };
    checkpoint('steady_workload');
    report.steady = await runWorkload({ seconds: 30, rate: 20, concurrency: WORKERS, maxP95Ms: 500 }, operation);
    checkpoint('soak_workload');
    report.soak = await runWorkload({ seconds: 60, rate: 10, concurrency: WORKERS, maxP95Ms: 500 }, operation);
    clearInterval(timer); timer = null;
    if (maintenanceRun) await maintenanceRun;
    if (maintenanceFailure) throw maintenanceFailure;
    report.preparedDuringLoad = drainedDuringLoad;
    assert.ok(drainedDuringLoad > 0, 'The soak must cross a real preparation refresh');

    // Recreate every client connection together, retaining account boundaries.
    checkpoint('reconnect');
    await Promise.all(workers.map(db => db.close())); workers = [];
    const reconnectAt = performance.now();
    const reconnected = await Promise.all(Array.from({ length: WORKERS }, async (_, i) => {
      const db = createSession(); workers.push(db); await db.query("set statement_timeout='3s';");
      const result = await readFeed(db, actors[i]); validateCards(result.rows, actors[i]); return result.rows.length;
    }));
    report.reconnect = { sessions: WORKERS, elapsedMs: performance.now() - reconnectAt, completedReads: reconnected.length, missing: 0, crossAccountRows: 0 };
    assert.ok(report.reconnect.elapsedMs < 5000);

    checkpoint('live_revocation');
    const privatePost = [...privatePosts][0][0];
    await admin.query(`insert into hidden_posts(user_id,post_id) values('${actors[0]}','${privatePost}')`);
    const revoked = await readFeed(workers[0], actors[0]);
    assert.equal(revoked.rows.some(row => row.post_id === privatePost), false);
    assert.equal(revoked.rows.length, 20);
    report.liveRevocationRechecked = true;
    report.preparedStatus = await admin.json('select prepared_feed_status_v1()');
    report.passed = report.steady.passed && report.soak.passed;
    report.limitations = ['Direct authenticated PostgreSQL RPC calls over a local Unix socket, not HTTP or Supabase Realtime.',
      'The 60-second bounded soak is a regression gate, not a day-long production capacity certification.',
      'Fixture actor and row counts do not establish a supported DAU count. No hosted capacity or spend was changed.'];
    checkpoint('complete');
    return report;
  } catch (error) {
    report.failure = { phase: report.phase, code: /^[A-Za-z0-9_]{1,40}$/.test(error?.code || '') ? error.code : 'operation_failed' };
    if (output) outputReport(report, output);
    throw error;
  } finally {
    if (timer) clearInterval(timer);
    if (maintenanceRun) await maintenanceRun;
    await Promise.allSettled([...workers, maintenance, admin].map(db => db.close()));
  }
}
if (require.main === module) run().then(report => { outputReport(report, process.argv[2]); if (!report.passed) process.exitCode = 1; }).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run, validateCards, authenticate };
