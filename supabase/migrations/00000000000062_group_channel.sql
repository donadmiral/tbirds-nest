-- 0062: group sessions carry their channel. The room IS the session id;
-- joiner paths read agora_channel, which was null — split rooms, silence.

create or replace function public.start_group_call(p_conversation_id uuid, p_is_video boolean default false)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare v_id uuid := gen_random_uuid();
begin
  perform sweep_dead_calls();
  if not is_conversation_member(p_conversation_id, auth.uid()) then
    raise exception 'not a member of this group';
  end if;
  if exists (select 1 from call_sessions
             where conversation_id = p_conversation_id
               and status in ('ringing', 'active')) then
    raise exception 'a call is already running in this group';
  end if;

  insert into call_sessions (id, conversation_id, initiator_id, call_type, status, is_video, is_group_call, agora_channel)
  values (v_id, p_conversation_id, auth.uid(), case when p_is_video then 'video' else 'voice' end, 'ringing', p_is_video, true, v_id::text);

  insert into call_participants (call_session_id, user_id, status, joined_at)
  select v_id, cm.user_id,
         case when cm.user_id = auth.uid() then 'joined' else 'invited' end,
         case when cm.user_id = auth.uid() then now() else null end
  from conversation_members cm
  where cm.conversation_id = p_conversation_id;

  return v_id;
end $fn$;