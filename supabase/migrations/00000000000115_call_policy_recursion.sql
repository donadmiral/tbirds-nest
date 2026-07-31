-- 0115 End the infinite recursion on call_participants. The SELECT
-- policy's third branch queried call_participants from inside its own
-- policy (42P17 on every session). A definer helper answers membership
-- without re-entering RLS.

create or replace function public.is_call_member(p_session_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select exists (
    select 1 from call_participants
    where call_session_id = p_session_id and user_id = auth.uid()
  );
$fn$;

grant execute on function public.is_call_member(uuid) to authenticated;

drop policy if exists "Users can view call participants" on public.call_participants;
create policy "Users can view call participants" on public.call_participants
  for select to authenticated using (
    user_id = auth.uid()
    or call_session_id in (select id from call_sessions where initiator_id = auth.uid())
    or public.is_call_member(call_session_id)
  );

notify pgrst, 'reload schema';