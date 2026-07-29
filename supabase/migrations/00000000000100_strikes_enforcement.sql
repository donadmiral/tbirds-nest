-- 0100 Strikes and graduated enforcement.
-- warn: a recorded strike. restrict: posting and listing blocked until a
-- date, enforced by the database itself. suspend and ban: the deactivation
-- gate, ban carrying permanent intent. Every strike is a row here.

create table if not exists public.member_strikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  level text not null check (level in ('warn', 'restrict', 'suspend', 'ban')),
  reason text not null,
  issued_by uuid,
  expires_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

alter table public.member_strikes enable row level security;

drop policy if exists "strikes_select_own" on public.member_strikes;
create policy "strikes_select_own" on public.member_strikes
  for select using (auth.uid() = user_id);

alter table public.profiles add column if not exists restricted_until timestamp with time zone;

-- Restrictive policies AND with existing permissive ones: a restricted
-- member cannot create posts or listings no matter what the client does.
drop policy if exists "restricted_cannot_post" on public.posts;
create policy "restricted_cannot_post" on public.posts
  as restrictive for insert
  with check (coalesce((select restricted_until from public.profiles where id = auth.uid()) < now(), true));

drop policy if exists "restricted_cannot_list" on public.marketplace_listings;
create policy "restricted_cannot_list" on public.marketplace_listings
  as restrictive for insert
  with check (coalesce((select restricted_until from public.profiles where id = auth.uid()) < now(), true));