-- One caller-bound snapshot of the retained records listed in schema version 2.
-- STABLE gives every read the calling statement's MVCC snapshot. No timestamp
-- predicate is used: legacy NULL dates and concurrently edited dates cannot omit rows.
-- The private definer can read retained own rows hidden by feed/chat RLS and exact
-- auth account metadata. It has no identity argument and never exports raw tokens.
begin;
create schema if not exists account_export;
revoke all on schema account_export from public, anon;
grant usage on schema account_export to authenticated;

create or replace function account_export.snapshot()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_time timestamptz := statement_timestamp();
  v_count bigint;
  v_account jsonb;
  v_profile jsonb;
  v_collections jsonb;
  v_counts jsonb;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at)
    into v_account from auth.users u where u.id = v_uid;
  if v_account is null then raise exception 'ACCOUNT_NOT_FOUND' using errcode = '28000'; end if;

  -- Refuse excessive collection sizes before constructing their JSON payloads.
  -- The small account/profile metadata objects are not collection rows.
  select sum(n) into v_count from (
    select count(*) as n from (select 1 from public.posts r where r.user_id = v_uid limit 50001) capped
    union all
    select count(*) as n from (select 1 from public.post_media r where exists (select 1 from public.posts owner_post where owner_post.id = r.post_id and owner_post.user_id = v_uid) limit 50001) capped
    union all
    select count(*) as n from (select 1 from public.post_comments r where r.user_id = v_uid limit 50001) capped
    union all
    select count(*) as n from (select 1 from public.post_likes r where r.user_id = v_uid limit 50001) capped
    union all
    select count(*) as n from (select 1 from public.post_bookmarks r where r.user_id = v_uid limit 50001) capped
    union all
    select count(*) as n from (select 1 from public.post_reposts r where r.user_id = v_uid limit 50001) capped
    union all
    select count(*) as n from (select 1 from public.follows r where r.follower_id = v_uid limit 50001) capped
    union all
    select count(*) as n from (select 1 from public.follows r where r.following_id = v_uid limit 50001) capped
    union all
    select count(*) as n from (select 1 from public.stories r where r.user_id = v_uid limit 50001) capped
    union all
    select count(*) as n from (select 1 from public.story_views r where r.user_id = v_uid limit 50001) capped
    union all
    select count(*) as n from (select 1 from public.messages r where r.sender_id = v_uid limit 50001) capped
    union all
    select count(*) as n from (select 1 from public.marketplace_listings r where r.seller_id = v_uid limit 50001) capped
    union all
    select count(*) as n from (select 1 from public.job_applications r where r.applicant_id = v_uid limit 50001) capped
    union all
    select count(*) as n from (select 1 from public.support_tickets r where r.user_id = v_uid limit 50001) capped
    union all
    select count(*) as n from (select 1 from public.blocked_users r where r.blocker_id = v_uid limit 50001) capped
    union all
    select count(*) as n from (select 1 from public.user_push_tokens r where r.user_id = v_uid limit 50001) capped
  ) collection_sizes;
  if v_count > 50000 then raise exception 'EXPORT_TOO_LARGE' using errcode = '54000'; end if;

  select to_jsonb(p) into v_profile from (
    select id, email, full_name, username, avatar_url, banner_url, bio,
      headline, location, interests, account_type, profile_visibility,
      degree_program, graduation_year, institution, workplace, school,
      created_at, updated_at
    from public.profiles where id = v_uid
  ) p;

  select jsonb_object_agg(collection, items) into v_collections from (
    select 'posts' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb) as items
    from (select r.id, r.user_id, r.body, r.content, r.image_url, r.media_url, r.created_at, r.updated_at, r.scope, r.account_type, r.channel, r.quoted_post_id, r.thread_parent_id, r.article_title, r.read_minutes
      from public.posts r where r.user_id = v_uid) item
    union all
    select 'post_media' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb) as items
    from (select r.id, r.post_id, r.url, r.media_type, r.sort_order, r.created_at, r.width, r.height, r.alt_text, r.is_sensitive
      from public.post_media r where exists (select 1 from public.posts owner_post where owner_post.id = r.post_id and owner_post.user_id = v_uid)) item
    union all
    select 'comments' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb) as items
    from (select r.id, r.post_id, r.user_id, r.body, r.content, r.parent_comment_id, r.created_at
      from public.post_comments r where r.user_id = v_uid) item
    union all
    select 'likes' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb) as items
    from (select r.id, r.post_id, r.created_at
      from public.post_likes r where r.user_id = v_uid) item
    union all
    select 'saved' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb) as items
    from (select r.id, r.post_id, r.created_at, r.collection_id
      from public.post_bookmarks r where r.user_id = v_uid) item
    union all
    select 'reposts' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb) as items
    from (select r.id, r.post_id, r.created_at
      from public.post_reposts r where r.user_id = v_uid) item
    union all
    select 'following' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb) as items
    from (select r.id, r.following_id, r.created_at
      from public.follows r where r.follower_id = v_uid) item
    union all
    select 'followers' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb) as items
    from (select r.id, r.follower_id, r.created_at
      from public.follows r where r.following_id = v_uid) item
    union all
    select 'stories' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb) as items
    from (select r.id, r.user_id, r.media_url, r.media_type, r.thumbnail_url, r.duration_sec, r.caption, r.expires_at, r.created_at, r.stickers_json, r.text_background, r.media_transform, r.category, r.dual_front_url, r.dual_layout, r.allow_replies, r.allow_reactions, r.allow_sharing, r.audience, r.reach
      from public.stories r where r.user_id = v_uid) item
    union all
    select 'story_views_given' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.story_id), '[]'::jsonb) as items
    from (select r.story_id, r.viewed_at
      from public.story_views r where r.user_id = v_uid) item
    union all
    select 'messages_sent' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb) as items
    from (select r.id, r.conversation_id, r.text, r.media_url, r.created_at
      from public.messages r where r.sender_id = v_uid) item
    union all
    select 'listings' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb) as items
    from (select r.id, r.seller_id, r.title, r.description, r.price, r.currency, r.category, r.condition, r.location_city, r.images, r.status, r.created_at, r.updated_at, r.delivery_available, r.delivery_fee, r.delivery_note
      from public.marketplace_listings r where r.seller_id = v_uid) item
    union all
    select 'job_applications' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb) as items
    from (select r.id, r.job_id, r.applicant_id, r.status, r.cover_note, r.cover_letter, r.applied_at, r.updated_at, r.interview_at, r.interview_location
      from public.job_applications r where r.applicant_id = v_uid) item
    union all
    select 'support_tickets' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb) as items
    from (select r.id, r.user_id, r.subject, r.message, r.body, r.kind, r.status, r.created_at, r.updated_at, r.resolution_note, r.resolved_at
      from public.support_tickets r where r.user_id = v_uid) item
    union all
    select 'blocked' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.blocked_id), '[]'::jsonb) as items
    from (select r.blocked_id, r.created_at
      from public.blocked_users r where r.blocker_id = v_uid) item
    union all
    select 'push_devices' as collection, coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb) as items
    from (select r.id, r.device_name, r.platform, r.created_at
      from public.user_push_tokens r where r.user_id = v_uid) item
  ) collections;
  select jsonb_object_agg(key, jsonb_array_length(value)) into v_counts
    from jsonb_each(v_collections);
  v_result := v_collections || jsonb_build_object(
    'schema_version', 2, 'export_status', 'complete',
    'exported_at', v_time, 'records_through', v_time,
    'account', v_account, 'profile', v_profile,
    'collection_counts', v_counts
  );
  if octet_length(convert_to(v_result::text, 'UTF8')) > 16777216 then
    raise exception 'EXPORT_TOO_LARGE' using errcode = '54000';
  end if;
  return v_result;
end;
$function$;
revoke all on function account_export.snapshot() from public, anon, service_role;
grant execute on function account_export.snapshot() to authenticated;

create or replace function public.account_export_snapshot()
returns jsonb
language sql stable security invoker
set search_path = ''
as $function$
  select account_export.snapshot();
$function$;
revoke all on function public.account_export_snapshot() from public, anon, service_role;
grant execute on function public.account_export_snapshot() to authenticated;
comment on function public.account_export_snapshot() is
  'Exports the authenticated caller only from one statement snapshot; fixed schema v2, max 50000 collection records and 16 MiB.';
notify pgrst, 'reload schema';
commit;
