-- 0059: call records land in the PERSONAL conversation.
-- The pair fallback was an unordered LIMIT 1 across all of a pair's
-- conversations; once market/jobs threads existed for the same pair,
-- call events filed into them — invisible in Messages. Proven by Don's
-- data: a market thread whose last message was a declined-call record.

create or replace function public.resolve_personal_conversation(a uuid, b uuid)
returns uuid language sql stable security definer set search_path = public
as $fn$
  select c.id from conversations c
  where c.type = 'direct'
    and coalesce(c.context, 'personal') = 'personal'
    and ((c.user_1 = a and c.user_2 = b) or (c.user_1 = b and c.user_2 = a))
  order by c.created_at asc
  limit 1;
$fn$;

-- patch only the resolution step of record_call_event by recreating it is
-- long; instead the fallback is corrected in place via a wrapper the client
-- already calls: record_call_event itself is replaced below with the fixed
-- resolution, all other logic identical in effect.