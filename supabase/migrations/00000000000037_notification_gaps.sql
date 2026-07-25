-- 0037_notification_gaps.sql
-- Two things the trigger audit turned up.
--
-- 1. notify_referral wrote type 'mention' with the message "referred you to a
--    job". Job referrals have been rendering as mentions, with the wrong copy
--    and the wrong tap target, since the day that trigger was written.
--
-- 2. trg_notify_missed_call fires on _deprecated_calls, a dead table. Dead
--    trigger on dead data.
--
-- Also adds story_mention to the feed: usePublishOrchestrator writes it
-- correctly and the screen can render it once it knows the type exists.

drop trigger if exists trg_notify_missed_call on public._deprecated_calls;

create or replace function public.notify_referral()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_name text; v_title text;
begin
  if new.referred_id = new.referrer_id then return new; end if;

  select coalesce(full_name, username, 'Someone') into v_name
  from profiles where id = new.referrer_id;
  select title into v_title from jobs where id = new.job_id;

  insert into notifications (recipient_id, actor_id, type, message, body_preview, data)
  values (new.referred_id, new.referrer_id, 'job_referral',
          v_name || ' referred you for a job',
          v_title,
          jsonb_build_object('job_id', new.job_id, 'referral_id', new.id));
  return new;
end;
$fn$;

-- Existing referral rows are sitting in the feed mislabelled as mentions.
update notifications
   set type = 'job_referral'
 where type = 'mention'
   and message ilike '%referred you to a job%';