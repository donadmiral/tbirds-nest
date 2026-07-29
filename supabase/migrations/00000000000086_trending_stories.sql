-- 0086 Trending stories: one bubble per person - their hottest public story
-- of the last 24 hours. Heat = views + reactions x2, floor of 3 views,
-- capped at a handful. The viewer's own gates still apply on open.

create or replace function public.get_trending_stories(p_limit int default 8)
returns table (
  story_id uuid, user_id uuid, full_name text, username text,
  avatar_url text, views int, reactions int, heat numeric
)
language sql stable security invoker set search_path = public
as $fn$
  select x.story_id, x.user_id, x.full_name, x.username, x.avatar_url,
         x.views, x.reactions, x.heat
  from (
    select distinct on (s.user_id)
      s.id as story_id, s.user_id, p.full_name, p.username, p.avatar_url,
      (select count(*) from story_views v where v.story_id = s.id)::int as views,
      (select count(*) from story_reactions r where r.story_id = s.id)::int as reactions,
      ((select count(*) from story_views v where v.story_id = s.id)
       + (select count(*) from story_reactions r where r.story_id = s.id) * 2.0) as heat
    from stories s
    join profiles p on p.id = s.user_id
    where s.created_at > now() - interval '24 hours'
      and coalesce(s.audience, 'everyone') = 'everyone'
    order by s.user_id, heat desc
  ) x
  where x.views >= 3
  order by x.heat desc, x.views desc
  limit least(greatest(coalesce(p_limit, 8), 1), 12);
$fn$;

grant execute on function public.get_trending_stories(int) to authenticated;