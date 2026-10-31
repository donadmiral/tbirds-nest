-- New replies and ticket reopening are one database transaction. Old clients
-- also receive the atomic insert behavior; their existing grants stay intact.
create schema if not exists support_private;
revoke all on schema support_private from public, anon, authenticated;

create or replace function support_private.reopen_member_ticket()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.sender = 'member' then
    update public.support_tickets
       set status = 'open', updated_at = pg_catalog.now()
     where id = new.ticket_id and user_id = new.sender_id;
    if not found then
      raise exception 'SUPPORT_TICKET_UNAVAILABLE' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function support_private.reopen_member_ticket() from public, anon, authenticated;

drop trigger if exists support_member_reply_reopens_ticket on public.support_messages;
create trigger support_member_reply_reopens_ticket
after insert on public.support_messages
for each row execute function support_private.reopen_member_ticket();

create or replace function public.send_member_support_reply(
  p_expected_user uuid, p_ticket_id uuid, p_request_id uuid, p_body text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_body text := pg_catalog.btrim(p_body);
  v_ticket public.support_tickets%rowtype;
  v_message public.support_messages%rowtype;
  v_replayed boolean := false;
begin
  if v_owner is null then
    raise exception 'SUPPORT_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_expected_user is distinct from v_owner then
    raise exception 'SUPPORT_ACCOUNT_CHANGED' using errcode = '42501';
  end if;
  if p_request_id is null or p_ticket_id is null or v_body is null
     or pg_catalog.char_length(v_body) < 1 or pg_catalog.char_length(v_body) > 2000 then
    raise exception 'SUPPORT_INPUT_INVALID' using errcode = '22023';
  end if;

  -- Serialize replies with staff updates on the same ticket. RLS remains in
  -- force; knowing another ticket UUID never grants access to it.
  select * into v_ticket from public.support_tickets
   where id = p_ticket_id and user_id = v_owner for update;
  if not found then
    raise exception 'SUPPORT_TICKET_UNAVAILABLE' using errcode = '42501';
  end if;

  insert into public.support_messages (id, ticket_id, sender, sender_id, body)
    values (p_request_id, p_ticket_id, 'member', v_owner, v_body)
    on conflict (id) do nothing
    returning * into v_message;
  if not found then
    v_replayed := true;
    select * into v_message from public.support_messages where id = p_request_id;
    if not found or v_message.ticket_id is distinct from p_ticket_id
       or v_message.sender is distinct from 'member' or v_message.sender_id is distinct from v_owner
       or v_message.body is distinct from v_body then
      raise exception 'SUPPORT_REQUEST_CONFLICT' using errcode = '22023';
    end if;
  end if;

  -- AFTER INSERT runs only for a new row, so a retry never reopens a ticket a
  -- staff member solved after the original reply. Return the current status.
  select * into v_ticket from public.support_tickets where id = p_ticket_id and user_id = v_owner;
  return pg_catalog.jsonb_build_object(
    'message_id', v_message.id, 'ticket_id', v_message.ticket_id,
    'sender_id', v_message.sender_id, 'body', v_message.body,
    'created_at', v_message.created_at, 'ticket_status', v_ticket.status,
    'replayed', v_replayed
  );
end;
$$;
revoke all on function public.send_member_support_reply(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.send_member_support_reply(uuid, uuid, uuid, text) to authenticated;
comment on function public.send_member_support_reply(uuid, uuid, uuid, text) is
  'Owned member reply with stable message UUID, atomic reopening and replay-safe confirmation. SECURITY INVOKER preserves RLS.';
notify pgrst, 'reload schema';
