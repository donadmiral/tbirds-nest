-- 0048: business inbox
-- Conversations where the business (a profiles row) is a party, readable by
-- its members. SECURITY DEFINER with an explicit membership check, because
-- the caller is a member, not the business itself.

create or replace function public.get_business_conversations(p_business_id uuid)
returns table (
  conversation_id uuid,
  context text,
  other_id uuid,
  other_name text,
  other_username text,
  other_avatar text,
  last_text text,
  last_at timestamptz,
  last_sender uuid,
  unread int
)
language sql stable security definer set search_path = public
as $fn$
  select c.id,
         c.context,
         pr.id, pr.full_name, pr.username, pr.avatar_url,
         lm.text,
         lm.created_at,
         lm.sender_id,
         (select count(*)::int from messages m
           where m.conversation_id = c.id
             and m.receiver_id = p_business_id
             and m.sender_id <> p_business_id
             and m.read_at is null) as unread
  from conversations c
  join profiles pr
    on pr.id = case when c.user_1 = p_business_id then c.user_2 else c.user_1 end
  left join lateral (
    select m.text, m.created_at, m.sender_id
    from messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where is_business_member(p_business_id)
    and c.type = 'direct'
    and (c.user_1 = p_business_id or c.user_2 = p_business_id)
  order by lm.created_at desc nulls last;
$fn$;

grant execute on function public.get_business_conversations(uuid) to authenticated;