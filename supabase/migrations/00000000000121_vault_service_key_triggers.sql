-- 0121: service-role literals out of database objects. Both push triggers
-- read the key from Vault at fire time, so rotation becomes a one-line
-- vault update. Also fixes the voip trigger body: send-voip-push reads
-- callId and returned 400 for the old session_id payload, so the
-- DB-triggered VoIP ring never delivered until now.

create or replace function public.notify_voip_ring()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare k text;
begin
  if new.status = 'invited' then
    select decrypted_secret into k from vault.decrypted_secrets
      where name = 'service_role_key' order by created_at desc limit 1;
    if k is null then
      raise warning 'notify_voip_ring: vault secret service_role_key missing, push skipped';
      return new;
    end if;
    perform net.http_post(
      url := 'https://prlkikhckbifseosbukl.supabase.co/functions/v1/send-voip-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || k
      ),
      body := jsonb_build_object('callId', new.call_session_id)
    );
  end if;
  return new;
end;
$fn$;

create or replace function public.notify_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets
    where name = 'service_role_key' order by created_at desc limit 1;
  if k is null then
    raise warning 'notify_push_notification: vault secret service_role_key missing, push skipped';
    return new;
  end if;
  perform net.http_post(
    url := 'https://prlkikhckbifseosbukl.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || k
    ),
    body := jsonb_build_object('type', 'INSERT', 'table', 'notifications', 'schema', 'public', 'record', to_jsonb(new))
  );
  return new;
end;
$fn$;

drop trigger if exists "push-on-notification-insert" on public.notifications;
drop trigger if exists trg_push_notification on public.notifications;
create trigger trg_push_notification
  after insert on public.notifications
  for each row execute function public.notify_push_notification();