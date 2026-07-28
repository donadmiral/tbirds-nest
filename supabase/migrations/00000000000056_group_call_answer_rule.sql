-- 0056: a group call is answered when a SECOND person arrives.
-- v1 flipped ringing->active on any join, including the initiator's own
-- lifecycle join, which killed everyone's ring instantly.

create or replace function public.join_group_call(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare v_conv uuid; v_status text; v_init uuid;
begin
  select conversation_id, status, initiator_id into v_conv, v_status, v_init
  from call_sessions where id = p_session_id;
  if v_conv is null then raise exception 'call not found'; end if;
  if v_status not in ('ringing', 'active') then raise exception 'call has ended'; end if;
  if not is_conversation_member(v_conv, auth.uid()) then raise exception 'not a member'; end if;

  insert into call_participants (call_session_id, user_id, status, joined_at)
  values (p_session_id, auth.uid(), 'joined', now())
  on conflict (call_session_id, user_id)
  do update set status = 'joined', joined_at = coalesce(call_participants.joined_at, now()), left_at = null;

  update call_sessions set status = 'active', started_at = coalesce(started_at, now())
  where id = p_session_id and status = 'ringing' and auth.uid() <> v_init;
end $fn$;