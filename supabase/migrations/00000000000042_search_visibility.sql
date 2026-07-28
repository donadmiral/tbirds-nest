-- 0042: search respects visibility
-- Post search goes through can_view_post so audience, privacy and blocks
-- apply in search exactly as they do in the feed.

create or replace function public.search_posts(p_q text, p_limit int default 20)
returns table (
  id uuid, user_id uuid, content text, body text, media_url text,
  likes_count int, comments_count int, created_at timestamptz
)
language sql stable security invoker set search_path = public
as $fn$
  select p.id, p.user_id, p.content, p.body, p.media_url,
         p.likes_count, p.comments_count, p.created_at
  from posts p
  where (p.content ilike '%' || p_q || '%' or p.body ilike '%' || p_q || '%')
    and can_view_post(p.id)
  order by p.created_at desc
  limit least(coalesce(p_limit, 20), 30);
$fn$;

grant execute on function public.search_posts(text, int) to authenticated;