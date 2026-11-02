-- Fixed, no-data proof for trusted service callers during API-key migration.
-- Invoke through the Data API using an unprivileged apikey and the incoming
-- bearer: the gateway authenticates it, and this function checks the invoker.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
declare existing pg_catalog.pg_proc;
begin
  if to_regprocedure('auth.jwt()') is null then
    raise exception 'Service authorization proof requires auth.jwt()';
  end if;
  select * into existing from pg_catalog.pg_proc
    where oid=to_regprocedure('public.authorize_legacy_push_service()');
  if found then
    -- Keep an identical previously installed proof unchanged. An unexpected
    -- implementation needs review; never silently replace or weaken it.
    if existing.prokind<>'f' or existing.prorettype<>'boolean'::regtype
      or existing.proretset or existing.prosecdef or existing.proisstrict
      or existing.provolatile<>'s' or existing.proleakproof
      or existing.prolang<>(select oid from pg_catalog.pg_language where lanname='sql')
      or existing.proconfig is distinct from array['search_path=""']::text[]
      or btrim(existing.prosrc,E' \t\r\n') is distinct from 'SELECT current_user=''service_role'' AND auth.jwt()->>''role''=''service_role'';'
    then
      raise exception 'Existing service authorization proof differs; review before installation';
    end if;
  else
    execute $ddl$
      create function public.authorize_legacy_push_service()
      returns boolean language sql stable security invoker set search_path='' as $auth$
 SELECT current_user='service_role' AND auth.jwt()->>'role'='service_role';
$auth$;
    $ddl$;
  end if;
end
$guard$;

revoke all on function public.authorize_legacy_push_service() from public,anon,authenticated;
grant execute on function public.authorize_legacy_push_service() to service_role;
do $acl$
begin
  if exists(
    select 1 from pg_catalog.pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid='public.authorize_legacy_push_service()'::regprocedure
      and a.grantee not in(p.proowner,(select oid from pg_catalog.pg_roles where rolname='service_role'))
  ) then
    raise exception 'Unexpected service authorization proof grants; review before installation';
  end if;
end
$acl$;
commit;
