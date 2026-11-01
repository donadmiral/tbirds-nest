-- Forward repair of the metadata-only cutover report. regexp_match returns a
-- NULL result for external URLs. Such URLs are not missing Storage objects.
-- Existing Storage references, grants, policies and asset data remain intact.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
do $readiness_guard$
declare fn regprocedure := to_regprocedure('public.private_media_cutover_readiness()');
begin
 if fn is null then raise exception 'PRIVATE_MEDIA_READINESS_PREREQUISITE';end if;
 if not exists(select 1 from pg_proc where oid=fn and prosecdef and provolatile='s'
   and md5(prosrc) in ('d0ece2842505adddcdd7edbf95d4fdf0','6830911bf6c431dab59988eab8e55b43')) then
  raise exception 'PRIVATE_MEDIA_READINESS_DEFINITION_DRIFT';
 end if;
 if has_function_privilege('anon',fn,'EXECUTE') or has_function_privilege('authenticated',fn,'EXECUTE')
  or not has_function_privilege('service_role',fn,'EXECUTE') then
  raise exception 'PRIVATE_MEDIA_READINESS_ACL_DRIFT';
 end if;
end $readiness_guard$;

create or replace function public.private_media_cutover_readiness() returns jsonb
language sql stable security definer set search_path='' as $$
 with entities as (
  select 'post'::text kind,id,user_id author from public.posts
  union all select 'story',id,user_id from public.stories
  union all select 'story_draft',id,user_id from public.story_drafts
 ), refs as (
  select distinct e.*,u.value url,loc[1] bucket,loc[2] path
  from entities e cross join lateral public.content_media_strings(public.content_media_document(e.kind,e.id)) u(value)
  cross join lateral regexp_match(u.value,'^https://[^/]+/storage/v1/object/public/(post-media|story-media|media)/([^?#]+)') loc
  where loc is not null
 ), checked as (
  select r.*,o.id object_id,
   exists(select 1 from public.content_media_bindings b where b.entity_kind=r.kind and b.entity_id=r.id
    and b.bucket_id=r.bucket and b.object_path=r.path and b.uploader_id::text=coalesce(o.owner_id,o.owner::text)) bound,
   exists(select 1 from content_media_legacy.snapshots l where l.entity_kind=r.kind and l.entity_id=r.id
    and l.author_id=r.author and l.object_id=o.id and l.bucket_id=r.bucket and l.object_path=r.path
    and l.object_version=o.version and l.canonical_url=r.url and l.revoked_at is null
    and (coalesce(o.owner_id,o.owner::text) is null or coalesce(o.owner_id,o.owner::text)=r.author::text)) legacy
  from refs r left join storage.objects o on o.bucket_id=r.bucket and o.name=r.path
 ), chat_refs as (
  select distinct public.chat_object_path(u.url) loc,m.view_limit is not null limited from public.messages m
   cross join lateral(values(m.media_url),(m.thumbnail_url)) u(url) where m.deleted_at is null and public.chat_object_path(u.url) is not null
  union all select public.chat_object_path(media_url),false from public.channel_messages where public.chat_object_path(media_url) is not null
  union all select public.chat_object_path(group_avatar_url),false from public.conversations where public.chat_object_path(group_avatar_url) is not null
  union all select public.chat_object_path(cv_url),false from public.job_applications where public.chat_object_path(cv_url) is not null
 ) select jsonb_build_object(
  'buckets',(select jsonb_agg(jsonb_build_object('id',id,'public',public) order by id) from storage.buckets
    where id in ('post-media','story-media','media','chat-media','chat-files')),
  'contentReferences',(select count(*) from checked),
  'missingObjects',(select count(*) from checked where object_id is null),
  'unboundReferences',(select count(*) from checked where object_id is not null and not bound and not legacy),
  'reviewedLegacyReferences',(select count(*) from checked where legacy),
  'missingChatObjects',(select count(distinct r.loc) from chat_refs r where not exists(select 1 from storage.objects o where o.bucket_id||'/'||o.name=r.loc)),
  'limitedObjectsWithOrdinaryReferences',(select count(distinct r.loc) from chat_refs r where not r.limited and not public.chat_locator_unrestricted(r.loc)),
  'legacyRequiresPublicBucket',position('AND b.public' in pg_get_functiondef('content_media_legacy.allows_read(text,uuid,uuid,text,text,text)'::regprocedure))>0,
  'restrictedPolicyCount',(select count(*) from pg_policy where polrelid='storage.objects'::regclass and not polpermissive and polname in (
   'chat_private_anon_guard','chat_private_read_guard','chat_private_insert_guard','chat_private_immutable_guard','chat_private_delete_guard',
   'private_content_anon_guard','private_content_read_guard','private_content_insert_guard','private_content_immutable_guard','private_content_delete_guard')),
  'chatObjectCount',(select count(*) from storage.objects where bucket_id in ('chat-media','chat-files'))
 );
$$;
-- CREATE OR REPLACE preserves the existing service-only ACL and owner.
notify pgrst, 'reload schema';
commit;
