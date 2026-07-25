-- 0009_views_are_unique_viewers.sql
-- posts.views_count becomes unique viewers, not sessions.
--
-- Before: one increment per (post, session), and a session is created on every
-- feed mount, so restarting the app three times produced three views. That is
-- an impressions metric wearing a viewers label.
--
-- After: a viewer increments the counter once per post, on the first session
-- where they cross three seconds. Total plays stay available as count(*) over
-- post_video_views, so nothing is lost and insights can show both.
--
-- Anonymous viewers (viewer_id null) fall back to per-session counting, since
-- there is no identity to deduplicate against.

create or replace function public.record_video_view(
  p_post_id uuid, p_viewer_id uuid, p_session text, p_duration integer
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_prev integer;
  v_now  integer;
  v_first_for_viewer boolean;
begin
  select duration_sec into v_prev
  from post_video_views
  where post_id = p_post_id and session_id = p_session;

  insert into post_video_views (post_id, viewer_id, session_id, duration_sec)
  values (p_post_id, p_viewer_id, p_session, greatest(coalesce(p_duration, 0), 0))
  on conflict (post_id, session_id) do update
    set duration_sec = greatest(post_video_views.duration_sec, excluded.duration_sec),
        viewed_at    = now()
  returning duration_sec into v_now;

  -- Only act when this session has just crossed the three second threshold.
  if coalesce(v_prev, 0) >= 3 or v_now < 3 then
    return;
  end if;

  if p_viewer_id is null then
    v_first_for_viewer := true;
  else
    v_first_for_viewer := not exists (
      select 1 from post_video_views
      where post_id = p_post_id
        and viewer_id = p_viewer_id
        and session_id <> p_session
        and duration_sec >= 3
    );
  end if;

  if v_first_for_viewer then
    update posts set views_count = coalesce(views_count, 0) + 1 where id = p_post_id;
  end if;
end;
$fn$;

grant execute on function public.record_video_view(uuid, uuid, text, integer) to authenticated;

-- Bring existing counts in line with the new definition.
update posts p
   set views_count = coalesce((
         select count(distinct coalesce(v.viewer_id::text, 'session:' || v.session_id))
         from post_video_views v
         where v.post_id = p.id and v.duration_sec >= 3
       ), 0)
 where exists (select 1 from post_video_views v where v.post_id = p.id);

-- Insights read this instead of assembling it client side.
create or replace function public.get_post_video_stats(p_post_id uuid)
returns jsonb
language sql stable security invoker set search_path = public
as $fn$
  select jsonb_build_object(
    'unique_viewers', count(distinct coalesce(viewer_id::text, 'session:' || session_id))
                        filter (where duration_sec >= 3),
    'total_plays',    count(*),
    'avg_seconds',    round(coalesce(avg(duration_sec) filter (where duration_sec >= 3), 0)::numeric, 1),
    'max_seconds',    coalesce(max(duration_sec), 0)
  )
  from post_video_views
  where post_id = p_post_id;
$fn$;

grant execute on function public.get_post_video_stats(uuid) to authenticated;