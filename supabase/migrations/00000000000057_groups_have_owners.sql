-- 0057 v3: every group has an owner. Columns verified:
-- conversation_id, user_id, joined_at, role.

update conversation_members cm
set role = 'owner'
from conversations c
where c.id = cm.conversation_id
  and c.type = 'group'
  and cm.user_id = c.created_by
  and not exists (
    select 1 from conversation_members x
    where x.conversation_id = cm.conversation_id
      and x.role in ('owner', 'admin')
  );

update conversation_members cm
set role = 'owner'
from (
  select distinct on (x.conversation_id) x.conversation_id, x.user_id
  from conversation_members x
  join conversations c on c.id = x.conversation_id and c.type = 'group'
  where not exists (
    select 1 from conversation_members y
    where y.conversation_id = x.conversation_id
      and y.role in ('owner', 'admin')
  )
  order by x.conversation_id, x.joined_at asc nulls last
) pick
where cm.conversation_id = pick.conversation_id
  and cm.user_id = pick.user_id;