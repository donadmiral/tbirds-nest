-- 0109 The full support_tickets contract. The live table carried an
-- older shape: message was mandatory and the resolution columns the
-- desk writes did not exist. Align completely: legacy message goes
-- dormant, the resolution trio arrives, defaults are set, and the
-- member's right to file and read their own tickets is guaranteed.

alter table public.support_tickets alter column message drop not null;
alter table public.support_tickets add column if not exists resolution_note text;
alter table public.support_tickets add column if not exists resolved_by uuid;
alter table public.support_tickets add column if not exists resolved_at timestamp with time zone;
alter table public.support_tickets alter column created_at set default now();
alter table public.support_tickets alter column updated_at set default now();

alter table public.support_tickets enable row level security;

drop policy if exists "tickets_insert_own" on public.support_tickets;
create policy "tickets_insert_own" on public.support_tickets
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "tickets_select_own" on public.support_tickets;
create policy "tickets_select_own" on public.support_tickets
  for select to authenticated using (auth.uid() = user_id);

notify pgrst, 'reload schema';