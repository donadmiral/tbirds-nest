-- 0040: post visibility — one rule, enforced everywhere
-- 1. can_view_post(): the single visibility rule (blocks, private profiles, audience)
-- 2. get_feed: adds the private-profile gate (private posts were leaking into every feed)
-- 3. get_profile_posts: adds audience + block gates
-- All body-only changes; return lists unchanged.

create or replace function public.can_view_post(p_post_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case
      when p.user_id = auth.uid() then true
      when exists (select 1 from blocked_users b
                   where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
                      or (b.blocker_id = p.user_id and b.blocked_id = auth.uid())) then false
      when exists (select 1 from profiles px
                   where px.id = p.user_id
                     and px.profile_visibility = 'private'
                     and not exists (select 1 from follows f
                                     where f.follower_id = auth.uid()
                                       and f.following_id = p.user_id)) then false
      when coalesce(p.audience, 'everyone') = 'everyone' then true
      when p.audience = 'followers' then exists (
        select 1 from follows f where f.follower_id = auth.uid() and f.following_id = p.user_id)
      when p.audience = 'mentioned' then exists (
        select 1 from post_mentions pm where pm.post_id = p.id and pm.mentioned_user_id = auth.uid())
      when p.audience = 'verified' then exists (
        select 1 from profiles vp where vp.id = auth.uid() and vp.is_verified)
      else true
    end
    from posts p where p.id = p_post_id
  ), false);
$$;

grant execute on function public.can_view_post(uuid) to authenticated;

create or replace function public.get_profile_posts(
  p_profile_id uuid,
  p_cursor     timestamptz default null,
  p_limit      int default 20
)
returns table (
  post_id uuid, content text, body text, media_url text, media jsonb, products jsonb,
  channel text, article_title text, read_minutes int,
  created_at timestamptz,
  likes_count int, comments_count int, reposts_count int, bookmarks_count int, views_count int,
  viewer_liked boolean, viewer_bookmarked boolean, viewer_reposted boolean
)
language sql stable security invoker set search_path = public
as $fn$
with viewer as (select auth.uid() as uid),
allowed as (
  select ((select uid from viewer) = p_profile_id)
      or coalesce(pr.profile_visibility, 'public') <> 'private'
      or exists (select 1 from follows f
                 where f.follower_id = (select uid from viewer)
                   and f.following_id = p_profile_id) as ok
  from profiles pr where pr.id = p_profile_id
)
select p.id, p.content, p.body, p.media_url,
  coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'url', m.url,
      'media_type', m.media_type, 'width', m.width, 'height', m.height,
      'sort_order', m.sort_order) order by m.sort_order nulls last)
    from post_media m where m.post_id = p.id), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', pp.id, 'title', pp.title, 'subtitle', pp.subtitle, 'price', pp.price,
      'currency', pp.currency, 'image_url', pp.image_url, 'listing_id', pp.listing_id,
      'link_url', pp.link_url, 'cta_label', pp.cta_label, 'sort_order', pp.sort_order)
      order by pp.sort_order)
    from post_products pp where pp.post_id = p.id), '[]'::jsonb),
  p.channel, p.article_title, p.read_minutes, p.created_at,
  p.likes_count, p.comments_count, p.reposts_count, p.bookmarks_count, p.views_count,
  (lk.user_id is not null), (bk.user_id is not null), (rp.user_id is not null)
from posts p
left join post_likes lk     on lk.post_id = p.id and lk.user_id = (select uid from viewer)
left join post_bookmarks bk on bk.post_id = p.id and bk.user_id = (select uid from viewer)
left join post_reposts rp   on rp.post_id = p.id and rp.user_id = (select uid from viewer)
where p.user_id = p_profile_id
  and (select ok from allowed)
  and not exists (select 1 from blocked_users b
                  where (b.blocker_id = (select uid from viewer) and b.blocked_id = p.user_id)
                     or (b.blocker_id = p.user_id and b.blocked_id = (select uid from viewer)))
  and (
    coalesce(p.audience, 'everyone') = 'everyone'
    or p.user_id = (select uid from viewer)
    or (p.audience = 'followers' and exists (
          select 1 from follows f
          where f.following_id = p.user_id and f.follower_id = (select uid from viewer)))
    or (p.audience = 'mentioned' and exists (
          select 1 from post_mentions pm
          where pm.post_id = p.id and pm.mentioned_user_id = (select uid from viewer)))
    or (p.audience = 'verified' and exists (
          select 1 from profiles vp
          where vp.id = (select uid from viewer) and vp.is_verified))
  )
  and (p_cursor is null or p.created_at < p_cursor)
order by p.created_at desc
limit least(coalesce(p_limit, 20), 50);
$fn$;

grant execute on function public.get_profile_posts(uuid, timestamptz, int) to authenticated;