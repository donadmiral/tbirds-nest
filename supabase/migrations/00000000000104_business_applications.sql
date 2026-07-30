-- 0104 Business applications. A company applies with its full details;
-- the case lands on the operations desk; approval mints the business
-- account already wearing space grey. No business exists unvetted.

create table if not exists public.business_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  company_name text not null,
  category text,
  description text not null,
  contact_email text not null,
  contact_phone text,
  website text,
  registration_info text,
  desired_username text not null,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  decision_reason text,
  decided_by uuid,
  decided_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

alter table public.business_applications enable row level security;

drop policy if exists "bizapps_insert_own" on public.business_applications;
create policy "bizapps_insert_own" on public.business_applications
  for insert to authenticated with check (auth.uid() = applicant_id);

drop policy if exists "bizapps_select_own" on public.business_applications;
create policy "bizapps_select_own" on public.business_applications
  for select to authenticated using (auth.uid() = applicant_id);