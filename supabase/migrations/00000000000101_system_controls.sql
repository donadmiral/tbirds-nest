-- 0101 System controls: feature flags the app reads and only the desk
-- writes, and announcements whose newest active row is the platform's
-- voice on every feed.

create table if not exists public.feature_flags (
  key text primary key,
  enabled boolean not null default true,
  note text,
  updated_by uuid,
  updated_at timestamp with time zone not null default now()
);
alter table public.feature_flags enable row level security;
drop policy if exists "flags_read_all" on public.feature_flags;
create policy "flags_read_all" on public.feature_flags
  for select to authenticated using (true);

insert into public.feature_flags (key, note) values
  ('calls', 'Voice and video calling'),
  ('market', 'Marketplace listing and buying'),
  ('jobs', 'Job posting and applications'),
  ('stories', 'Story posting'),
  ('payments', 'In-chat money transfer')
on conflict (key) do nothing;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  active boolean not null default true,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);
alter table public.announcements enable row level security;
drop policy if exists "announcements_read_active" on public.announcements;
create policy "announcements_read_active" on public.announcements
  for select to authenticated using (active = true);