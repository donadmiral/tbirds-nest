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
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBybGtpa2hja2JpZnNlb3NidWtsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTc5NTUwOSwiZXhwIjoyMDkxMzcxNTA5fQ.JKlal56cQAPeWWOj3aubN0900XuW68df682kVBKevDE'
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