-- 0051: close the group self-invite hole.
-- Old policy allowed ANY authenticated user to insert any row into
-- conversation_members — i.e. add themselves to any group and read it.
-- New rule: existing members add members; the creator seeds at creation.

drop policy if exists conversation_members_insert_authenticated on public.conversation_members;
create policy conversation_members_insert on public.conversation_members
  for insert to authenticated
  with check (
    is_conversation_member(conversation_id, auth.uid())
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.created_by = auth.uid()
    )
  );