-- Staff web is responsible for the current staff session, permission and assurance.
-- This service-only read recomputes the exact ordinary post/object moderation proof,
-- then restricts it to the enrolled current-version published derivative.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create function public.admin_bound_post_representation_v1(p_entity_id uuid,p_bucket text,p_path text,p_origin text,p_kind text,p_payload boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o jsonb; result jsonb;
begin
 perform media_processing.require_service();
 if p_kind is null or p_kind not in('poster','compatible') or p_bucket is distinct from 'post-media' or p_entity_id is null then return null;end if;
 o:=public.admin_bound_content_media_object('post',p_entity_id,p_bucket,p_path,p_origin);
 if o is null then return null;end if;
 select jsonb_build_object('object_id',e.source_id,'object_version',e.source_version,'lease',j.publication_lease)||
 case when p_kind='poster' then jsonb_build_object('bytes',octet_length(j.jpeg),'hash',j.jpeg_hash,
  'jpeg',case when p_payload then replace(encode(j.jpeg,'base64'),E'\n','') end)
 else jsonb_build_object('bytes',e.bytes,'path',e.path,'version',e.version,'etag',e.etag) end into result
 from media_delivery.post_poster_eligible_v1 e join media_delivery.post_poster_jobs_v1 j using(media_id,source_id,source_version,publication_lease,recipe_hash)
 join public.post_media m on m.id=e.media_id and m.edit->'generatedPosterV1'='true'::jsonb
 where e.post_id=p_entity_id and e.source_path=p_path and e.source_id::text=o->>'object_id' and e.source_version=o->>'object_version' and j.finished_at is not null;
 return result;
end $$;
revoke all on function public.admin_bound_post_representation_v1(uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.admin_bound_post_representation_v1(uuid,text,text,text,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
