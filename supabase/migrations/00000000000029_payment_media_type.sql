-- 0029_payment_media_type.sql
-- messages_media_type_check did not allow 'payment', which rolled back the
-- backfill in 0028. Extending the constraint, then running that backfill.
--
-- 'audio' was already permitted, so voice messages were never at risk.

alter table public.messages drop constraint if exists messages_media_type_check;

alter table public.messages
  add constraint messages_media_type_check
  check (media_type = any (array[
    'image'::text, 'video'::text, 'gif'::text, 'audio'::text,
    'link'::text, 'document'::text, 'call_event'::text, 'payment'::text
  ]));

-- ── the backfill from 0028, now that the constraint permits it ──────────────

-- 1. adopt the old "Sent USD 5.00" system lines in place
update public.messages m
   set payment_id = p.id,
       media_type = 'payment',
       text = null
  from public.chat_payments p
 where p.status = 'completed'
   and m.payment_id is null
   and m.conversation_id = p.conversation_id
   and m.sender_id = p.sender_id
   and coalesce(m.is_system_message, false) = true
   and m.text like 'Sent %'
   and m.created_at between coalesce(p.completed_at, p.created_at) - interval '3 minutes'
                        and coalesce(p.completed_at, p.created_at) + interval '3 minutes';

-- 2. anything still unrepresented gets its own message, placed in time
insert into public.messages (conversation_id, sender_id, receiver_id, text, media_type, payment_id, created_at)
select p.conversation_id, p.sender_id, p.recipient_id, null, 'payment', p.id,
       coalesce(p.completed_at, p.created_at)
from public.chat_payments p
where p.status = 'completed'
  and not exists (select 1 from public.messages m where m.payment_id = p.id);