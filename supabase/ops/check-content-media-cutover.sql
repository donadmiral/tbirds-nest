-- Read-only release check. Run after content_media_manifests and before making
-- post-media/story-media/media private. Each returned row needs investigation:
-- backfill must never guess ownership or expose another account's upload.
with entities as (
  select 'post'::text as kind, id from public.posts
  union all select 'story', id from public.stories
  union all select 'story_draft', id from public.story_drafts
  union all select 'sound', id from public.story_sounds
), object_refs as (
  select distinct e.kind, e.id, location[1] as bucket_id, location[2] as object_path
  from entities e
  cross join lateral public.content_media_strings(public.content_media_document(e.kind,e.id)) u(value)
  cross join lateral regexp_match(u.value, '^https://[^/]+/storage/v1/(?:object/(?:public|sign|authenticated)|render/image/(?:public|sign|authenticated))/(post-media|story-media|media)/([^?#]+)') location
  where location is not null
)
select r.kind, r.id, r.bucket_id, r.object_path,
  case when o.id is null then 'missing_storage_object'
       when b.entity_id is null then 'missing_authorized_binding'
       else 'missing_recorded_owner' end as issue
from object_refs r
left join storage.objects o on o.bucket_id=r.bucket_id and o.name=r.object_path
left join public.content_media_bindings b on b.entity_kind=r.kind and b.entity_id=r.id
  and b.bucket_id=r.bucket_id and b.object_path=r.object_path
where o.id is null or b.entity_id is null or coalesce(o.owner_id,o.owner::text) is null
order by r.kind,r.id,r.bucket_id,r.object_path;
