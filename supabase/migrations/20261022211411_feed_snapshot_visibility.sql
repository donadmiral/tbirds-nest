-- Reconcile saved/paginated IDs without re-ranking or treating absence from
-- the first feed page as deletion. The caller receives no post content.
create or replace function public.get_feed_visibility(p_ids uuid[])
returns table(post_id uuid, snapshot_eligible boolean)
language plpgsql stable security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_ids), 0) > 100 then
    raise exception 'At most 100 post IDs can be checked' using errcode = '22023';
  end if;
  return query
  select p.id,
    coalesce(pr.profile_visibility, 'public') = 'public'
      and coalesce(p.audience, 'everyone') = 'everyone'
      and not coalesce(p.is_exclusive, false)
      and p.community_id is null and p.archived_at is null
  from public.posts p
  join public.profiles pr on pr.id = p.user_id
  where p.id = any(coalesce(p_ids, '{}'::uuid[]))
    and public.can_view_post(p.id)
    and not exists (select 1 from public.muted_authors ma where ma.user_id = auth.uid() and ma.author_id = p.user_id)
    and not exists (select 1 from public.hidden_posts h where h.post_id = p.id and h.user_id = auth.uid())
    -- These are the access predicates used by get_feed, not its ranking or
    -- age windows. Keep older but still accessible paginated rows in place.
    and not exists (select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
         or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))
    and (coalesce(pr.profile_visibility, 'public') <> 'private'
      or p.user_id = auth.uid()
      or exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = p.user_id))
    and (coalesce(p.audience, 'everyone') = 'everyone' or p.user_id = auth.uid()
      or (p.audience = 'followers' and exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = p.user_id))
      or (p.audience = 'mentioned' and exists (select 1 from public.post_mentions m where m.post_id = p.id and m.mentioned_user_id = auth.uid()))
      or (p.audience = 'verified' and exists (select 1 from public.profiles v where v.id = auth.uid() and v.is_verified)));
end;
$$;
revoke all on function public.get_feed_visibility(uuid[]) from public, anon;
grant execute on function public.get_feed_visibility(uuid[]) to authenticated;
