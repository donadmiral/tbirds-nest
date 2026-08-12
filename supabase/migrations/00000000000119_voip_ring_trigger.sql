-- 0119 The phone rings because the database says so: every invited
-- participant row fires the VoIP sender, which resolves tokens and
-- knocks on Apple's door. Substitute the service role key before
-- running - the send function requires real authorization.

create or replace function public.notify_voip_ring()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.status = 'invited' then
    perform net.http_post(
      url := 'https://prlkikhckbifseosbukl.supabase.co/functions/v1/send-voip-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer REDACTED_MOVED_TO_VAULT_SEE_0121'
      ),
      body := jsonb_build_object('session_id', new.call_session_id, 'user_id', new.user_id)
    );
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_voip_ring on public.call_participants;
create trigger trg_voip_ring
  after insert on public.call_participants
  for each row execute function public.notify_voip_ring();