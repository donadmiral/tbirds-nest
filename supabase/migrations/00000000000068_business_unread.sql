-- 0068 v2: business inbox unread. Gate written inline against
-- business_members (business_id, member_id) — no helper fn exists.

create or replace function public.get_business_unread(p_business_id uuid)
returns int language sql stable security definer set search_path = public
as $fn$
  select case when exists (
    select 1 from business_members bm
    where bm.business_id = p_business_id and bm.member_id = auth.uid()
  ) then (
    select count(*)::int from messages m
    where m.receiver_id = p_business_id
      and m.read_at is null
      and m.deleted_at is null
  ) else 0 end;
$fn$;

grant execute on function public.get_business_unread(uuid) to authenticated;