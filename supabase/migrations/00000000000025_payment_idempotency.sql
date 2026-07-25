-- 0025_payment_idempotency.sql
-- A retry after a network timeout must not charge twice.
--
-- The bridge previously used each payment row's own id as the reference to Crisp,
-- which identifies an attempt rather than an intent. Two attempts meant two rows
-- and two charges. A client-generated key, reused across retries of the same
-- intent, is what actually prevents it.
--
-- Unique per sender rather than globally: two people can generate the same UUID
-- only by accident, but scoping it removes even that.

alter table public.chat_payments
  add column if not exists idempotency_key text;

create unique index if not exists uq_chat_payments_idempotency
  on public.chat_payments (sender_id, idempotency_key)
  where idempotency_key is not null;

-- Guards the database can enforce regardless of what any client sends.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.chat_payments'::regclass
                   and conname = 'chat_payments_currency_check') then
    alter table public.chat_payments
      add constraint chat_payments_currency_check check (currency in ('USD', 'ZWG'));
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.chat_payments'::regclass
                   and conname = 'chat_payments_status_check') then
    alter table public.chat_payments
      add constraint chat_payments_status_check
      check (status in ('pending', 'completed', 'failed'));
  end if;
end $$;

-- Payment history for one conversation, so a chat can show what has been sent.
create or replace function public.get_conversation_payments(p_conversation_id uuid)
returns table (
  payment_id uuid, sender_id uuid, recipient_id uuid,
  amount numeric, currency text, status text,
  note text, listing_id uuid, created_at timestamptz, completed_at timestamptz
)
language sql stable security invoker set search_path = public
as $fn$
  select p.id, p.sender_id, p.recipient_id, p.amount, p.currency, p.status,
         p.note, p.listing_id, p.created_at, p.completed_at
  from chat_payments p
  where p.conversation_id = p_conversation_id
    and (p.sender_id = auth.uid() or p.recipient_id = auth.uid())
  order by p.created_at desc
  limit 50;
$fn$;

grant execute on function public.get_conversation_payments(uuid) to authenticated;