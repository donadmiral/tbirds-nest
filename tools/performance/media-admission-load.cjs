#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createSession, source, manifest, sourceCommit, outputReport } = require('./local-capacity-db.cjs');
const { distribution } = require('./bounded-workload.cjs');
const migrations = [
  'supabase/tests/media-processing-fixture.sql',
  'supabase/migrations/20261102071532_durable_media_processing_v1.sql',
  'supabase/migrations/20261102090521_adaptive_media_renditions_v2.sql',
  'supabase/migrations/20261105044918_adaptive_media_admission_backfill_v2.sql',
];
const id = n => '40000000-0000-4000-8000-' + String(n).padStart(12, '0');
const owner = id(1), JOBS = 64, WORKERS = 16, LIMIT = 4;
const service = "set request.jwt.claims='{\"role\":\"service_role\"}';";
const finish = (db, job, outcome = 'failed') => db.json(`select finish_media_rendition_v2('${job.job_id}','${job.lease_id}',${job.attempt},'${outcome}',null,'isolated_capacity_fixture')`);

async function run() {
  if (process.env.PGDATABASE !== 'pc_scale_foundation_media') throw Error('Use disposable pc_scale_foundation_media');
  const admin = createSession(), workers = [];
  const began = performance.now();
  const report = { version: 1, kind: 'isolated-media-admission-load', sourceCommit: sourceCommit(), measuredAt: new Date().toISOString(),
    sourceFiles: manifest(migrations), jobs: JOBS, competingSessions: WORKERS, configuredLeaseLimit: LIMIT,
    providerCalls: 0, encoderThroughputMeasured: false, productionCapacityEstablished: false, passed: false };
  try {
    await admin.query("set client_min_messages='warning';drop schema if exists media_renditions,media_processing,media_delivery,storage,auth,extensions,public cascade;create schema public");
    for (const file of migrations) await admin.query(source(file));
    await admin.query(service + `insert into auth.users(id) values('${owner}');
      insert into storage.objects(id,bucket_id,name,version,owner_id,metadata)
      select ('40000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,'story-media',
       '${owner}/source-'||n||'.mp4','source-v1','${owner}','{"size":1048576,"eTag":"fixture"}'::jsonb from generate_series(1,${JOBS}) n;
      insert into stories(id,user_id,media_url)
      select ('40000000-0000-4000-8000-'||lpad((2000+n)::text,12,'0'))::uuid,'${owner}',
       'https://fixture.test/storage/v1/object/public/story-media/${owner}/source-'||n||'.mp4' from generate_series(1,${JOBS}) n;
      insert into content_media_bindings(entity_kind,entity_id,bucket_id,object_path,uploader_id)
      select 'story',('40000000-0000-4000-8000-'||lpad((2000+n)::text,12,'0'))::uuid,'story-media',
       '${owner}/source-'||n||'.mp4','${owner}' from generate_series(1,${JOBS}) n;`);
    assert.equal(Number(await admin.query('select count(*) from media_renditions.jobs')), 0);
    const preview = await admin.json('select backfill_media_renditions_v2(null,100,true)');
    assert.equal(preview.eligible, JOBS);
    assert.equal(Number(await admin.query('select count(*) from media_renditions.jobs')), 0);
    await admin.query(`update media_renditions.settings set admission_enabled=true,worker_enabled=true,concurrency=${LIMIT}`);
    const enrolled = await admin.json('select backfill_media_renditions_v2(null,100,false)');
    assert.equal(enrolled.admitted, JOBS);
    assert.equal((await admin.json('select backfill_media_renditions_v2(null,100,false)')).admitted, 0);
    for (let n = 0; n < WORKERS; n++) {
      const db = createSession(); workers.push(db);
      await db.query(service + "set statement_timeout='3s';");
    }
    const latencies = [];
    async function burst() {
      return (await Promise.all(workers.map(async db => {
        const at = performance.now();
        const raw = await db.query('select claim_media_rendition_v2()');
        latencies.push(performance.now() - at);
        return raw ? JSON.parse(raw) : null;
      }))).filter(Boolean);
    }
    let active = await burst();
    assert.equal(active.length, LIMIT, 'The global semaphore must reject excess concurrent claims');
    assert.equal(new Set(active.map(job => job.job_id)).size, LIMIT);
    assert.equal(Number(await admin.query("select count(*) from media_renditions.jobs where state='processing'")), LIMIT);
    const expired = active[0];
    await admin.query(`update media_renditions.jobs set lease_until=clock_timestamp()-interval '1 second' where id='${expired.job_id}'`);
    const replacement = await burst();
    assert.equal(replacement.length, 1);
    assert.equal(replacement[0].job_id, expired.job_id);
    assert.notEqual(replacement[0].lease_id, expired.lease_id);
    assert.equal(await finish(admin, expired), false, 'An expired worker must never finish the replacement lease');
    active[0] = replacement[0];
    await admin.query('update media_renditions.settings set emergency_revoke=true');
    assert.equal((await burst()).length, 0);
    assert.equal(await admin.json(`select check_media_rendition_v2('${active[0].job_id}','${active[0].lease_id}',${active[0].attempt})`), false);
    await admin.query('update media_renditions.settings set emergency_revoke=false');
    let completed = 0, rounds = 0, peakLeases = active.length;
    while (active.length) {
      if (++rounds > JOBS) throw Error('Bounded admission drain did not converge');
      const finished = await Promise.all(active.map((job, index) => finish(workers[index], job)));
      assert.ok(finished.every(Boolean)); completed += active.length;
      active = await burst();
      peakLeases = Math.max(peakLeases, active.length);
      assert.ok(active.length <= LIMIT);
      assert.equal(new Set(active.map(job => job.job_id)).size, active.length);
    }
    assert.equal(completed, JOBS);
    assert.equal(Number(await admin.query("select count(*) from media_renditions.jobs where state in ('pending','processing','retry')")), 0);
    assert.equal(Number(await admin.query('select count(*) from media_renditions.publications')), 0);
    assert.equal(Number(await admin.query('select count(*) from storage.objects')), JOBS, 'Original source objects must remain intact');
    Object.assign(report, { passed: true, preview, enrolled, completedControlledFailures: completed, peakLeases,
      expiredLeaseFenced: true, emergencyStopEnforced: true, duplicateEnrollmentPrevented: true,
      claimCalls: latencies.length, claimLatencyMs: distribution(latencies),
      elapsedMs: performance.now() - began, sourceObjectsRetained: JOBS,
      limitations: ['Measures SQL admission and lease control only, not encoding, Storage transfer, CDN delivery, or provider quotas.',
        'Jobs intentionally finish as failed without uploading media. These are controlled failure-path checks, not produced renditions.'] });
    return report;
  } finally { await Promise.allSettled([...workers, admin].map(db => db.close())); }
}
if (require.main === module) run().then(report => outputReport(report, process.argv[2])).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
