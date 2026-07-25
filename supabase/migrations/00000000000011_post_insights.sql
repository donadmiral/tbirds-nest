-- 0011_post_insights.sql
-- Author-only analytics for a single post, in one call.
--
-- Reach is real here, not estimated: post_seen records every person who had the
-- post in their viewport. Engagement rate is measured against that reach rather
-- than against follower count, which is the number that actually answers "did
-- this land".
--
-- security invoker plus an explicit author check: insights are private. RLS on
-- the underlying tables would leak aggregate counts otherwise.

create or replace function public.get_post_insights(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_me     uuid := auth.uid();
  v_author uuid;
  v_reach  int;
  v_result jsonb;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;

  select user_id into v_author from posts where id = p_post_id;
  if v_author is null then raise exception 'Post not found'; end if;
  if v_author <> v_me then raise exception 'Insights are only visible to the author'; end if;

  select count(distinct user_id)::int into v_reach
  from post_seen where post_id = p_post_id;

  select jsonb_build_object(
    'reach',           v_reach,
    'likes',           coalesce(p.likes_count, 0),
    'comments',        coalesce(p.comments_count, 0),
    'reposts',         coalesce(p.reposts_count, 0),
    'bookmarks',       coalesce(p.bookmarks_count, 0),
    'engagements',     coalesce(p.likes_count,0) + coalesce(p.comments_count,0)
                       + coalesce(p.reposts_count,0) + coalesce(p.bookmarks_count,0),
    'engagement_rate', case when v_reach > 0 then
                         round(((coalesce(p.likes_count,0) + coalesce(p.comments_count,0)
                               + coalesce(p.reposts_count,0) + coalesce(p.bookmarks_count,0))::numeric
                               / v_reach) * 100, 1)
                       else null end,
    'posted_at',       p.created_at,
    'video',           case when exists (
                              select 1 from post_media m
                              where m.post_id = p_post_id and m.media_type = 'video')
                         then (
                           select jsonb_build_object(
                             'unique_viewers', count(distinct coalesce(viewer_id::text, 'session:' || session_id))
                                                 filter (where duration_sec >= 3),
                             'total_plays',    count(*),
                             'avg_seconds',    round(coalesce(avg(duration_sec) filter (where duration_sec >= 3), 0)::numeric, 1)
                           ) from post_video_views where post_id = p_post_id)
                         else null end,
    'recent_likers',   coalesce((
                         select jsonb_agg(jsonb_build_object(
                                  'id', pr.id, 'full_name', pr.full_name,
                                  'username', pr.username, 'avatar_url', pr.avatar_url)
                                order by pl.created_at desc)
                         from post_likes pl
                         join profiles pr on pr.id = pl.user_id
                         where pl.post_id = p_post_id
                         limit 12), '[]'::jsonb)
  ) into v_result
  from posts p where p.id = p_post_id;

  return v_result;
end;
$fn$;

grant execute on function public.get_post_insights(uuid) to authenticated;