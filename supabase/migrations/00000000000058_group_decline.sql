-- 0058: group decline that actually declines.
-- Shared sessions have receiver_id NULL, so the legacy per-row decline
-- no-ops. Decline lives on the participant row; when every invitee has
-- declined and nobody but the initiator joined, the session ends missed.

create or replace function public.decline_group_call(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  update call_participants set status = 'declined', left_at = now()
  where call_session_id = p_session_id and user_id = auth.uid();

  update call_sessions s
  set status = 'missed', ended_at = now()
  where s.id = p_session_id
    and s.status = 'ringing'
    and not exists (
      select 1 from call_participants p
      where p.call_session_id = s.id
        and p.status in ('invited', 'joined')
        and p.user_id <> s.initiator_id
    );
end $fn$;

grant execute on function public.decline_group_call(uuid) to authenticated;