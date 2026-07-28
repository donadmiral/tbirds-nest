-- 0050: ONE conversation per person per context.
-- Buying five things from one seller is one market chat; the subject chip
-- follows the latest item (context_ref_id updates on each start_dm_ctx).
-- Also merges the per-listing threads that already exist.

create or replace function public.start_dm_ctx(
  p_receiver_id uuid, p_context text default 'personal', p_ref_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare v_id uuid; a uuid; b uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_receiver_id = auth.uid() then raise exception 'cannot message yourself'; end if;
  a := least(auth.uid(), p_receiver_id);
  b := greatest(auth.uid(), p_receiver_id);

  select id into v_id from public.conversations
   where type = 'direct' and coalesce(is_group, false) = false
     and ((user_1 = a and user_2 = b) or (user_1 = b and user_2 = a))
     and coalesce(context, 'personal') = p_context
   order by created_at asc
   limit 1;

  if v_id is not null then
    if p_ref_id is not null then
      update public.conversations set context_ref_id = p_ref_id where id = v_id;
    end if;
    return v_id;
  end if;

  insert into public.conversations (user_1, user_2, type, is_group, context, context_ref_id, last_message, last_message_time)
  values (a, b, 'direct', false, p_context, p_ref_id, '', now())
  returning id into v_id;
  return v_id;
end $fn$;

-- merge the per-listing fragmentation that already exists
create temp table _ctx_dupes on commit drop as
  select (array_agg(id order by created_at))[1] as keeper,
         (array_agg(context_ref_id order by last_message_time desc nulls last))[1] as latest_ref,
         unnest((array_agg(id order by created_at))[2:]) as extra
  from public.conversations
  where type = 'direct' and coalesce(is_group, false) = false
    and context in ('market', 'jobs')
  group by least(user_1::text, coalesce(user_2::text, '')),
           greatest(user_1::text, coalesce(user_2::text, '')),
           context
  having count(*) > 1;

update public.messages m set conversation_id = d.keeper
from _ctx_dupes d where m.conversation_id = d.extra;

update public.chat_payments p set conversation_id = d.keeper
from _ctx_dupes d where p.conversation_id = d.extra;

update public.conversations c set context_ref_id = d.latest_ref
from (select distinct keeper, latest_ref from _ctx_dupes) d
where c.id = d.keeper;

delete from public.conversations c using _ctx_dupes d where c.id = d.extra;

update public.conversations c
set last_message = coalesce(lm.text, c.last_message),
    last_message_time = coalesce(lm.created_at, c.last_message_time)
from (
  select distinct on (conversation_id) conversation_id, text, created_at
  from public.messages order by conversation_id, created_at desc
) lm
where lm.conversation_id = c.id
  and c.id in (select distinct keeper from _ctx_dupes);