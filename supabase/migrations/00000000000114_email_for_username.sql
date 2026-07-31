-- 0114 Username sign-in for the signed-out. RLS rightly hides profiles
-- from anonymous visitors, so the login screen could never resolve a
-- handle to its address. This definer function answers exactly one
-- question and nothing more.

create or replace function public.email_for_username(p_username text)
returns text
language sql
security definer
set search_path = public
stable
as $fn$
  select email from profiles
   where lower(username) = lower(trim(both '@' from p_username))
   limit 1;
$fn$;

grant execute on function public.email_for_username(text) to anon, authenticated;