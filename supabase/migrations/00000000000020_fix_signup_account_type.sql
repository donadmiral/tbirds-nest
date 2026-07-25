-- 0020_fix_signup_account_type.sql
-- handle_new_user set account_type to 'asu' or 'public', never 'personal'.
-- Every existing row is personal or business, so they were normalised once by
-- hand, but every new signup since has been landing outside the two values the
-- app actually uses. get_my_account_type() would return 'public' for them.
--
-- Fixed here, the school stamping removed with it, and a constraint added so it
-- cannot drift again. The user_presence insert is kept.

-- Normalise anything stray before constraining.
update public.profiles
   set account_type = 'personal'
 where account_type is null
    or account_type not in ('personal', 'business');

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.profiles'::regclass
                   and conname = 'profiles_account_type_check') then
    alter table public.profiles
      add constraint profiles_account_type_check
      check (account_type in ('personal', 'business'));
  end if;
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profiles (id, email, full_name, account_type)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'personal'
  );

  insert into public.user_presence (user_id) values (new.id);
  return new;
end;
$fn$;