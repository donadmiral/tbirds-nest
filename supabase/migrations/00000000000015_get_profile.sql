-- 0015_get_profile.sql
-- One call for everything a profile screen needs.
--
-- Replaces: 6 count queries in ProfileScreen (4 of them against the retired
-- connections table) and 5 more in UserProfileScreen. Follower and following
-- counts are computed rather than stored, because profiles.connections_count
-- already proved that a counter column nobody maintains drifts into fiction.
--
-- Also carries the business extension inline, so a company profile renders
-- through the same screen as a person rather than needing its own.
--
-- can_view_content answers the private-account question once, server side, so
-- the UI never has to reason about it.

create or replace function public.get_profile(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_me uuid := auth.uid();
  v_row profiles;
  v_follows boolean;
  v_requested boolean;
  v_result jsonb;
begin
  select * into v_row from profiles where id = p_profile_id;
  if v_row.id is null then raise exception 'Profile not found'; end if;

  v_follows := exists (
    select 1 from follows
    where follower_id = v_me and following_id = p_profile_id);

  v_requested := exists (
    select 1 from follow_requests
    where requester_id = v_me and target_id = p_profile_id and status = 'pending');

  select jsonb_build_object(
    'id',                 v_row.id,
    'full_name',          v_row.full_name,
    'username',           v_row.username,
    'avatar_url',         v_row.avatar_url,
    'banner_url',         v_row.banner_url,
    'bio',                v_row.bio,
    'headline',           v_row.headline,
    'workplace',          v_row.workplace,
    'location',           v_row.location,
    'profile_visibility', coalesce(v_row.profile_visibility, 'public'),
    'account_type',       coalesce(v_row.account_type, 'personal'),
    'is_verified',        coalesce(v_row.is_verified, false),
    'joined_at',          v_row.created_at,

    'is_self',            (v_me = p_profile_id),
    'viewer_follows',     v_follows,
    'viewer_requested',   v_requested,

    -- A private profile's posts are visible to itself and to its followers only.
    'can_view_content',   (v_me = p_profile_id)
                            or coalesce(v_row.profile_visibility, 'public') <> 'private'
                            or v_follows,

    'counts', jsonb_build_object(
      'posts',     (select count(*) from posts   where user_id = p_profile_id),
      'followers', (select count(*) from follows where following_id = p_profile_id),
      'following', (select count(*) from follows where follower_id = p_profile_id)
    ),

    'business', case when coalesce(v_row.account_type, 'personal') = 'business' then (
      select jsonb_build_object(
        'category',      b.category,
        'address',       b.address,
        'phone',         b.phone,
        'email',         b.email,
        'website',       b.website,
        'social_links',  b.social_links,
        'avg_rating',    b.avg_rating,
        'review_count',  b.review_count,
        'is_verified',   b.is_verified
      ) from business_profiles b where b.profile_id = p_profile_id
    ) else null end,

    -- Which humans may act as this business. Empty for a person.
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pr.id, 'full_name', pr.full_name,
               'username', pr.username, 'avatar_url', pr.avatar_url,
               'role', m.role))
      from business_members m
      join profiles pr on pr.id = m.member_id
      where m.business_id = p_profile_id), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$fn$;

grant execute on function public.get_profile(uuid) to authenticated;

/**
 * A profile's own posts, paginated by cursor, with the same viewer flags and
 * product cards the feed returns. Replaces the .limit(50) with no pagination
 * that both profile screens use today.
 *
 * Respects private accounts: returns nothing if the viewer may not see content.
 */
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
  and (p_cursor is null or p.created_at < p_cursor)
order by p.created_at desc
limit least(coalesce(p_limit, 20), 50);
$fn$;

grant execute on function public.get_profile_posts(uuid, timestamptz, int) to authenticated;