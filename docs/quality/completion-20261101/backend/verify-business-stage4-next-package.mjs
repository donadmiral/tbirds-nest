// Offline acceptance of the source-bound request and read-only success checker.
// All writes below target an isolated PGlite fixture, never hosted Supabase.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {extensions} from '../../../../supabase/tests/rpc-authorization/live-schema-fixture.mjs';
import {loadBusinessAuthBaseline} from '../../../../supabase/tests/rpc-authorization/business-auth-fixture.mjs';

const root = new URL('../../../../', import.meta.url);
const here = new URL('./', import.meta.url);
const fixtureRequire = createRequire(new URL('supabase/tests/rpc-authorization/package.json', root));
const {PGlite} = fixtureRequire('@electric-sql/pglite');
const read = path => readFile(new URL(path, root), 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const request = JSON.parse(await readFile(new URL('business-stage4-next-apply-request.json', here), 'utf8'));
const packaged = JSON.parse(await readFile(new URL('business-stage4-next-apply-package.json', here), 'utf8'));
const source = await read(packaged.source.path);
const postflight = await readFile(new URL('business-stage4-success-postflight.sql', here), 'utf8');
const manifest = JSON.parse(await read('supabase/ops/qa/business-auth-staged-20261031/candidate.json'));
const db = new PGlite({extensions});
const checks = [];
const check = async (name, action) => { await action(); checks.push(name); };
const observe = async () => {
  const results = await db.exec(postflight);
  const rows = results.flatMap(result => result.rows ?? []);
  assert.equal(rows.length, 1);
  return rows[0].postflight;
};

try {
  await check('request preserves exact reviewed query bytes, QA project and official confirmation classification', async () => {
    assert.deepEqual(Object.keys(request).sort(), ['name', 'project_id', 'query']);
    assert.equal(request.project_id, 'uaulhuelcfkjwojtymmw');
    assert.equal(request.name, 'qa_business_auth_04_private_member_signin_20261101');
    assert.equal(request.query, source);
    assert.equal(sha256(source), packaged.source.sha256);
    assert.equal(Buffer.byteLength(source), packaged.source.bytes);
    assert.equal(packaged.requiresDestructiveConfirmation, manifest.stages[3].requiresDestructiveConfirmation);
    assert.equal(packaged.requiresDestructiveConfirmation, true);
    for (const file of packaged.files) {
      const bytes = await readFile(new URL(file.path, root));
      assert.equal(bytes.length, file.bytes);
      assert.equal(sha256(bytes), file.sha256);
    }
  });
  await loadBusinessAuthBaseline(db, true, true);
  await db.exec('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])');
  for (const stage of manifest.stages.slice(0, 3)) await db.exec(await read(stage.path));
  await check('known private stage 3 returns not installed without invoking an application function', async () => {
    const result = await observe();
    assert.equal(result.fingerprint, manifest.stages[2].expectedAfterFingerprint);
    assert.equal(result.stage4Installed, false);
    assert.equal(result.targetFunction, null);
  });
  await db.exec(source);
  await check('a stage 4 catalog without the provider migration record is not accepted', async () => {
    const result = await observe();
    assert.equal(result.fingerprint, manifest.stages[3].expectedAfterFingerprint);
    assert.equal(result.stage4Installed, false);
  });
  await db.query('insert into supabase_migrations.schema_migrations values($1,$2,$3)', ['fixture-stage4', request.name, [source]]);
  await check('the exact private stage 4 plus source-identical journal passes all installation gates', async () => {
    const result = await observe();
    assert.equal(result.stage4Installed, true);
    assert.equal(result.catalog_rows, 100);
    assert.equal(result.targetFunction.bodyMd5, packaged.source.bodyMd5);
    assert.equal(result.candidateMigrationJournal[0].querySha256, packaged.source.sha256);
    assert.equal(result.private_table_access, 0);
    assert.equal(result.private_function_access, 0);
    assert.equal(result.private_schema_access, 0);
  });
  await db.exec('grant execute on function business_auth.triniti_business_signin_check(text,text,text,text,text) to anon');
  await check('an unreviewed execute grant fails installation acceptance', async () => {
    assert.equal((await observe()).stage4Installed, false);
  });
  await db.exec('revoke execute on function business_auth.triniti_business_signin_check(text,text,text,text,text) from anon');
  await db.query('update supabase_migrations.schema_migrations set statements=$1', [[source + '\n-- changed journal bytes\n']]);
  await check('a source-different migration journal fails despite an unchanged installed function', async () => {
    const result = await observe();
    assert.equal(result.fingerprint, manifest.stages[3].expectedAfterFingerprint);
    assert.equal(result.stage4Installed, false);
  });
  await db.query('update supabase_migrations.schema_migrations set statements=$1', [[source]]);
  await db.exec("alter role authenticator set pgrst.db_pre_request='public.unreviewed_guard'");
  await check('an unexpected public activation hook fails the private-stage gate', async () => {
    assert.equal((await observe()).stage4Installed, false);
  });
  const receipt = {
    formatVersion: 1,
    completedAtUtc: new Date().toISOString(),
    scope: 'Isolated actual SQL fixture; no provider request, hosted mutation, Auth issuance or external acceptance.',
    checksPassed: checks.length,
    checks,
    allPassed: true,
    sourceSha256: packaged.source.sha256,
    postflightSha256: sha256(postflight),
    sourceUnchanged: true,
    liveMigrationHistoryWasNotModified: true,
  };
  await writeFile(new URL('business-stage4-next-package-local-verification.json', here), JSON.stringify(receipt, null, 2) + '\n');
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
} finally {
  await db.close();
}
