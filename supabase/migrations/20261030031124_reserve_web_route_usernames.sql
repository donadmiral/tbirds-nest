-- Reserve actual web root routes without renaming or rewriting any account.
-- A collision aborts before installation so the route rollout can be held.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.profiles in share row exclusive mode;
do $preflight$
begin
 if current_user<>'postgres' then raise exception 'ROUTE_RESERVATION_POSTGRES_REQUIRED';end if;
 if to_regnamespace('app_routes') is not null then raise exception 'ROUTE_RESERVATION_TARGET_EXISTS';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.is_username_available(text)')
  and md5(pg_get_functiondef(oid))='dca1048f7c4ce81e552d3992f07e1e11' and pg_get_userbyid(proowner)='postgres') then
  raise exception 'ROUTE_RESERVATION_BASELINE_DRIFT';end if;
 if exists(select 1 from public.profiles where lower(btrim(username))=any(array[
  'about','account-deletion','ads','album','archive','business-login','businesses','calls','channels','communities','discover','explore',
  'forgot-password','home','jobs','login','market','messages','monetization','music','notifications','post','privacy','reset-password',
  'saved','search','settings','signup','story','studio','terms','topic','watch','write'])) then
  raise exception 'ROUTE_RESERVATION_EXISTING_HANDLE_COLLISION';end if;
end $preflight$;

create schema app_routes;
revoke all on schema app_routes from public,anon,authenticated,service_role;
create function app_routes.is_reserved_username(p_username text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(lower(btrim(p_username))=any(array[
  'about','account-deletion','ads','album','archive','business-login','businesses','calls','channels','communities','discover','explore',
  'forgot-password','home','jobs','login','market','messages','monetization','music','notifications','post','privacy','reset-password',
  'saved','search','settings','signup','story','studio','terms','topic','watch','write']),false);
$$;
create function app_routes.guard_profile_username() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.username is not distinct from old.username then return new;end if;
 if app_routes.is_reserved_username(new.username) then
  raise exception 'That username is reserved for an app page. Choose another username.' using errcode='23514';end if;
 return new;
end $$;
create trigger guard_reserved_web_username before insert or update of username on public.profiles
 for each row execute function app_routes.guard_profile_username();
revoke all on all functions in schema app_routes from public,anon,authenticated,service_role;

create or replace function public.is_username_available(p_username text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_username is not null
  and length(btrim(p_username)) between 3 and 30
  and btrim(p_username) ~ '^[a-z0-9_]+$'
  and not app_routes.is_reserved_username(p_username)
  and not exists(select 1 from public.profiles where lower(username)=lower(btrim(p_username)));
$$;
revoke all on function public.is_username_available(text) from public,anon,authenticated,service_role;
grant execute on function public.is_username_available(text) to anon,authenticated,service_role;
commit;
