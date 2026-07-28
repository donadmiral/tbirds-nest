-- 0064: the list prefix is a per-viewer decision. The row carries who
-- sent the last message; each viewer's client renders "You:" only for
-- themselves.
alter table public.conversations add column if not exists last_sender_id uuid;