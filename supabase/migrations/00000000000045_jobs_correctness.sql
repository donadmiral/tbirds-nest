-- 0045: jobs correctness (v2 — the count column is renamed to plural here,
-- matching likes_count/comments_count convention and the app code)
-- 12 policies -> 4, duplicate counter trigger dropped, counts repaired.

drop policy if exists "Anyone reads jobs"      on public.jobs;
drop policy if exists "Users delete own jobs"  on public.jobs;
drop policy if exists "Users insert own jobs"  on public.jobs;
drop policy if exists jobs_delete              on public.jobs;
drop policy if exists jobs_insert              on public.jobs;
drop policy if exists jobs_update              on public.jobs;
drop policy if exists jobs_select              on public.jobs;
drop policy if exists jobs_select_all          on public.jobs;

drop policy if exists jobs_select_visible on public.jobs;
create policy jobs_select_visible on public.jobs
  for select to authenticated
  using (
    not exists (
      select 1 from blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = jobs.posted_by)
         or (b.blocker_id = jobs.posted_by and b.blocked_id = auth.uid())
    )
  );

-- one counter trigger, not two
drop trigger if exists trg_app_count on public.job_applications;

-- rename the count column to plural (idempotent)
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'jobs'
               and column_name = 'application_count') then
    alter table public.jobs rename column application_count to applications_count;
  end if;
end $$;

-- the surviving counter trigger function follows the rename
create or replace function public.sync_job_application_count()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
begin
  if TG_OP = 'INSERT' then
    update jobs set applications_count = applications_count + 1 where id = NEW.job_id;
  elsif TG_OP = 'DELETE' then
    update jobs set applications_count = greatest(0, applications_count - 1) where id = OLD.job_id;
  end if;
  return null;
end;
$fn$;

-- repair the double-counted history
update public.jobs j
set applications_count = (
  select count(*) from public.job_applications a where a.job_id = j.id
)
where true;