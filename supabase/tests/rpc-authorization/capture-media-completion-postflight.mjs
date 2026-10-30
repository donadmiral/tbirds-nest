// Reconstruct catalog expectations locally; never connects to a hosted project.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { extensions } from './live-schema-fixture.mjs';
import { loadDeployedMediaBaseline, source } from './deployed-media-baseline.mjs';
const qa = process.argv.includes('--qa');
const db = new PGlite({ extensions });
try {
  assert.deepEqual(await loadDeployedMediaBaseline(db), { units: 25, repairs: 4 });
  await db.exec(await source('supabase/migrations/20261029224550_admin_operations_completion.sql'));
  if (qa) {
    const admin = await import('./qa-admin-baseline.mjs');
    const media = await import('./qa-media-baseline.mjs');
    await admin.installQaAdminBaseline(db);
    await media.installQaMediaBaseline(db);
    const before = await media.qaDataSnapshot(db);
    await db.exec(await source('supabase/ops/qa/20261029233252_qa_admin_completion_forward.sql'));
    await db.exec(await source('supabase/ops/qa/20261029233915_qa_media_completion_forward.sql'));
    await db.exec(await source('supabase/migrations/20261029224812_account_storage_erasure.sql'));
    await db.exec(await source('supabase/migrations/20261029231321_account_erasure_admin_review_queue.sql'));
    assert.deepEqual(await media.qaDataSnapshot(db), before);
  } else {
    for (const name of ['20261029224812_account_storage_erasure', '20261029224813_private_media_cutover_compatibility',
      '20261029231321_account_erasure_admin_review_queue', '20261029231440_bounded_media_delivery'])
      await db.exec(await source(`supabase/migrations/${name}.sql`));
  }
  const { postflight } = (await db.query(await source('supabase/ops/check-media-completion-postflight.sql'))).rows[0];
  assert.equal(postflight.observations.unfencedApplicationTables, 0);
  assert.equal(postflight.observations.workerConfigured, false);
  assert.equal(postflight.observations.workerHealthy, false);
  assert.deepEqual(postflight.observations.queueStates, []);
  for (const table of postflight.catalog.privateTables) {
    assert.equal(table.rls, true);
    assert.equal(table.anonAccess, false);
    assert.equal(table.appAccess, false);
    assert.equal(table.serviceDirectAccess, false);
  }
  const path = `docs/quality/${qa ? 'QA_' : 'PRODUCTION_'}MEDIA_COMPLETION_EXPECTED_20261029.json`;
  await writeFile(new URL(`../../../${path}`, import.meta.url), JSON.stringify({
    source: 'Expected catalog from an isolated local PostgreSQL reconstruction; this is not a hosted postflight result.',
    mode: qa ? 'qa' : 'production',
    compare: 'Before later database-hardening projections, compare catalog membership and values exactly after ordinal-key sorting: functions by signature, policies by name, privateTables by schema/table, triggers by table/name, schemas by name. PGlite/hosted collation can change array order without catalog drift. Observations include synthetic counts, not hosted data.',
    ...postflight,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ path, functions: postflight.catalog.functions.length, policies: postflight.catalog.policies.length,
    privateTables: postflight.catalog.privateTables.length, preservedQaRows: qa, assertions: 'passed' }));
} finally {
  await db.close();
}
