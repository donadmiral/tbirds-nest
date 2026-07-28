-- 0067: group unread, the watermark model. One last_read_at per member per
-- conversation; unread = messages newer than your watermark. DMs keep their
-- read_at mechanics. Seen indicators will ride this same watermark.

alter table public.conversation_members
  add column if not exists last_read_at timestamptz not null default now();

create or replace function public.get_unread_counts()
returns table (conversation_id uuid, unread int)
language sql stable security definer set search_path = public
as $fn$
  select m.conversation_id, count(*)::int
  from messages m
  where m.receiver_id = auth.uid()
    and m.sender_id <> auth.uid()
    and m.read_at is null
    and m.deleted_at is null
  group by m.conversation_id
  union all
  select m.conversation_id, count(*)::int
  from messages m
  join conversation_members cm
    on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
  where m.sender_id <> auth.uid()
    and m.deleted_at is null
    and m.created_at > cm.last_read_at
  group by m.conversation_id;
$fn$;

create or replace function public.mark_conversation_read_v2(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public
as $fn$
begin
  update messages set read_at = now()
  where conversation_id = p_conversation_id
    and receiver_id = auth.uid() and read_at is null;

  update conversation_members set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = auth.uid();
end $fn$;

grant execute on function public.get_unread_counts() to authenticated;
grant execute on function public.mark_conversation_read_v2(uuid) to authenticated;