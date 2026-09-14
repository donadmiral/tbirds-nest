-- Fair bounded recovery of chat payment outcomes. Does not schedule any job,
-- move funds, resend requests, enable outbound webhooks or modify old outcomes.
alter table public.chat_payments
  add column if not exists last_status_check_at timestamptz;

create index if not exists chat_payments_pending_recovery_idx
  on public.chat_payments (last_status_check_at nulls first, id)
  where status = 'pending';

-- The bridge and internal worker alone create or transition payment records.
-- Participants retain the existing owner-scoped read policies.
alter table public.chat_payments enable row level security;
revoke insert, update, delete on public.chat_payments from public, anon, authenticated;

-- A deleted conversation must not erase a transfer identity and allow a replay.
alter table public.chat_payments
  drop constraint if exists chat_payments_conversation_id_fkey;
alter table public.chat_payments
  add constraint chat_payments_conversation_id_fkey
  foreign key (conversation_id) references public.conversations(id) on delete restrict;
-- Sender/recipient already reference auth.users without cascading deletion.
-- Explicit account-deletion routines must not remove these records either.
create or replace function public.preserve_chat_payment_record()
returns trigger language plpgsql security invoker set search_path = '' as $fn$
begin
  raise exception using errcode = '23503',
    message = 'Payment history requires a reviewed retention process and cannot be deleted through chat or account deletion';
end;
$fn$;
revoke all on function public.preserve_chat_payment_record() from public, anon, authenticated;
drop trigger if exists preserve_chat_payment_delete on public.chat_payments;
create trigger preserve_chat_payment_delete before delete on public.chat_payments
for each row execute function public.preserve_chat_payment_record();
drop trigger if exists preserve_chat_payment_truncate on public.chat_payments;
create trigger preserve_chat_payment_truncate before truncate on public.chat_payments
for each statement execute function public.preserve_chat_payment_record();
revoke truncate, trigger, references on public.chat_payments from public, anon, authenticated;

-- A visible payment card needs server-verified provenance. Legacy messages keep
-- their original contents. Only exact matches to completed records are verified.
alter table public.messages
  add column if not exists payment_receipt_verified boolean not null default false;
revoke truncate, trigger on public.messages from public, anon, authenticated;
update public.messages m set payment_receipt_verified = true
from public.chat_payments p
where m.payment_id = p.id and p.status = 'completed'
  and p.tx_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and m.conversation_id = p.conversation_id
  and m.sender_id = p.sender_id and m.receiver_id = p.recipient_id
  and m.media_type = 'payment' and m.text is null;
-- Duplicate canonical candidates fail this migration for review, never deletion.
create unique index if not exists messages_verified_payment_receipt_idx
  on public.messages (payment_id) where payment_receipt_verified = true;

create or replace function public.guard_payment_receipt_message()
returns trigger language plpgsql security invoker set search_path = '' as $fn$
declare
  v_sensitive boolean := false;
  v_trusted boolean := auth.uid() is null
    and current_user in ('postgres', 'service_role', 'supabase_admin');
begin
  if tg_op <> 'INSERT' then
    v_sensitive := old.payment_id is not null or old.media_type = 'payment'
      or old.payment_receipt_verified;
  end if;
  if tg_op <> 'DELETE' then
    v_sensitive := v_sensitive or new.payment_id is not null or new.media_type = 'payment'
      or new.payment_receipt_verified;
  end if;
  -- auth.uid() also identifies user calls inside SECURITY DEFINER account/message
  -- helpers, where current_user alone would misleadingly appear privileged.
  if coalesce(v_sensitive, false) and not v_trusted then
    -- Recipient delivery/read acknowledgements do not change payment evidence.
    -- Keep the existing mark_conversation_read flow working without allowing
    -- either participant to alter, clear or forge the receipt itself.
    if tg_op = 'UPDATE' and auth.uid() = old.receiver_id
      and (to_jsonb(new) - array['read_at','viewed_at','delivered_at'])
        = (to_jsonb(old) - array['read_at','viewed_at','delivered_at']) then
      return new;
    end if;
    raise exception using errcode = '42501', message = 'Payment receipt messages are managed by the payment service';
  end if;
  if tg_op <> 'DELETE' and new.payment_receipt_verified then
    if new.payment_id is null or new.media_type is distinct from 'payment' or new.text is not null
      or not exists (
        select 1 from public.chat_payments p
        where p.id = new.payment_id and p.status = 'completed'
          and p.tx_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and p.conversation_id = new.conversation_id
          and p.sender_id = new.sender_id and p.recipient_id = new.receiver_id
      ) then
      raise exception using errcode = '23514', message = 'Payment receipt does not match a completed payment';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$fn$;
revoke all on function public.guard_payment_receipt_message() from public, anon, authenticated;
drop trigger if exists guard_payment_receipt_message on public.messages;
create trigger guard_payment_receipt_message before insert or update or delete on public.messages
for each row execute function public.guard_payment_receipt_message();

create or replace function public.post_payment_message()
returns trigger language plpgsql security invoker set search_path = '' as $fn$
begin
  if new.status <> 'completed' or old.status is not distinct from 'completed' then return new; end if;
  if new.tx_id is null or new.tx_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = '23514', message = 'Completed payment requires a canonical transaction reference';
  end if;
  if exists (
    select 1 from public.messages m where m.payment_id = new.id
      and m.payment_receipt_verified = true and m.conversation_id = new.conversation_id
      and m.sender_id = new.sender_id and m.receiver_id = new.recipient_id
      and m.media_type = 'payment' and m.text is null
  ) then return new; end if;
  insert into public.messages (conversation_id, sender_id, receiver_id, text, media_type, payment_id, payment_receipt_verified)
  values (new.conversation_id, new.sender_id, new.recipient_id, null, 'payment', new.id, true);
  update public.conversations set last_message = 'Payment', last_message_time = now(),
    last_message_sender_id = new.sender_id where id = new.conversation_id;
  return new;
end;
$fn$;
revoke all on function public.post_payment_message() from public, anon, authenticated;
drop trigger if exists trg_post_payment_message on public.chat_payments;
create trigger trg_post_payment_message after update on public.chat_payments
for each row execute function public.post_payment_message();
