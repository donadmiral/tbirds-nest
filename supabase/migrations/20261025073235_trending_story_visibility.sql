-- A ranking snapshot is not an access grant. Recheck the live story and
-- the viewer's current privacy preferences whenever a ranked row is read.
begin;
set local lock_timeout = '3s';

create or replace function public.can_discover_story(p_story_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.stories s
    join public.profiles p on p.id = s.user_id
    where s.id = p_story_id
      and s.expires_at > now() and s.created_at <= now()
      and s.created_at > now() - interval '24 hours'
      and coalesce(s.audience, 'everyone') = 'everyone'
      and coalesce(p.profile_visibility, 'public') = 'public'
      and p.deactivated_at is null
      and (s.reach = 'wider' or s.user_id = auth.uid() or exists (
        select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = s.user_id))
      and public.viewer_can_see_story(s.id)
      and not exists (select 1 from public.blocked_users b
        where (b.blocker_id = auth.uid() and b.blocked_id = s.user_id)
           or (b.blocker_id = s.user_id and b.blocked_id = auth.uid()))
      and not exists (select 1 from public.muted_stories m
        where m.user_id = auth.uid() and m.muted_id = s.user_id)
      and not exists (select 1 from public.muted_authors m
        where m.user_id = auth.uid() and m.author_id = s.user_id)
  );
$$;
revoke all on function public.can_discover_story(uuid) from public, anon;
grant execute on function public.can_discover_story(uuid) to authenticated;

-- Protect direct snapshot reads as well as the public RPC. An overdue refresh
-- must not turn yesterday's ranking into an indefinitely cached discovery feed.
drop policy if exists trending_story_current_visibility on public.trending_snapshot;
create policy trending_story_current_visibility on public.trending_snapshot
as restrictive for select to authenticated using (
  kind <> 'story' or (
    computed_at > now() - interval '15 minutes'
    and computed_at <= now()
    and public.can_discover_story(ref_id)
  )
);

create or replace function public.get_trending_stories(p_limit integer default 6)
returns table(story_id uuid, user_id uuid, full_name text, username text,
  avatar_url text, views integer, reactions integer, heat numeric)
language sql stable security invoker set search_path = '' as $$
  select t.ref_id, s.user_id, p.full_name, p.username, p.avatar_url,
    t.uniq_engagers, 0, t.heat
  from public.trending_snapshot t
  join public.stories s on s.id = t.ref_id and s.user_id = t.user_id
  join public.profiles p on p.id = s.user_id
  where t.kind = 'story'
    and t.computed_at > now() - interval '15 minutes'
    and t.computed_at <= now()
    and public.can_discover_story(s.id)
  order by t.rank, t.ref_id
  limit least(greatest(coalesce(p_limit, 6), 1), 12);
$$;
revoke all on function public.get_trending_stories(integer) from public, anon;
grant execute on function public.get_trending_stories(integer) to authenticated;
commit;
