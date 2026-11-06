-- /live is an application route, so new profile and business handles cannot use it.
-- Existing identities and unfinished provisions require review, never automatic renaming.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare source text; anchor text; pending_live_provision boolean; legacy_production boolean:=false;
begin
 if current_user<>'postgres' then raise exception 'LIVE_ROUTE_RESERVATION_POSTGRES_REQUIRED';end if;
 perform pg_advisory_xact_lock(77123,1);
 lock table public.profiles in share row exclusive mode;
 if exists(select 1 from pg_proc where oid=to_regprocedure('app_routes.is_reserved_username(text)')
  and md5(pg_get_functiondef(oid))='7131f4adec0b5325d873d73cb0623707' and pg_get_userbyid(proowner)='postgres') then
  legacy_production:=false;
 elsif to_regnamespace('app_routes') is null
  and exists(select 1 from pg_proc where oid=to_regprocedure('public.is_username_available(text)')
   and md5(pg_get_functiondef(oid))='dca1048f7c4ce81e552d3992f07e1e11' and pg_get_userbyid(proowner)='postgres')
  and to_regprocedure('public.guard_live_route_username()') is null
  and not exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass
   and tgname in('guard_reserved_web_username','guard_reserved_live_username')) then
  -- The deployed production baseline predates the broader route guards. Reserve
  -- only /live here, without installing unrelated schema or changing other handles.
  legacy_production:=true;
 else raise exception 'LIVE_ROUTE_RESERVATION_BASELINE_DRIFT';end if;
 if exists(select 1 from public.profiles where lower(btrim(username))='live') then
  raise exception 'LIVE_ROUTE_RESERVATION_EXISTING_HANDLE_COLLISION';end if;
 if to_regclass('admin_ops.provisions') is not null then
  execute 'lock table admin_ops.provisions in share row exclusive mode';
  execute 'select exists(select 1 from admin_ops.provisions where kind=''business'' and completed_at is null
   and lower(btrim(snapshot->>''desired_username''))=''live'')' into pending_live_provision;
  if pending_live_provision then raise exception 'LIVE_ROUTE_RESERVATION_PENDING_REVIEW';end if;
 end if;
 if legacy_production then
  source:=pg_get_functiondef('public.is_username_available(text)'::regprocedure);
  anchor:='     and not exists (select 1 from profiles where lower(username) = lower(trim(p_username)));';
  if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
   raise exception 'LIVE_ROUTE_RESERVATION_ANCHOR_DRIFT';end if;
  execute replace(source,anchor,E'     and lower(trim(p_username)) <> ''live''\n'||anchor);
  execute $ddl$
   create function public.guard_live_route_username() returns trigger
   language plpgsql set search_path='' as $guard$
   begin
    if tg_op='UPDATE' and new.username is not distinct from old.username then return new;end if;
    if lower(btrim(new.username))='live' then
     raise exception 'That username is reserved for an app page. Choose another username.' using errcode='23514';end if;
    return new;
   end $guard$
  $ddl$;
  revoke all on function public.guard_live_route_username() from public,anon,authenticated,service_role;
  create trigger guard_reserved_live_username before insert or update of username on public.profiles
   for each row execute function public.guard_live_route_username();
 else
  source:=pg_get_functiondef('app_routes.is_reserved_username(text)'::regprocedure);
  anchor:='''jobs'',''login''';
  if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
   raise exception 'LIVE_ROUTE_RESERVATION_ANCHOR_DRIFT';end if;
  execute replace(source,anchor,'''jobs'',''live'',''login''');
 end if;
end $patch$;
-- CREATE OR REPLACE preserves the patched function's owner, grants and search path.
notify pgrst,'reload schema';
commit;
