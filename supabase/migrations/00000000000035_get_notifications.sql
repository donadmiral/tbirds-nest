-- 0035_get_notifications.sql
-- One call for the notifications screen: actor hydrated, engagement on the same
-- post collapsed into a single row, the target's thumbnail attached, and the
-- follow state for follow rows.
--
-- Grouping matters more than it sounds. 129 likes across a handful of posts is
-- 129 rows today. Collapsed, it is a readable list.

create or replace function public.get_notifications(
  p_limit  int default 50,
  p_cursor timestamptz default null
)
returns table (
  notification_id uuid,
  type text,
  message text,
  body_preview text,
  data jsonb,
  read_at timestamptz,
  created_at timestamptz,
  actor_id uuid,
  actor_name text,
  actor_username text,
  actor_avatar text,
  others_count int,
  other_avatars text[],
  post_id uuid,
  post_thumb text,
  post_text text,
  viewer_follows boolean,
  unread_in_group int
)
language sql stable security invoker set search_path = public
as $fn$
with mine as (
  select n.id, n.type, n.message, n.body_preview, n.data, n.read_at, n.created_at,
         n.actor_id,
         nullif(n.data->>'post_id', '')::uuid as pid
  from notifications n
  where n.recipient_id = auth.uid()
    and (p_cursor is null or n.created_at < p_cursor)
),
keyed as (
  select m.*,
    -- Engagement on the same post collapses. Everything else stays its own row.
    case when m.type in ('like', 'repost', 'comment_like') and m.pid is not null
         then m.type || ':' || m.pid::text
         else 'x:' || m.id::text end as gkey
  from mine m
),
agg as (
  select
    gkey,
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
    (array_agg(distinct actor_id))                        as actor_ids
  from keyed
  group by gkey
)
select
  a.id,
  a.type,
  a.message,
  a.body_preview,
  a.data,
  a.read_at,
  a.created_at,
  a.actor_id,
  pr.full_name,
  pr.username,
  pr.avatar_url,
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

-- Mark everything read in one call rather than one update per row.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns int
language plpgsql security invoker set search_path = public
as $fn$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  update notifications
     set read_at = now()
   where recipient_id = auth.uid()
     and read_at is null
     and (p_ids is null or id = any(p_ids));

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

grant execute on function public.mark_notifications_read(uuid[]) to authenticated;