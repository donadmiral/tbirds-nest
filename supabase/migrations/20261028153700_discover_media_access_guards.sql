-- RLS deliberately hides the other person's block row. Read surfaces must use
-- the existing definer visibility predicate instead of inferring no block from
-- an empty SELECT on blocked_users. Keep ranking, pagination and grants intact.
create or replace function public.feed_media_access_allowed(p_post_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and not coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
    and exists (
      select 1 from public.posts p join public.profiles author on author.id=p.user_id
      where p.id=p_post_id
        and author.deactivated_at is null
        and public.can_view_post(p.id)
        and (p.archived_at is null or p.user_id=auth.uid())
        and (p.community_id is null or p.user_id=auth.uid() or public.community_is_member(p.community_id))
        and (not coalesce(p.is_exclusive,false) or public.can_act_as(p.user_id)
          or public.creator_has_active_subscription(p.user_id,auth.uid()))
        and (p.user_id=auth.uid() or coalesce(p.audience,'everyone')='everyone'
          or (p.audience='followers' and exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=p.user_id))
          or (p.audience='mentioned' and exists(select 1 from public.post_mentions pm where pm.post_id=p.id and pm.mentioned_user_id=auth.uid()))
          or (p.audience='verified' and exists(select 1 from public.profiles v where v.id=auth.uid() and v.is_verified)))
    );
$$;
revoke all on function public.feed_media_access_allowed(uuid) from public,anon;
grant execute on function public.feed_media_access_allowed(uuid) to authenticated;

create or replace function public.feed_media_json(p_post_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
 select coalesce((select jsonb_agg(jsonb_build_object(
   'id',m.id,'url',m.url,'media_type',m.media_type,'width',m.width,'height',m.height,
   'sort_order',m.sort_order,'is_sensitive',m.is_sensitive,'alt_text',m.alt_text,'edit',m.edit
 ) order by m.sort_order nulls last,m.id)
 from public.post_media m where m.post_id=p_post_id and public.feed_media_access_allowed(p_post_id)),'[]'::jsonb);
$$;
revoke all on function public.feed_media_json(uuid) from public,anon;
grant execute on function public.feed_media_json(uuid) to authenticated;

do $guard$
declare body text; anchor text := 'where p.community_id is null and p.created_at <= p_as_of';
begin
  body := pg_get_functiondef('public.get_discover_page(text,boolean,integer,integer,timestamptz)'::regprocedure);
  if position('public.feed_media_access_allowed(p.id)' in body)=0 then
    if position(anchor in body)=0 then raise exception 'Unknown Discover candidate query; review before changing visibility'; end if;
    execute replace(body,anchor,anchor||' and public.feed_media_access_allowed(p.id)');
  end if;
end;
$guard$;
