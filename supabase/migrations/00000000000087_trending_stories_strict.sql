-- 0087 Trending stories, strict. A trending rail must be comfortable empty:
-- the owner no longer counts toward their own heat, the floor rises to 10
-- outside views plus at least 1 reaction, and the cap tightens to 6. These
-- are launch constants - tune upward as real traffic arrives.

create or replace function public.get_trending_stories(p_limit int default 6)
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
      (select count(*) from story_views v
        where v.story_id = s.id and v.user_id <> s.user_id)::int as views,
      (select count(*) from story_reactions r
        where r.story_id = s.id and r.user_id <> s.user_id)::int as reactions,
      ((select count(*) from story_views v
         where v.story_id = s.id and v.user_id <> s.user_id)
       + (select count(*) from story_reactions r
          where r.story_id = s.id and r.user_id <> s.user_id) * 2.0) as heat
    from stories s
    join profiles p on p.id = s.user_id
    where s.created_at > now() - interval '24 hours'
      and coalesce(s.audience, 'everyone') = 'everyone'
    order by s.user_id, heat desc
  ) x
  where x.views >= 10 and x.reactions >= 1
  order by x.heat desc, x.views desc
  limit least(greatest(coalesce(p_limit, 6), 1), 6);
$fn$;

grant execute on function public.get_trending_stories(int) to authenticated;