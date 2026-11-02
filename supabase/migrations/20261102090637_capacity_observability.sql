-- Bounded operational samples. No customer rows, SQL text, credentials or
-- external destinations are stored. Scheduling is a separate rollout action.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create schema capacity_ops;
revoke all on schema capacity_ops from public,anon,authenticated,service_role;
create table capacity_ops.settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  retention_days integer not null default 14 check(retention_days between 1 and 30),
  stale_seconds integer not null default 180 check(stale_seconds between 60 and 900)
);
insert into capacity_ops.settings(singleton) values(true);
create table capacity_ops.samples (
  sampled_at timestamptz primary key,
  metrics jsonb not null check(octet_length(metrics::text)<=131072)
);
create table capacity_ops.alerts (
  key text primary key check(length(key)<=80),
  severity text not null check(severity in('warning','critical')),
  opened_at timestamptz not null,
  last_seen_at timestamptz not null,
  resolved_at timestamptz,
  value numeric,
  threshold numeric
);
-- These are operator-confirmed limits, not capacity inferred from unit tests.
-- NULL values remain visibly unconfirmed. A dated provider reservation expires.
create table capacity_ops.provider_limits (
  provider text primary key check(provider in('database','realtime','frontend','media','push','calls','auth')),
  unit text not null check(unit in('connections','requests_per_second','bytes_per_second','jobs_per_second')),
  observed_limit numeric check(observed_limit>=0),
  reserved_peak numeric check(reserved_peak>=0),
  confirmed_at timestamptz,
  valid_until timestamptz,
  reservation_evidence text check(length(reservation_evidence) between 8 and 2048),
  monthly_budget_usd numeric check(monthly_budget_usd>=0),
  budget_approved_at timestamptz,
  budget_approval_evidence text check(length(budget_approval_evidence) between 8 and 2048),
  check((reserved_peak is null) or (confirmed_at is not null and valid_until>confirmed_at and reservation_evidence is not null)),
  check((monthly_budget_usd is null)=(budget_approved_at is null)),
  check(monthly_budget_usd is null or budget_approval_evidence is not null)
);
insert into capacity_ops.provider_limits(provider,unit) values
 ('database','connections'),('realtime','connections'),('frontend','requests_per_second'),
 ('media','bytes_per_second'),('push','requests_per_second'),('calls','requests_per_second'),('auth','requests_per_second');
alter table capacity_ops.settings enable row level security;
alter table capacity_ops.samples enable row level security;
alter table capacity_ops.alerts enable row level security;
alter table capacity_ops.provider_limits enable row level security;
revoke all on all tables in schema capacity_ops from public,anon,authenticated,service_role;

create function capacity_ops.set_alert(p_key text,p_value numeric,p_warning numeric,p_critical numeric)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_value is not null and p_value>=p_warning then
  insert into capacity_ops.alerts(key,severity,opened_at,last_seen_at,value,threshold)
  values(p_key,case when p_value>=p_critical then 'critical' else 'warning' end,clock_timestamp(),clock_timestamp(),p_value,
   case when p_value>=p_critical then p_critical else p_warning end)
  on conflict(key) do update set severity=excluded.severity,
   opened_at=case when capacity_ops.alerts.resolved_at is null then capacity_ops.alerts.opened_at else excluded.opened_at end,
   last_seen_at=excluded.last_seen_at,resolved_at=null,value=excluded.value,threshold=excluded.threshold;
 elsif p_value is not null then
  update capacity_ops.alerts set resolved_at=coalesce(resolved_at,clock_timestamp()),last_seen_at=clock_timestamp(),value=p_value
   where key=p_key and resolved_at is null;
 end if;
end $$;

create function capacity_ops.capture() returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare v_at timestamptz:=clock_timestamp(); v_metrics jsonb; v_db jsonb; v_connections jsonb;
 v_components jsonb:='{}'; v_component jsonb; v_name text; v_key text;
 v_max integer:=current_setting('max_connections')::integer;
 v_clients integer; v_active integer; v_waiting integer; v_idle_tx integer; v_old_tx numeric;
 v_pending integer; v_age numeric; v_sample timestamptz; v_settings capacity_ops.settings;
 v_timestamp timestamptz; v_states jsonb;
begin
 if not pg_try_advisory_xact_lock(718402611020::bigint) then return jsonb_build_object('busy',true); end if;
 select * into v_settings from capacity_ops.settings where singleton;
 select count(*) filter(where backend_type='client backend'),count(*) filter(where state='active'),
  count(*) filter(where wait_event_type='Lock'),count(*) filter(where state like 'idle in transaction%'),
  coalesce(max(extract(epoch from v_at-xact_start)) filter(where backend_type='client backend' and pid<>pg_backend_pid()),0)
 into v_clients,v_active,v_waiting,v_idle_tx,v_old_tx from pg_stat_activity;
 v_connections:=jsonb_build_object('clients',v_clients,'active',v_active,'waiting_for_lock',v_waiting,
  'idle_in_transaction',v_idle_tx,'oldest_transaction_seconds',greatest(0,v_old_tx),'maximum',v_max,
  'used_percent',round(v_clients::numeric*100/greatest(1,v_max),2));
 select jsonb_build_object('bytes',pg_database_size(current_database()),'transactions_committed',xact_commit,
  'transactions_rolled_back',xact_rollback,'blocks_read',blks_read,'blocks_hit',blks_hit,
  'rows_inserted',tup_inserted,'rows_updated',tup_updated,'rows_deleted',tup_deleted,
  'temp_bytes',temp_bytes,'deadlocks',deadlocks,'statistics_reset_at',stats_reset)
 into v_db from pg_stat_database where datname=current_database();
 -- Fixed allowlist only. Optional component RPCs keep private queue layouts
 -- decoupled and must return bounded aggregate data, never user payloads.
 foreach v_name in array array['post_counter_status_v1','notification_fanout_status_v1','admin_reporting_status_v1','media_processing_status_v1','feed_ranking_status_v1'] loop
  v_key:=replace(v_name,'_status_v1','');
  if to_regprocedure('public.'||v_name||'()') is null then
   v_component:=jsonb_build_object('state','not_installed');
  else
   begin
    execute format('select public.%I()',v_name) into v_component;
    if v_component is null or jsonb_typeof(v_component)<>'object' or octet_length(v_component::text)>16384 then
     v_component:=jsonb_build_object('state','invalid_status');
    end if;
   exception when others then v_component:=jsonb_build_object('state','unavailable'); end;
  end if;
  -- A failed metrics read must not appear as an empty, healthy queue. The
  -- allowlisted contracts below have bounded numeric/timestamp fields. A
  -- contract error is isolated to its component, preserving the DB sample.
  perform capacity_ops.set_alert(v_key||'_status_unavailable',
    case when v_component->>'state' in('unavailable','invalid_status') then 1 else 0 end,1,1);
  if not(v_component ? 'state') then
   begin
    if v_key='post_counter' then
     v_timestamp:=(v_component->>'oldest_pending_at')::timestamptz;
     v_age:=coalesce(greatest(0,extract(epoch from v_at-v_timestamp)),0);
     v_component:=v_component||jsonb_build_object('oldest_pending_seconds',v_age,
      'pending_is_lower_bound',coalesce((v_component->>'pending_capped')::boolean,false));
     perform capacity_ops.set_alert('post_counter_queue_age_seconds',v_age,5,15);
     perform capacity_ops.set_alert('post_counter_synchronous_fallback',
      case when coalesce((v_component->>'synchronous_fallback')::boolean,false) then 1 else 0 end,1,1);
    elsif v_key='notification_fanout' then
     v_component:=v_component||jsonb_build_object(
      'enabled',coalesce((v_component->>'fanout_enabled')::boolean,false) or coalesce((v_component->>'dispatch_enabled')::boolean,false),
      'pending',coalesce((v_component->>'fanout_pending')::integer,0)+coalesce((v_component->>'dispatch_pending')::integer,0),
      'pending_is_lower_bound',coalesce((v_component->>'fanout_pending')::integer,0)>=coalesce((v_component->>'count_cap')::integer,100001)
       or coalesce((v_component->>'dispatch_pending')::integer,0)>=coalesce((v_component->>'count_cap')::integer,100001));
     v_timestamp:=(v_component->>'oldest_fanout_at')::timestamptz;
     perform capacity_ops.set_alert('notification_fanout_age_seconds',coalesce(greatest(0,extract(epoch from v_at-v_timestamp)),0),30,120);
     v_timestamp:=(v_component->>'oldest_dispatch_at')::timestamptz;
     perform capacity_ops.set_alert('notification_dispatch_age_seconds',coalesce(greatest(0,extract(epoch from v_at-v_timestamp)),0),30,120);
     perform capacity_ops.set_alert('notification_dead_letters',
      coalesce((v_component->>'fanout_dead')::integer,0)+coalesce((v_component->>'dispatch_dead')::integer,0),1,1);
    elsif v_key='media_processing' then
     v_states:=coalesce(v_component->'states','{}'::jsonb);
     v_pending:=coalesce((v_states->>'pending')::integer,0)+coalesce((v_states->>'retry')::integer,0)+coalesce((v_states->>'processing')::integer,0);
     v_component:=v_component||jsonb_build_object('enabled',coalesce((v_component->>'worker_enabled')::boolean,false),
      'pending',v_pending,'pending_is_lower_bound',
       coalesce((v_states->>'pending_capped')::boolean,false) or coalesce((v_states->>'retry_capped')::boolean,false)
       or coalesce((v_states->>'processing_capped')::boolean,false));
     perform capacity_ops.set_alert('media_queue_age_seconds',coalesce((v_component->>'oldest_pending_seconds')::numeric,0),300,900);
     perform capacity_ops.set_alert('media_expired_leases',coalesce((v_component->>'expired_leases')::numeric,0),1,5);
     perform capacity_ops.set_alert('media_failed_jobs',coalesce((v_states->>'failed')::numeric,0),1,10);
     perform capacity_ops.set_alert('media_cleanup_backlog',coalesce((v_component->>'cleanup_pending')::numeric,0),100,1000);
     v_timestamp:=(v_component->>'worker_last_seen_at')::timestamptz;
     v_age:=case when v_pending>0 and coalesce((v_component->>'worker_enabled')::boolean,false)
      then case when v_timestamp is null then 600 else greatest(0,extract(epoch from v_at-v_timestamp)) end else 0 end;
     perform capacity_ops.set_alert('media_worker_silence_seconds',v_age,180,600);
    end if;
   exception when others then
    v_component:=jsonb_build_object('state','invalid_status');
    perform capacity_ops.set_alert(v_key||'_status_unavailable',1,1,1);
   end;
  end if;
  v_components:=v_components||jsonb_build_object(v_key,v_component);
 end loop;
 if to_regclass('feed_live.pending') is not null then
  execute 'select count(*) from (select 1 from feed_live.pending limit 10001) q' into v_pending;
  execute 'select greatest(0,extract(epoch from clock_timestamp()-queued_at)) from feed_live.pending order by queued_at limit 1' into v_age;
  execute 'select jsonb_build_object(''enabled'',enabled,''last_drain_at'',last_drain_at,''drain_failed'',drain_failed,''recovery_required'',recovery_required) from feed_live.settings where singleton' into v_component;
  v_components:=v_components||jsonb_build_object('feed',v_component||jsonb_build_object('pending',least(v_pending,10000),
   'pending_is_lower_bound',v_pending>10000,'oldest_pending_seconds',coalesce(v_age,0)));
  perform capacity_ops.set_alert('feed_queue_age_seconds',coalesce(v_age,0),5,15);
 end if;
 if to_regclass('public.call_provider_revocations') is not null then
  execute 'select count(*) from (select 1 from public.call_provider_revocations where completed_at is null limit 10001) q' into v_pending;
  execute 'select greatest(0,extract(epoch from clock_timestamp()-available_at)) from public.call_provider_revocations where completed_at is null order by available_at limit 1' into v_age;
  v_components:=v_components||jsonb_build_object('calls',jsonb_build_object('pending',least(v_pending,10000),
   'pending_is_lower_bound',v_pending>10000,'oldest_available_seconds',coalesce(v_age,0)));
  perform capacity_ops.set_alert('call_queue_age_seconds',coalesce(v_age,0),180,600);
 end if;
 perform capacity_ops.set_alert('database_connections_percent',v_clients::numeric*100/greatest(1,v_max),70,90);
 perform capacity_ops.set_alert('database_lock_waiters',v_waiting,5,20);
 perform capacity_ops.set_alert('database_oldest_transaction_seconds',greatest(0,v_old_tx),30,120);
 v_metrics:=jsonb_build_object('version',1,'observed_at',v_at,'database',v_db,'connections',v_connections,'components',v_components);
 v_sample:=date_trunc('minute',v_at);
 insert into capacity_ops.samples(sampled_at,metrics) values(v_sample,v_metrics)
  on conflict(sampled_at) do update set metrics=excluded.metrics;
 -- Indexed, bounded cleanup. Catch-up never makes a sample perform an
 -- unbounded delete after a prolonged outage.
 delete from capacity_ops.samples where sampled_at in(select sampled_at from capacity_ops.samples
  where sampled_at<v_at-make_interval(days=>v_settings.retention_days) order by sampled_at limit 1440);
 return v_metrics;
end $$;

create function capacity_ops.tick() returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from capacity_ops.settings where singleton and enabled) then perform capacity_ops.capture(); end if;
end $$;

create function public.capacity_capture_v1() returns jsonb
language sql security definer set search_path='' as $$select capacity_ops.capture()$$;
create function public.capacity_status_v1(p_history_minutes integer default 60) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='3s' as $$
declare v_latest capacity_ops.samples; v_settings capacity_ops.settings; v_alerts jsonb; v_history jsonb; v_providers jsonb;
begin
 if p_history_minutes is null or p_history_minutes<0 or p_history_minutes>1440 then
  raise exception 'History must be between 0 and 1440 minutes' using errcode='22023';
 end if;
 select * into v_settings from capacity_ops.settings where singleton;
 select * into v_latest from capacity_ops.samples order by sampled_at desc limit 1;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.key),'[]') into v_alerts
  from capacity_ops.alerts a where resolved_at is null;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('reservation_current',
  coalesce(p.reserved_peak is not null and p.reserved_peak>0 and p.confirmed_at<=now()
    and p.valid_until>now() and p.reservation_evidence is not null,false),
  'budget_approved',p.monthly_budget_usd is not null and p.budget_approved_at<=now() and p.budget_approval_evidence is not null) order by p.provider),'[]')
  into v_providers from capacity_ops.provider_limits p;
 select coalesce(jsonb_agg(jsonb_build_object('sampled_at',h.sampled_at,'connections',h.metrics->'connections','database',h.metrics->'database') order by h.sampled_at),'[]')
  into v_history from (select sampled_at,metrics from capacity_ops.samples where sampled_at>=now()-make_interval(mins=>p_history_minutes)
   and p_history_minutes>0 order by sampled_at desc limit 1440) h;
 return jsonb_build_object('version',1,'observed_at',now(),'sampling_enabled',v_settings.enabled,
  'sampled_at',v_latest.sampled_at,'stale',v_latest.sampled_at is null or v_latest.sampled_at<now()-make_interval(secs=>v_settings.stale_seconds),
  'latest',v_latest.metrics,'alerts',v_alerts,'providers',v_providers,'history',v_history);
end $$;
revoke all on all functions in schema capacity_ops from public,anon,authenticated,service_role;
revoke all on function public.capacity_capture_v1(),public.capacity_status_v1(integer) from public,anon,authenticated;
grant execute on function public.capacity_capture_v1(),public.capacity_status_v1(integer) to service_role;
commit;
