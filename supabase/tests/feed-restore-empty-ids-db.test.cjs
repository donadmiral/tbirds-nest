const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || './rpc-authorization/node_modules/@electric-sql/pglite');

const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/feed-restore-before-empty-fast-path.json'), 'utf8')).definition.join('\n');
const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261105210937_feed_restore_empty_ids_fast_path.sql'), 'utf8');
const viewer = '10000000-0000-4000-8000-000000000101';
const post = '10000000-0000-4000-8000-000000000001';
const guard = '   if coalesce(cardinality(p_ids),0)=0 then return; end if;\n';
let db, original, installed, originalEmptyError;

async function metadata() {
  return (await db.query(`select to_jsonb(p)-'prosrc' attributes, p.prosrc body,
    md5(p.prosrc) body_md5, pg_get_functiondef(p.oid) definition,
    obj_description(p.oid,'pg_proc') description
    from pg_proc p where p.oid='public.get_feed_rows_by_ids_v1(uuid[])'::regprocedure`)).rows[0];
}

async function read(ids, user = viewer, role = 'authenticated') {
  assert.ok(['authenticated', 'anon', 'service_role'].includes(role));
  await db.exec('begin');
  try {
    await db.exec('set local role ' + role);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user || '']);
    const result = await db.query('select * from public.get_feed_rows_by_ids_v1($1::uuid[])', [ids]);
    await db.exec('commit');
    return result.rows;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

before(async () => {
  db = new PGlite();
  // There are deliberately no feed tables or enrichment functions. An empty
  // call must finish before PostgreSQL plans or accesses any of those relations.
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create role feed_restore_owner;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth, public to authenticated,anon,service_role;
    grant execute on function auth.uid() to authenticated,anon,service_role;`);
  await db.exec(baseline);
  await db.exec(`alter function public.get_feed_rows_by_ids_v1(uuid[]) owner to feed_restore_owner;
    revoke all on function public.get_feed_rows_by_ids_v1(uuid[]) from public,anon;
    grant execute on function public.get_feed_rows_by_ids_v1(uuid[]) to authenticated,service_role;
    comment on function public.get_feed_rows_by_ids_v1(uuid[]) is 'Preserve this function metadata';`);
  original = await metadata();
  assert.equal(original.body_md5, '45186117b2564f3321ba6cd2a718e9b0', 'Fixture is the exact inspected hosted body');
  try { await read([]); } catch (error) { originalEmptyError = error; }
  assert.equal(originalEmptyError?.code, '42P01', 'The original empty call enters the query and requires feed relations');
  await db.exec(migration);
  installed = await metadata();
});
after(async () => { if (db) await db.close(); });

test('migration inserts only the guard and preserves identity, attributes, owner, grants and comment', () => {
  assert.equal(installed.body.split(guard).length, 2);
  assert.equal(installed.body.replace(guard, ''), original.body);
  assert.deepEqual(installed.attributes, original.attributes);
  assert.equal(installed.description, original.description);
  assert.equal(installed.attributes.prosecdef, false);
  assert.equal(installed.attributes.provolatile, 's');
  assert.deepEqual(installed.attributes.proconfig, ['search_path=public']);
});

test('authenticated empty and null IDs return no rows without planning feed relations', async () => {
  assert.deepEqual(await read([]), []);
  assert.deepEqual(await read(null), []);
});

test('missing identity still fails before empty, null and oversized input handling', async () => {
  for (const ids of [[], null, Array(101).fill(post)]) {
    await assert.rejects(read(ids, null), { code: '42501', message: 'Authentication required' });
  }
});

test('anonymous callers retain the original execute denial', async () => {
  for (const ids of [[], null, [post]]) {
    await assert.rejects(read(ids, null, 'anon'), { code: '42501' });
  }
});

test('the 100-ID limit is unchanged and still runs before card planning', async () => {
  await assert.rejects(read(Array(101).fill(post)), {
    code: '22023', message: 'At most 100 post IDs can be restored',
  });
  await assert.rejects(read(Array(100).fill(post)), { code: '42P01' });
});

test('nonempty input including null elements still reaches the unchanged card query', async () => {
  for (const ids of [[post], [null]]) {
    await assert.rejects(read(ids), { code: '42P01' });
  }
});

test('an unrecognized baseline aborts without changing the installed function or metadata', async () => {
  const driftedBody = original.body + '\n-- unrelated future change\n';
  await db.exec(original.definition.replace(original.body, driftedBody));
  const beforeRejected = await metadata();
  await assert.rejects(db.exec(migration), /FEED_RESTORE_EMPTY_BASELINE_REQUIRED/);
  await db.exec('rollback');
  assert.deepEqual(await metadata(), beforeRejected);
});
