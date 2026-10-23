-- Paginated social read APIs. Legacy signatures remain compatible.
-- Pages are bounded and account-scoped; snapshots exclude newly inserted rows.


CREATE OR REPLACE FUNCTION public.social_literal_query(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path TO public AS $function$
  select replace(replace(replace(value, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
$function$;
REVOKE ALL ON FUNCTION public.social_literal_query(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.social_literal_query(text) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_channels_page(p_query text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(id uuid, name text, description text, icon_url text, member_count integer, owner_id uuid, owner_name text, owner_username text, owner_avatar text, is_member boolean, my_role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.name, c.description, c.icon_url, c.member_count,
         pr.id, pr.full_name, pr.username, pr.avatar_url,
         (cm.user_id is not null), cm.role
  from channels c
  join profiles pr on pr.id = c.owner_id
  left join channel_members cm on cm.channel_id = c.id and cm.user_id = auth.uid()
  where auth.uid() is not null and c.created_at <= p_as_of and c.status = 'active'
    and (coalesce(trim(p_query),'') = '' or c.name ilike '%' || public.social_literal_query(trim(p_query)) || '%' or c.description ilike '%' || public.social_literal_query(trim(p_query)) || '%')
    and not exists (select 1 from blocked_users b
                    where (b.blocker_id = auth.uid() and b.blocked_id = c.owner_id)
                       or (b.blocker_id = c.owner_id and b.blocked_id = auth.uid()))
  order by (cm.user_id is not null) desc, c.member_count desc, c.created_at desc, c.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
$function$;

CREATE OR REPLACE FUNCTION public.get_communities_page(p_query text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(id uuid, name text, description text, icon_url text, cover_color text, category text, join_mode text, member_count integer, last_activity_at timestamp with time zone, is_member boolean, my_role text, has_pending boolean, owner_username text, has_invite boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.name, c.description, c.icon_url, c.cover_color, c.category,
         c.join_mode, c.member_count, c.last_activity_at,
         (m.user_id is not null) as is_member,
         m.role as my_role,
         exists (select 1 from community_join_requests r where r.community_id = c.id and r.user_id = auth.uid()) as has_pending,
         p.username as owner_username,
         exists(select 1 from community_invites i where i.community_id=c.id and i.user_id=auth.uid() and i.status='invited')
  from communities c
  left join profiles p on p.id = c.owner_id
  left join community_members m on m.community_id = c.id and m.user_id = auth.uid()
  where auth.uid() is not null and c.created_at <= p_as_of and c.status = 'active' and c.name is not null and c.owner_id is not null and (c.parent_id is null or exists(select 1 from community_invites i where i.community_id=c.id and i.user_id=auth.uid() and i.status='invited'))
    and (p_query is null or trim(p_query) = '' or c.name ilike '%' || public.social_literal_query(trim(p_query)) || '%' or c.description ilike '%' || public.social_literal_query(trim(p_query)) || '%')
    and not exists (select 1 from blocked_users b where (b.blocker_id = auth.uid() and b.blocked_id = c.owner_id) or (b.blocker_id = c.owner_id and b.blocked_id = auth.uid()))
  order by (m.user_id is not null) desc, c.last_activity_at desc, c.member_count desc, c.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
$function$;

CREATE OR REPLACE FUNCTION public.get_profile_posts_page(p_profile_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(post_id uuid, content text, body text, media_url text, media jsonb, products jsonb, channel text, article_title text, read_minutes integer, created_at timestamp with time zone, likes_count integer, comments_count integer, reposts_count integer, bookmarks_count integer, views_count integer, viewer_liked boolean, viewer_bookmarked boolean, viewer_reposted boolean, is_pinned boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with viewer as (select auth.uid() as uid),
allowed as (
  select ((select uid from viewer) = p_profile_id)
      or coalesce(pr.profile_visibility, 'public') <> 'private'
      or exists (select 1 from follows f
                 where f.follower_id = (select uid from viewer)
                   and f.following_id = p_profile_id) as ok
  from profiles pr where pr.id = p_profile_id
),
pin as (select pinned_post_id from profiles where id = p_profile_id)
select p.id, p.content, p.body, p.media_url,
  coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'url', m.url,
      'media_type', m.media_type, 'width', m.width, 'height', m.height,
      'alt_text', m.alt_text, 'is_sensitive', m.is_sensitive,
      'sort_order', m.sort_order) order by m.sort_order nulls last)
    from post_media m where m.post_id = p.id), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', pp.id, 'title', pp.title, 'subtitle', pp.subtitle, 'price', pp.price,
      'currency', pp.currency, 'image_url', pp.image_url, 'listing_id', pp.listing_id,
      'link_url', pp.link_url, 'cta_label', pp.cta_label, 'sort_order', pp.sort_order,
      'listing_status', ml.status)
      order by pp.sort_order)
    from post_products pp
    left join marketplace_listings ml on ml.id = pp.listing_id
    where pp.post_id = p.id), '[]'::jsonb),
  p.channel, p.article_title, p.read_minutes, p.created_at,
  p.likes_count, p.comments_count, p.reposts_count, p.bookmarks_count, p.views_count,
  (lk.user_id is not null), (bk.user_id is not null), (rp.user_id is not null),
  (p.id = (select pinned_post_id from pin))
from posts p
left join post_likes lk     on lk.post_id = p.id and lk.user_id = (select uid from viewer)
left join post_bookmarks bk on bk.post_id = p.id and bk.user_id = (select uid from viewer)
left join post_reposts rp   on rp.post_id = p.id and rp.user_id = (select uid from viewer)
where p.user_id = p_profile_id
  and p.community_id is null
  and (select ok from allowed)
  and not exists (select 1 from blocked_users b
                  where (b.blocker_id = (select uid from viewer) and b.blocked_id = p.user_id)
                     or (b.blocker_id = p.user_id and b.blocked_id = (select uid from viewer)))
  and (
    coalesce(p.audience, 'everyone') = 'everyone'
    or p.user_id = (select uid from viewer)
    or (p.audience = 'followers' and exists (
          select 1 from follows f
          where f.following_id = p.user_id and f.follower_id = (select uid from viewer)))
    or (p.audience = 'mentioned' and exists (
          select 1 from post_mentions pm
          where pm.post_id = p.id and pm.mentioned_user_id = (select uid from viewer)))
    or (p.audience = 'verified' and exists (
          select 1 from profiles vp
          where vp.id = (select uid from viewer) and vp.is_verified))
  )
  and p.created_at <= p_as_of
order by (case when p.id = (select pinned_post_id from pin) then 0 else 1 end),
         p.created_at desc, p.id desc
limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
$function$
;

CREATE OR REPLACE FUNCTION public.get_community_posts_page(p_community uuid, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(post_id uuid, author_id uuid, content text, body text, media_url text, media jsonb, products jsonb, link jsonb, channel text, article_title text, read_minutes integer, quoted_post_id uuid, thread_parent_id uuid, created_at timestamp with time zone, likes_count integer, comments_count integer, reposts_count integer, bookmarks_count integer, views_count integer, is_trending boolean, author_name text, author_username text, author_avatar text, author_verified boolean, author_kind text, author_verified_tier text, viewer_liked boolean, viewer_bookmarked boolean, viewer_reposted boolean, viewer_follows boolean, sort_key double precision, innovation_field text, innovation_stage text, has_fact_check boolean, reposted_by_id uuid, reposted_by_name text, reposted_by_username text, has_poll boolean, edited_at timestamp with time zone, category text, is_pinned boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select p.id, p.user_id, p.content, p.body, p.media_url,
  coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'url', m.url,
      'media_type', m.media_type, 'width', m.width, 'height', m.height, 'alt_text', m.alt_text, 'is_sensitive', m.is_sensitive,
      'sort_order', m.sort_order) order by m.sort_order nulls last)
    from post_media m where m.post_id = p.id), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', pp.id, 'title', pp.title, 'subtitle', pp.subtitle,
      'price', pp.price, 'currency', pp.currency, 'image_url', pp.image_url,
      'listing_id', pp.listing_id, 'link_url', pp.link_url,
      'cta_label', pp.cta_label, 'sort_order', pp.sort_order)
      order by pp.sort_order)
    from post_products pp where pp.post_id = p.id), '[]'::jsonb),
  case when lp.url is not null then jsonb_build_object(
      'url', lp.url, 'title', lp.title, 'description', lp.description,
      'image_url', lp.image_url, 'domain', lp.domain)
    else null end,
  p.channel, p.article_title, p.read_minutes, p.quoted_post_id, p.thread_parent_id,
  p.created_at, p.likes_count, p.comments_count, p.reposts_count, p.bookmarks_count,
  p.views_count, false,
  pr.full_name, pr.username, pr.avatar_url, pr.is_verified, pr.account_type, pr.verified_tier,
  (lk.user_id is not null), (bk.user_id is not null), (rp.user_id is not null), (fl.follower_id is not null),
  extract(epoch from p.created_at)::double precision,
  p.innovation_field, p.innovation_stage,
  exists (select 1 from fact_checks fc
          join fact_check_votes fv on fv.fact_check_id = fc.id
          where fc.post_id = p.id
          group by fc.id
          having count(*) filter (where fv.helpful) >= 3
             and count(*) filter (where fv.helpful) > 2 * count(*) filter (where not fv.helpful)),
  null::uuid, null::text, null::text,
  exists (select 1 from post_polls pl where pl.post_id = p.id),
  p.edited_at, p.category,
  p.is_community_pinned
from posts p
join profiles pr on pr.id = p.user_id
left join link_previews lp on lp.url = p.link_url
left join post_likes lk     on lk.post_id = p.id and lk.user_id = auth.uid()
left join post_bookmarks bk on bk.post_id = p.id and bk.user_id = auth.uid()
left join post_reposts rp   on rp.post_id = p.id and rp.user_id = auth.uid()
left join follows fl        on fl.following_id = p.user_id and fl.follower_id = auth.uid()
where auth.uid() is not null and p.community_id = p_community
  and public.community_is_member(p_community)
  and not exists (select 1 from blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=p.user_id) or (b.blocker_id=p.user_id and b.blocked_id=auth.uid()))
  and p.created_at <= p_as_of
order by (case when p.is_community_pinned then 0 else 1 end), p.created_at desc, p.id desc
limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
$function$
;

CREATE OR REPLACE FUNCTION public.get_community_announcements_page(p_community uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(id uuid, body text, created_at timestamp with time zone, author_id uuid, full_name text, username text, avatar_url text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id, a.body, a.created_at, a.author_id, p.full_name, p.username, p.avatar_url
  from community_announcements a join profiles p on p.id = a.author_id
  where a.community_id = p_community and community_is_member(p_community)
    and a.created_at <= p_as_of
  order by a.created_at desc, a.id
  limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
$function$;

CREATE OR REPLACE FUNCTION public.get_community_bans_page(p_community uuid, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(user_id uuid, full_name text, username text, avatar_url text, reason text, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select b.user_id, p.full_name, p.username, p.avatar_url, b.reason, b.created_at
  from community_bans b join profiles p on p.id = b.user_id
  where b.community_id = p_community and community_is_mod(p_community)
    and b.created_at <= p_as_of
  order by b.created_at desc, b.user_id
  limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
$function$;

CREATE OR REPLACE FUNCTION public.get_community_invites_page(p_community uuid, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(user_id uuid, full_name text, username text, avatar_url text, invited_by uuid, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select i.user_id, p.full_name, p.username, p.avatar_url, i.invited_by, i.created_at
  from community_invites i join profiles p on p.id = i.user_id
  where i.community_id = p_community and i.status = 'invited' and community_is_mod(p_community)
    and i.created_at <= p_as_of
  order by i.created_at desc, i.user_id
  limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
$function$;

CREATE OR REPLACE FUNCTION public.get_community_members_page(p_community uuid, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(user_id uuid, full_name text, username text, avatar_url text, role text, status text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.user_id, p.full_name, p.username, p.avatar_url, m.role, m.status
  from community_members m
  join profiles p on p.id = m.user_id
  where m.community_id = p_community
    and exists (select 1 from community_members me where me.community_id = p_community and me.user_id = auth.uid())
  order by case m.role when 'owner' then 0 when 'moderator' then 1 else 2 end, p.full_name nulls last, m.user_id
  limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
$function$;

CREATE OR REPLACE FUNCTION public.get_join_requests_page(p_community uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(user_id uuid, full_name text, username text, avatar_url text, message text, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.user_id, p.full_name, p.username, p.avatar_url, r.message, r.created_at
  from community_join_requests r
  join profiles p on p.id = r.user_id
  where r.community_id = p_community
    and exists (select 1 from community_members m where m.community_id = p_community and m.user_id = auth.uid() and m.role in ('owner','moderator'))
    and r.created_at <= p_as_of
  order by r.created_at asc, r.user_id
  limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
$function$;

CREATE OR REPLACE FUNCTION public.get_sub_communities_page(p_community uuid, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(id uuid, name text, description text, icon_url text, cover_color text, join_mode text, member_count integer, is_member boolean, my_role text, has_pending boolean, has_invite boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.name, c.description, c.icon_url, c.cover_color, c.join_mode, c.member_count,
         (m.user_id is not null), m.role,
         exists (select 1 from community_join_requests r where r.community_id = c.id and r.user_id = auth.uid()),
         exists (select 1 from community_invites i where i.community_id = c.id and i.user_id = auth.uid() and i.status = 'invited')
  from communities c
  left join community_members m on m.community_id = c.id and m.user_id = auth.uid()
  where c.parent_id = p_community and c.status = 'active' and community_is_member(p_community)
    and c.created_at <= p_as_of
  order by (m.user_id is not null) desc, c.last_activity_at desc nulls last, c.member_count desc, c.id
  limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
$function$;

CREATE OR REPLACE FUNCTION public.search_people_page(p_q text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(id uuid, full_name text, username text, avatar_url text, is_verified boolean, verified_tier text, rank real)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid;
  qn text;
begin
  uid := auth.uid();
  qn := lower(trim(coalesce(p_q,'')));
  if qn = '' then return; end if;
  return query
  select pr.id, pr.full_name, pr.username, pr.avatar_url, pr.is_verified, pr.verified_tier,
         ((case when lower(pr.username) = qn then 1000.0
                when lower(pr.username) like public.social_literal_query(qn) || '%' then 500.0
                when lower(coalesce(pr.full_name,'')) = qn then 400.0
                when lower(coalesce(pr.full_name,'')) like public.social_literal_query(qn) || '%' then 250.0
                else 0.0 end)
          + greatest(similarity(coalesce(pr.username,''), qn), similarity(coalesce(pr.full_name,''), qn)) * 100.0
          + ts_rank_cd(pr.search_tsv, websearch_to_tsquery('simple', p_q), 32) * 10.0
         )::real as rnk
  from profiles pr
  where pr.deactivated_at is null and pr.created_at <= p_as_of and (lower(pr.username) like public.social_literal_query(qn) || '%'
         or lower(coalesce(pr.full_name,'')) like '%' || public.social_literal_query(qn) || '%'
         or similarity(coalesce(pr.username,''), qn) > 0.3
         or similarity(coalesce(pr.full_name,''), qn) > 0.3
         or pr.search_tsv @@ websearch_to_tsquery('simple', p_q))
    and not exists (select 1 from blocked_users b
                    where (b.blocker_id = uid and b.blocked_id = pr.id)
                       or (b.blocker_id = pr.id and b.blocked_id = uid))
  order by rnk desc, pr.id
  limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
end $function$
;

CREATE OR REPLACE FUNCTION public.search_posts_page(p_q text, p_mode text DEFAULT 'top'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(post_id uuid, content text, body text, article_title text, created_at timestamp with time zone, author_id uuid, author_name text, author_username text, author_avatar text, likes_count integer, comments_count integer, media jsonb, rank real)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q tsquery;
  uid uuid;
begin
  uid := auth.uid();
  if coalesce(trim(p_q),'') = '' then return; end if;
  q := websearch_to_tsquery('simple', p_q);
  return query
  select p.id, p.content, p.body, p.article_title, p.created_at,
         pr.id, pr.full_name, pr.username, pr.avatar_url,
         p.likes_count, p.comments_count,
         coalesce((select jsonb_agg(jsonb_build_object('url', pm.url, 'media_type', pm.media_type, 'width', pm.width, 'height', pm.height) order by pm.sort_order nulls last)
                   from post_media pm where pm.post_id = p.id), '[]'::jsonb) as media,
         (ts_rank_cd(p.search_tsv, q, 32)
           * (case when position(lower(p_q) in lower(coalesce(p.content,'') || ' ' || coalesce(p.body,'') || ' ' || coalesce(p.article_title,''))) > 0 then 3.0 else 1.0 end)
           * (case when p_mode = 'top' then (1.0 + 2.0 / (1.0 + extract(epoch from (p_as_of - p.created_at)) / 604800.0)) else 1.0 end)
         )::real as rnk
  from posts p
  join profiles pr on pr.id = p.user_id
  where p.created_at <= p_as_of and pr.deactivated_at is null and p.search_tsv @@ q
    and p.community_id is null
    and not exists (select 1 from blocked_users b
                    where (b.blocker_id = uid and b.blocked_id = p.user_id)
                       or (b.blocker_id = p.user_id and b.blocked_id = uid))
    and (p.user_id = uid
         or coalesce(pr.profile_visibility, 'public') <> 'private'
         or exists (select 1 from follows f where f.follower_id = uid and f.following_id = p.user_id))
    and (coalesce(p.audience, 'everyone') = 'everyone'
         or p.user_id = uid
         or (p.audience = 'followers' and exists (select 1 from follows f where f.following_id = p.user_id and f.follower_id = uid))
         or (p.audience = 'verified' and exists (select 1 from profiles vp where vp.id = uid and vp.is_verified)))
  order by (case when p_mode = 'latest' then p.created_at end) desc nulls last,
           (case when p_mode = 'latest' then p.id end) desc nulls last,
           rnk desc, p.created_at desc, p.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
end $function$
;

CREATE OR REPLACE FUNCTION public.search_jobs_fts_page(p_q text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS SETOF jobs
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select j.* from jobs j
  where j.created_at <= p_as_of and (j.deadline is null or j.deadline > now())
    and not exists (select 1 from blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=j.posted_by) or (b.blocker_id=j.posted_by and b.blocked_id=auth.uid()))
    and j.search_tsv @@ websearch_to_tsquery('simple', p_q)
  order by (ts_rank_cd(j.search_tsv, websearch_to_tsquery('simple', p_q), 32)
    * (case when position(lower(p_q) in lower(coalesce(j.title,'') || ' ' || coalesce(j.company,''))) > 0 then 3.0 else 1.0 end)) desc,
    j.created_at desc, j.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
$function$
;

CREATE OR REPLACE FUNCTION public.search_listings_fts_page(p_q text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS SETOF marketplace_listings
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.* from marketplace_listings m
  where m.created_at <= p_as_of and m.status = 'available'
    and not exists (select 1 from blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=m.seller_id) or (b.blocker_id=m.seller_id and b.blocked_id=auth.uid())) and m.hidden_at is null
    and m.search_tsv @@ websearch_to_tsquery('simple', p_q)
  order by (ts_rank_cd(m.search_tsv, websearch_to_tsquery('simple', p_q), 32)
    * (case when position(lower(p_q) in lower(coalesce(m.title,''))) > 0 then 3.0 else 1.0 end)) desc,
    m.created_at desc, m.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
$function$
;

CREATE OR REPLACE FUNCTION public.search_media_page(p_q text, p_limit integer DEFAULT 18, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(post_id uuid, url text, media_type text, width integer, height integer, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select p.id, m.url, m.media_type, m.width, m.height, p.created_at
from post_media m
join posts p on p.id = m.post_id
where (p.content ilike '%' || public.social_literal_query(p_q) || '%'
       or p.body ilike '%' || public.social_literal_query(p_q) || '%'
       or p.article_title ilike '%' || public.social_literal_query(p_q) || '%'
       or m.alt_text ilike '%' || public.social_literal_query(p_q) || '%')
  and p.community_id is null and p.created_at <= p_as_of
  and (coalesce(p.audience, 'everyone') = 'everyone' or p.user_id = auth.uid())
  and not exists (select 1 from blocked_users b
                  where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
                     or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))
  and not exists (select 1 from profiles px
                  where px.id = p.user_id and px.profile_visibility = 'private'
                    and px.id <> auth.uid()
                    and not exists (select 1 from follows f
                                    where f.follower_id = auth.uid() and f.following_id = p.user_id))
order by p.created_at desc, p.id desc, m.id
limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
$function$
;

CREATE OR REPLACE FUNCTION public.search_articles_page(p_q text, p_limit integer DEFAULT 6, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(post_id uuid, article_title text, read_minutes integer, created_at timestamp with time zone, author_name text, author_username text, author_avatar text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select p.id, coalesce(p.article_title, left(p.content, 80)), p.read_minutes, p.created_at,
       pr.full_name, pr.username, pr.avatar_url
from posts p
join profiles pr on pr.id = p.user_id
where (p.channel = 'article' or p.article_title is not null)
  and (p.article_title ilike '%' || public.social_literal_query(p_q) || '%'
       or p.content ilike '%' || public.social_literal_query(p_q) || '%'
       or p.body ilike '%' || public.social_literal_query(p_q) || '%')
  and p.community_id is null and p.created_at <= p_as_of
  and (coalesce(p.audience, 'everyone') = 'everyone' or p.user_id = auth.uid())
  and not exists (select 1 from blocked_users b
                  where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
                     or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))
  and not exists (select 1 from profiles px
                  where px.id = p.user_id and px.profile_visibility = 'private'
                    and px.id <> auth.uid()
                    and not exists (select 1 from follows f
                                    where f.follower_id = auth.uid() and f.following_id = p.user_id))
order by p.created_at desc, p.id desc
limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
$function$
;

CREATE OR REPLACE FUNCTION public.search_places_page(p_q text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(name text, kind text, hits integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select name, kind, count(*)::int as hits from (
  select j.location as name, 'jobs' as kind from jobs j
  where j.location ilike '%' || public.social_literal_query(p_q) || '%'
  union all
  select l.location_city, 'market' from marketplace_listings l
  where l.status = 'available' and l.location_city ilike '%' || public.social_literal_query(p_q) || '%'
  union all
  select pr.location, 'people' from profiles pr
  where pr.location ilike '%' || public.social_literal_query(p_q) || '%'
) x
where name is not null and btrim(name) <> ''
group by name, kind
order by hits desc, name, kind
limit greatest(1, least(coalesce(p_limit,20),100)) offset greatest(0,coalesce(p_offset,0));
$function$
;

CREATE OR REPLACE FUNCTION public.social_can_read_channel(p_channel uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $function$
 select auth.uid() is not null and exists (
  select 1 from channels c where c.id=p_channel and c.status='active'
  and (c.audience='everyone' or c.owner_id=auth.uid() or exists(select 1 from channel_members m where m.channel_id=c.id and m.user_id=auth.uid()))
  and not exists(select 1 from blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=c.owner_id) or (b.blocker_id=c.owner_id and b.blocked_id=auth.uid()))
 );
$function$;

CREATE OR REPLACE FUNCTION public.get_channel_detail(p_channel uuid)
RETURNS TABLE(id uuid,name text,description text,icon_url text,member_count integer,is_member boolean,my_role text,replies_enabled boolean,audience text,my_notification_level text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $function$
 select c.id,c.name,c.description,c.icon_url,c.member_count,(m.user_id is not null),m.role,c.replies_enabled,c.audience,coalesce(m.notification_level,'all')
 from channels c left join channel_members m on m.channel_id=c.id and m.user_id=auth.uid()
 where auth.uid() is not null and c.id=p_channel and c.status='active'
 and not exists(select 1 from blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=c.owner_id) or (b.blocker_id=c.owner_id and b.blocked_id=auth.uid()));
$function$;

CREATE OR REPLACE FUNCTION public.get_channel_messages_page(p_channel uuid, p_limit integer DEFAULT 40, p_cursor timestamptz DEFAULT NULL, p_cursor_id uuid DEFAULT NULL)
 RETURNS TABLE(id uuid, content text, created_at timestamp with time zone, media_url text, media_type text, sender_name text, sender_avatar text, sender_role text, reactions jsonb, my_reactions text[], reply_count integer, is_prompt boolean, poll jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    m.id, m.content, m.created_at, m.media_url, m.media_type,
    p.full_name, p.avatar_url,
    coalesce(cm.role, 'member'),
    coalesce((select jsonb_object_agg(r.emoji, r.n) from (
      select emoji, count(*)::int as n from channel_message_reactions where message_id = m.id group by emoji
    ) r), '{}'::jsonb),
    coalesce((select array_agg(emoji) from channel_message_reactions where message_id = m.id and user_id = auth.uid()), '{}'),
    m.reply_count, m.is_prompt,
    (select case when pl.message_id is null then null else jsonb_build_object(
      'ends_at', pl.ends_at,
      'total', (select count(*)::int from channel_poll_votes v where v.message_id = m.id),
      'my_option', (select v.option_id from channel_poll_votes v where v.message_id = m.id and v.user_id = auth.uid()),
      'options', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', o.id, 'label', o.label,
          'votes', (select count(*)::int from channel_poll_votes v where v.option_id = o.id)
        ) order by o.position), '[]'::jsonb)
        from channel_poll_options o where o.message_id = m.id)
    ) end from channel_polls pl where pl.message_id = m.id)
  from channel_messages m
  join profiles p on p.id = m.sender_id
  left join channel_members cm on cm.channel_id = m.channel_id and cm.user_id = m.sender_id
  where m.channel_id = p_channel
    and public.social_can_read_channel(p_channel)
    and (p_cursor is null or (m.created_at,m.id)<(p_cursor,coalesce(p_cursor_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by m.created_at desc, m.id desc
  limit greatest(1,least(coalesce(p_limit, 40), 100));
$function$
;

CREATE OR REPLACE FUNCTION public.get_channel_replies(p_message uuid, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 40)
 RETURNS TABLE(id uuid, content text, created_at timestamp with time zone, user_id uuid, user_name text, user_avatar text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.id, r.content, r.created_at, pr.id, pr.full_name, pr.avatar_url
  from channel_replies r join profiles pr on pr.id = r.user_id
  where r.message_id = p_message and exists(select 1 from channel_messages m where m.id=p_message and public.social_can_read_channel(m.channel_id)) and (p_cursor is null or r.created_at > p_cursor)
  order by r.created_at asc, r.id asc
  limit greatest(1,least(coalesce(p_limit, 40), 80));
$function$
;

CREATE OR REPLACE FUNCTION public.get_channel_replies_page(p_message uuid, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 40, p_cursor_id uuid DEFAULT NULL)
 RETURNS TABLE(id uuid, content text, created_at timestamp with time zone, user_id uuid, user_name text, user_avatar text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.id, r.content, r.created_at, pr.id, pr.full_name, pr.avatar_url
  from channel_replies r join profiles pr on pr.id = r.user_id
  where r.message_id = p_message and exists(select 1 from channel_messages m where m.id=p_message and public.social_can_read_channel(m.channel_id)) and (p_cursor is null or (r.created_at,r.id)>(p_cursor,coalesce(p_cursor_id,'00000000-0000-0000-0000-000000000000'::uuid)))
  order by r.created_at asc, r.id asc
  limit greatest(1,least(coalesce(p_limit, 40), 80));
$function$
;

CREATE OR REPLACE FUNCTION public.get_notifications_page(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(notification_id uuid, type text, message text, body_preview text, data jsonb, read_at timestamp with time zone, created_at timestamp with time zone, actor_id uuid, actor_name text, actor_username text, actor_avatar text, others_count integer, other_avatars text[], post_id uuid, post_thumb text, post_text text, viewer_follows boolean, unread_in_group integer, group_key text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with mine as (
  select n.id, n.type, n.message, n.body_preview, n.data, n.read_at, n.created_at,
         n.actor_id,
         case when n.data->>'post_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (n.data->>'post_id')::uuid else null end as pid
  from notifications n
  where n.recipient_id = auth.uid()
    and n.type not in ('message', 'incoming_call', 'missed_call',
                       'connection_request', 'connection_accepted')
    and n.created_at <= p_as_of
),
keyed as (
  select m.*,
    case
      -- engagement on one post
      when m.type in ('like', 'repost', 'comment_like') and m.pid is not null
        then m.type || ':' || m.pid::text || ':' || (m.created_at at time zone 'UTC')::date::text
      -- people doing the same thing to you
      when m.type = 'follow'
        then m.type || ':' || (m.created_at at time zone 'UTC')::date::text
      else 'x:' || m.id::text
    end as gkey
  from mine m
),
agg as (
  select gkey,
    (array_agg(id order by created_at desc, id desc))[1]           as id,
    (array_agg(type order by created_at desc, id desc))[1]         as type,
    (array_agg(message order by created_at desc, id desc))[1]      as message,
    (array_agg(body_preview order by created_at desc, id desc))[1] as body_preview,
    (array_agg(data order by created_at desc, id desc))[1]         as data,
    min(read_at)                                          as read_at,
    max(created_at)                                       as created_at,
    (array_agg(actor_id order by created_at desc, id desc))[1]     as actor_id,
    (array_agg(pid order by created_at desc, id desc))[1]          as pid,
    count(distinct actor_id)::int                         as actor_count,
    count(*) filter (where read_at is null)::int          as unread_n,
    array_agg(distinct actor_id)                          as actor_ids
  from keyed
  group by gkey
)
select
  a.id, a.type, a.message, a.body_preview, a.data, a.read_at, a.created_at,
  a.actor_id, pr.full_name, pr.username, pr.avatar_url,
  greatest(a.actor_count - 1, 0),
  coalesce((
    select array_agg(p2.avatar_url)
    from (select unnest(a.actor_ids) as aid limit 3) x
    join profiles p2 on p2.id = x.aid
    where p2.avatar_url is not null
  ), '{}'::text[]),
  a.pid,
  (select coalesce(
     (select m.url from post_media m where m.post_id = a.pid order by m.sort_order nulls last limit 1),
     (select p.media_url from posts p where p.id = a.pid))),
  (select left(coalesce(p.content, p.body, ''), 90) from posts p where p.id = a.pid),
  exists (select 1 from follows f
          where f.follower_id = auth.uid() and f.following_id = a.actor_id),
  a.unread_n, a.gkey
from agg a
left join profiles pr on pr.id = a.actor_id
order by a.created_at desc, a.id desc
limit greatest(1, least(coalesce(p_limit, 50), 100)) offset greatest(0,coalesce(p_offset,0));
$function$;

CREATE OR REPLACE FUNCTION public.get_discover_page(p_category text DEFAULT NULL, p_video boolean DEFAULT false, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(post_id uuid, author_id uuid, content text, body text, media_url text, media jsonb, products jsonb, link jsonb, channel text, article_title text, read_minutes integer, quoted_post_id uuid, thread_parent_id uuid, created_at timestamp with time zone, likes_count integer, comments_count integer, reposts_count integer, bookmarks_count integer, views_count integer, is_trending boolean, author_name text, author_username text, author_avatar text, author_verified boolean, author_kind text, author_verified_tier text, viewer_liked boolean, viewer_bookmarked boolean, viewer_reposted boolean, viewer_follows boolean, sort_key double precision, innovation_field text, innovation_stage text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with viewer as (select auth.uid() as uid),
recent_velocity as (
  select coalesce(percentile_cont(0.9) within group (
           order by (coalesce(likes_count,0) + coalesce(comments_count,0) + coalesce(reposts_count,0))
                    / greatest(extract(epoch from (p_as_of - created_at)) / 3600.0, 1.0)
         ), 0) as cutoff
  from posts where created_at > p_as_of - interval '72 hours'
),
affinity as (
  select p.user_id as author_id, count(*)::int as n
  from post_likes pl join posts p on p.id = pl.post_id
  where pl.user_id = (select uid from viewer)
    and pl.created_at > p_as_of - interval '30 days'
  group by p.user_id
),
candidates as (
  select p.id, p.user_id, p.content, p.body, p.media_url, p.link_url, p.channel,
         p.article_title, p.read_minutes, p.innovation_field, p.innovation_stage, p.quoted_post_id, p.thread_parent_id,
         p.created_at, p.likes_count, p.comments_count, p.reposts_count,
         p.bookmarks_count, p.views_count
  from posts p
  where p.community_id is null and p.created_at <= p_as_of
    and (p_category is null or p.category=p_category)
    and (not p_video or exists(select 1 from post_media vm where vm.post_id=p.id and vm.media_type='video'))
    and ('for_you' <> 'innovation' or p.channel = 'innovation')
    and ('for_you' <> 'for_you'    or p.created_at > p_as_of - interval '365 days')
    and ('for_you' <> 'trending'   or p.created_at > p_as_of - interval '7 days')
    and ('for_you' <> 'trending' or (coalesce(p.likes_count,0) + coalesce(p.comments_count,0) + coalesce(p.reposts_count,0)) >= 3)
    and ('for_you' <> 'trending' or p.id in (select ref_id from trending_snapshot where kind = 'post'))
    and ('for_you' <> 'for_you'
      or not exists (select 1 from post_products pp2
                     where pp2.post_id = p.id and pp2.listing_id is not null)
      or exists (select 1 from post_products pp3
                 join marketplace_listings ml3 on ml3.id = pp3.listing_id
                 where pp3.post_id = p.id and ml3.status = 'available')
      or exists (select 1 from post_media pm2 where pm2.post_id = p.id))
    and not exists (select 1 from muted_authors ma where ma.user_id=(select uid from viewer) and ma.author_id=p.user_id)
    and not exists (select 1 from hidden_posts h
                    where h.post_id = p.id and h.user_id = (select uid from viewer))
    and not exists (select 1 from blocked_users b
                    where (b.blocker_id = (select uid from viewer) and b.blocked_id = p.user_id)
                       or (b.blocker_id = p.user_id and b.blocked_id = (select uid from viewer)))
    and not exists (select 1 from profiles px
                    where px.id = p.user_id
                      and px.profile_visibility = 'private'
                      and px.id <> (select uid from viewer)
                      and not exists (select 1 from follows f2
                                      where f2.follower_id = (select uid from viewer)
                                        and f2.following_id = p.user_id))
    and (
      coalesce(p.audience, 'everyone') = 'everyone'
      or p.user_id = (select uid from viewer)
      or (p.audience = 'followers' and exists (
            select 1 from follows f
            where f.following_id = p.user_id and f.follower_id = (select uid from viewer)))
      or (p.audience = 'mentioned' and exists (
            select 1 from post_mentions pm
            where pm.post_id = p.id and pm.mentioned_user_id = (select uid from viewer)))
      or (p.audience = 'verified' and exists (
            select 1 from profiles vp
            where vp.id = (select uid from viewer) and vp.is_verified))
    )
),
enriched as (
  select c.*, pr.full_name, pr.username, pr.avatar_url, pr.is_verified, pr.account_type, pr.verified_tier,
    (fl.follower_id is not null) as follows,
    (lk.user_id is not null) as liked,
    (bk.user_id is not null) as bookmarked,
    (rp.user_id is not null) as reposted,
    (sn.post_id is not null) as seen,
    coalesce(af.n, 0) as affinity_n,
    (coalesce(c.likes_count,0) + coalesce(c.comments_count,0) + coalesce(c.reposts_count,0)) as engagements,
    (coalesce(c.likes_count,0) + coalesce(c.comments_count,0) + coalesce(c.reposts_count,0))
      / greatest(extract(epoch from (p_as_of - c.created_at)) / 3600.0, 1.0) as velocity
  from candidates c
  join profiles pr on pr.id = c.user_id
  left join follows fl        on fl.following_id = c.user_id and fl.follower_id = (select uid from viewer)
  left join post_likes lk     on lk.post_id = c.id and lk.user_id = (select uid from viewer)
  left join post_bookmarks bk on bk.post_id = c.id and bk.user_id = (select uid from viewer)
  left join post_reposts rp   on rp.post_id = c.id and rp.user_id = (select uid from viewer)
  left join post_seen sn      on sn.post_id = c.id and sn.user_id = (select uid from viewer)
  left join affinity af       on af.author_id = c.user_id
),
base as (
  select e.*,
    (exists (select 1 from trending_snapshot ts
             where ts.kind = 'post' and ts.ref_id = e.id)) as trending,
    case
      when 'for_you' in ('for_you', 'innovation') then
        ( (coalesce(e.likes_count,0) * 1.0)
        + (coalesce(e.comments_count,0) * 2.5)
        + (coalesce(e.reposts_count,0) * 2.0) + 1.0 )
        / power((extract(epoch from (p_as_of - e.created_at)) / 3600.0) + 2.0, 1.5)
        * (case when e.follows then 3.0 else 1.0 end)
        * (1.0 + least(e.affinity_n, 5) * 0.15)
        * (case when e.seen then 0.15 else 1.0 end)
      when 'for_you' = 'trending' then
        10000.0 - coalesce((select ts.rank from trending_snapshot ts
                    where ts.kind = 'post' and ts.ref_id = e.id), 9999)
      else extract(epoch from e.created_at)
    end as raw_score
  from enriched e
),
diversified as (
  select b.*,
    case when 'for_you' in ('for_you', 'trending', 'innovation')
      then b.raw_score * power(0.55::double precision,
             (row_number() over (partition by b.user_id order by b.raw_score desc) - 1))
      else b.raw_score
    end as sort_key
  from base b
)
select d.id, d.user_id, d.content, d.body, d.media_url,
  coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'url', m.url,
      'media_type', m.media_type, 'width', m.width, 'height', m.height,
      'sort_order', m.sort_order) order by m.sort_order nulls last)
    from post_media m where m.post_id = d.id), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', pp.id, 'title', pp.title, 'subtitle', pp.subtitle,
      'price', pp.price, 'currency', pp.currency, 'image_url', pp.image_url,
      'listing_id', pp.listing_id, 'link_url', pp.link_url,
      'cta_label', pp.cta_label, 'sort_order', pp.sort_order,
      'listing_status', ml.status)
      order by pp.sort_order)
    from post_products pp
    left join marketplace_listings ml on ml.id = pp.listing_id
    where pp.post_id = d.id
      and (ml.id is null or ml.status = 'available' or d.user_id = (select uid from viewer))), '[]'::jsonb),
  case when lp.url is not null then jsonb_build_object(
      'url', lp.url, 'title', lp.title, 'description', lp.description,
      'image_url', lp.image_url, 'domain', lp.domain)
    else null end,
  d.channel, d.article_title, d.read_minutes, d.quoted_post_id, d.thread_parent_id,
  d.created_at, d.likes_count, d.comments_count, d.reposts_count, d.bookmarks_count,
  d.views_count, d.trending,
  d.full_name, d.username, d.avatar_url, d.is_verified, d.account_type, d.verified_tier,
  d.liked, d.bookmarked, d.reposted, d.follows, d.sort_key,
  d.innovation_field, d.innovation_stage
from diversified d
left join link_previews lp on lp.url = d.link_url
order by d.sort_key desc, d.id desc
limit greatest(1,least(coalesce(p_limit,20),60)) offset greatest(0,coalesce(p_offset,0));
$function$
;

CREATE OR REPLACE FUNCTION public.get_trending_creators(p_limit integer DEFAULT 10)
RETURNS TABLE(id uuid,full_name text,username text,avatar_url text,headline text,connections_count integer,is_verified boolean,verified_tier text,recent_followers bigint)
LANGUAGE sql STABLE SET search_path TO public AS $function$
 with momentum as (select f.following_id,count(distinct f.follower_id) as n from follows f where f.created_at>now()-interval '7 days' and f.following_id<>f.follower_id group by f.following_id)
 select p.id,p.full_name,p.username,p.avatar_url,p.headline,p.connections_count,p.is_verified,p.verified_tier,m.n
 from momentum m join profiles p on p.id=m.following_id
 where p.deactivated_at is null and p.id<>auth.uid()
 and coalesce(p.profile_visibility,'public')<>'private'
 and not exists(select 1 from blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=auth.uid()))
 order by m.n desc,p.id limit greatest(1,least(coalesce(p_limit,10),40));
$function$;

REVOKE ALL ON FUNCTION public.get_channels_page(text,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_channels_page(text,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.get_communities_page(text,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_communities_page(text,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.get_profile_posts_page(uuid,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_posts_page(uuid,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.get_community_posts_page(uuid,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_community_posts_page(uuid,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.get_community_announcements_page(uuid,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_community_announcements_page(uuid,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.get_community_bans_page(uuid,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_community_bans_page(uuid,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.get_community_invites_page(uuid,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_community_invites_page(uuid,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.get_community_members_page(uuid,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_community_members_page(uuid,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.get_join_requests_page(uuid,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_join_requests_page(uuid,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.get_sub_communities_page(uuid,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sub_communities_page(uuid,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.search_people_page(text,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_people_page(text,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.search_posts_page(text,text,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_posts_page(text,text,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.search_jobs_fts_page(text,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_jobs_fts_page(text,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.search_listings_fts_page(text,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_listings_fts_page(text,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.search_media_page(text,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_media_page(text,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.search_articles_page(text,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_articles_page(text,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.search_places_page(text,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_places_page(text,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.social_can_read_channel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_can_read_channel(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_channel_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_channel_detail(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_channel_messages_page(uuid,integer,timestamptz,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_channel_messages_page(uuid,integer,timestamptz,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_channel_replies(uuid,timestamptz,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_channel_replies(uuid,timestamptz,integer) TO authenticated;

REVOKE ALL ON FUNCTION public.get_channel_replies_page(uuid,timestamptz,integer,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_channel_replies_page(uuid,timestamptz,integer,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_notifications_page(integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_notifications_page(integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.get_discover_page(text,boolean,integer,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_discover_page(text,boolean,integer,integer,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.get_trending_creators(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trending_creators(integer) TO authenticated;

CREATE INDEX IF NOT EXISTS channel_messages_history_idx ON public.channel_messages(channel_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS channel_replies_history_idx ON public.channel_replies(message_id,created_at,id);
CREATE INDEX IF NOT EXISTS notifications_history_idx ON public.notifications(recipient_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS follows_recent_creators_idx ON public.follows(created_at DESC,following_id,follower_id);


-- New broadcast attachments are private, separate from direct-message attachments.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('channel-media','channel-media',false,104857600,ARRAY['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.social_channel_media_access(p_name text,p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public AS $function$
DECLARE channel uuid; uploader uuid;
BEGIN
 IF auth.uid() IS NULL THEN RETURN false; END IF;
 BEGIN channel:=split_part(p_name,'/',1)::uuid; uploader:=split_part(p_name,'/',2)::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
 IF NOT public.social_can_read_channel(channel) THEN RETURN false; END IF;
 IF NOT p_write THEN RETURN true; END IF;
 RETURN uploader=auth.uid() AND EXISTS(SELECT 1 FROM channel_members m WHERE m.channel_id=channel AND m.user_id=auth.uid() AND m.role IN ('owner','collaborator'));
END;
$function$;
REVOKE ALL ON FUNCTION public.social_channel_media_access(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.social_channel_media_access(text,boolean) TO authenticated;
CREATE POLICY "channel_media_authorized_read" ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='channel-media' AND public.social_channel_media_access(name,false));
CREATE POLICY "channel_media_authorized_upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='channel-media' AND public.social_channel_media_access(name,true));
CREATE POLICY "channel_media_authorized_delete" ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='channel-media' AND public.social_channel_media_access(name,true));

CREATE OR REPLACE FUNCTION public.get_channel_members_page(p_channel uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_as_of timestamptz DEFAULT now())
 RETURNS TABLE(user_id uuid, full_name text, username text, avatar_url text, role text, notification_level text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.user_id, p.full_name, p.username, p.avatar_url, m.role, m.notification_level
  from channel_members m
  join profiles p on p.id = m.user_id
  where m.channel_id = p_channel
    and exists (select 1 from channel_members me where me.channel_id = p_channel and me.user_id = auth.uid())
  order by case m.role when 'owner' then 0 when 'collaborator' then 1 when 'moderator' then 2 else 3 end,
           p.full_name nulls last, m.user_id
  limit greatest(1,least(coalesce(p_limit,20),100)) offset greatest(0,coalesce(p_offset,0));
$function$
;
REVOKE ALL ON FUNCTION public.get_channel_members_page(uuid,integer,integer,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_channel_members_page(uuid,integer,integer,timestamptz) TO authenticated;

-- Realtime uses table SELECT policies, unlike the definer read RPCs. Publish only
-- rows that the same caller could read through the channel API.
ALTER TABLE public.channel_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_replies ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.channel_messages, public.channel_replies TO authenticated;
CREATE POLICY channel_messages_authorized_read ON public.channel_messages FOR SELECT TO authenticated
USING (public.social_can_read_channel(channel_id));
CREATE POLICY channel_replies_authorized_read ON public.channel_replies FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.channel_messages m WHERE m.id=message_id AND public.social_can_read_channel(m.channel_id)));
DO $publication$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='channel_messages') THEN
     ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_messages;
   END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='channel_replies') THEN
     ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_replies;
   END IF;
 END IF;
END;
$publication$;

CREATE OR REPLACE FUNCTION public.get_channel_messages(p_channel uuid, p_limit integer DEFAULT 40)
 RETURNS TABLE(id uuid, content text, created_at timestamp with time zone, media_url text, media_type text, sender_name text, sender_avatar text, sender_role text, reactions jsonb, my_reactions text[], reply_count integer, is_prompt boolean, poll jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select * from public.get_channel_messages_page(p_channel,p_limit,null,null);
$function$
;
REVOKE ALL ON FUNCTION public.get_channel_messages(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_channel_messages(uuid,integer) TO authenticated;
