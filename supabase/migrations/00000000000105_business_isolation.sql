-- 0105 Business isolation. A business is fully separate: its people
-- sign in AS the business with their own revocable access code, only
-- on devices the company has registered. The business session manages
-- its own members and devices (auth.uid() = the business itself).

create table if not exists public.business_access_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null,
  role text not null default 'representative',
  code_hash text not null,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  last_sign_in_at timestamp with time zone
);
alter table public.business_access_members enable row level security;
drop policy if exists "bam_business_manages_own" on public.business_access_members;
create policy "bam_business_manages_own" on public.business_access_members
  for all to authenticated using (auth.uid() = business_id) with check (auth.uid() = business_id);

create table if not exists public.business_devices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  label text,
  status text not null default 'pending' check (status in ('approved', 'pending')),
  created_at timestamp with time zone not null default now(),
  approved_at timestamp with time zone,
  unique (business_id, device_id)
);
alter table public.business_devices enable row level security;
drop policy if exists "bdev_business_manages_own" on public.business_devices;
create policy "bdev_business_manages_own" on public.business_devices
  for all to authenticated using (auth.uid() = business_id) with check (auth.uid() = business_id);

create table if not exists public.business_signin_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.profiles(id) on delete cascade,
  member_id uuid,
  member_name text,
  device_id text,
  created_at timestamp with time zone not null default now()
);
alter table public.business_signin_log enable row level security;
drop policy if exists "blog_business_reads_own" on public.business_signin_log;
create policy "blog_business_reads_own" on public.business_signin_log
  for select to authenticated using (auth.uid() = business_id);

alter table public.business_applications alter column applicant_id drop not null;

create extension if not exists pgcrypto;

create or replace function public.create_business_access_member(p_name text)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_biz uuid := auth.uid();
  v_type text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_raw text := '';
  v_code text;
  i int;
begin
  if v_biz is null then raise exception 'Not signed in'; end if;
  select account_type into v_type from profiles where id = v_biz;
  if v_type is distinct from 'business' then
    raise exception 'Only a business account manages its access';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'A name is required'; end if;
  for i in 1..8 loop
    v_raw := v_raw || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  end loop;
  v_code := substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4);
  insert into business_access_members (business_id, display_name, code_hash)
  values (v_biz, trim(p_name), encode(digest(upper(v_code), 'sha256'), 'hex'));
  return jsonb_build_object('code', v_code);
end;
$fn$;

grant execute on function public.create_business_access_member(text) to authenticated;