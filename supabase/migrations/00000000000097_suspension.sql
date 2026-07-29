-- 0097 Suspension bookkeeping. Admin suspension sets deactivated_at, which
-- the app already honors everywhere; these columns record why and by whom,
-- and the audit log records the act itself.

alter table public.profiles add column if not exists suspended_reason text;
alter table public.profiles add column if not exists suspended_by uuid;