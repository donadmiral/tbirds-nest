-- 0116 The recursion survived 0115 through the OTHER branch: the policy
-- still subqueried call_sessions, whose own policies can look back at
-- call_participants - mutual recursion. This policy now touches no
-- RLS-governed table at all: every lookup goes through a definer.

create or replace function public.is_call_initiator(p_session_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select exists (
    select 1 from call_sessions
    where id = p_session_id and initiator_id = auth.uid()
  );
$fn$;

grant execute on function public.is_call_initiator(uuid) to authenticated;

drop policy if exists "Users can view call participants" on public.call_participants;
create policy "Users can view call participants" on public.call_participants
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_call_initiator(call_session_id)
    or public.is_call_member(call_session_id)
  );

notify pgrst, 'reload schema';