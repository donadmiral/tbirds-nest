-- 0111 Crash reporting the sovereign way: every client error writes
-- itself here. Write-only from devices (signed in or not); reading is
-- the operations desk's job through the service role.

create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  message text not null,
  stack text,
  context jsonb,
  platform text,
  app_version text,
  created_at timestamp with time zone not null default now()
);
alter table public.client_errors enable row level security;

drop policy if exists "cerr_insert_any" on public.client_errors;
create policy "cerr_insert_any" on public.client_errors
  for insert to authenticated, anon with check (true);

create index if not exists idx_client_errors_recent on public.client_errors (created_at desc);