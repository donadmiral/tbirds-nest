-- 0061: zombie call cleanup. Force-killed apps leave sessions ringing or
-- active forever. Any call attempt sweeps corpses first: ringing > 2 min
-- ends missed; active with no joined participants > 2 min ends.

create or replace function public.sweep_dead_calls()
returns void language sql security definer set search_path = public
as $fn$
  update call_sessions set status = 'missed', ended_at = now()
  where status = 'ringing' and created_at < now() - interval '2 minutes';

  update call_sessions s set status = 'ended', ended_at = now()
  where s.status = 'active'
    and coalesce(s.started_at, s.created_at) < now() - interval '2 minutes'
    and s.is_group_call
    and not exists (select 1 from call_participants p
                    where p.call_session_id = s.id and p.status = 'joined');
$fn$;

create or replace function public.start_group_call(p_conversation_id uuid, p_is_video boolean default false)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare v_id uuid;
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

grant execute on function public.sweep_dead_calls() to authenticated;