const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LocalPsqlSession } = require('./local-psql-session.cjs');

test('capacity monitoring uses bounded samples and fails closed without measurements', { skip: !process.env.PC_TEST_PSQL }, async t => {
  const db = new LocalPsqlSession();
  try {
    assert.equal(await db.query("select current_database() like 'pc_scale_%' and inet_server_addr() is null"), 't');
    await db.query(`drop schema if exists capacity_ops cascade;
      drop function if exists public.capacity_capture_v1();
      drop function if exists public.capacity_status_v1(integer);
      drop function if exists public.post_counter_status_v1();
      drop function if exists public.notification_fanout_status_v1();
      drop function if exists public.notification_worker_status_v1();
      drop function if exists public.media_processing_status_v1();
      drop function if exists public.media_sandbox_status_v1();
      do $$begin
       if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
       if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
       if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
      end$$;`);
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/20261102090637_capacity_observability.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/20261102180521_capacity_media_sandbox_observability.sql'), 'utf8'));
    await t.test('no observations and no reservations cannot appear ready', async () => {
      const status = JSON.parse(await db.query('select public.capacity_status_v1(0)'));
      assert.equal(status.stale, true);
      assert.equal(status.latest, null);
      assert.equal(status.sampling_enabled, false);
      assert.equal(status.providers.length, 7);
      assert.ok(status.providers.every(p => !p.reservation_current && p.monthly_budget_usd === null));
    });
    await t.test('only the backend can read or collect operational state', async () => {
      assert.equal(await db.query(`select
        not has_function_privilege('anon','public.capacity_status_v1(integer)','execute')
        and not has_function_privilege('authenticated','public.capacity_capture_v1()','execute')
        and not has_function_privilege('authenticated','public.capacity_status_v1(integer)','execute')
        and has_function_privilege('service_role','public.capacity_status_v1(integer)','execute')
        and not has_schema_privilege('service_role','capacity_ops','usage')`), 't');
      const denied = new LocalPsqlSession();
      try { await assert.rejects(denied.query('set role authenticated; select public.capacity_status_v1(0)'), /permission denied/); }
      finally { await denied.close(); }
    });
    await t.test('samples coalesce within a minute and expose statistics without query text', async () => {
      const first = JSON.parse(await db.query('select public.capacity_capture_v1()'));
      assert.equal(first.version, 1);
      assert.ok(first.database.bytes > 0);
      assert.ok(first.connections.maximum > 0);
      assert.equal(first.components.post_counter.state, 'not_installed');
      assert.equal(first.components.media_sandbox.state, 'not_installed');
      await db.query('select public.capacity_capture_v1()');
      assert.ok(Number(await db.query('select count(*) from capacity_ops.samples')) <= 2);
      const status = JSON.parse(await db.query('select public.capacity_status_v1(60)'));
      assert.equal(status.stale, false);
      assert.ok(status.history.length > 0 && status.history.length <= 2);
      assert.ok(!JSON.stringify(status).includes('select public.capacity_capture'));
    });
    await t.test('unavailable component status is explicit and does not break database monitoring', async () => {
      await db.query(`create function public.post_counter_status_v1() returns jsonb language plpgsql as $$begin raise exception 'PRIVATE_INTERNAL_DETAIL'; end$$;`);
      const value = JSON.parse(await db.query('select public.capacity_capture_v1()'));
      assert.equal(value.components.post_counter.state, 'unavailable');
      assert.ok(!JSON.stringify(value).includes('PRIVATE_INTERNAL_DETAIL'));
      assert.equal(await db.query("select severity from capacity_ops.alerts where key='post_counter_status_unavailable' and resolved_at is null"), 'critical');
      await db.query('drop function public.post_counter_status_v1()');
    });
    await t.test('queue lag and worker failure create alerts with normalized pending counts', async () => {
      await db.query(`create function public.post_counter_status_v1() returns jsonb language sql as $$
        select jsonb_build_object('enabled',true,'pending',7,'pending_capped',false,'synchronous_fallback',true,
         'oldest_pending_at',now()-interval '20 seconds')$$;
       create function public.notification_fanout_status_v1() returns jsonb language sql as $$
        select jsonb_build_object('fanout_enabled',true,'dispatch_enabled',true,'fanout_pending',12,'dispatch_pending',8,
         'fanout_dead',0,'dispatch_dead',1,'count_cap',100001,'oldest_fanout_at',now()-interval '3 minutes',
         'oldest_dispatch_at',now()-interval '4 minutes')$$;
       create function public.notification_worker_status_v1() returns jsonb language sql as $$
        select jsonb_build_object('enabled',true,'last_completed_at',now(),'active_ticks',1)$$;
       create function public.media_processing_status_v1() returns jsonb language sql as $$
        select jsonb_build_object('worker_enabled',true,'states','{"pending":3,"retry":2,"processing":1,"failed":10}'::jsonb,
         'oldest_pending_seconds',1000,'worker_last_seen_at',null,'expired_leases',5,'cleanup_pending',1000)$$;`);
      const value = JSON.parse(await db.query('select public.capacity_capture_v1()'));
      assert.equal(value.components.notification_fanout.pending, 20);
      assert.equal(value.components.notification_fanout.enabled, true);
      assert.equal(value.components.media_processing.pending, 6);
      assert.equal(value.components.media_processing.pending_is_lower_bound, false);
      for (const key of ['post_counter_queue_age_seconds','post_counter_synchronous_fallback','notification_fanout_age_seconds',
        'notification_dispatch_age_seconds','notification_dead_letters','media_queue_age_seconds','media_worker_silence_seconds',
        'media_expired_leases','media_failed_jobs','media_cleanup_backlog']) {
        assert.equal(await db.query(`select severity from capacity_ops.alerts where key='${key}' and resolved_at is null`), 'critical', key);
      }
      await db.query(`create or replace function public.post_counter_status_v1() returns jsonb language sql as $$
        select '{"enabled":true,"pending":0,"pending_capped":false,"synchronous_fallback":false}'::jsonb$$;
       create or replace function public.notification_fanout_status_v1() returns jsonb language sql as $$
        select '{"fanout_enabled":true,"dispatch_enabled":true,"fanout_pending":0,"dispatch_pending":0,"fanout_dead":0,"dispatch_dead":0}'::jsonb$$;
       create or replace function public.media_processing_status_v1() returns jsonb language sql as $$
        select '{"worker_enabled":true,"states":{"pending":0,"retry":0,"processing":0,"failed":0},"oldest_pending_seconds":0,"expired_leases":0,"cleanup_pending":0}'::jsonb$$;`);
      await db.query('select public.capacity_capture_v1()');
      assert.equal(await db.query("select count(*) from capacity_ops.alerts where resolved_at is null and key not like 'database_%'"), '0');
      await db.query('drop function public.post_counter_status_v1(); drop function public.notification_fanout_status_v1(); drop function public.notification_worker_status_v1(); drop function public.media_processing_status_v1();');
    });
    await t.test('a disabled or silent push consumer is visible even with an empty queue', async () => {
      await db.query(`create function public.notification_fanout_status_v1() returns jsonb language sql as $$
        select '{"fanout_enabled":true,"dispatch_enabled":true,"fanout_pending":0,"dispatch_pending":0}'::jsonb$$;
       create function public.notification_worker_status_v1() returns jsonb language sql as $$
        select '{"enabled":false,"active_ticks":0}'::jsonb$$;`);
      await db.query('select public.capacity_capture_v1()');
      assert.equal(await db.query("select severity from capacity_ops.alerts where key='notification_dispatch_worker_unavailable' and resolved_at is null"),'critical');
      await db.query(`create or replace function public.notification_worker_status_v1() returns jsonb language sql as $$
        select jsonb_build_object('enabled',true,'last_completed_at',now()-interval '4 minutes','active_ticks',2)$$;`);
      const value = JSON.parse(await db.query('select public.capacity_capture_v1()'));
      assert.equal(value.components.notification_worker.pending,2);
      assert.equal(await db.query("select severity from capacity_ops.alerts where key='notification_worker_silence_seconds' and resolved_at is null"),'critical');
      await db.query(`create or replace function public.notification_worker_status_v1() returns jsonb language sql as $$
        select jsonb_build_object('enabled',true,'last_completed_at',now(),'active_ticks',0)$$;`);
      await db.query('select public.capacity_capture_v1()');
      assert.equal(await db.query("select count(*) from capacity_ops.alerts where key in('notification_dispatch_worker_unavailable','notification_worker_silence_seconds') and resolved_at is null"),'0');
      await db.query('drop function public.notification_fanout_status_v1(); drop function public.notification_worker_status_v1();');
    });
    await t.test('malformed component metrics fail visibly without suppressing database monitoring', async () => {
      await db.query(`create function public.post_counter_status_v1() returns jsonb language sql as $$
        select '{"pending":3,"oldest_pending_at":"PRIVATE_INVALID_DATE"}'::jsonb$$;`);
      const value = JSON.parse(await db.query('select public.capacity_capture_v1()'));
      assert.equal(value.components.post_counter.state, 'invalid_status');
      assert.ok(value.database.bytes > 0);
      assert.ok(!JSON.stringify(value).includes('PRIVATE_INVALID_DATE'));
      await db.query('drop function public.post_counter_status_v1()');
    });
    await t.test('sandbox enforcement caps produce bounded usage alerts without inventing approved spend', async () => {
      const status = {enabled:true,active_reservations:1,daily_wall_cap_seconds:1560,monthly_wall_cap_seconds:6240,
        daily_wall_reserved_seconds:1560,monthly_wall_reserved_seconds:5460};
      const install = value => db.query(`create or replace function public.media_sandbox_status_v1() returns jsonb language sql as $$
        select '${JSON.stringify(value)}'::jsonb$$;`);
      await install(status);
      const value = JSON.parse(await db.query('select public.capacity_capture_v1()'));
      assert.equal(value.components.media_sandbox.pending,1);
      assert.equal(value.components.media_sandbox.pending_is_lower_bound,false);
      assert.equal(value.components.media_sandbox.daily_budget_used_percent,100);
      assert.equal(value.components.media_sandbox.monthly_budget_used_percent,87.5);
      assert.equal(await db.query("select severity from capacity_ops.alerts where key='media_sandbox_daily_budget_percent' and resolved_at is null"),'critical');
      assert.equal(await db.query("select severity from capacity_ops.alerts where key='media_sandbox_monthly_budget_percent' and resolved_at is null"),'warning');
      const publicStatus = JSON.parse(await db.query('select public.capacity_status_v1(0)'));
      assert.ok(publicStatus.providers.every(p => !p.budget_approved && p.monthly_budget_usd === null));
      await install({...status,enabled:false});
      await db.query('select public.capacity_capture_v1()');
      assert.equal(await db.query("select count(*) from capacity_ops.alerts where key like 'media_sandbox_%' and resolved_at is null"),'0');
      await install({...status,daily_wall_cap_seconds:0});
      const malformed = JSON.parse(await db.query('select public.capacity_capture_v1()'));
      assert.equal(malformed.components.media_sandbox.state,'invalid_status');
      assert.ok(malformed.database.bytes>0);
      assert.equal(await db.query("select severity from capacity_ops.alerts where key='media_sandbox_status_unavailable' and resolved_at is null"),'critical');
      await db.query('drop function public.media_sandbox_status_v1(); select public.capacity_capture_v1();');
    });
    await t.test('provider reservations need evidence, positive capacity and a current confirmation', async () => {
      await db.query(`update capacity_ops.provider_limits set reserved_peak=100,confirmed_at=now()-interval '1 minute',
       valid_until=now()+interval '1 day',reservation_evidence='provider-ticket-123' where provider='database';
       update capacity_ops.provider_limits set reserved_peak=100,confirmed_at=now()+interval '1 day',
       valid_until=now()+interval '2 days',reservation_evidence='provider-ticket-456' where provider='realtime';
       update capacity_ops.provider_limits set monthly_budget_usd=100,budget_approved_at=now()-interval '1 minute',
       budget_approval_evidence='explicit-approval-123' where provider='database';`);
      const value = JSON.parse(await db.query('select public.capacity_status_v1(0)'));
      assert.equal(value.providers.find(p => p.provider === 'database').reservation_current, true);
      assert.equal(value.providers.find(p => p.provider === 'database').budget_approved, true);
      assert.equal(value.providers.find(p => p.provider === 'realtime').reservation_current, false);
      const invalid = new LocalPsqlSession();
      try {
        await assert.rejects(invalid.query(`update capacity_ops.provider_limits set reserved_peak=100,confirmed_at=now(),
          valid_until=now()+interval '1 day' where provider='media'`), /check constraint/);
      } finally { await invalid.close(); }
    });
    await t.test('alerts retain incident identity until resolution, then reopen', async () => {
      await db.query("select capacity_ops.set_alert('test_lag',20,10,30)");
      const first = JSON.parse(await db.query("select to_jsonb(a) from capacity_ops.alerts a where key='test_lag'"));
      assert.equal(first.severity, 'warning');
      await db.query("select capacity_ops.set_alert('test_lag',40,10,30)");
      const second = JSON.parse(await db.query("select to_jsonb(a) from capacity_ops.alerts a where key='test_lag'"));
      assert.equal(second.severity, 'critical');
      assert.equal(second.opened_at, first.opened_at);
      await db.query("select capacity_ops.set_alert('test_lag',0,10,30)");
      assert.equal(await db.query("select resolved_at is not null from capacity_ops.alerts where key='test_lag'"), 't');
      await db.query("select capacity_ops.set_alert('test_lag',11,10,30)");
      assert.equal(await db.query("select resolved_at is null from capacity_ops.alerts where key='test_lag'"), 't');
    });
    await t.test('history and stale-data behavior are bounded', async () => {
      await db.query(`delete from capacity_ops.samples;
        insert into capacity_ops.samples select date_trunc('minute',now())-n*interval '1 minute', '{}'::jsonb from generate_series(1,1500) n;`);
      const status = JSON.parse(await db.query('select public.capacity_status_v1(1440)'));
      assert.ok(status.history.length <= 1440);
      assert.equal(JSON.parse(await db.query('select public.capacity_status_v1(0)')).history.length, 0);
      await db.query("delete from capacity_ops.samples where sampled_at>now()-interval '10 minutes'");
      assert.equal(JSON.parse(await db.query('select public.capacity_status_v1(0)')).stale, true);
      const invalid = new LocalPsqlSession();
      try { await assert.rejects(invalid.query('select public.capacity_status_v1(1000000)'), /History must be/); }
      finally { await invalid.close(); }
    });
    await t.test('cleanup cannot delete more than its bounded batch', async () => {
      await db.query(`delete from capacity_ops.samples;
        insert into capacity_ops.samples select date_trunc('minute',now())-interval '20 days'-n*interval '1 minute', '{}'::jsonb from generate_series(1,3000) n;`);
      await db.query('select public.capacity_capture_v1()');
      assert.equal(Number(await db.query("select count(*) from capacity_ops.samples where sampled_at<now()-interval '14 days'")), 1560);
    });
  } finally { await db.close(); }
});
