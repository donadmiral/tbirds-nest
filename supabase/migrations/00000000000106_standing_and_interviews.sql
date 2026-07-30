-- 0106 Two member-facing rights: a person may read their own strike
-- record (the desk issues them; the member deserves to see them), and
-- job applications gain interview scheduling fields.

do $do$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'member_strikes' and column_name = 'user_id') then
    execute 'drop policy if exists "strikes_select_own" on public.member_strikes';
    execute 'create policy "strikes_select_own" on public.member_strikes for select to authenticated using (user_id = auth.uid())';
  elsif exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'member_strikes' and column_name = 'member_id') then
    execute 'drop policy if exists "strikes_select_own" on public.member_strikes';
    execute 'create policy "strikes_select_own" on public.member_strikes for select to authenticated using (member_id = auth.uid())';
  end if;
end
$do$;

alter table public.job_applications add column if not exists interview_at timestamp with time zone;
alter table public.job_applications add column if not exists interview_location text;