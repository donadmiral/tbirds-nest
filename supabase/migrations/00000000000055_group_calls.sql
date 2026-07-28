-- 0055: group calls.
-- One session = one Daily room (rooms are named by session id already).
-- start creates the session and fans out a participant row per member —
-- the INSERT on call_participants is what rings each phone. join flips the
-- session active; leave ends the session when the last person goes.

create or replace function public.start_group_call(p_conversation_id uuid, p_is_video boolean default false)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare v_id uuid;
begin
  if not is_conversation_member(p_conversation_id, auth.uid()) then
    raise exception 'not a member of this group';
  end if;
  if exists (select 1 from call_sessions
             where conversation_id = p_conversation_id
               and status in ('ringing', 'active')) then
    raise exception 'a call is already running in this group';
  end if;

  insert into call_sessions (conversation_id, initiator_id, call_type, status, is_video, is_group_call)
  values (p_conversation_id, auth.uid(), case when p_is_video then 'video' else 'voice' end, 'ringing', p_is_video, true)
  returning id into v_id;

  insert into call_participants (call_session_id, user_id, status, joined_at)
  select v_id, cm.user_id,
         case when cm.user_id = auth.uid() then 'joined' else 'invited' end,
         case when cm.user_id = auth.uid() then now() else null end
  from conversation_members cm
  where cm.conversation_id = p_conversation_id;

  return v_id;
end $fn$;

create or replace function public.join_group_call(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare v_conv uuid; v_status text;
begin
  select conversation_id, status into v_conv, v_status from call_sessions where id = p_session_id;
  if v_conv is null then raise exception 'call not found'; end if;
  if v_status not in ('ringing', 'active') then raise exception 'call has ended'; end if;
  if not is_conversation_member(v_conv, auth.uid()) then raise exception 'not a member'; end if;

  insert into call_participants (call_session_id, user_id, status, joined_at)
  values (p_session_id, auth.uid(), 'joined', now())
  on conflict (call_session_id, user_id)
  do update set status = 'joined', joined_at = coalesce(call_participants.joined_at, now()), left_at = null;

  update call_sessions set status = 'active', started_at = coalesce(started_at, now())
  where id = p_session_id and status = 'ringing';
end $fn$;

create or replace function public.leave_group_call(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  update call_participants set status = 'left', left_at = now()
  where call_session_id = p_session_id and user_id = auth.uid();

  update call_sessions s
  set status = 'ended', ended_at = now(),
      duration_sec = greatest(0, extract(epoch from (now() - coalesce(s.started_at, s.created_at)))::int)
  where s.id = p_session_id
    and s.status in ('ringing', 'active')
    and not exists (select 1 from call_participants p
                    where p.call_session_id = s.id and p.status = 'joined');
end $fn$;

grant execute on function public.start_group_call(uuid, boolean) to authenticated;
grant execute on function public.join_group_call(uuid) to authenticated;
grant execute on function public.leave_group_call(uuid) to authenticated;