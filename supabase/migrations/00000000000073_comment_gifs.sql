-- 0073: GIFs in comments.
alter table public.post_comments add column if not exists media_url text;
alter table public.post_comments add column if not exists media_type text;