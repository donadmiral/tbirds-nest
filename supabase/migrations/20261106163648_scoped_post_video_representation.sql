-- Disabled until a DB operator explicitly enrolls an exact media/source/version tuple.
-- No sweep, trigger, automatic enrollment, bucket privilege change, or raw-media fallback.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create table media_delivery.post_poster_jobs_v1(
 media_id uuid primary key references public.post_media(id) on delete cascade,
 source_id uuid not null references storage.objects(id) on delete cascade,
 source_version text not null, recipe_hash text not null, publication_lease uuid not null,
 admit_until timestamptz not null, attempts smallint not null default 0 check(attempts between 0 and 2),
 lease uuid unique,lease_until timestamptz,
 jpeg bytea check(octet_length(jpeg) between 32 and 65536), jpeg_hash text, finished_at timestamptz,
 check ((jpeg is null and jpeg_hash is null and finished_at is null) or
 (jpeg is not null and jpeg_hash ~ '^[0-9a-f]{64}$' and finished_at is not null))
);
alter table media_delivery.post_poster_jobs_v1 enable row level security;
revoke all on media_delivery.post_poster_jobs_v1 from public,anon,authenticated,service_role;

-- Private join: physical ownership, current explicit post binding, immutable source,
-- current published rendition, exact output owner/job/lease/path/object/version/etag.
create view media_delivery.post_poster_eligible_v1 with (security_barrier=true) as
 select m.id media_id,m.post_id,md5((coalesce(m.edit,'{}'::jsonb)-'generatedPosterV1')::text) recipe_hash,coalesce(m.edit->>'filterId','none') filter_id,j.source_id,j.source_version,p.lease_id publication_lease,
 j.source_path,so.name path,so.version,trim(both '"' from a.etag) etag,a.bytes,a.sha256
 from public.post_media m join public.posts post on post.id=m.post_id
 join public.content_media_bindings b on b.entity_kind='post' and b.entity_id=m.post_id and b.uploader_id=post.user_id and b.bucket_id='post-media'
 join storage.objects src on src.bucket_id=b.bucket_id and src.name=b.object_path and coalesce(src.owner_id,src.owner::text)=post.user_id::text
 join media_renditions.jobs j on j.source_id=src.id and j.source_bucket=src.bucket_id and j.source_path=src.name and j.source_version=src.version and j.source_owner=post.user_id
 join media_renditions.publications p on p.job_id=j.id and p.active
 join media_renditions.assets a on a.lease_id=p.lease_id and a.name='fallback.mp4' and a.mime='video/mp4'
 join storage.objects so on so.id=a.object_id and so.version=a.object_version and so.bucket_id='adaptive-media'
 where m.media_type='video' and not coalesce(m.is_sensitive,false)
 and (coalesce(m.edit,'{}'::jsonb)-'generatedPosterV1') in ('{}'::jsonb,'{"filterId":"fade"}'::jsonb) and j.profile='hls-v2' and j.state='ready' and starts_with(src.name,post.user_id::text||'/')
 and right(m.url,length('/storage/v1/object/public/post-media/'||src.name))='/storage/v1/object/public/post-media/'||src.name
 and so.name=post.user_id::text||'/_renditions_v2/'||j.id::text||'/'||p.lease_id::text||'/fallback.mp4'
 and a.bytes between 1 and 33554432 and a.sha256 ~ '^[0-9a-f]{64}$' and a.etag is not null
 and so.metadata->>'mimetype'='video/mp4' and so.metadata->>'size'=a.bytes::text
 and trim(both '"' from coalesce(so.metadata->>'eTag',so.metadata->>'etag'))=trim(both '"' from a.etag)
 and coalesce(m.edit->>'coverUrl','')='' and coalesce(m.edit->>'thumbnail','')='' and coalesce(m.edit->>'thumbnailUrl','')=''
 and not exists(select 1 from media_renditions.settings where emergency_revoke)
 and media_renditions.source_matches(j);
revoke all on media_delivery.post_poster_eligible_v1 from public,anon,authenticated,service_role;

create function public.claim_post_poster_v1() returns jsonb
language plpgsql security definer set search_path='' as $$
declare job media_delivery.post_poster_jobs_v1; candidate media_delivery.post_poster_eligible_v1; token uuid:=gen_random_uuid();
begin
 perform media_processing.require_service();
 select j.* into job from media_delivery.post_poster_jobs_v1 j join media_delivery.post_poster_eligible_v1 e using(media_id,source_id,source_version,publication_lease,recipe_hash)
 where j.finished_at is null and j.admit_until>clock_timestamp() and j.attempts<2 and (j.lease_until is null or j.lease_until<clock_timestamp()) order by j.media_id limit 1 for update of j skip locked;
 if not found then return null;end if;
 select * into strict candidate from media_delivery.post_poster_eligible_v1 where media_id=job.media_id and source_id=job.source_id and source_version=job.source_version and publication_lease=job.publication_lease and recipe_hash=job.recipe_hash;
 update media_delivery.post_poster_jobs_v1 set lease=token,lease_until=least(admit_until,clock_timestamp()+interval '120 seconds'),attempts=attempts+1 where media_id=job.media_id;
 return jsonb_build_object('lease',token,'media_id',job.media_id,'filter_id',candidate.filter_id,'bucket','adaptive-media','path',candidate.path,'bytes',candidate.bytes,'version',candidate.version,'etag',candidate.etag,'sha256',candidate.sha256);
end $$;

create function public.finish_post_poster_v1(p_lease uuid,p_media uuid,p_jpeg text,p_sha256 text) returns boolean
language plpgsql security definer set search_path='' as $$
declare job media_delivery.post_poster_jobs_v1; img bytea;
begin
 perform media_processing.require_service();
 if p_jpeg is null or length(p_jpeg) not between 40 and 87384 or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then return false;end if;
 img:=decode(p_jpeg,'base64');
 if octet_length(img) not between 32 and 65536 or substring(img from 1 for 3)<>decode('ffd8ff','hex')
 or substring(img from octet_length(img)-1 for 2)<>decode('ffd9','hex') or encode(extensions.digest(img,'sha256'),'hex')<>p_sha256 then return false;end if;
 select * into job from media_delivery.post_poster_jobs_v1 where media_id=p_media and lease=p_lease for update;
 if not found then return false;end if;
 perform 1 from public.post_media where id=p_media for update;
 if not exists(select 1 from media_delivery.post_poster_eligible_v1 e where e.media_id=p_media and e.source_id=job.source_id and e.source_version=job.source_version and e.publication_lease=job.publication_lease and e.recipe_hash=job.recipe_hash) then return false;end if;
 if job.finished_at is not null then return job.jpeg_hash=p_sha256;end if;
 if least(job.admit_until,job.lease_until)<=clock_timestamp() then return false;end if;
 update public.post_media set edit=coalesce(edit,'{}'::jsonb)||jsonb_build_object('generatedPosterV1',true)
 where id=p_media and (edit is null or jsonb_typeof(edit)='object') and coalesce(edit->>'coverUrl','')='' and coalesce(edit->>'thumbnail','')='' and coalesce(edit->>'thumbnailUrl','')='';
 if not found then return false;end if;
 update media_delivery.post_poster_jobs_v1 set jpeg=img,jpeg_hash=p_sha256,finished_at=clock_timestamp() where media_id=p_media;
 return true;
end $$;

-- Original session ticket authorization is reevaluated, including current exact
-- content context. A ticket for a different post sharing an object cannot be reused.
create function public.read_post_representation_v1(p_token text,p_bucket text,p_path text,p_source_version text,p_kind text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g jsonb; result jsonb;
begin
 perform media_processing.require_service();
 if p_kind is null or p_kind not in ('poster','compatible') or p_bucket<>'post-media' then return null;end if;
 g:=public.resolve_media_delivery(p_token,p_bucket,p_path);
 if g is null or g->>'version' is null or (p_source_version is not null and (g->>'version') is distinct from p_source_version) or g->>'path' is distinct from p_path or g->>'bucket' is distinct from p_bucket then return null;end if;
 select case when p_kind='poster' then jsonb_build_object('bytes',octet_length(j.jpeg),'jpeg',replace(encode(j.jpeg,'base64'),E'\n',''),'hash',j.jpeg_hash)
 else jsonb_build_object('bucket','adaptive-media','path',e.path,'version',e.version,'etag',e.etag,'sourceVersion',e.source_version) end into result
 from media_delivery.tickets t join media_delivery.post_poster_eligible_v1 e on e.post_id=t.source_id and e.source_id=t.object_id and e.source_version=t.object_version and e.source_path=t.object_path
 join media_delivery.post_poster_jobs_v1 j on j.media_id=e.media_id and j.source_id=e.source_id and j.source_version=e.source_version and j.publication_lease=e.publication_lease and j.recipe_hash=e.recipe_hash
 join public.post_media pm on pm.id=j.media_id and pm.edit->'generatedPosterV1'='true'::jsonb
 where t.token_digest=extensions.digest(p_token,'sha256') and t.source_kind='post' and t.bucket_id=p_bucket and t.object_path=p_path and j.finished_at is not null and e.source_version=g->>'version';
 return result||jsonb_build_object('sourceVersion',g->>'version','sourcePath',g->>'path','sourceBucket',g->>'bucket','expiresAt',g->>'expiresAt');
end $$;
revoke all on function public.claim_post_poster_v1(),public.finish_post_poster_v1(uuid,uuid,text,text),public.read_post_representation_v1(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_post_poster_v1(),public.finish_post_poster_v1(uuid,uuid,text,text),public.read_post_representation_v1(text,text,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
