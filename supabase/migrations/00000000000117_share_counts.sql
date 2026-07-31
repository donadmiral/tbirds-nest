-- 0117 Shares become a counted signal like likes and reposts. Any of
-- the three share paths (to a story, to a chat, out of the app) counts.

alter table public.posts add column if not exists shares_count integer not null default 0;

create or replace function public.increment_share_count(p_post_id uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  update posts set shares_count = shares_count + 1 where id = p_post_id;
$fn$;

grant execute on function public.increment_share_count(uuid) to authenticated;

notify pgrst, 'reload schema';