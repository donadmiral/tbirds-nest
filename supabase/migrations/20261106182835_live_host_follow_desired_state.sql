-- The room client expresses its intended result. An old tab cannot invert it.
-- Rows and triggers are the same ones used by the existing profile follow flow.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
create function live_streams.set_host_follow_v1(p_session_id uuid,p_host_id uuid,p_follow boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=live_streams.require_publisher();visibility text;f uuid;r uuid;rs text; result jsonb;
begin
 if p_session_id is null or p_host_id is null or p_follow is null or p_host_id=uid then raise exception 'INVALID_FOLLOW_TARGET';end if;
 if not exists(select 1 from live_streams.sessions s where s.id=p_session_id and s.host_id=p_host_id
   and s.state in('scheduled','starting','live','reconnecting','ending','ended')) or not live_streams.can_view(p_session_id,uid)
 then raise exception 'LIVE_NOT_AVAILABLE' using errcode='42501';end if;
 -- A caller-exclusive profile lock conflicts with FK checks on a concurrently
 -- inserted block in either direction. The host lock is shared across viewers,
 -- and conflicts with concurrent privacy changes. Acquire both in stable order.
 if uid<p_host_id then
  perform 1 from public.profiles where id=uid for update;
  select profile_visibility into visibility from public.profiles where id=p_host_id for share;
 else
  select profile_visibility into visibility from public.profiles where id=p_host_id for share;
  perform 1 from public.profiles where id=uid for update;
 end if;
 perform 1 from live_streams.sessions where id=p_session_id and host_id=p_host_id
   and state in('scheduled','starting','live','reconnecting','ending','ended') for key share;
 if not found or not live_streams.can_view(p_session_id,uid)
 or not live_streams.publisher_allowed(uid,(auth.jwt()->>'session_id')::uuid)
 or exists(select 1 from public.blocked_users b where (b.blocker_id=uid and b.blocked_id=p_host_id) or (b.blocker_id=p_host_id and b.blocked_id=uid))
 then raise exception 'LIVE_NOT_AVAILABLE' using errcode='42501';end if;
 select id into f from public.follows where follower_id=uid and following_id=p_host_id for update;
 select id,status into r,rs from public.follow_requests where requester_id=uid and target_id=p_host_id for update;
 if p_follow then
  if f is not null then return jsonb_build_object('state','following');end if;
  if rs='pending' then return jsonb_build_object('state','requested');end if;
  perform live_streams.take_rate('live_host_follow',uid::text,30,60);
  -- No existing follow or pending request, under lock. Reuse exactly the
  -- established public/private request and notification semantics, not a blind toggle.
  result:=public.handle_follow_action(p_host_id);
  if coalesce(visibility,'public')='private' and result->>'action'='requested' then return jsonb_build_object('state','requested');
  elsif coalesce(visibility,'public')<>'private' and result->>'action'='followed' then return jsonb_build_object('state','following');end if;
  raise exception 'FOLLOW_STATE_CONFLICT';
 end if;
 if f is not null or r is not null then
  perform live_streams.take_rate('live_host_follow',uid::text,30,60);
  delete from public.follows where follower_id=uid and following_id=p_host_id;
  delete from public.follow_requests where requester_id=uid and target_id=p_host_id;
 end if;
 return jsonb_build_object('state','none');
end $$;
revoke all on function live_streams.set_host_follow_v1(uuid,uuid,boolean) from public,anon,service_role;
grant execute on function live_streams.set_host_follow_v1(uuid,uuid,boolean) to authenticated;
create function public.set_live_host_follow_v1(p_session_id uuid,p_host_id uuid,p_follow boolean)
returns jsonb language sql security invoker set search_path='' as $$select live_streams.set_host_follow_v1(p_session_id,p_host_id,p_follow)$$;
revoke all on function public.set_live_host_follow_v1(uuid,uuid,boolean) from public,anon,service_role;
grant execute on function public.set_live_host_follow_v1(uuid,uuid,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
