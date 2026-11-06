-- Current member clients sign in via the server-side function. Only that
-- trusted service needs to resolve a handle to an email before authentication.
set local lock_timeout = '2s';
do $guard$ begin
 if (select md5(prosrc) from pg_proc where oid='public.email_for_username(text)'::regprocedure)
    is distinct from 'd0dc6a86fc8116504142bb81b954f185' then
  raise exception 'USERNAME_LOOKUP_BASELINE_CHANGED';
 end if;
end $guard$;
revoke all on function public.email_for_username(text) from public, anon, authenticated;
grant execute on function public.email_for_username(text) to service_role;
notify pgrst, 'reload schema';
