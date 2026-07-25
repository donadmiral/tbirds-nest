-- 0036_notification_feed_shape.sql
-- The notifications feed is for social engagement. Things with their own home
-- and their own unread count do not belong in it as well:
--
--   message          125 rows -> Messages, which already badges unread
--   incoming_call     32 rows -> the call log
--   connection_*      49 rows -> a retired concept
--
-- That is 206 of 472 rows removed from the feed. Push notifications are
-- unaffected: a message still buzzes the phone, it just does not also sit in
-- the notifications tab.
--
-- Grouping widened too: follows and story reactions now collapse the same way
-- likes do, so "three people followed you" is one row.

create or replace function public.get_notifications(
  p_limit  int default 50,
  p_cursor timestamptz default null
)
returns table (
  notification_id uuid, type text, message text, body_preview text, data jsonb,
  read_at timestamptz, created_at timestamptz,
  actor_id uuid, actor_name text, actor_username text, actor_avatar text,
  others_count int, other_avatars text[],
  post_id uuid, post_thumb text, post_text text,
  viewer_follows boolean, unread_in_group int
)
language sql stable security invoker set search_path = public
as $fn$
with mine as (
  select n.id, n.type, n.message, n.body_preview, n.data, n.read_at, n.created_at,
         n.actor_id,
         nullif(n.data->>'post_id', '')::uuid as pid
  from notifications n
  where n.recipient_id = auth.uid()
    and n.type not in ('message', 'incoming_call', 'missed_call',
                       'connection_request', 'connection_accepted')
    and (p_cursor is null or n.created_at < p_cursor)
),
keyed as (
  select m.*,
    case
      -- engagement on one post
      when m.type in ('like', 'repost', 'comment_like') and m.pid is not null
        then m.type || ':' || m.pid::text
      -- people doing the same thing to you
      when m.type in ('follow', 'follow_request', 'story_reaction')
        then m.type || ':bucket'
      else 'x:' || m.id::text
    end as gkey
  from mine m
),
agg as (
  select gkey,
    (array_agg(id order by created_at desc))[1]           as id,
    (array_agg(type order by created_at desc))[1]         as type,
    (array_agg(message order by created_at desc))[1]      as message,
    (array_agg(body_preview order by created_at desc))[1] as body_preview,
    (array_agg(data order by created_at desc))[1]         as data,
    min(read_at)                                          as read_at,
    max(created_at)                                       as created_at,
    (array_agg(actor_id order by created_at desc))[1]     as actor_id,
    (array_agg(pid order by created_at desc))[1]          as pid,
    count(distinct actor_id)::int                         as actor_count,
    count(*) filter (where read_at is null)::int          as unread_n,
    array_agg(distinct actor_id)                          as actor_ids
  from keyed
  group by gkey
)
select
  a.id, a.type, a.message, a.body_preview, a.data, a.read_at, a.created_at,
  a.actor_id, pr.full_name, pr.username, pr.avatar_url,
  greatest(a.actor_count - 1, 0),
  coalesce((
    select array_agg(p2.avatar_url)
    from (select unnest(a.actor_ids) as aid limit 3) x
    join profiles p2 on p2.id = x.aid
    where p2.avatar_url is not null
  ), '{}'::text[]),
  a.pid,
  (select coalesce(
     (select m.url from post_media m where m.post_id = a.pid order by m.sort_order nulls last limit 1),
     (select p.media_url from posts p where p.id = a.pid))),
  (select left(coalesce(p.content, p.body, ''), 90) from posts p where p.id = a.pid),
  exists (select 1 from follows f
          where f.follower_id = auth.uid() and f.following_id = a.actor_id),
  a.unread_n
from agg a
left join profiles pr on pr.id = a.actor_id
order by a.created_at desc
limit least(coalesce(p_limit, 50), 100);
$fn$;

grant execute on function public.get_notifications(int, timestamptz) to authenticated;