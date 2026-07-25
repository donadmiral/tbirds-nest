-- 0032_chat_info_features.sql
-- What the chat info screen needs that the database could not answer yet:
-- reporting a person, disappearing messages, and groups in common.

-- ── reporting a person ─────────────────────────────────────────────────────
-- post_reports and listing_reports existed; there was nowhere to report a
-- human being, which meant blocking was only half a safety story.
create table if not exists public.user_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references public.profiles(id) on delete cascade,
  reported_id  uuid not null references public.profiles(id) on delete cascade,
  reason       text not null,
  details      text,
  conversation_id uuid references public.conversations(id) on delete set null,
  status       text not null default 'open',
  created_at   timestamptz not null default now(),
  constraint user_reports_reason_check check (reason in
    ('spam', 'harassment', 'scam', 'impersonation', 'inappropriate', 'other')),
  constraint user_reports_status_check check (status in ('open', 'reviewing', 'closed')),
  constraint user_reports_not_self check (reporter_id <> reported_id)
);

create unique index if not exists uq_user_reports_open
  on public.user_reports (reporter_id, reported_id)
  where status = 'open';

create index if not exists idx_user_reports_reported on public.user_reports (reported_id);

alter table public.user_reports enable row level security;

-- You can file one and see your own. Nobody reads reports about themselves.
drop policy if exists user_reports_insert_own on public.user_reports;
create policy user_reports_insert_own on public.user_reports
  for insert to authenticated with check (reporter_id = auth.uid());

drop policy if exists user_reports_select_own on public.user_reports;
create policy user_reports_select_own on public.user_reports
  for select to authenticated using (reporter_id = auth.uid());

-- ── disappearing messages ──────────────────────────────────────────────────
-- Per conversation, not per person: both sides must agree on what the thread
-- is, or one of them keeps a copy the other believes is gone.
alter table public.conversations
  add column if not exists disappearing_seconds int,
  add column if not exists disappearing_set_by uuid references public.profiles(id) on delete set null,
  add column if not exists disappearing_set_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.conversations'::regclass
                   and conname = 'conversations_disappearing_check') then
    alter table public.conversations
      add constraint conversations_disappearing_check
      check (disappearing_seconds is null or disappearing_seconds in (86400, 604800, 7776000));
  end if;
end $$;

create or replace function public.set_disappearing_messages(
  p_conversation_id uuid,
  p_seconds int default null
) returns void
language plpgsql security invoker set search_path = public
as $fn$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from conversations c
    where c.id = p_conversation_id
      and (c.user_1 = auth.uid() or c.user_2 = auth.uid()
           or exists (select 1 from conversation_members m
                      where m.conversation_id = c.id and m.user_id = auth.uid()))
  ) then
    raise exception 'Not a participant in this conversation';
  end if;

  update conversations
     set disappearing_seconds = p_seconds,
         disappearing_set_by = auth.uid(),
         disappearing_set_at = now()
   where id = p_conversation_id;
end;
$fn$;

grant execute on function public.set_disappearing_messages(uuid, int) to authenticated;

-- ── groups in common ───────────────────────────────────────────────────────
create or replace function public.get_groups_in_common(p_other_id uuid)
returns table (conversation_id uuid, group_name text, group_avatar_url text, member_count int)
language sql stable security invoker set search_path = public
as $fn$
  select c.id, c.group_name, c.group_avatar_url,
         (select count(*)::int from conversation_members m3 where m3.conversation_id = c.id)
  from conversations c
  where coalesce(c.is_group, false) = true
    and exists (select 1 from conversation_members m1
                where m1.conversation_id = c.id and m1.user_id = auth.uid())
    and exists (select 1 from conversation_members m2
                where m2.conversation_id = c.id and m2.user_id = p_other_id)
  order by c.group_name;
$fn$;

grant execute on function public.get_groups_in_common(uuid) to authenticated;