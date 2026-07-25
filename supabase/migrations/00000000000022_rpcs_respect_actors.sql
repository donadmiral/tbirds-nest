-- 0022_rpcs_respect_actors.sql
-- Two RPCs written before can_act_as existed still compare the post's author to
-- auth.uid() directly, so a business post would be rejected by its own team.
--
-- set_post_products matters most: product cards are the main reason a business
-- posts, and a business could not attach any.
-- get_post_insights matters because a team could not see how its own post did.

create or replace function public.set_post_products(p_post_id uuid, p_products jsonb)
returns int
language plpgsql security invoker set search_path = public
as $fn$
declare
  v_author uuid;
  v_count int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select user_id into v_author from posts where id = p_post_id;
  if v_author is null then raise exception 'Post not found'; end if;
  if not can_act_as(v_author) then
    raise exception 'Only the author can set products';
  end if;

  delete from post_products where post_id = p_post_id;

  insert into post_products (post_id, sort_order, title, subtitle, price, currency,
                             image_url, listing_id, link_url, cta_label)
  select p_post_id,
         coalesce((elem->>'sort_order')::int, ord - 1),
         elem->>'title',
         nullif(elem->>'subtitle', ''),
         nullif(elem->>'price', '')::numeric,
         coalesce(nullif(elem->>'currency', ''), 'USD'),
         nullif(elem->>'image_url', ''),
         nullif(elem->>'listing_id', '')::uuid,
         nullif(elem->>'link_url', ''),
         coalesce(nullif(elem->>'cta_label', ''), 'View')
  from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) with ordinality as t(elem, ord);

  select count(*) into v_count from post_products where post_id = p_post_id;
  return v_count;
end;
$fn$;

grant execute on function public.set_post_products(uuid, jsonb) to authenticated;

create or replace function public.get_post_insights(p_post_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $fn$
declare
  v_author uuid;
  v_reach  int;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select user_id into v_author from posts where id = p_post_id;
  if v_author is null then raise exception 'Post not found'; end if;
  if not can_act_as(v_author) then
    raise exception 'Insights are only visible to the author';
  end if;

  select count(distinct user_id)::int into v_reach
  from post_seen where post_id = p_post_id;

  select jsonb_build_object(
    'reach',           v_reach,
    'likes',           coalesce(p.likes_count, 0),
    'comments',        coalesce(p.comments_count, 0),
    'reposts',         coalesce(p.reposts_count, 0),
    'bookmarks',       coalesce(p.bookmarks_count, 0),
    'engagements',     coalesce(p.likes_count,0) + coalesce(p.comments_count,0)
                       + coalesce(p.reposts_count,0) + coalesce(p.bookmarks_count,0),
    'engagement_rate', case when v_reach > 0 then
                         round(((coalesce(p.likes_count,0) + coalesce(p.comments_count,0)
                               + coalesce(p.reposts_count,0) + coalesce(p.bookmarks_count,0))::numeric
                               / v_reach) * 100, 1)
                       else null end,
    'posted_at',       p.created_at,
    'video',           case when exists (
                              select 1 from post_media m
                              where m.post_id = p_post_id and m.media_type = 'video')
                         then (
                           select jsonb_build_object(
                             'unique_viewers', count(distinct coalesce(viewer_id::text, 'session:' || session_id))
                                                 filter (where duration_sec >= 3),
                             'total_plays',    count(*),
                             'avg_seconds',    round(coalesce(avg(duration_sec) filter (where duration_sec >= 3), 0)::numeric, 1)
                           ) from post_video_views where post_id = p_post_id)
                         else null end,
    'recent_likers',   coalesce((
                         select jsonb_agg(jsonb_build_object(
                                  'id', pr.id, 'full_name', pr.full_name,
                                  'username', pr.username, 'avatar_url', pr.avatar_url)
                                order by pl.created_at desc)
                         from post_likes pl
                         join profiles pr on pr.id = pl.user_id
                         where pl.post_id = p_post_id
                         limit 12), '[]'::jsonb)
  ) into v_result
  from posts p where p.id = p_post_id;

  return v_result;
end;
$fn$;

grant execute on function public.get_post_insights(uuid) to authenticated;