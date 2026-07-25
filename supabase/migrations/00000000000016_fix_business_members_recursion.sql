-- 0016_fix_business_members_recursion.sql
-- The policies from 0013 queried business_members from inside a policy ON
-- business_members, which Postgres rejects as infinite recursion (42P17).
--
-- Fix: put the membership lookup in a SECURITY DEFINER function. It runs as the
-- owner, so it does not re-enter RLS, and the policy calls that instead of
-- querying the table it is guarding.

create or replace function public.is_business_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from business_members
    where business_id = p_business_id and member_id = auth.uid()
  );
$fn$;

create or replace function public.is_business_owner(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from business_members
    where business_id = p_business_id and member_id = auth.uid() and role = 'owner'
  );
$fn$;

grant execute on function public.is_business_member(uuid) to authenticated;
grant execute on function public.is_business_owner(uuid) to authenticated;

drop policy if exists business_members_select on public.business_members;
create policy business_members_select on public.business_members
  for select to authenticated
  using (member_id = auth.uid() or is_business_member(business_id));

drop policy if exists business_members_write_owner on public.business_members;
create policy business_members_write_owner on public.business_members
  for all to authenticated
  using (is_business_owner(business_id))
  with check (is_business_owner(business_id));