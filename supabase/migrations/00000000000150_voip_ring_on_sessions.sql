-- 0150: ring the phone that is actually being called.
--
-- The VoIP ring has never fired for a real call. The trigger sits on
-- call_participants and fires when a row lands with status 'invited', but this
-- app does not create calls that way. A one to one call inserts a single
-- call_sessions row with receiver_id set, and a group call inserts one
-- call_sessions row per member, each with its own receiver_id. The only writers
-- of call_participants are the older group RPCs, and they write 'joined', not
-- 'invited'. So the table the trigger watches stays empty and no push is sent.
--
-- This adds the trigger where the rows actually appear, and keeps the old one
-- so nothing that still writes call_participants regresses. Both call the same
-- edge function with the same body shape, and the function is idempotent for a
-- given call because it refuses to send unless the session is still ringing.

begin;

create or replace function public.notify_voip_ring_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare k text;
begin
  -- Only rows that represent somebody's phone ringing. The caller's own row
  -- carries receiver_id null and status 'active', and must not push.
  if new.status = 'ringing' and new.receiver_id is not null then
    select decrypted_secret into k from vault.decrypted_secrets
      where name = 'service_role_key' order by created_at desc limit 1;
    if k is null then
      raise warning 'notify_voip_ring_session: vault secret service_role_key missing, push skipped';
      return new;
    end if;
    perform net.http_post(
      url := 'https://prlkikhckbifseosbukl.supabase.co/functions/v1/send-voip-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || k
      ),
      body := jsonb_build_object('callId', new.id)
    );
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_voip_ring_session on public.call_sessions;
create trigger trg_voip_ring_session
  after insert on public.call_sessions
  for each row execute function public.notify_voip_ring_session();

commit;
