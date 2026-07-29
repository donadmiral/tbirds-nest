-- 0094 The admin foundation. Roles, the immutable audit log, and the
-- verification system's tables. The admin web app stands on this layer.

create table if not exists public.admin_users (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in (
    'super_admin','platform_admin','trust_safety','support_agent',
    'ops_engineer','market_reviewer','jobs_reviewer','verification_reviewer',
    'finance_admin','analyst','auditor_readonly'
  )),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
drop policy if exists admin_users_select on public.admin_users;
create policy admin_users_select on public.admin_users
  for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $fn$
  select exists (select 1 from admin_users where user_id = auth.uid() and active);
$fn$;
grant execute on function public.is_admin() to authenticated;

create or replace function public.admin_role()
returns text language sql stable security definer set search_path = public
as $fn$
  select role from admin_users where user_id = auth.uid() and active;
$fn$;
grant execute on function public.admin_role() to authenticated;

-- Immutable: admins can read; nothing client-side can write, change, or erase.
-- The admin server writes rows with the service key on every action.
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null,
  action text not null,
  target_kind text,
  target_id text,
  reason text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
drop policy if exists audit_select on public.admin_audit_log;
create policy audit_select on public.admin_audit_log
  for select to authenticated using (public.is_admin());

alter table public.profiles add column if not exists verified_tier text;
alter table public.profiles drop constraint if exists profiles_verified_tier_check;
alter table public.profiles add constraint profiles_verified_tier_check
  check (verified_tier is null or verified_tier in ('public_figure','business','official'));
alter table public.profiles add column if not exists verified_category text;

create table if not exists public.verification_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  tier text not null check (tier in ('public_figure','business','official')),
  category text,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'submitted'
    check (status in ('submitted','under_review','approved','rejected')),
  reviewer_id uuid,
  decision_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
alter table public.verification_applications enable row level security;
drop policy if exists vapps_insert_own on public.verification_applications;
create policy vapps_insert_own on public.verification_applications
  for insert to authenticated with check (applicant_id = auth.uid());
drop policy if exists vapps_select on public.verification_applications;
create policy vapps_select on public.verification_applications
  for select to authenticated using (applicant_id = auth.uid() or public.is_admin());
create index if not exists idx_vapps_status on public.verification_applications (status, created_at);