-- 0079 host controls (calls standard section 27): the call starter can end
-- the whole group call. Initiator-only, enforced server-side.

create or replace function public.end_group_call_for_all(p_session_id uuid)
returns void language plpgsql security definer set search_path = public
as $fn$
begin
  if not exists (select 1 from call_sessions
                 where id = p_session_id and initiator_id = auth.uid()) then
    raise exception 'only the call starter can end it for everyone';
  end if;

  update call_participants set status = 'left', left_at = now()
  where call_session_id = p_session_id and status in ('invited', 'joined');

  update call_sessions set status = 'ended', ended_at = now()
  where id = p_session_id and status in ('ringing', 'active');
end $fn$;

grant execute on function public.end_group_call_for_all(uuid) to authenticated;