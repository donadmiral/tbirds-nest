const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
if (!process.env.PC_TEST_PSQL) test('notification scheduler requires isolated local PostgreSQL', { skip: true }, () => {});
else {
  let db;
  const query = sql => db.query(sql);
  const token = 'pc_notify_' + 'ab'.repeat(32);
  before(async () => {
    if (process.env.PGDATABASE !== 'pc_scale_notification_worker') throw Error('Use disposable pc_scale_notification_worker.');
    db = new LocalPsqlSession();
    await query(`drop schema if exists notification_fanout,auth,net,public,extensions cascade;
      create schema public;create schema notification_fanout;create schema auth;create schema net;create schema extensions;
      create extension pgcrypto with schema extensions;
      do $$begin
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
        if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
      end$$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
      create table notification_fanout.jobs(state text,available_at timestamptz);
      create table notification_fanout.dispatch_jobs(state text,available_at timestamptz,lease_until timestamptz);
      create table net.calls(id bigint generated always as identity,url text,headers jsonb,body jsonb,timeout_ms integer);
      create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer)
        returns bigint language sql as $$insert into net.calls(url,headers,body,timeout_ms)
          values(url,headers,body,timeout_milliseconds) returning id$$;`);
    await query(fs.readFileSync(path.join(__dirname, '../migrations/20261102100704_notification_worker_schedule.sql'), 'utf8'));
  });
  after(async () => { await db?.close(); });
  const seed = async (expires = "clock_timestamp()+interval '1 minute'") => {
    await query(`truncate notification_fanout.worker_ticks;insert into notification_fanout.worker_ticks(digest,created_at,expires_at)
      values(extensions.digest('${token}','sha256'),clock_timestamp()-interval '1 minute',${expires});`);
  };
  test('installation is disabled and all worker APIs and state exclude public callers', async () => {
    assert.equal(await query('select notification_fanout.enqueue_worker_tick() is null'), 't');
    assert.equal(await query('select count(*) from net.calls'), '0');
    for (const role of ['anon', 'authenticated']) {
      for (const name of ['validate_notification_worker_tick_v1(text)', 'finish_notification_worker_tick_v1(text,boolean)',
        'notification_worker_status_v1()', 'configure_notification_worker_v1(text,boolean,integer)']) {
        assert.equal(await query(`select has_function_privilege('${role}','public.${name}','execute')`), 'f');
      }
      assert.equal(await query(`select has_table_privilege('${role}','notification_fanout.worker_ticks','select')`), 'f');
    }
    assert.equal(await query("select has_function_privilege('service_role','notification_fanout.enqueue_worker_tick()','execute')"), 'f');
  });
  test('only verified service role can consume a scoped token once and publish its completion', async () => {
    await query("select configure_notification_worker_v1('https://uaulhuelcfkjwojtymmw.supabase.co',true,2);");
    await seed();
    await query(`set request.jwt.claims='{"role":"authenticated"}';`);
    assert.equal(await query(`select validate_notification_worker_tick_v1('${token}')`), 'f');
    await query(`set request.jwt.claims='{"role":"service_role"}';set role service_role;`);
    assert.equal(await query(`select validate_notification_worker_tick_v1('${token}')`), 't');
    assert.equal(await query(`select validate_notification_worker_tick_v1('${token}')`), 'f');
    assert.equal(await query(`select finish_notification_worker_tick_v1('${token}',true)`), 't');
    assert.equal(await query(`select finish_notification_worker_tick_v1('${token}',true)`), 'f');
    await query('reset role;');
    assert.equal(await query('select last_completed_at is not null from notification_fanout.worker_settings'), 't');
  });
  test('expired, malformed, unissued and disabled capabilities fail closed', async () => {
    await seed("clock_timestamp()-interval '1 second'");
    assert.equal(await query(`select validate_notification_worker_tick_v1('${token}')`), 'f');
    assert.equal(await query(`select validate_notification_worker_tick_v1('pc_notify_not_hex')`), 'f');
    assert.equal(await query(`select validate_notification_worker_tick_v1('pc_notify_${'cd'.repeat(32)}')`), 'f');
    await seed();await query('update notification_fanout.worker_settings set enabled=false;');
    assert.equal(await query(`select validate_notification_worker_tick_v1('${token}')`), 'f');
    await query('update notification_fanout.worker_settings set enabled=true;');
  });
  test('scheduler fixes destination and body, exposes only a one-use capability and obeys parallel ceiling', async () => {
    await query(`truncate notification_fanout.worker_ticks;insert into notification_fanout.dispatch_jobs values('pending',now(),null);
      update notification_fanout.worker_settings set last_issued_at=null;`);
    assert.equal(await query('select notification_fanout.enqueue_worker_tick() is not null'), 't');
    assert.equal(await query('select notification_fanout.enqueue_worker_tick() is null'), 't');
    await query("update notification_fanout.worker_settings set last_issued_at=now()-interval '2 seconds';");
    assert.equal(await query('select notification_fanout.enqueue_worker_tick() is not null'), 't');
    await query("update notification_fanout.worker_settings set last_issued_at=now()-interval '2 seconds';");
    assert.equal(await query('select notification_fanout.enqueue_worker_tick() is null'), 't');
    const rows = JSON.parse(await query("select jsonb_agg(jsonb_build_object('url',url,'body',body,'timeout',timeout_ms,'scoped',headers->>'Authorization' ~ '^Bearer pc_notify_[a-f0-9]{64}$')) from net.calls"));
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.url === 'https://uaulhuelcfkjwojtymmw.supabase.co/functions/v1/process-notification-outbox'
      && row.scoped && row.timeout === 30000 && Object.keys(row.body).length === 0));
  });
  test('idle scheduler sends one heartbeat per thirty seconds and abandoned slots expire', async () => {
    await query('truncate notification_fanout.dispatch_jobs,notification_fanout.worker_ticks,net.calls;');
    await query("update notification_fanout.worker_settings set last_issued_at=now()-interval '5 seconds';");
    assert.equal(await query('select notification_fanout.enqueue_worker_tick() is null'), 't');
    await query("update notification_fanout.worker_settings set last_issued_at=now()-interval '31 seconds';");
    assert.equal(await query('select notification_fanout.enqueue_worker_tick() is not null'), 't');
    await query("update notification_fanout.worker_ticks set created_at=now()-interval '3 minutes',expires_at=now()-interval '1 minute';");
    assert.equal(await query("select (notification_worker_status_v1()->>'active_ticks')::int"), '0');
    assert.equal(await query('select count(*) from net.calls'), '1');
  });
}
