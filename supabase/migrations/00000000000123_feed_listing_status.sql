-- 0123: the feed learns listing status. Two changes to get_feed (0095 body
-- otherwise verbatim): (1) the products jsonb joins marketplace_listings and
-- carries 'listing_status' so cards can wear the SOLD veil; (2) in for_you,
-- posts whose every tagged listing is unavailable stop being candidates.
-- Return shape unchanged, so create-or-replace without drop.

create or replace function public.get_feed(
  p_mode       text default 'for_you',
  p_cursor_key double precision default null,
  p_cursor_id  uuid default null,
  p_limit      int default 20
)
returns table (
  post_id uuid, author_id uuid, content text, body text, media_url text,
  media jsonb, products jsonb, link jsonb, channel text, article_title text, read_minutes int,
  quoted_post_id uuid, thread_parent_id uuid, created_at timestamptz,
  likes_count int, comments_count int, reposts_count int, bookmarks_count int,
  views_count int, is_trending boolean,
  author_name text, author_username text, author_avatar text,
  author_verified boolean, author_kind text, author_verified_tier text,
  viewer_liked boolean, viewer_bookmarked boolean, viewer_reposted boolean,
  viewer_follows boolean, sort_key double precision,
  innovation_field text, innovation_stage text
)
language sql stable security invoker set search_path = public
as $fn$
with viewer as (select auth.uid() as uid),
recent_velocity as (
  select coalesce(percentile_cont(0.9) within group (
           order by (coalesce(likes_count,0) + coalesce(comments_count,0) + coalesce(reposts_count,0))
                    / greatest(extract(epoch from (now() - created_at)) / 3600.0, 1.0)
         ), 0) as cutoff
  from posts where created_at > now() - interval '72 hours'
),
affinity as (
  select p.user_id as author_id, count(*)::int as n
  from post_likes pl join posts p on p.id = pl.post_id
  where pl.user_id = (select uid from viewer)
    and pl.created_at > now() - interval '30 days'
  group by p.user_id
),
candidates as (
  select p.id, p.user_id, p.content, p.body, p.media_url, p.link_url, p.channel,
         p.article_title, p.read_minutes, p.innovation_field, p.innovation_stage, p.quoted_post_id, p.thread_parent_id,
         p.created_at, p.likes_count, p.comments_count, p.reposts_count,
         p.bookmarks_count, p.views_count
  from posts p
  where (p_mode <> 'innovation' or p.channel = 'innovation')
    and (p_mode <> 'for_you'    or p.created_at > now() - interval '365 days')
    and (p_mode <> 'trending'   or p.created_at > now() - interval '7 days')
    and (p_mode <> 'trending' or (coalesce(p.likes_count,0) + coalesce(p.comments_count,0) + coalesce(p.reposts_count,0)) >= 3)
    and (p_mode <> 'trending' or p.id in (select ref_id from trending_snapshot where kind = 'post'))
    and (p_mode <> 'for_you'
      or not exists (select 1 from post_products pp2
                     where pp2.post_id = p.id and pp2.listing_id is not null)
      or exists (select 1 from post_products pp3
                 join marketplace_listings ml3 on ml3.id = pp3.listing_id
                 where pp3.post_id = p.id and ml3.status = 'available'))
    and not exists (select 1 from hidden_posts h
                    where h.post_id = p.id and h.user_id = (select uid from viewer))
    and not exists (select 1 from blocked_users b
                    where (b.blocker_id = (select uid from viewer) and b.blocked_id = p.user_id)
                       or (b.blocker_id = p.user_id and b.blocked_id = (select uid from viewer)))
    and not exists (select 1 from profiles px
                    where px.id = p.user_id
                      and px.profile_visibility = 'private'
                      and px.id <> (select uid from viewer)
                      and not exists (select 1 from follows f2
                                      where f2.follower_id = (select uid from viewer)
                                        and f2.following_id = p.user_id))
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
),
enriched as (
  select c.*, pr.full_name, pr.username, pr.avatar_url, pr.is_verified, pr.account_type, pr.verified_tier,
    (fl.follower_id is not null) as follows,
    (lk.user_id is not null) as liked,
    (bk.user_id is not null) as bookmarked,
    (rp.user_id is not null) as reposted,
    (sn.post_id is not null) as seen,
    coalesce(af.n, 0) as affinity_n,
    (coalesce(c.likes_count,0) + coalesce(c.comments_count,0) + coalesce(c.reposts_count,0)) as engagements,
    (coalesce(c.likes_count,0) + coalesce(c.comments_count,0) + coalesce(c.reposts_count,0))
      / greatest(extract(epoch from (now() - c.created_at)) / 3600.0, 1.0) as velocity
  from candidates c
  join profiles pr on pr.id = c.user_id
  left join follows fl        on fl.following_id = c.user_id and fl.follower_id = (select uid from viewer)
  left join post_likes lk     on lk.post_id = c.id and lk.user_id = (select uid from viewer)
  left join post_bookmarks bk on bk.post_id = c.id and bk.user_id = (select uid from viewer)
  left join post_reposts rp   on rp.post_id = c.id and rp.user_id = (select uid from viewer)
  left join post_seen sn      on sn.post_id = c.id and sn.user_id = (select uid from viewer)
  left join affinity af       on af.author_id = c.user_id
),
base as (
  select e.*,
    (exists (select 1 from trending_snapshot ts
             where ts.kind = 'post' and ts.ref_id = e.id)) as trending,
    case
      when p_mode in ('for_you', 'innovation') then
        ( (coalesce(e.likes_count,0) * 1.0)
        + (coalesce(e.comments_count,0) * 2.5)
        + (coalesce(e.reposts_count,0) * 2.0) + 1.0 )
        / power((extract(epoch from (now() - e.created_at)) / 3600.0) + 2.0, 1.5)
        * (case when e.follows then 3.0 else 1.0 end)
        * (1.0 + least(e.affinity_n, 5) * 0.15)
        * (case when e.seen then 0.15 else 1.0 end)
      when p_mode = 'trending' then
        10000.0 - coalesce((select ts.rank from trending_snapshot ts
                    where ts.kind = 'post' and ts.ref_id = e.id), 9999)
      else extract(epoch from e.created_at)
    end as raw_score
  from enriched e
),
diversified as (
  select b.*,
    case when p_mode in ('for_you', 'trending', 'innovation')
      then b.raw_score * power(0.55::double precision,
             (row_number() over (partition by b.user_id order by b.raw_score desc) - 1))
      else b.raw_score
    end as sort_key
  from base b
)
select d.id, d.user_id, d.content, d.body, d.media_url,
  coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'url', m.url,
      'media_type', m.media_type, 'width', m.width, 'height', m.height,
      'sort_order', m.sort_order) order by m.sort_order nulls last)
    from post_media m where m.post_id = d.id), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', pp.id, 'title', pp.title, 'subtitle', pp.subtitle,
      'price', pp.price, 'currency', pp.currency, 'image_url', pp.image_url,
      'listing_id', pp.listing_id, 'link_url', pp.link_url,
      'cta_label', pp.cta_label, 'sort_order', pp.sort_order,
      'listing_status', ml.status)
      order by pp.sort_order)
    from post_products pp
    left join marketplace_listings ml on ml.id = pp.listing_id
    where pp.post_id = d.id), '[]'::jsonb),
  case when lp.url is not null then jsonb_build_object(
      'url', lp.url, 'title', lp.title, 'description', lp.description,
      'image_url', lp.image_url, 'domain', lp.domain)
    else null end,
  d.channel, d.article_title, d.read_minutes, d.quoted_post_id, d.thread_parent_id,
  d.created_at, d.likes_count, d.comments_count, d.reposts_count, d.bookmarks_count,
  d.views_count, d.trending,
  d.full_name, d.username, d.avatar_url, d.is_verified, d.account_type, d.verified_tier,
  d.liked, d.bookmarked, d.reposted, d.follows, d.sort_key,
  d.innovation_field, d.innovation_stage
from diversified d
left join link_previews lp on lp.url = d.link_url
where p_cursor_key is null or (d.sort_key, d.id) < (p_cursor_key, p_cursor_id)
order by d.sort_key desc, d.id desc
limit least(coalesce(p_limit, 20), 50);
$fn$;