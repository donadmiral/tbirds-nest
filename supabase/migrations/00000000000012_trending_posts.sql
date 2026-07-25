-- 0012_trending_posts.sql
-- Per-post trending signal, exposed through get_feed as is_trending.
--
-- Definition: under 72 hours old, at least 3 engagements, and engagement
-- velocity in the top decile of posts from the same window.
--
-- The 3-engagement floor is deliberate. Velocity alone makes a one-hour-old
-- post with a single like look explosive, and a badge that fires on one like
-- is a badge users learn to ignore.
--
-- Note this is post-level velocity, not hashtag trending. get_trending_topics
-- already covers topics, and labelling a post because its topic is hot tells
-- the reader nothing about the post.

drop function if exists public.get_feed(text, double precision, uuid, int);

create or replace function public.get_feed(
  p_mode       text default 'for_you',
  p_cursor_key double precision default null,
  p_cursor_id  uuid default null,
  p_limit      int default 20
)
returns table (
  post_id uuid, author_id uuid, content text, body text, media_url text,
  media jsonb, channel text, article_title text, read_minutes int,
  quoted_post_id uuid, thread_parent_id uuid, created_at timestamptz,
  likes_count int, comments_count int, reposts_count int, bookmarks_count int,
  views_count int, is_trending boolean,
  author_name text, author_username text, author_avatar text,
  author_verified boolean, author_kind text,
  viewer_liked boolean, viewer_bookmarked boolean, viewer_reposted boolean,
  viewer_follows boolean, sort_key double precision
)
language sql stable security invoker set search_path = public
as $fn$
with viewer as (select auth.uid() as uid),
recent_velocity as (
  select coalesce(percentile_cont(0.9) within group (
           order by (coalesce(likes_count,0) + coalesce(comments_count,0) + coalesce(reposts_count,0))
                    / greatest(extract(epoch from (now() - created_at)) / 3600.0, 1.0)
         ), 0) as cutoff
  from posts
  where created_at > now() - interval '72 hours'
),
affinity as (
  select p.user_id as author_id, count(*)::int as n
  from post_likes pl join posts p on p.id = pl.post_id
  where pl.user_id = (select uid from viewer)
    and pl.created_at > now() - interval '30 days'
  group by p.user_id
),
candidates as (
  select p.id, p.user_id, p.content, p.body, p.media_url, p.channel,
         p.article_title, p.read_minutes, p.quoted_post_id, p.thread_parent_id,
         p.created_at, p.likes_count, p.comments_count, p.reposts_count,
         p.bookmarks_count, p.views_count
  from posts p
  where (p_mode <> 'innovation' or p.channel = 'innovation')
    and (p_mode <> 'for_you'    or p.created_at > now() - interval '365 days')
    and not exists (select 1 from hidden_posts h
                    where h.post_id = p.id and h.user_id = (select uid from viewer))
    and not exists (select 1 from blocked_users b
                    where (b.blocker_id = (select uid from viewer) and b.blocked_id = p.user_id)
                       or (b.blocker_id = p.user_id and b.blocked_id = (select uid from viewer)))
),
enriched as (
  select c.*, pr.full_name, pr.username, pr.avatar_url, pr.is_verified, pr.account_type,
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
    (e.created_at > now() - interval '72 hours'
      and e.engagements >= 3
      and e.velocity >= (select cutoff from recent_velocity)
      and (select cutoff from recent_velocity) > 0) as trending,
    case when p_mode = 'for_you' then
      ( (coalesce(e.likes_count,0) * 1.0)
      + (coalesce(e.comments_count,0) * 2.5)
      + (coalesce(e.reposts_count,0) * 2.0) + 1.0 )
      / power((extract(epoch from (now() - e.created_at)) / 3600.0) + 2.0, 1.5)
      * (case when e.follows then 3.0 else 1.0 end)
      * (1.0 + least(e.affinity_n, 5) * 0.15)
      * (case when e.seen then 0.15 else 1.0 end)
    else extract(epoch from e.created_at) end as raw_score
  from enriched e
),
diversified as (
  select b.*,
    case when p_mode = 'for_you'
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
  d.channel, d.article_title, d.read_minutes, d.quoted_post_id, d.thread_parent_id,
  d.created_at, d.likes_count, d.comments_count, d.reposts_count, d.bookmarks_count,
  d.views_count, d.trending,
  d.full_name, d.username, d.avatar_url, d.is_verified, d.account_type,
  d.liked, d.bookmarked, d.reposted, d.follows, d.sort_key
from diversified d
where p_cursor_key is null or (d.sort_key, d.id) < (p_cursor_key, p_cursor_id)
order by d.sort_key desc, d.id desc
limit least(coalesce(p_limit, 20), 50);
$fn$;

grant execute on function public.get_feed(text, double precision, uuid, int) to authenticated;