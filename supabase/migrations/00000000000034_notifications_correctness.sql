-- 0034_notifications_correctness.sql
-- Three problems, all visible in the schema baseline.
--
-- 1. DOUBLE MENTIONS. posts has both trg_mention_posts (notify_mentions) and
--    trg_notify_post_mention (notify_on_post_mention), and post_comments has
--    the matching pair. Both insert a mention notification. notify_mentions
--    dedupes within 60 seconds and runs first alphabetically, so the second
--    always adds a duplicate. Keeping notify_mentions: it dedupes, it handles
--    posts and comments in one function, and it writes a body_preview.
--
-- 2. ANYONE CAN FORGE A NOTIFICATION. notif_insert is CHECK true, so any
--    signed-in user can write a notification to anybody claiming to be from
--    anybody. Now you must be the actor, or it must be for yourself.
--
-- 3. THINGS THAT SHOULD NOTIFY AND DO NOT: follow requests (a private account
--    never learns someone asked), follow requests being accepted, money
--    arriving, job applications, and being added to a business team.

-- ── 1. one mention notification, not two ───────────────────────────────────
drop trigger if exists trg_notify_post_mention on public.posts;
drop trigger if exists trg_notify_comment_mention on public.post_comments;

-- ── 2. close the forgery hole ──────────────────────────────────────────────
drop policy if exists notif_insert on public.notifications;
drop policy if exists notifications_insert_authenticated on public.notifications;

create policy notifications_insert_as_actor on public.notifications
  for insert to authenticated
  with check (actor_id = auth.uid() or recipient_id = auth.uid());

-- Triggers are SECURITY DEFINER and bypass this, which is the point: the
-- database writes notifications, the client mostly should not.

-- ── 3. the missing notifications ───────────────────────────────────────────

create or replace function public.notify_on_follow_request()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_name text;
begin
  if new.status <> 'pending' then return new; end if;
  select coalesce(full_name, username, 'Someone') into v_name
  from profiles where id = new.requester_id;

  insert into notifications (recipient_id, actor_id, type, message, data)
  values (new.target_id, new.requester_id, 'follow_request',
          v_name || ' wants to follow you',
          jsonb_build_object('request_id', new.id));
  return new;
end;
$fn$;

drop trigger if exists trg_notify_follow_request on public.follow_requests;
create trigger trg_notify_follow_request
after insert on public.follow_requests
for each row execute function public.notify_on_follow_request();

create or replace function public.notify_on_follow_request_accepted()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_name text;
begin
  if new.status <> 'accepted' or old.status is not distinct from 'accepted' then
    return new;
  end if;
  select coalesce(full_name, username, 'Someone') into v_name
  from profiles where id = new.target_id;

  insert into notifications (recipient_id, actor_id, type, message, data)
  values (new.requester_id, new.target_id, 'follow_accepted',
          v_name || ' accepted your follow request',
          jsonb_build_object('request_id', new.id));
  return new;
end;
$fn$;

drop trigger if exists trg_notify_follow_request_accepted on public.follow_requests;
create trigger trg_notify_follow_request_accepted
after update on public.follow_requests
for each row execute function public.notify_on_follow_request_accepted();

-- Money arriving is the single most important thing to be told about.
create or replace function public.notify_on_payment()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_name text; v_amount text;
begin
  if new.status <> 'completed' or old.status is not distinct from 'completed' then
    return new;
  end if;
  select coalesce(full_name, username, 'Someone') into v_name
  from profiles where id = new.sender_id;

  v_amount := case when coalesce(new.currency, 'USD') = 'USD'
                   then '$' || trim(to_char(new.amount, 'FM999999990.00'))
                   else 'ZWG ' || trim(to_char(new.amount, 'FM999999990.00')) end;

  insert into notifications (recipient_id, actor_id, type, message, body_preview, data)
  values (new.recipient_id, new.sender_id, 'payment_received',
          v_name || ' sent you ' || v_amount,
          new.note,
          jsonb_build_object('payment_id', new.id,
                             'conversation_id', new.conversation_id,
                             'listing_id', new.listing_id));
  return new;
end;
$fn$;

drop trigger if exists trg_notify_payment on public.chat_payments;
create trigger trg_notify_payment
after update on public.chat_payments
for each row execute function public.notify_on_payment();

create or replace function public.notify_on_job_application()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_poster uuid; v_title text; v_name text;
begin
  select posted_by, title into v_poster, v_title from jobs where id = new.job_id;
  if v_poster is null or v_poster = new.applicant_id then return new; end if;

  select coalesce(full_name, username, 'Someone') into v_name
  from profiles where id = new.applicant_id;

  insert into notifications (recipient_id, actor_id, type, message, body_preview, data)
  values (v_poster, new.applicant_id, 'job_application',
          v_name || ' applied to your job',
          v_title,
          jsonb_build_object('job_id', new.job_id, 'application_id', new.id));
  return new;
end;
$fn$;

drop trigger if exists trg_notify_job_application on public.job_applications;
create trigger trg_notify_job_application
after insert on public.job_applications
for each row execute function public.notify_on_job_application();

create or replace function public.notify_on_business_member()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_business text;
begin
  if new.member_id = auth.uid() then return new; end if;
  select full_name into v_business from profiles where id = new.business_id;

  insert into notifications (recipient_id, actor_id, type, message, body_preview, data)
  values (new.member_id, auth.uid(), 'business_member',
          'You were added to ' || coalesce(v_business, 'a business'),
          initcap(new.role),
          jsonb_build_object('business_id', new.business_id, 'role', new.role));
  return new;
end;
$fn$;

drop trigger if exists trg_notify_business_member on public.business_members;
create trigger trg_notify_business_member
after insert on public.business_members
for each row execute function public.notify_on_business_member();