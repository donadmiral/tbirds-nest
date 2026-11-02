const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261102075040_service_authorization_proof.sql'), 'utf8');
if (!process.env.PC_TEST_PSQL) test('service proof requires a disposable local PostgreSQL fixture', { skip: true }, () => {});
else {
  let db;
  const query = sql => db.query(sql);
  const install = () => query(migration);
  async function rejects(sql, pattern) {
    // ON_ERROR_STOP intentionally closes a failed psql connection. Keep
    // negative probes separate; closing also proves transaction rollback.
    const denied = new LocalPsqlSession();
    try { await assert.rejects(denied.query(sql), pattern); }
    finally { await denied.close(); }
  }
  before(async () => {
    if (process.env.PGDATABASE !== 'pc_scale_service_proof') throw new Error('A dedicated pc_scale_service_proof fixture database is required.');
    db = new LocalPsqlSession();
    await query(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      if not exists(select 1 from pg_roles where rolname='pc_scale_media_proof_extra') then create role pc_scale_media_proof_extra nologin; end if;
    end $$`);
  });
  after(async () => { await db?.close(); });
  beforeEach(async () => {
    await query(`rollback; reset role; drop schema if exists auth,public cascade; create schema public; create schema auth;
      grant usage on schema public,auth to anon,authenticated,service_role,pc_scale_media_proof_extra;
      create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
      set request.jwt.claims='{}'`);
  });
  test('fresh install is a stable, empty-search-path invoker proof with service-only execution', async () => {
    await install();
    assert.equal(await query(`select jsonb_build_object('definer',prosecdef,'stable',provolatile='s','config',proconfig,'returns_boolean',prorettype='boolean'::regtype)
      from pg_proc where oid='authorize_legacy_push_service()'::regprocedure`), '{"config": ["search_path=\\"\\""], "stable": true, "definer": false, "returns_boolean": true}');
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await query(`select has_function_privilege('${role}','public.authorize_legacy_push_service()','execute')`), 'f');
      await rejects(`set role ${role}; set request.jwt.claims='{"role":"service_role"}'; select public.authorize_legacy_push_service()`, /permission denied/);
    }
    assert.equal(await query("select has_function_privilege('service_role','public.authorize_legacy_push_service()','execute')"), 't');
  });
  test('both verified database role and service role claim are required', async () => {
    await install();
    await query(`set request.jwt.claims='{"role":"service_role"}'`);
    assert.equal(await query('select authorize_legacy_push_service()'), 'f', 'the schema owner is not an authenticated service caller');
    await query('set role service_role');
    assert.equal(await query('select authorize_legacy_push_service()'), 't');
    await query(`set request.jwt.claims='{"role":"authenticated"}'`);
    assert.equal(await query('select authorize_legacy_push_service()'), 'f');
    await query(`set request.jwt.claims='{}'`);
    assert.notEqual(await query('select authorize_legacy_push_service()'), 't');
    await query('reset role');
  });
  test('an identical existing definition is accepted without replacing its identity or body', async () => {
    await install();
    const before = await query("select oid::text||':'||md5(pg_get_functiondef(oid)) from pg_proc where oid='authorize_legacy_push_service()'::regprocedure");
    await install();
    assert.equal(await query("select oid::text||':'||md5(pg_get_functiondef(oid)) from pg_proc where oid='authorize_legacy_push_service()'::regprocedure"), before);
  });
  test('an incompatible existing body is rejected transactionally and remains unchanged', async () => {
    await query(`create function authorize_legacy_push_service() returns boolean language sql stable security invoker set search_path='' as $$ select false $$`);
    const before = await query("select pg_get_functiondef('authorize_legacy_push_service()'::regprocedure)");
    await rejects(migration, /differs; review/);
    assert.equal(await query("select pg_get_functiondef('authorize_legacy_push_service()'::regprocedure)"), before);
  });
  test('changing the proof to SECURITY DEFINER cannot pass the compatibility guard', async () => {
    await install(); await query('alter function authorize_legacy_push_service() security definer');
    await rejects(migration, /differs; review/);
    assert.equal(await query("select prosecdef from pg_proc where oid='authorize_legacy_push_service()'::regprocedure"), 't', 'installation must not silently rewrite an unexpected existing function');
  });
  test('unexpected third-party execution grants fail closed without partially changing ACLs', async () => {
    await install(); await query('grant execute on function authorize_legacy_push_service() to pc_scale_media_proof_extra,authenticated');
    await rejects(migration, /Unexpected service authorization proof grants/);
    assert.equal(await query("select has_function_privilege('authenticated','public.authorize_legacy_push_service()','execute')"), 't', 'the failed transaction must restore its prior ACL');
  });
  test('a missing JWT verifier fails before creating the proof', async () => {
    await query('drop function auth.jwt()');
    await rejects(migration, /requires auth.jwt/);
    assert.equal(await query("select to_regprocedure('public.authorize_legacy_push_service()') is null"), 't');
  });
}
