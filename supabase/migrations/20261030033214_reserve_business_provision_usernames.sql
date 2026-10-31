-- Reject reserved route handles before the server asks Auth to create a business
-- identity. The profile trigger remains the final direct-write safeguard.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare source text; anchor text:='   username_value:=lower(btrim(application.desired_username));';
begin
 if current_user<>'postgres' then raise exception 'BUSINESS_ROUTE_RESERVATION_POSTGRES_REQUIRED';end if;
 perform pg_advisory_xact_lock(77123,1);
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)')
  and md5(pg_get_functiondef(oid))='def6cbc9557e3ec5fa22ce85b003a291'
  and proacl::text='{postgres=X/postgres,service_role=X/postgres}' and pg_get_userbyid(proowner)='postgres')
  or not exists(select 1 from pg_proc where oid=to_regprocedure('app_routes.is_reserved_username(text)')
   and md5(pg_get_functiondef(oid))='7131f4adec0b5325d873d73cb0623707' and pg_get_userbyid(proowner)='postgres') then
  raise exception 'BUSINESS_ROUTE_RESERVATION_BASELINE_DRIFT';end if;
 if exists(select 1 from admin_ops.provisions where kind='business' and completed_at is null
  and app_routes.is_reserved_username(snapshot->>'desired_username')) then
  raise exception 'BUSINESS_ROUTE_RESERVATION_PENDING_REVIEW';end if;
 source:=pg_get_functiondef('public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)'::regprocedure);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
  raise exception 'BUSINESS_ROUTE_RESERVATION_ANCHOR_DRIFT';end if;
 source:=replace(source,anchor,anchor||E'\n   if app_routes.is_reserved_username(username_value) then raise exception \'USERNAME_ALREADY_IN_USE\';end if;');
 execute source;
end $patch$;
-- CREATE OR REPLACE retains the server-only execution grant and empty path.
notify pgrst,'reload schema';
commit;
