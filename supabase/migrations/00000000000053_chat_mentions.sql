-- 0053: mentions in chat.
-- Server-side parse on message insert (same proven pattern as posts), a
-- per-message mention ledger, and a notification to each mentioned member.
-- Only participants of the conversation can be mentioned — a random @name
-- in a private group must not leak the message to outsiders.

create table if not exists public.message_mentions (
  message_id uuid not null references public.messages(id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, mentioned_user_id)
);
alter table public.message_mentions enable row level security;
drop policy if exists message_mentions_select on public.message_mentions;
create policy message_mentions_select on public.message_mentions
  for select to authenticated
  using (mentioned_user_id = auth.uid()
         or exists (select 1 from messages m where m.id = message_id and m.sender_id = auth.uid()));

create or replace function public.sync_message_mentions()
returns trigger language plpgsql security definer set search_path = public
as $tg$
begin
  if new.text is null or position('@' in new.text) = 0 then return new; end if;

  insert into public.message_mentions (message_id, mentioned_user_id)
  select distinct new.id, p.id
  from regexp_matches(coalesce(new.text, ''), '@([A-Za-z0-9_\.]{2,30})', 'g') as m(u)
  join public.profiles p on lower(p.username) = lower(m.u[1])
  where p.id <> new.sender_id
    and exists (
      select 1 from conversations c
      where c.id = new.conversation_id
        and (c.user_1 = p.id or c.user_2 = p.id
             or is_conversation_member(c.id, p.id))
    )
  on conflict do nothing;

  insert into public.notifications (recipient_id, actor_id, type, message, data)
  select mm.mentioned_user_id, new.sender_id, 'mention',
         'mentioned you in a chat',
         jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id)
  from public.message_mentions mm
  where mm.message_id = new.id;

  return new;
end;
$tg$;
drop trigger if exists trg_sync_message_mentions on public.messages;
create trigger trg_sync_message_mentions after insert on public.messages
  for each row execute function sync_message_mentions();