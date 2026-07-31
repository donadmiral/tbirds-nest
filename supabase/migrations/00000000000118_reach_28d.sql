-- 0118 Reach becomes defensible: the distinct people who saw ANY of
-- your content - posts or stories - in the last 28 days, never counting
-- yourself. The old all-time post-only number stays untouched inside
-- get_profile; the app simply prefers this answer.

create or replace function public.get_profile_reach_28d(p_profile_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $fn$
  select count(distinct u)::int from (
    select s.user_id as u
    from post_seen s
    join posts p on p.id = s.post_id
    where p.user_id = p_profile_id
      and s.seen_at > now() - interval '28 days'
      and s.user_id <> p_profile_id
    union
    select v.user_id
    from story_views v
    join stories st on st.id = v.story_id
    where st.user_id = p_profile_id
      and v.viewed_at > now() - interval '28 days'
      and v.user_id <> p_profile_id
  ) x;
$fn$;

grant execute on function public.get_profile_reach_28d(uuid) to authenticated;