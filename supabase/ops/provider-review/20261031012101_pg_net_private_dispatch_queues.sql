-- HTTP request headers can contain server credentials. Keep the extension
-- worker and trusted server operators, while removing application access.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $preflight$
begin
 if to_regclass('net.http_request_queue') is null
  or to_regclass('net._http_response') is null then
  raise exception 'PG_NET_TABLES_REQUIRED';
 end if;
end $preflight$;
grant all on table net.http_request_queue,net._http_response
 to postgres,service_role,supabase_functions_admin;
revoke all on table net.http_request_queue,net._http_response
 from public,anon,authenticated;
do $postflight$
declare target regclass; app_role text; server_role text;
begin
 foreach target in array array['net.http_request_queue'::regclass,'net._http_response'::regclass] loop
  foreach app_role in array array['anon','authenticated'] loop
   if has_table_privilege(app_role,target,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception 'PG_NET_APP_PRIVILEGES_REMAIN';
   end if;
  end loop;
  foreach server_role in array array['postgres','service_role','supabase_functions_admin'] loop
   if not has_table_privilege(server_role,target,'SELECT')
    or not has_table_privilege(server_role,target,'INSERT')
    or not has_table_privilege(server_role,target,'DELETE') then
    raise exception 'PG_NET_SERVER_PRIVILEGES_REQUIRED';
   end if;
  end loop;
 end loop;
end $postflight$;
commit;
