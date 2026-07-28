-- 0063: mark-unread + drafts groundwork for the WhatsApp list.
alter table public.conversation_settings
  add column if not exists manually_unread boolean not null default false;