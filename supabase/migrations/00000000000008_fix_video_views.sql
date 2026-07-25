-- 0008_fix_video_views.sql
-- record_video_view had a broken idempotency guard. The insert used
-- "on conflict do nothing" so at most one row existed per session, and the
-- not-exists check then compared that row's id against its own id, which is
-- always false, so the guard always passed and every call incremented
-- views_count. It also kept whatever duration it first saw, so an early
-- progress report of one second was stored permanently.
--
-- Now: duration is raised to the highest value seen for the session, and
-- views_count increments exactly once, on the call where that session first
-- crosses three seconds.

create or replace function public.record_video_view(
  p_post_id uuid, p_viewer_id uuid, p_session text, p_duration integer
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_prev integer;
  v_now  integer;
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

  if coalesce(v_prev, 0) < 3 and v_now >= 3 then
    update posts
       set views_count = coalesce(views_count, 0) + 1
     where id = p_post_id;
  end if;
end;
$fn$;

grant execute on function public.record_video_view(uuid, uuid, text, integer) to authenticated;