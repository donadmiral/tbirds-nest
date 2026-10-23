const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || './rpc-authorization/node_modules/@electric-sql/pglite');
let db;
const user = '10000000-0000-4000-8000-000000000001';
test.before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;`);
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/00000000000111_client_errors.sql'), 'utf8'));
  // Match the initial exposed-schema defaults; the migration must revoke these grants.
  await db.exec('grant all on client_errors to anon, authenticated');
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261023185734_redacted_client_diagnostics.sql'), 'utf8');
  await db.exec(migration); await db.exec(migration);
});
test.beforeEach(() => db.exec('truncate client_errors'));
test.after(() => db.close());
async function asUser(sql, args = [], role = 'authenticated', uid = user) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? '']);
    const result = await db.query(sql, args); await db.exec('commit'); return result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const report = (value, ...rest) => asUser('select report_client_error($1::jsonb) as accepted', [JSON.stringify(value)], ...rest).then(result => result.rows[0].accepted);
test('raw table writes and reads are denied to both client roles', async () => {
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(asUser("insert into client_errors(message) values('private')", [], role), /permission denied/);
    await assert.rejects(asUser('select * from client_errors', [], role), /permission denied/);
  }
});
test('the RPC requires authenticated identity and cannot accept a caller supplied user ID or raw diagnostic strings', async () => {
  await assert.rejects(report({}, 'anon'), /permission denied/);
  await assert.rejects(report({}, 'authenticated', null), /Authentication required/);
  assert.equal(await report({ category: 'TypeError', source: 'render', platform: 'web', appVersion: '1.2.3', fatal: true,
    user_id: 'forged', message: 'secret', stack: 'secret', context: { password: 'secret' } }), true);
  const row = (await db.query('select * from client_errors')).rows[0];
  assert.equal(row.user_id, user); assert.equal(row.message, 'TypeError'); assert.equal(row.stack, null);
  assert.deepEqual(row.context, { version: 1, source: 'render', fatal: true });
  assert.doesNotMatch(JSON.stringify(row), /secret|forged/);
});
test('unknown category and source values are replaced and oversized payloads never persist', async () => {
  assert.equal(await report({ category: 'secret', source: 'secret', platform: 'secret', appVersion: 'secret' }), true);
  const row = (await db.query('select * from client_errors')).rows[0];
  assert.equal(row.message, 'UnknownError'); assert.equal(row.platform, 'unknown'); assert.equal(row.app_version, null);
  assert.equal(await report({ message: 'a'.repeat(3000) }), false);
  assert.equal((await db.query('select count(*)::int as n from client_errors')).rows[0].n, 1);
});
test('duplicate and per-account volume limits also apply outside the official clients', async () => {
  const item = { category: 'Error', platform: 'web', source: 'render' };
  assert.equal(await report(item), true); assert.equal(await report(item), false);
  for (const category of ['TypeError','RangeError','ReferenceError','SyntaxError','URIError','EvalError','AbortError','TimeoutError','NetworkError']) {
    assert.equal(await report({ ...item, category }), true);
  }
  assert.equal(await report({ ...item, category: 'AuthError' }), false);
});
test('budgets are isolated by verified user and the private implementation cannot bypass identity checks', async () => {
  for (const category of ['Error','TypeError','RangeError','ReferenceError','SyntaxError','URIError','EvalError','AbortError','TimeoutError','NetworkError']) {
    assert.equal(await report({ category }), true);
  }
  assert.equal(await report({ category: 'AuthError' }), false);
  assert.equal(await report({ category: 'AuthError', user_id: user }, 'authenticated', '10000000-0000-4000-8000-000000000002'), true);
  await assert.rejects(asUser("select private.report_client_error('{}')", [], 'anon'), /permission denied/);
  await assert.rejects(asUser("select private.report_client_error('{}')", [], 'authenticated', null), /Authentication required/);
  const owners = (await db.query('select user_id,count(*)::int as n from client_errors group by user_id order by user_id')).rows;
  assert.deepEqual(owners.map(row => row.n), [10, 1]);
});
