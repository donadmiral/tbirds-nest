-- 0026_conversation_contexts.sql
-- Market conversations belong in Market, job conversations in Jobs, and neither
-- belongs in Messages. This is the server side of that: one call that returns
-- both the unread badge numbers and a context-filtered conversation list, so
-- three screens read the same source rather than each rolling their own.

-- Unread counts per context, for the tab badges.
create or replace function public.get_context_unread()
returns jsonb
language sql stable security invoker set search_path = public
as $fn$
  with mine as (
    select c.id, coalesce(c.context, 'personal') as ctx, c.is_group
    from conversations c
    where (c.user_1 = auth.uid() or c.user_2 = auth.uid())
       or exists (select 1 from conversation_members m
                  where m.conversation_id = c.id and m.user_id = auth.uid())
  ),
  unread as (
    select mine.ctx, mine.is_group, count(*)::int as n
    from mine
    join messages msg on msg.conversation_id = mine.id
    where msg.sender_id <> auth.uid()
      and not exists (select 1 from message_reads r
                      where r.message_id = msg.id and r.user_id = auth.uid())
    group by mine.ctx, mine.is_group
  )
  select jsonb_build_object(
    'market',   coalesce((select sum(n) from unread where ctx = 'market'), 0),
    'jobs',     coalesce((select sum(n) from unread where ctx = 'jobs'), 0),
    'groups',   coalesce((select sum(n) from unread where is_group and ctx = 'personal'), 0),
    'personal', coalesce((select sum(n) from unread where ctx = 'personal' and not is_group), 0)
  );
$fn$;

grant execute on function public.get_context_unread() to authenticated;

-- Conversations for one context, with the other party resolved and the listing
-- or job attached. Market and Jobs call this; Messages calls it for 'personal'.
create or replace function public.get_conversations_by_context(
  p_context text default 'personal',
  p_include_groups boolean default true
)
returns table (
  conversation_id uuid,
  is_group boolean,
  group_name text,
  group_avatar_url text,
  other_id uuid,
  other_name text,
  other_username text,
  other_avatar text,
  last_message text,
  last_message_time timestamptz,
  last_message_sender_id uuid,
  unread_count int,
  context text,
  context_ref_id uuid,
  ref_title text,
  ref_subtitle text,
  ref_image text
)
language sql stable security invoker set search_path = public
as $fn$
  with mine as (
    select c.*
    from conversations c
    where ((c.user_1 = auth.uid() or c.user_2 = auth.uid())
        or exists (select 1 from conversation_members m
                   where m.conversation_id = c.id and m.user_id = auth.uid()))
      and coalesce(c.context, 'personal') = p_context
      and (p_include_groups or coalesce(c.is_group, false) = false)
      and coalesce(c.is_request, false) = false
  )
  select
    m.id,
    coalesce(m.is_group, false),
    m.group_name,
    m.group_avatar_url,
    other.id,
    other.full_name,
    other.username,
    other.avatar_url,
    m.last_message,
    m.last_message_time,
    m.last_message_sender_id,
    (select count(*)::int from messages msg
      where msg.conversation_id = m.id
        and msg.sender_id <> auth.uid()
        and not exists (select 1 from message_reads r
                        where r.message_id = msg.id and r.user_id = auth.uid())),
    coalesce(m.context, 'personal'),
    m.context_ref_id,
    case when m.context = 'market' then l.title
         when m.context = 'jobs'   then j.title end,
    case when m.context = 'market' then coalesce(l.currency, 'USD') || ' ' || l.price::text
         when m.context = 'jobs'   then j.company end,
    case when m.context = 'market' then l.images[1] end
  from mine m
  left join profiles other
    on other.id = case when coalesce(m.is_group, false) then null
                       when m.user_1 = auth.uid() then m.user_2
                       else m.user_1 end
  left join marketplace_listings l on m.context = 'market' and l.id = m.context_ref_id
  left join jobs j                 on m.context = 'jobs'   and j.id = m.context_ref_id
  order by m.last_message_time desc nulls last;
$fn$;

grant execute on function public.get_conversations_by_context(text, boolean) to authenticated;