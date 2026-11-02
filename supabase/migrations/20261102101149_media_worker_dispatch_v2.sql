-- An inert, bounded dispatcher for the independently scaled media worker.
-- Secrets are inserted separately through the operator's protected connection.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create table media_renditions.worker_dispatch (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 origin text check(origin is null or origin ~ '^https://[a-z0-9][a-z0-9.-]*[a-z0-9]$'),
 cron_secret_id uuid,
 last_request_id bigint,last_request_at timestamptz,
 last_http_status integer,last_response_at timestamptz,last_error boolean not null default false
);
insert into media_renditions.worker_dispatch(singleton) values(true);
alter table media_renditions.worker_dispatch enable row level security;
revoke all on media_renditions.worker_dispatch from public,anon,authenticated,service_role;
create function public.dispatch_media_worker_v2() returns bigint
language plpgsql security definer set search_path='' as $$
declare c media_renditions.worker_dispatch;credential text;request_id bigint;
begin
 select * into c from media_renditions.worker_dispatch where singleton for update;
 if not c.enabled or c.origin is null or c.cron_secret_id is null
  or c.last_request_at>clock_timestamp()-interval '55 seconds'
  or not exists(select 1 from media_renditions.settings where (worker_enabled or maintenance_enabled) and not emergency_revoke) then return null;end if;
 if c.last_request_id is not null then
  update media_renditions.worker_dispatch set last_http_status=r.status_code,last_response_at=r.created,last_error=r.error_msg is not null
   from net._http_response r where singleton and r.id=c.last_request_id;
 end if;
 select decrypted_secret into credential from vault.decrypted_secrets where id=c.cron_secret_id;
 if credential is null or length(credential)<32 then raise exception 'Media dispatch credential unavailable';end if;
 select net.http_get(url=>c.origin||'/drain',headers=>jsonb_build_object('Authorization','Bearer '||credential),timeout_milliseconds=>250000) into request_id;
 update media_renditions.worker_dispatch set last_request_id=request_id,last_request_at=clock_timestamp() where singleton;
 return request_id;
end $$;
create function public.media_worker_dispatch_status_v2() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',enabled,'last_request_at',last_request_at,'last_http_status',last_http_status,
  'last_response_at',last_response_at,'last_error',last_error) from media_renditions.worker_dispatch where singleton
$$;
revoke all on function public.dispatch_media_worker_v2() from public,anon,authenticated;
revoke all on function public.media_worker_dispatch_status_v2() from public,anon,authenticated;
grant execute on function public.dispatch_media_worker_v2() to service_role;
grant execute on function public.media_worker_dispatch_status_v2() to service_role;
do $$begin
 if exists(select 1 from pg_extension where extname='pg_cron') and exists(select 1 from pg_extension where extname='pg_net') then
  perform cron.schedule('media-worker-dispatch-v2','* * * * *','select public.dispatch_media_worker_v2()');
 end if;
end $$;
commit;
