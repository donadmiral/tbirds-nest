-- 0052: view-once / view-twice photos.
-- view_limit on the message; per-recipient view ledger; consume_media_view is
-- the gate — it returns the url only while the caller's views are under the
-- limit, and never for the sender.

alter table public.messages add column if not exists view_limit smallint
  check (view_limit is null or view_limit in (1, 2));

create table if not exists public.message_views (
  message_id      uuid not null references public.messages(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  views           int not null default 0,
  first_viewed_at timestamptz,
  primary key (message_id, user_id)
);
alter table public.message_views enable row level security;
drop policy if exists message_views_own on public.message_views;
create policy message_views_own on public.message_views
  for select to authenticated using (user_id = auth.uid());
-- writes happen only through the definer function below

create or replace function public.consume_media_view(p_message_id uuid)
returns table (url text, remaining int)
language plpgsql security definer set search_path = public
as $fn$
declare
  m record;
  v int;
begin
  select msg.id, msg.sender_id, msg.media_url, msg.view_limit, msg.conversation_id
    into m from messages msg where msg.id = p_message_id;
  if m.id is null or m.view_limit is null then
    return query select null::text, 0; return;
  end if;
  if m.sender_id = auth.uid() then
    return query select null::text, 0; return;  -- sender never reopens
  end if;
  if not exists (
    select 1 from conversations c
    where c.id = m.conversation_id
      and (c.user_1 = auth.uid() or c.user_2 = auth.uid()
           or is_conversation_member(c.id, auth.uid()))
  ) then
    raise exception 'not a participant';
  end if;

  insert into message_views (message_id, user_id, views, first_viewed_at)
  values (p_message_id, auth.uid(), 0, now())
  on conflict (message_id, user_id) do nothing;

  select views into v from message_views
   where message_id = p_message_id and user_id = auth.uid() for update;

  if v >= m.view_limit then
    return query select null::text, 0; return;
  end if;

  update message_views set views = views + 1,
    first_viewed_at = coalesce(first_viewed_at, now())
  where message_id = p_message_id and user_id = auth.uid();

  return query select m.media_url, (m.view_limit - v - 1);
end $fn$;

grant execute on function public.consume_media_view(uuid) to authenticated;