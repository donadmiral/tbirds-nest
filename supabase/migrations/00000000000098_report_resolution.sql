-- 0098 Report resolution lifecycle. Every report can be open, dismissed,
-- or actioned, with who resolved it and when. user_reports already had a
-- status column; it gains only the resolver bookkeeping.

alter table public.post_reports add column if not exists status text not null default 'open';
alter table public.post_reports add column if not exists resolved_by uuid;
alter table public.post_reports add column if not exists resolved_at timestamp with time zone;

alter table public.listing_reports add column if not exists status text not null default 'open';
alter table public.listing_reports add column if not exists resolved_by uuid;
alter table public.listing_reports add column if not exists resolved_at timestamp with time zone;

alter table public.user_reports add column if not exists resolved_by uuid;
alter table public.user_reports add column if not exists resolved_at timestamp with time zone;