-- 0071: notification preferences as data, not columns. Missing key = ON.
-- Legacy booleans backfilled, then left in place until the UI stops writing them.

alter table public.profiles add column if not exists notif_prefs jsonb not null default '{}'::jsonb;

update profiles set notif_prefs = notif_prefs || '{"message":false,"message_reaction":false}'::jsonb
where notif_messages = false;
update profiles set notif_prefs = notif_prefs || '{"follow":false,"connection_request":false,"connection_accepted":false}'::jsonb
where notif_connections = false;
update profiles set notif_prefs = notif_prefs || '{"job":false,"job_application":false}'::jsonb
where notif_jobs = false;