-- 0017_profile_reach.sql
-- Adds total reach to get_profile, for the owner only.
--
-- Reach here means distinct people who have had any of your posts in their
-- viewport, taken from post_seen. It is the number the profile's fourth stat
-- pill shows, and it is only returned to the profile's owner because it is
-- performance data, not a public vanity metric.
--
-- Return type is unchanged (jsonb), so no drop is needed.

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
    from post_seen s
    join posts p on p.id = s.post_id
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
      'reach',     v_reach
    ),
    'business', case when coalesce(v_row.account_type, 'personal') = 'business' then (
      select jsonb_build_object(
        'category', b.category, 'address', b.address, 'phone', b.phone,
        'email', b.email, 'website', b.website, 'social_links', b.social_links,
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

grant execute on function public.get_profile(uuid) to authenticated;