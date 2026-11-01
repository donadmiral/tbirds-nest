-- Scheduled maintenance carries one short-lived, one-use capability. A readable
-- provider queue must never contain a reusable worker or service credential.
-- The existing Edge API, token shape and bounded cleanup handler stay unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
set local search_path=pg_catalog;
lock table music_library.maintenance_worker in share row exclusive mode;
do $preflight$
begin
 if current_user<>'postgres' then raise exception 'MUSIC_DISPATCH_POSTGRES_REQUIRED';end if;
 if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
  or not coalesce(has_function_privilege('postgres',to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)'),'EXECUTE'),false)
  or to_regprocedure('public.claim_catalogue_upload_cleanup(uuid)') is null
  or to_regprocedure('public.validate_music_maintenance_worker(text)') is null
  or to_regprocedure('public.set_music_maintenance_ready(boolean,text)') is null then
  raise exception 'MUSIC_DISPATCH_PREREQUISITES_REQUIRED';
 end if;
 if to_regclass('music_library.maintenance_dispatch') is not null
  or to_regclass('music_library.maintenance_runs') is not null then
  raise exception 'MUSIC_DISPATCH_ALREADY_INSTALLED';
 end if;
 if (select count(*) from music_library.maintenance_worker)<>1
  or exists(select 1 from music_library.maintenance_worker where enabled or secret_digest is not null or last_seen_at is not null) then
  raise exception 'MUSIC_DISPATCH_LEGACY_WORKER_REVIEW';
 end if;
 if exists(select 1 from pg_proc p where p.oid in('public.validate_music_maintenance_worker(text)'::regprocedure,'public.set_music_maintenance_ready(boolean,text)'::regprocedure)
  and(pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']
   or has_function_privilege('anon',p.oid,'EXECUTE')or has_function_privilege('authenticated',p.oid,'EXECUTE')or not has_function_privilege('service_role',p.oid,'EXECUTE')))then
  raise exception 'MUSIC_DISPATCH_EXISTING_RPC_ACL_DRIFT';
 end if;
 if (select md5(prosrc) from pg_proc where oid='public.validate_music_maintenance_worker(text)'::regprocedure)<>'cee216310abc02a485b0e56de3d31a63'
  or (select md5(prosrc) from pg_proc where oid='public.set_music_maintenance_ready(boolean,text)'::regprocedure)<>'ddc31acede1cfb024e96443893ba3023' then
  raise exception 'MUSIC_DISPATCH_EXISTING_RPC_BODY_DRIFT';
 end if;
end $preflight$;

create table music_library.maintenance_dispatch(
 singleton boolean primary key default true check(singleton),
 revision uuid not null default gen_random_uuid(),
 project_origin text check(project_origin ~ '^https://[a-z0-9]+[.]supabase[.]co$'),
 worker_sha256 text check(worker_sha256 ~ '^[a-f0-9]{64}$'),
 verified_at timestamptz,
 check((project_origin is null and worker_sha256 is null and verified_at is null)
  or(project_origin is not null and worker_sha256 is not null and verified_at is not null))
);
insert into music_library.maintenance_dispatch(singleton) values(true);
create table music_library.maintenance_runs(
 id uuid primary key default gen_random_uuid(),
 dispatch_revision uuid not null,
 purpose text not null default 'music-maintenance' check(purpose='music-maintenance'),
 token_digest bytea not null unique check(octet_length(token_digest)=32),
 state text not null check(state in('prepared','queued','claimed','failed','revoked')),
 request_id bigint,
 created_at timestamptz not null,
 expires_at timestamptz not null,
 claimed_at timestamptz,
 error_code text check(error_code ~ '^[0-9A-Z]{5}$'),
 check(expires_at>created_at and expires_at<=created_at+interval '2 minutes'),
 check((state='claimed')=(claimed_at is not null)),
 check(claimed_at is null or(claimed_at>=created_at and claimed_at<expires_at)),
 check(state not in('queued','claimed')or request_id is not null)
);
create index maintenance_runs_retention on music_library.maintenance_runs(expires_at,id);
create index maintenance_runs_recent on music_library.maintenance_runs(created_at desc,id);
alter table music_library.maintenance_dispatch enable row level security;
alter table music_library.maintenance_runs enable row level security;
revoke all on music_library.maintenance_dispatch,music_library.maintenance_runs from public,anon,authenticated,service_role;

create function music_library.configure_maintenance_dispatch(p_project_origin text,p_worker_sha256 text)
returns void language plpgsql security invoker set search_path='' as $$
declare ready boolean;
begin
 if current_user<>'postgres' then raise exception 'MUSIC_DISPATCH_POSTGRES_REQUIRED';end if;
 select enabled into ready from music_library.maintenance_worker where singleton for update;
 if ready then raise exception 'MUSIC_DISPATCH_PAUSE_BEFORE_CONFIGURE';end if;
 if p_project_origin is null or p_project_origin !~ '^https://[a-z0-9]+[.]supabase[.]co$'
  or p_worker_sha256 is null or p_worker_sha256 !~ '^[a-f0-9]{64}$' then
  raise exception 'MUSIC_DISPATCH_VERIFIED_SOURCE_REQUIRED';
 end if;
 update music_library.maintenance_dispatch set revision=gen_random_uuid(),project_origin=p_project_origin,worker_sha256=p_worker_sha256,verified_at=clock_timestamp() where singleton;
 update music_library.maintenance_runs set state='revoked' where state in('prepared','queued');
end $$;

create or replace function public.set_music_maintenance_ready(p_ready boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_ready is null or length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'SERVICE_READINESS_REASON_REQUIRED';end if;
 perform 1 from music_library.maintenance_worker where singleton for update;
 if p_ready and not exists(select 1 from music_library.maintenance_dispatch where singleton and project_origin is not null and worker_sha256 is not null and verified_at is not null)then
  raise exception 'MUSIC_MAINTENANCE_VERIFIED_DISPATCH_REQUIRED';
 end if;
 update music_library.maintenance_worker set enabled=p_ready,updated_at=clock_timestamp(),last_seen_at=case when p_ready then last_seen_at else null end where singleton;
 if not p_ready then update music_library.maintenance_runs set state='revoked' where state in('prepared','queued');end if;
 insert into music_library.events(action,detail) values('maintenance.readiness',jsonb_build_object('ready',p_ready,'reason',p_reason,'authentication','one_use_capability'));
end $$;

-- Explicit operator-only bounded retention. Keep this DELETE visible to normal
-- provider confirmation. It removes only expired capability receipts, not media.
create function music_library.cleanup_maintenance_runs(p_limit integer default 500)
returns integer language plpgsql security invoker set search_path='' as $$
declare removed integer;
begin
 if current_user<>'postgres' then raise exception 'MUSIC_DISPATCH_POSTGRES_REQUIRED';end if;
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'MUSIC_DISPATCH_RETENTION_LIMIT';end if;
 delete from music_library.maintenance_runs where id in(
  select id from music_library.maintenance_runs where expires_at<clock_timestamp()-interval '7 days'
   order by expires_at,id for update skip locked limit p_limit
 );
 get diagnostics removed=row_count;return removed;
end $$;

create function music_library.enqueue_maintenance_run()
returns bigint language plpgsql security invoker set search_path='' as $$
declare ready boolean;config music_library.maintenance_dispatch;run uuid;token text;request bigint;
 created timestamptz;
begin
 if current_user<>'postgres' then raise exception 'MUSIC_DISPATCH_POSTGRES_REQUIRED';end if;
 select enabled into ready from music_library.maintenance_worker where singleton for update;
 if not coalesce(ready,false)then return null;end if;
 created:=clock_timestamp();
 select * into config from music_library.maintenance_dispatch where singleton;
 if config.project_origin is null or config.worker_sha256 is null or config.verified_at is null then raise exception 'MUSIC_MAINTENANCE_VERIFIED_DISPATCH_REQUIRED';end if;
 -- A retry returns the same queue receipt during the five-minute schedule window
 -- even after the one-use token was consumed. It cannot authorize another batch.
 select request_id into request from music_library.maintenance_runs where dispatch_revision=config.revision and state in('queued','claimed')and created_at>created-interval '5 minutes' order by created_at desc,id limit 1;
 if found then return request;end if;
 perform music_library.cleanup_maintenance_runs(500);
 created:=clock_timestamp();
 token:='pc_music_'||encode(extensions.gen_random_bytes(32),'hex');
 insert into music_library.maintenance_runs(dispatch_revision,token_digest,state,created_at,expires_at)
  values(config.revision,extensions.digest(token,'sha256'),'prepared',created,created+interval '2 minutes')returning id into run;
 begin
  select net.http_post(url:=config.project_origin||'/functions/v1/music-maintenance',
   headers:=jsonb_build_object('Authorization','Bearer '||token,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=50000)into request;
  if request is null then raise exception 'MUSIC_DISPATCH_NOT_QUEUED';end if;
  update music_library.maintenance_runs set state='queued',request_id=request where id=run;
 exception when others then
  update music_library.maintenance_runs set state='failed',error_code=sqlstate where id=run;
  return null;
 end;
 return request;
end $$;

create or replace function public.validate_music_maintenance_worker(p_token text)
returns boolean language plpgsql security definer set search_path='' as $$
declare ready boolean;run uuid;checked timestamptz;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_token is null or p_token !~ '^pc_music_[0-9a-f]{64}$'then return false;end if;
 -- Match the enqueue/disable lock order, then consume the digest atomically.
 select enabled into ready from music_library.maintenance_worker where singleton for update;
 if not coalesce(ready,false)then return false;end if;
 checked:=clock_timestamp();
 update music_library.maintenance_runs r set state='claimed',claimed_at=checked
 where r.token_digest=extensions.digest(p_token,'sha256')and r.purpose='music-maintenance'
  and r.state='queued'and r.request_id is not null and r.created_at<=checked and r.expires_at>checked
  and r.dispatch_revision=(select revision from music_library.maintenance_dispatch where singleton)
 returning r.id into run;
 if run is null then return false;end if;
 update music_library.maintenance_worker set last_seen_at=checked where singleton;
 return true;
end $$;
revoke all on function public.validate_music_maintenance_worker(text),public.set_music_maintenance_ready(boolean,text)from public,anon,authenticated,service_role;
grant execute on function public.validate_music_maintenance_worker(text),public.set_music_maintenance_ready(boolean,text)to service_role;
revoke all on function music_library.configure_maintenance_dispatch(text,text),music_library.cleanup_maintenance_runs(integer),music_library.enqueue_maintenance_run()from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
