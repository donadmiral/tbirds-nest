-- 0027_payment_messages.sql
-- A completed payment becomes a message in the thread, the way Apple Cash does.
--
-- Done with a trigger rather than from the client so the record exists for both
-- people even if the sender's app dies between the charge and the redraw. The
-- bridge already updates status to completed; this hangs off that.

alter table public.messages
  add column if not exists payment_id uuid references public.chat_payments(id) on delete set null;

create index if not exists idx_messages_payment
  on public.messages (payment_id) where payment_id is not null;

create or replace function public.post_payment_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Only on the transition into completed, and only once.
  if new.status <> 'completed' or old.status is not distinct from 'completed' then
    return new;
  end if;
  if exists (select 1 from messages where payment_id = new.id) then
    return new;
  end if;

  insert into messages (conversation_id, sender_id, receiver_id, text, media_type, payment_id)
  values (new.conversation_id, new.sender_id, new.recipient_id, null, 'payment', new.id);

  update conversations
     set last_message = 'Payment',
         last_message_time = now(),
         last_message_sender_id = new.sender_id
   where id = new.conversation_id;

  return new;
end;
$fn$;

drop trigger if exists trg_post_payment_message on public.chat_payments;
create trigger trg_post_payment_message
after update on public.chat_payments
for each row execute function public.post_payment_message();

-- Payments for the messages currently on screen, keyed by id.
create or replace function public.get_payments_by_ids(p_ids uuid[])
returns table (
  payment_id uuid, sender_id uuid, recipient_id uuid,
  amount numeric, currency text, status text,
  note text, listing_id uuid, listing_title text,
  created_at timestamptz, completed_at timestamptz
)
language sql stable security invoker set search_path = public
as $fn$
  select p.id, p.sender_id, p.recipient_id, p.amount, p.currency, p.status,
         p.note, p.listing_id, l.title, p.created_at, p.completed_at
  from chat_payments p
  left join marketplace_listings l on l.id = p.listing_id
  where p.id = any(p_ids)
    and (p.sender_id = auth.uid() or p.recipient_id = auth.uid());
$fn$;

grant execute on function public.get_payments_by_ids(uuid[]) to authenticated;