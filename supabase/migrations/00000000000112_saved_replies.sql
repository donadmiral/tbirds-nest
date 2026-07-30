-- 0112 Business saved replies: canned answers a business session keeps
-- for its inbox. Fully own-row - the business IS the signed-in user.

create table if not exists public.business_saved_replies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamp with time zone not null default now()
);
alter table public.business_saved_replies enable row level security;

drop policy if exists "bsr_all_own" on public.business_saved_replies;
create policy "bsr_all_own" on public.business_saved_replies
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());