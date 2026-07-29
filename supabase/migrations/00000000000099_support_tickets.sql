-- 0099 Support and appeals. One table for both: members write tickets,
-- suspended members write appeals, operations resolves with a note.
-- RLS: members insert and read their own; the desk works via service role.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'support' check (kind in ('support', 'appeal')),
  subject text not null,
  body text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

alter table public.support_tickets enable row level security;

drop policy if exists "tickets_insert_own" on public.support_tickets;
create policy "tickets_insert_own" on public.support_tickets
  for insert with check (auth.uid() = user_id);

drop policy if exists "tickets_select_own" on public.support_tickets;
create policy "tickets_select_own" on public.support_tickets
  for select using (auth.uid() = user_id);