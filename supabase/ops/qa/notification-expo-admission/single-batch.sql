-- Isolated QA candidate. Install after durable_notification_fanout.
-- Intentionally excluded from migrations and every deployed dispatcher.
begin;
create table notification_fanout.qa_expo_windows (
  slot integer primary key check (slot between 0 and 10),
  tick bigint not null,
  units integer not null check (units between 1 and 500)
);
alter table notification_fanout.qa_expo_windows enable row level security;
revoke all on notification_fanout.qa_expo_windows from public, anon, authenticated, service_role;

alter table notification_fanout.dispatch_jobs
  add column qa_expo_grant_lease uuid,
  add column qa_expo_grant_units integer check (qa_expo_grant_units between 1 and 100);

create function public.qa_reserve_ordinary_expo_batch(p_job uuid, p_lease uuid, p_units integer)
returns text language plpgsql security definer set search_path='' as $$
declare
  job notification_fanout.dispatch_jobs;
  observed timestamptz;
  tick_now bigint;
  charged integer;
begin
  if p_units is null or p_units not between 1 and 1000 or p_job is null or p_lease is null then
    raise exception 'INVALID_EXPO_RESERVATION';
  end if;
  select * into job from notification_fanout.dispatch_jobs where id=p_job for update;
  if not found or job.lease_id is distinct from p_lease then return 'stale'; end if;
  if job.state='pending' and job.last_error='EXPO_RATE_DEFERRED' then return 'deferred'; end if;
  if job.state<>'leased' or job.lease_until is null or job.lease_until<=clock_timestamp() then return 'stale'; end if;
  if job.qa_expo_grant_lease=p_lease then
    if job.qa_expo_grant_units<>p_units then raise exception 'EXPO_RESERVATION_SIZE_CHANGED'; end if;
    -- A replay can discover that a prior RPC charged capacity, but cannot send again.
    return 'already_reserved';
  end if;
  if p_units>100 then return 'requires_device_checkpoints'; end if;

  -- One short transaction per admitted provider request. All ordinary workers
  -- in this project share the lock. Never hold it across an HTTP call.
  perform pg_advisory_xact_lock(51728941,1);
  observed:=clock_timestamp();
  if job.lease_until<=observed then return 'stale'; end if;
  tick_now:=floor(extract(epoch from observed)*10)::bigint;
  -- Eleven 100ms slots conservatively include both partial boundary intervals.
  select coalesce(sum(units),0) into charged from notification_fanout.qa_expo_windows
    where tick>=tick_now-10;
  if charged+p_units>500 then
    update notification_fanout.dispatch_jobs set state='pending',last_error='EXPO_RATE_DEFERRED',
      available_at=observed+interval '1100 milliseconds', lease_until=null, attempts=attempts-1
      where id=p_job and attempts>0;
    if not found then raise exception 'INVALID_DISPATCH_ATTEMPTS'; end if;
    return 'deferred';
  end if;
  insert into notification_fanout.qa_expo_windows as w(slot,tick,units)
    values ((tick_now%11)::integer,tick_now,p_units)
    on conflict (slot) do update set tick=excluded.tick,
      units=case when w.tick=excluded.tick then w.units+excluded.units else excluded.units end;
  update notification_fanout.dispatch_jobs set qa_expo_grant_lease=p_lease,qa_expo_grant_units=p_units where id=p_job;
  return 'granted';
end $$;
revoke all on function public.qa_reserve_ordinary_expo_batch(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.qa_reserve_ordinary_expo_batch(uuid,uuid,integer) to service_role;
commit;
