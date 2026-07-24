-- 0003_feed_ranking.sql
-- One server-side feed endpoint with real ranking and keyset pagination.
-- Replaces "fetch the newest 80 and sort them in JavaScript".
--
-- Modes:
--   for_you    ranked by engagement, recency, who you follow, who you like
--   latest     strict reverse chronological
--   innovation the innovation channel only, newest first
--
-- Pagination: pass the sort_key and post_id of the last row you received.

create or replace function public.get_feed(
  p_mode       text default 'for_you',
  p_cursor_key double precision default null,
  p_cursor_id  uuid default null,
  p_limit      int default 20
)
returns table (
  post_id           uuid,
  author_id         uuid,
  content           text,
  body              text,
  media_url         text,
  media             jsonb,
  channel           text,
  article_title     text,
  read_minutes      int,
  quoted_post_id    uuid,
  thread_parent_id  uuid,
  created_at        timestamptz,
  likes_count       int,
  comments_count    int,
  reposts_count     int,
  bookmarks_count   int,
  author_name       text,
  author_username   text,
  author_avatar     text,
  author_verified   boolean,
  author_kind       text,
  viewer_liked      boolean,
  viewer_bookmarked boolean,
  viewer_reposted   boolean,
  viewer_follows    boolean,
  sort_key          double precision
)
language sql
stable
security invoker
set search_path = public
as $fn$
with viewer as (
  select auth.uid() as uid
),
affinity as (
  select p.user_id as author_id, count(*)::int as n
  from post_likes pl
  join posts p on p.id = pl.post_id
  where pl.user_id = (select uid from viewer)
    and pl.created_at > now() - interval '30 days'
  group by p.user_id
),
candidates as (
  select
    p.id, p.user_id, p.content, p.body, p.media_url, p.channel,
    p.article_title, p.read_minutes, p.quoted_post_id, p.thread_parent_id,
    p.created_at, p.likes_count, p.comments_count, p.reposts_count, p.bookmarks_count
  from posts p
  where (p_mode <> 'innovation' or p.channel = 'innovation')
    and (p_mode <> 'for_you'    or p.created_at > now() - interval '30 days')
    and not exists (
      select 1 from hidden_posts h
      where h.post_id = p.id and h.user_id = (select uid from viewer))
    and not exists (
      select 1 from blocked_users b
      where (b.blocker_id = (select uid from viewer) and b.blocked_id = p.user_id)
         or (b.blocker_id = p.user_id and b.blocked_id = (select uid from viewer)))
),
scored as (
  select
    c.*,
    pr.full_name, pr.username, pr.avatar_url, pr.is_verified, pr.account_type,
    (fl.follower_id is not null) as follows,
    (lk.user_id     is not null) as liked,
    (bk.user_id     is not null) as bookmarked,
    (rp.user_id     is not null) as reposted,
    case when p_mode = 'for_you' then
      ( (coalesce(c.likes_count,0)    * 1.0)
      + (coalesce(c.comments_count,0) * 2.5)
      + (coalesce(c.reposts_count,0)  * 2.0)
      + 1.0 )
      * exp(- (extract(epoch from (now() - c.created_at)) / 3600.0) / 24.0)
      * (case when fl.follower_id is not null then 3.0 else 1.0 end)
      * (1.0 + least(coalesce(af.n,0), 5) * 0.15)
      + (case when c.created_at > now() - interval '2 hours' then 5.0 else 0.0 end)
    else
      extract(epoch from c.created_at)
    end as sort_key
  from candidates c
  join profiles pr on pr.id = c.user_id
  left join follows fl        on fl.following_id = c.user_id and fl.follower_id = (select uid from viewer)
  left join post_likes lk     on lk.post_id = c.id and lk.user_id = (select uid from viewer)
  left join post_bookmarks bk on bk.post_id = c.id and bk.user_id = (select uid from viewer)
  left join post_reposts rp   on rp.post_id = c.id and rp.user_id = (select uid from viewer)
  left join affinity af       on af.author_id = c.user_id
)
select
  s.id, s.user_id, s.content, s.body, s.media_url,
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', m.id, 'url', m.url, 'media_type', m.media_type,
             'width', m.width, 'height', m.height, 'sort_order', m.sort_order)
           order by m.sort_order nulls last)
    from post_media m where m.post_id = s.id), '[]'::jsonb),
  s.channel, s.article_title, s.read_minutes, s.quoted_post_id, s.thread_parent_id,
  s.created_at, s.likes_count, s.comments_count, s.reposts_count, s.bookmarks_count,
  s.full_name, s.username, s.avatar_url, s.is_verified, s.account_type,
  s.liked, s.bookmarked, s.reposted, s.follows,
  s.sort_key
from scored s
where p_cursor_key is null
   or (s.sort_key, s.id) < (p_cursor_key, p_cursor_id)
order by s.sort_key desc, s.id desc
limit least(coalesce(p_limit, 20), 50);
$fn$;

grant execute on function public.get_feed(text, double precision, uuid, int) to authenticated;