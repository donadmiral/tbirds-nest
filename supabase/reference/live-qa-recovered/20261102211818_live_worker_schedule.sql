-- The scheduler advances already-authorized Live control and cover cleanup only. Its
-- transport-visible token is single-use, short-lived, and never a service key.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table live_streams.worker_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  project_origin text check (project_origin ~ '^https://[a-z0-9]{20}[.]supabase[.]co$'),
  max_parallel integer not null default 1 check (max_parallel between 1 and 1),
  last_issued_at timestamptz,
  last_completed_at timestamptz,
  last_failed_at timestamptz,
  check (not enabled or project_origin is not null)
);
insert into live_streams.worker_settings(singleton) values (true);

create table live_streams.worker_ticks (
  digest bytea primary key check (octet_length(digest) = 32),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  finished_at timestamptz,
  succeeded boolean,
  check (expires_at > created_at and expires_at <= created_at + interval '2 minutes'),
  check (finished_at is null or consumed_at is not null)
);
create index live_worker_ticks_active on live_streams.worker_ticks(expires_at)
  where finished_at is null;
create index live_worker_ticks_expiry on live_streams.worker_ticks(expires_at);
alter table live_streams.worker_settings enable row level security;
alter table live_streams.worker_ticks enable row level security;
revoke all on live_streams.worker_settings, live_streams.worker_ticks
  from public, anon, authenticated, service_role;

create function public.configure_live_worker_v1(p_origin text, p_enabled boolean, p_parallel integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $body$
begin
  if p_enabled is null or p_parallel is null or p_parallel not between 1 and 1
    or p_origin is null or p_origin !~ '^https://[a-z0-9]{20}[.]supabase[.]co$' then
    raise exception 'Invalid Live worker configuration';
  end if;
  update live_streams.worker_settings set project_origin = p_origin,
    enabled = p_enabled, max_parallel = p_parallel where singleton;
  return jsonb_build_object('enabled', p_enabled, 'max_parallel', p_parallel);
end $body$;

create function public.validate_live_worker_tick_v1(p_token text)
returns boolean language plpgsql security definer set search_path = '' as $body$
declare matched bytea;
begin
  if auth.jwt()->>'role' is distinct from 'service_role'
    or p_token is null or p_token !~ '^pc_live_[a-f0-9]{64}$'
    or not exists(select 1 from live_streams.worker_settings where singleton and enabled) then
    return false;
  end if;
  update live_streams.worker_ticks set consumed_at = clock_timestamp()
    where digest = extensions.digest(p_token, 'sha256') and consumed_at is null
      and finished_at is null and expires_at > clock_timestamp()
    returning digest into matched;
  return matched is not null;
end $body$;

create function public.finish_live_worker_tick_v1(p_token text, p_succeeded boolean)
returns boolean language plpgsql security definer set search_path = '' as $body$
declare finished timestamptz := clock_timestamp(); matched bytea;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' or p_succeeded is null
    or p_token is null or p_token !~ '^pc_live_[a-f0-9]{64}$' then return false; end if;
  update live_streams.worker_ticks set finished_at = finished, succeeded = p_succeeded
    where digest = extensions.digest(p_token, 'sha256') and consumed_at is not null
      and finished_at is null and expires_at > finished returning digest into matched;
  if matched is null then return false; end if;
  update live_streams.worker_settings set
    last_completed_at = case when p_succeeded then finished else last_completed_at end,
    last_failed_at = case when not p_succeeded then finished else last_failed_at end where singleton;
  return true;
end $body$;

create function live_streams.enqueue_worker_tick()
returns bigint language plpgsql security definer set search_path = '' as $body$
declare settings live_streams.worker_settings%rowtype;
  issued timestamptz := clock_timestamp(); token text; request_id bigint; active_count integer;
begin
  select * into settings from live_streams.worker_settings where singleton for update skip locked;
  if not found or not settings.enabled or settings.project_origin is null
    or settings.last_issued_at > issued - interval '55 seconds' then return null; end if;
  select count(*) into active_count from live_streams.worker_ticks
    where finished_at is null and expires_at > issued;
  if active_count >= settings.max_parallel then return null; end if;
  -- One short-lived credential per minute bounds maintenance fanout.
  token := 'pc_live_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into live_streams.worker_ticks(digest, created_at, expires_at)
    values(extensions.digest(token, 'sha256'), issued, issued + interval '2 minutes');
  select net.http_post(url := settings.project_origin || '/functions/v1/live-maintenance',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || token),
    body := '{}'::jsonb, timeout_milliseconds := 30000) into request_id;
  update live_streams.worker_settings set last_issued_at = issued where singleton;
  delete from live_streams.worker_ticks where digest in (
    select digest from live_streams.worker_ticks where expires_at < issued - interval '1 day'
      order by expires_at for update skip locked limit 100);
  return request_id;
end $body$;

create function public.live_worker_status_v1()
returns jsonb language sql stable security definer set search_path = '' as $body$
  select jsonb_build_object('enabled', s.enabled, 'max_parallel', s.max_parallel,
    'last_issued_at', s.last_issued_at, 'last_completed_at', s.last_completed_at,
    'last_failed_at', s.last_failed_at, 'active_ticks', (
      select count(*) from live_streams.worker_ticks where finished_at is null and expires_at > now()))
  from live_streams.worker_settings s where s.singleton;
$body$;

revoke all on function live_streams.enqueue_worker_tick() from public, anon, authenticated, service_role;
revoke all on function public.configure_live_worker_v1(text,boolean,integer),
  public.validate_live_worker_tick_v1(text), public.finish_live_worker_tick_v1(text,boolean),
  public.live_worker_status_v1() from public, anon, authenticated;
grant execute on function public.configure_live_worker_v1(text,boolean,integer),
  public.validate_live_worker_tick_v1(text), public.finish_live_worker_tick_v1(text,boolean),
  public.live_worker_status_v1() to service_role;

do $body$ begin
  if exists(select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('platinum-live-worker', '* * * * *', 'select live_streams.enqueue_worker_tick()');
  end if;
end $body$;
commit;
