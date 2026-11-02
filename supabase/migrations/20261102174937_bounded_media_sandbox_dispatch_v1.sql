-- Inert bounded Vercel Sandbox reservations. These conservative enforcement
-- caps are not an approval of the application's overall operating budget.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create table media_renditions.sandbox_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 daily_wall_seconds integer not null default 1560 check(daily_wall_seconds between 780 and 1560),
 monthly_wall_seconds integer not null default 6240 check(monthly_wall_seconds between 780 and 6240),
 daily_cpu_seconds integer not null default 3120 check(daily_cpu_seconds between 1560 and 3120),
 monthly_cpu_seconds integer not null default 12480 check(monthly_cpu_seconds between 1560 and 12480)
);
insert into media_renditions.sandbox_settings(singleton) values(true);
create table media_renditions.sandbox_usage (
 period text not null check(period in('day','month')),starts_on date not null,
 wall_seconds integer not null default 0 check(wall_seconds>=0),
 cpu_seconds integer not null default 0 check(cpu_seconds>=0),
 creations integer not null default 0 check(creations>=0),
 primary key(period,starts_on)
);
create table media_renditions.sandbox_runs (
 id uuid primary key,name text not null unique,
 state text not null default 'reserved' check(state in('reserved','running','finished','failed','expired')),
 reserved_at timestamptz not null,launch_until timestamptz not null,stop_after timestamptz not null,
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 session_id text,command_id text,
 finished_at timestamptz,exit_code integer,
 wall_seconds integer not null default 780 check(wall_seconds=780),
 cpu_seconds integer not null default 1560 check(cpu_seconds=1560),
 check(name='pc-media-'||replace(id::text,'-','')),
 check(session_id is null or session_id ~ '^[A-Za-z0-9_-]{8,160}$'),
 check(command_id is null or command_id ~ '^[A-Za-z0-9_-]{8,160}$')
);
create index media_sandbox_active on media_renditions.sandbox_runs(stop_after,id) where state in('reserved','running');
alter table media_renditions.sandbox_settings enable row level security;
alter table media_renditions.sandbox_usage enable row level security;
alter table media_renditions.sandbox_runs enable row level security;
revoke all on media_renditions.sandbox_settings,media_renditions.sandbox_usage,media_renditions.sandbox_runs from public,anon,authenticated,service_role;
-- A dispatcher credential is never injected into the encoding VM. The VM
-- retains only the existing worker credential, with no reservation authority.
alter table media_renditions.broker_keys drop constraint broker_keys_role_check;
alter table media_renditions.broker_keys add constraint broker_keys_role_check check(role in('worker','gateway','dispatcher'));

create function public.reserve_media_sandbox_v1(p_run_id uuid,p_source_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg media_renditions.sandbox_settings;run media_renditions.sandbox_runs;
 at_time timestamptz;day_on date;month_on date;usage_day media_renditions.sandbox_usage;usage_month media_renditions.sandbox_usage;
begin
 perform media_processing.require_service();
 if p_run_id is null or p_source_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid sandbox reservation';end if;
 -- One row serializes daily/monthly reservations and the global single-VM cap.
 select * into cfg from media_renditions.sandbox_settings where singleton for update;
 at_time:=clock_timestamp();
 if not cfg.enabled or not exists(select 1 from media_renditions.settings where (worker_enabled or maintenance_enabled) and not emergency_revoke) then return null;end if;
 select * into run from media_renditions.sandbox_runs where id=p_run_id;
 if found then return null;end if; -- Never reuse a launch permission, even after a retry.
 -- Time alone never releases a slot. The dispatcher confirms the provider
 -- stopped the exact session, or confirms absence after the full hard bound.
 if exists(select 1 from media_renditions.sandbox_runs where state in('reserved','running')) then return null;end if;
 if not exists(select 1 from media_renditions.settings s where s.worker_enabled and exists(
  select 1 from media_renditions.jobs j where j.source_bytes<=s.input_max_bytes
   and ((j.state in('pending','retry') and j.available_at<=at_time) or(j.state='processing' and j.lease_until<=at_time))))
  and not exists(select 1 from media_renditions.settings s where s.maintenance_enabled and exists(
   select 1 from media_renditions.attempts a where not a.cleanup_done and (a.cleanup_pending or(a.closed_at is null and a.expires_at<=at_time))
    and(a.cleanup_until is null or a.cleanup_until<=at_time))) then return null;end if;
 day_on:=(at_time at time zone 'UTC')::date;month_on:=date_trunc('month',at_time at time zone 'UTC')::date;
 insert into media_renditions.sandbox_usage(period,starts_on) values('day',day_on),('month',month_on) on conflict do nothing;
 select * into usage_day from media_renditions.sandbox_usage where period='day' and starts_on=day_on;
 select * into usage_month from media_renditions.sandbox_usage where period='month' and starts_on=month_on;
 if usage_day.wall_seconds+780>cfg.daily_wall_seconds or usage_day.cpu_seconds+1560>cfg.daily_cpu_seconds
  or usage_month.wall_seconds+780>cfg.monthly_wall_seconds or usage_month.cpu_seconds+1560>cfg.monthly_cpu_seconds then return null;end if;
 update media_renditions.sandbox_usage set wall_seconds=wall_seconds+780,cpu_seconds=cpu_seconds+1560,creations=creations+1
  where(period='day' and starts_on=day_on)or(period='month' and starts_on=month_on);
 insert into media_renditions.sandbox_runs(id,name,reserved_at,launch_until,stop_after,source_sha256)
  values(p_run_id,'pc-media-'||replace(p_run_id::text,'-',''),at_time,at_time+interval '30 seconds',at_time+interval '825 seconds',p_source_sha256)
  returning * into run;
 return jsonb_build_object('id',run.id,'name',run.name,'launchUntil',run.launch_until,'stopAfter',run.stop_after,'timeoutMs',780000,'vcpus',2,'sourceSha256',run.source_sha256);
end $$;
create function public.attach_media_sandbox_v1(p_run_id uuid,p_session_id text,p_command_id text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare run media_renditions.sandbox_runs;
begin
 perform media_processing.require_service();
 if p_session_id is null or p_session_id !~ '^[A-Za-z0-9_-]{8,160}$' or(p_command_id is not null and p_command_id !~ '^[A-Za-z0-9_-]{8,160}$') then return false;end if;
 select * into run from media_renditions.sandbox_runs where id=p_run_id for update;
 if not found or run.state not in('reserved','running') or run.launch_until<=clock_timestamp()
  or(run.session_id is not null and run.session_id<>p_session_id) or(run.command_id is not null and run.command_id is distinct from p_command_id) then return false;end if;
 update media_renditions.sandbox_runs set state='running',session_id=p_session_id,command_id=coalesce(p_command_id,command_id) where id=p_run_id;
 return true;
end $$;
create function public.pending_media_sandboxes_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform media_processing.require_service();
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'state',state,'launchUntil',launch_until,'stopAfter',stop_after,'sessionId',session_id,'commandId',command_id))
  from(select * from media_renditions.sandbox_runs where state in('reserved','running') order by stop_after,id limit 2) q),'[]'::jsonb);
end $$;
create function public.finish_media_sandbox_v1(p_run_id uuid,p_session_id text,p_exit_code integer default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare run media_renditions.sandbox_runs;
begin
 perform media_processing.require_service();
 select * into run from media_renditions.sandbox_runs where id=p_run_id for update;
 if not found or run.state not in('reserved','running')
  or(run.session_id is not null and run.session_id is distinct from p_session_id)
  or(run.session_id is null and run.launch_until>clock_timestamp())
  or(p_session_id is null and run.stop_after>clock_timestamp())
  or(p_session_id is not null and p_session_id !~ '^[A-Za-z0-9_-]{8,160}$')
  or(p_exit_code is not null and p_exit_code not between 0 and 255) then return false;end if;
 -- Called only by the separately scoped dispatcher after a provider-confirmed
 -- stop, or confirmed absence after the full hard bound. Ambiguous errors
 -- retain the slot and its entire charged budget.
 update media_renditions.sandbox_runs set state=case when p_session_id is null then 'expired' when p_exit_code=0 then 'finished' else 'failed' end,
  session_id=coalesce(session_id,p_session_id),exit_code=p_exit_code,finished_at=clock_timestamp() where id=p_run_id;
 return true;
end $$;
create function public.media_sandbox_status_v1() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',c.enabled,'max_concurrency',1,'vcpus',2,'memory_mb',4096,'timeout_seconds',780,
  'daily_wall_cap_seconds',c.daily_wall_seconds,'monthly_wall_cap_seconds',c.monthly_wall_seconds,
  'daily_cpu_cap_seconds',c.daily_cpu_seconds,'monthly_cpu_cap_seconds',c.monthly_cpu_seconds,
  'active_reservations',(select count(*) from media_renditions.sandbox_runs where state in('reserved','running')),
  'daily_wall_reserved_seconds',coalesce((select wall_seconds from media_renditions.sandbox_usage where period='day' and starts_on=(statement_timestamp() at time zone 'UTC')::date),0),
  'monthly_wall_reserved_seconds',coalesce((select wall_seconds from media_renditions.sandbox_usage where period='month' and starts_on=date_trunc('month',statement_timestamp() at time zone 'UTC')::date),0))
 from media_renditions.sandbox_settings c where singleton
$$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in('reserve_media_sandbox_v1','attach_media_sandbox_v1','pending_media_sandboxes_v1','finish_media_sandbox_v1','media_sandbox_status_v1') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
