-- 0110 Support becomes a real helpdesk. Tickets carry a conversation:
-- statuses are open (customer waiting), pending (ops replied, ball with
-- the customer) and solved. Every message lives in support_messages.

alter table public.support_tickets drop constraint if exists support_tickets_status_check;
update public.support_tickets set status = 'solved' where status = 'resolved';
alter table public.support_tickets add constraint support_tickets_status_check
  check (status in ('open', 'pending', 'solved'));

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender text not null check (sender in ('member', 'ops')),
  sender_id uuid,
  body text not null,
  created_at timestamp with time zone not null default now()
);
alter table public.support_messages enable row level security;

drop policy if exists "smsg_select_own_ticket" on public.support_messages;
create policy "smsg_select_own_ticket" on public.support_messages
  for select to authenticated using (
    exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid())
  );

drop policy if exists "smsg_insert_as_member" on public.support_messages;
create policy "smsg_insert_as_member" on public.support_messages
  for insert to authenticated with check (
    sender = 'member' and sender_id = auth.uid()
    and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid())
  );

drop policy if exists "tickets_update_own_status" on public.support_tickets;
create policy "tickets_update_own_status" on public.support_tickets
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into public.support_messages (ticket_id, sender, sender_id, body, created_at)
select t.id, 'member', t.user_id, coalesce(t.body, t.message), t.created_at
from public.support_tickets t
where coalesce(t.body, t.message) is not null
  and not exists (select 1 from public.support_messages m where m.ticket_id = t.id);

notify pgrst, 'reload schema';