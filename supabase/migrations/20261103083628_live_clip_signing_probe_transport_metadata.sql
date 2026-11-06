-- Observed production Storage signing probe: version='1', user_metadata NULL,
-- metadata exactly {"mimetype":"application/json","contentLength":2}.
-- These describe the empty signing request body '{}', not uploaded file bytes.
-- The service-role + exact signing-operation + INSERT boundary and all current
-- lease/source/owner/format checks remain. Restore the canonical function body
-- without temporary operator diagnostic DETAIL fields.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create or replace function live_streams.clip_bind_storage_owner()
returns trigger language plpgsql security definer set search_path='' as $$
declare c live_streams.clips;j live_streams.clip_jobs;clip uuid;job uuid;lease uuid;asset text;signing_probe boolean;
begin
 if new.bucket_id<>'live-clips' then
  if tg_op='UPDATE' and old.bucket_id='live-clips' then raise exception 'CLIP_OBJECT_IMMUTABLE';end if;
  return new;
 end if;
 if new.name!~'^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}/(horizontal.mp4|vertical.mp4|thumbnail.jpg|captions.vtt)$' then raise exception 'INVALID_CLIP_OBJECT';end if;

 signing_probe:=tg_op='INSERT' and auth.role()='service_role'
  and storage.allow_only_operation('object.sign_upload_url');
 if coalesce(signing_probe,false) then
  -- The deployed Storage engine describes its empty signing HTTP body as
  -- application/json with contentLength=2. Accept that exact transport-only
  -- object, or no metadata. Actual uploads still require full provenance.
  if new.version is distinct from '1' or coalesce(new.metadata,'{}'::jsonb) not in ('{}'::jsonb,'{"mimetype":"application/json","contentLength":2}'::jsonb)
   or coalesce(new.user_metadata,'{}'::jsonb)<>'{}'::jsonb then raise exception 'INVALID_CLIP_OBJECT';end if;
  begin clip:=split_part(new.name,'/',3)::uuid;lease:=split_part(new.name,'/',4)::uuid;
  exception when invalid_text_representation then raise exception 'INVALID_CLIP_OBJECT';end;
  select * into j from live_streams.clip_jobs where clip_id=clip and lease_id=lease and state='leased';
  job:=j.id;
 else
  begin clip:=(new.user_metadata->>'live_clip_id')::uuid;job:=(new.user_metadata->>'live_clip_job_id')::uuid;lease:=(new.user_metadata->>'live_clip_lease_id')::uuid;
  exception when invalid_text_representation then raise exception 'INVALID_CLIP_OBJECT';end;
  if clip is null or job is null or lease is null or coalesce(new.user_metadata->>'sha256','')!~'^[a-f0-9]{64}$' then raise exception 'INVALID_CLIP_OBJECT';end if;
  select * into j from live_streams.clip_jobs where id=job and clip_id=clip;
 end if;
 select * into c from live_streams.clips where id=clip;
 if not coalesce((live_streams.clip_check_job(job,lease)->>'ok')::boolean,false)
  or new.name<>c.owner_id::text||'/'||c.session_id::text||'/'||c.id::text||'/'||lease::text||'/'||split_part(new.name,'/',5)
  or(tg_op='UPDATE' and(old.bucket_id<>new.bucket_id or old.name<>new.name)) then raise exception 'CLIP_LEASE_LOST';end if;
 asset:=split_part(new.name,'/',5);
 if(asset like '%.mp4' and not(c.formats ? replace(asset,'.mp4',''))) or(asset='captions.vtt' and jsonb_array_length(c.subtitles)=0) then raise exception 'INVALID_CLIP_OBJECT';end if;
 new.owner:=c.creator_id;new.owner_id:=c.creator_id::text;
 return new;
end$$;

commit;
