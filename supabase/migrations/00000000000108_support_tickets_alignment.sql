-- 0108 Align support_tickets with the app and the desk. The original
-- table used subject + message; the screen and desk speak body + kind.
-- Add what is missing, carry old message text into body, reload the API.

alter table public.support_tickets add column if not exists body text;
alter table public.support_tickets add column if not exists kind text not null default 'support';

alter table public.support_tickets drop constraint if exists support_tickets_kind_check;
alter table public.support_tickets add constraint support_tickets_kind_check
  check (kind in ('support', 'appeal'));

update public.support_tickets set body = coalesce(body, message);

alter table public.support_tickets alter column status set default 'open';

notify pgrst, 'reload schema';