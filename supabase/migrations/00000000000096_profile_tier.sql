-- 0096 The profile tells its tier. get_profile re-issued from 0024 adding
-- verified_tier and verified_category to the jsonb, so the profile header can
-- render the correct metal. Return type unchanged, no drop needed.
create or replace function public.get_profile(p_profile_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path = public
as $fn$
declare
  v_me uuid := auth.uid();
  v_row profiles;
  v_follows boolean;
  v_requested boolean;
  v_reach int;
  v_result jsonb;
begin
  select * into v_row from profiles where id = p_profile_id;
  if v_row.id is null then raise exception 'Profile not found'; end if;

  v_follows := exists (select 1 from follows
                       where follower_id = v_me and following_id = p_profile_id);
  v_requested := exists (select 1 from follow_requests
                         where requester_id = v_me and target_id = p_profile_id
                           and status = 'pending');

  if v_me = p_profile_id then
    select count(distinct s.user_id) into v_reach
    from post_seen s join posts p on p.id = s.post_id
    where p.user_id = p_profile_id;
  else
    v_reach := null;
  end if;

  select jsonb_build_object(
    'id', v_row.id,
    'full_name', v_row.full_name,
    'username', v_row.username,
    'avatar_url', v_row.avatar_url,
    'banner_url', v_row.banner_url,
    'bio', v_row.bio,
    'headline', v_row.headline,
    'workplace', v_row.workplace,
    'location', v_row.location,
    'email', v_row.email,
    'role', v_row.role,
    'degree_program', v_row.degree_program,
    'profile_visibility', coalesce(v_row.profile_visibility, 'public'),
    'account_type', coalesce(v_row.account_type, 'personal'),
    'is_verified', coalesce(v_row.is_verified, false),
    'verified_tier', v_row.verified_tier,
    'verified_category', v_row.verified_category,
    'joined_at', v_row.created_at,
    'created_at', v_row.created_at,
    'is_self', (v_me = p_profile_id),
    'viewer_follows', v_follows,
    'viewer_requested', v_requested,
    'can_view_content', (v_me = p_profile_id)
                          or coalesce(v_row.profile_visibility, 'public') <> 'private'
                          or v_follows,
    'counts', jsonb_build_object(
      'posts',     (select count(*) from posts   where user_id = p_profile_id),
      'followers', (select count(*) from follows where following_id = p_profile_id),
      'following', (select count(*) from follows where follower_id = p_profile_id),
      'reach',     v_reach,
      'media',     (select count(*) from posts p2
                     where p2.user_id = p_profile_id
                       and (p2.media_url is not null
                            or exists (select 1 from post_media m where m.post_id = p2.id))),
      'reposts',   (select count(*) from post_reposts   where user_id = p_profile_id),
      'saved',     (select count(*) from post_bookmarks where user_id = p_profile_id),
      'listings',  (select count(*) from marketplace_listings
                     where seller_id = p_profile_id and status = 'available')
    ),
    'seller_rating', (select jsonb_build_object(
                        'avg', round(coalesce(avg(rating), 0)::numeric, 1),
                        'count', count(*))
                      from seller_reviews where seller_id = p_profile_id),
    'business', case when coalesce(v_row.account_type, 'personal') = 'business' then (
      select jsonb_build_object(
        'category', b.category, 'address', b.address, 'phone', b.phone,
        'email', b.email, 'website', b.website, 'social_links', b.social_links,
        'hours', b.hours,
        'avg_rating', b.avg_rating, 'review_count', b.review_count,
        'is_verified', b.is_verified)
      from business_profiles b where b.profile_id = p_profile_id
    ) else null end,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pr.id, 'full_name', pr.full_name,
               'username', pr.username, 'avatar_url', pr.avatar_url, 'role', m.role))
      from business_members m
      join profiles pr on pr.id = m.member_id
      where m.business_id = p_profile_id), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$fn$;
