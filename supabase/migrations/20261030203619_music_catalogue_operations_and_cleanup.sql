-- Catalogue metadata can be staged and reviewed, never activated here.
-- Abandoned original uploads are removed through Storage, then acknowledged
-- against actual object absence before their retained quota is released.
begin;
set local lock_timeout='3s';
do $$ begin
 if to_regprocedure('music_library.require_admin(uuid,uuid)') is null
 or to_regprocedure('public.reserve_original_audio(uuid,uuid,text,text,integer,text,boolean,boolean)') is null
 or to_regprocedure('public.resolve_media_delivery(text,text,text)') is null then
  raise exception 'MUSIC_OPERATIONS_PREREQUISITES_REQUIRED';
 end if;
end $$;

alter table music_library.uploads drop constraint uploads_status_check;
alter table music_library.uploads add constraint uploads_status_check check(status in ('reserved','ready','revoked','purging','purged'));
alter table music_library.uploads add column purged_at timestamptz;
create index music_upload_abandoned on music_library.uploads(expires_at,id)
 where status in ('reserved','revoked') and sound_id is null;

create table music_library.maintenance_worker(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false, secret_digest bytea check(octet_length(secret_digest)=32),
 last_seen_at timestamptz, updated_at timestamptz not null default now()
);
insert into music_library.maintenance_worker(singleton) values(true);
create table music_library.cleanup_jobs(
 upload_id uuid primary key references music_library.uploads(id) on delete cascade,
 state text not null check(state in ('pending','running','complete','review')),
 object_id uuid, object_version text, lease_token uuid, lease_until timestamptz,
 attempts integer not null default 0 check(attempts>=0),
 next_attempt_at timestamptz not null default now(),
 last_error text check(last_error in ('storage_unavailable','object_changed','lease_expired')),
 created_at timestamptz not null default now(), completed_at timestamptz
);
create index music_cleanup_pending on music_library.cleanup_jobs(next_attempt_at) where state in ('pending','running');

create table music_library.catalogue_imports(
 id uuid primary key, provider_id text not null references music_library.providers(id),
 manifest_sha256 text not null check(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 track_count integer not null check(track_count between 1 and 100),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create table music_library.catalogue_tracks(
 id uuid primary key default gen_random_uuid(),
 provider_id text not null references music_library.providers(id),
 provider_track_id text not null check(provider_track_id ~ '^[a-zA-Z0-9_.:-]{1,200}$'),
 revision text not null check(revision ~ '^[a-zA-Z0-9_.:-]{1,100}$'),
 title text not null check(length(title) between 1 and 200),
 artist text not null check(length(artist) between 1 and 200),
 album text check(length(album)<=200),
 isrc text check(isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
 duration_sec numeric not null check(duration_sec between 1 and 3600 and duration_sec::text not in ('NaN','Infinity','-Infinity')),
 asset_ref text check(length(asset_ref) between 1 and 1000 and asset_ref ~ '^[a-zA-Z0-9_./:-]+$' and asset_ref !~ '^https?://'),
 asset_sha256 text check(asset_sha256 ~ '^[a-f0-9]{64}$'),
 license_draft_id uuid references music_library.license_drafts(id),
 metadata_sha256 text not null check(metadata_sha256 ~ '^[a-f0-9]{64}$'),
 import_id uuid not null references music_library.catalogue_imports(id),
 status text not null default 'awaiting_license' check(status='awaiting_license'),
 created_at timestamptz not null default now(),
 unique(provider_id,provider_track_id,revision)
);
create index music_catalogue_provider on music_library.catalogue_tracks(provider_id,created_at desc);
create table music_library.usage_events(
 id bigint generated always as identity primary key,
 event_key text not null unique default gen_random_uuid()::text,
 event_type text not null check(event_type in ('attachment','detachment','delivery_authorization','export_authorization')),
 sound_id uuid references public.story_sounds(id) on delete cascade,
 provider_id text not null, provider_track_id text, title text not null,
 use_kind text not null check(use_kind in ('story','post','memory_album','preview')),
 territory text check(territory ~ '^[A-Z]{2}$'),
 occurred_at timestamptz not null default clock_timestamp()
);
create index music_usage_report on music_library.usage_events(occurred_at,provider_id);
do $$ declare t text; begin
 foreach t in array array['maintenance_worker','cleanup_jobs','catalogue_imports','catalogue_tracks','usage_events'] loop
  execute format('alter table music_library.%I enable row level security',t);
  execute format('revoke all on music_library.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger account_erasure_actor_write before insert or update or delete on music_library.%I for each statement execute function account_erasure.guard_actor_write()',t);
 end loop;
end $$;

-- A Storage insert shares this reservation lock with cleanup. Once cleanup
-- starts, a new insert, renewal or finalization cannot revive the old path.
create or replace function public.music_upload_permitted(p_path text) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare u uuid:=music_library.require_user(); r music_library.uploads;
begin
 select * into r from music_library.uploads where object_path=p_path and owner_id=u for share;
 return found and r.status='reserved' and r.expires_at>now()
  and coalesce((select uploads_enabled from music_library.service_state where singleton),false);
end $$;

create or replace function public.reserve_original_audio(p_request_id uuid,p_expected_user uuid,p_title text,p_mime text,p_bytes integer,p_sha256 text,p_reuse boolean,p_rights_attested boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=music_library.require_user(); existing music_library.uploads; origin text; ext text;
begin
 if not (select uploads_enabled from music_library.service_state where singleton) then raise exception 'ORIGINAL_AUDIO_SERVICE_NOT_READY' using errcode='55000';end if;
 if u is distinct from p_expected_user or p_request_id is null then raise exception 'ACCOUNT_CHANGED' using errcode='42501'; end if;
 if p_rights_attested is distinct from true then raise exception 'AUDIO_RIGHTS_REQUIRED' using errcode='22023'; end if;
 if p_bytes is null or p_bytes not between 44 and 52428800 or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$'
 or p_mime is null or p_mime not in ('audio/wav','audio/mpeg','audio/mp4') or nullif(trim(p_title),'') is null or length(p_title)>200 then raise exception 'INVALID_AUDIO_UPLOAD';end if;
 perform pg_advisory_xact_lock(hashtextextended('music-upload:'||u::text,0));
 select * into existing from music_library.uploads where id=p_request_id for update;
 if found then
  if existing.owner_id<>u or existing.sha256<>p_sha256 or existing.byte_size<>p_bytes or existing.mime<>p_mime or existing.reuse_allowed<>coalesce(p_reuse,false) then raise exception 'AUDIO_UPLOAD_CONFLICT';end if;
  if existing.status in ('purging','purged') then raise exception 'AUDIO_UPLOAD_EXPIRED';end if;
  if existing.status='revoked' then raise exception 'AUDIO_REVOKED';end if;
  if existing.status='reserved' then update music_library.uploads set expires_at=now()+interval '24 hours' where id=p_request_id returning * into existing;end if;
  return jsonb_build_object('id',existing.id,'path',existing.object_path,'status',existing.status,'soundId',existing.sound_id);
 end if;
 -- Only Storage-confirmed purging releases capacity. Until byte
 -- verification succeeds, every path can hold the bucket's full 50 MiB, even
 -- when the client declares fewer bytes. Expiry and revocation delete no bytes.
 if (select count(*) from music_library.uploads where owner_id=u and status<>'purged')>=1000
 or (select coalesce(sum(case
      when status in ('ready','revoked') and object_id is not null
       and object_version is not null and verified_duration between 1 and 600
      then byte_size else 52428800 end),0)
     from music_library.uploads where owner_id=u and status<>'purged')+52428800>1073741824
 then raise exception 'AUDIO_STORAGE_LIMIT';end if;
 if (select count(*) from music_library.uploads where owner_id=u and created_at>now()-interval '24 hours')>=100
 or (select coalesce(sum(byte_size),0) from music_library.uploads where owner_id=u and created_at>now()-interval '24 hours')+p_bytes>1073741824 then raise exception 'AUDIO_UPLOAD_LIMIT';end if;
 origin:=regexp_replace(auth.jwt()->>'iss','/auth/v1/?$','');
 if origin is null or origin !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$' then raise exception 'AUDIO_ORIGIN_REQUIRED';end if;
 ext:=case p_mime when 'audio/wav' then 'wav' when 'audio/mpeg' then 'mp3' else 'm4a' end;
 insert into music_library.uploads(id,owner_id,object_path,origin,title,mime,byte_size,sha256,reuse_allowed,rights_attested_at)
 values(p_request_id,u,u::text||'/'||p_request_id::text||'.'||ext,origin,trim(p_title),p_mime,p_bytes,p_sha256,coalesce(p_reuse,false),now()) returning * into existing;
 return jsonb_build_object('id',existing.id,'path',existing.object_path,'status',existing.status,'soundId',existing.sound_id);
end $$;

alter function public.finish_original_audio_upload(uuid,uuid,numeric,text,text) rename to finish_original_audio_upload_before_operations;
revoke all on function public.finish_original_audio_upload_before_operations(uuid,uuid,numeric,text,text) from public,anon,authenticated,service_role;
create function public.finish_original_audio_upload(p_request_id uuid,p_owner uuid,p_duration numeric,p_sha256 text,p_object_version text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r music_library.uploads;
begin
 perform account_erasure.assert_writable(p_owner);
 select * into r from music_library.uploads where id=p_request_id and owner_id=p_owner for update;
 if not found or r.status not in ('reserved','ready') then raise exception 'AUDIO_UPLOAD_EXPIRED';end if;
 return public.finish_original_audio_upload_before_operations(p_request_id,p_owner,p_duration,p_sha256,p_object_version);
end $$;
revoke all on function public.finish_original_audio_upload(uuid,uuid,numeric,text,text) from public,anon,authenticated;
grant execute on function public.finish_original_audio_upload(uuid,uuid,numeric,text,text) to service_role;

create or replace function public.get_original_audio_upload(p_request_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=music_library.require_user();r music_library.uploads;
begin
 select * into r from music_library.uploads where id=p_request_id and owner_id=u and status in ('reserved','ready') and (status='ready' or expires_at>now());
 if not found then return null;end if;
 return jsonb_build_object('id',r.id,'ownerId',r.owner_id,'path',r.object_path,'mime',r.mime,'bytes',r.byte_size,'sha256',r.sha256,'status',r.status,'soundId',r.sound_id,'objectVersion',(select o.version from storage.objects o where o.bucket_id='music-audio' and o.name=r.object_path and coalesce(o.owner_id,o.owner::text)=u::text and (o.metadata->>'size')::bigint=r.byte_size));
end $$;

create function public.validate_music_maintenance_worker(p_token text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_token is null or p_token !~ '^pc_music_[0-9a-f]{64}$' then return false;end if;
 update music_library.maintenance_worker set last_seen_at=clock_timestamp()
 where singleton and enabled and secret_digest=extensions.digest(p_token,'sha256');
 return found;
end $$;
create function public.set_music_maintenance_ready(p_ready boolean,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_ready is null or length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'SERVICE_READINESS_REASON_REQUIRED';end if;
 if p_ready and not exists(select 1 from music_library.maintenance_worker where singleton and secret_digest is not null) then raise exception 'MUSIC_MAINTENANCE_CREDENTIAL_REQUIRED';end if;
 update music_library.maintenance_worker set enabled=p_ready,updated_at=now() where singleton;
 insert into music_library.events(action,detail) values('maintenance.readiness',jsonb_build_object('ready',p_ready,'reason',p_reason));
end $$;

create function public.claim_music_upload_cleanup(p_worker uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r music_library.uploads; j music_library.cleanup_jobs; o storage.objects;
begin
 if p_worker is null then raise exception 'WORKER_REQUIRED';end if;
 if not exists(select 1 from music_library.maintenance_worker where singleton and enabled and last_seen_at>clock_timestamp()-interval '2 minutes') then return null;end if;
 select u.* into r from music_library.uploads u left join music_library.cleanup_jobs c on c.upload_id=u.id
 where u.sound_id is null and u.verified_duration is null
 and ((u.status in ('reserved','revoked') and u.expires_at<clock_timestamp()-interval '24 hours' and c.upload_id is null)
 or (u.status='purging' and c.state in ('pending','running') and c.next_attempt_at<=clock_timestamp() and (c.lease_until is null or c.lease_until<clock_timestamp())))
 order by u.expires_at,u.id for update of u skip locked limit 1;
 if not found then return null;end if;
 select * into o from storage.objects where bucket_id='music-audio' and name=r.object_path;
 insert into music_library.cleanup_jobs(upload_id,state,object_id,object_version)
 values(r.id,'pending',o.id,o.version) on conflict(upload_id) do nothing;
 select * into j from music_library.cleanup_jobs where upload_id=r.id for update;
 update music_library.uploads set status='purging' where id=r.id;
 if o.id is not null and (coalesce(o.owner_id,o.owner::text) is distinct from r.owner_id::text
  or o.version is null or (j.object_id is not null and (o.id is distinct from j.object_id or o.version is distinct from j.object_version))) then
  update music_library.cleanup_jobs set state='review',last_error='object_changed',lease_token=null,lease_until=null where upload_id=r.id;
  return jsonb_build_object('review',true);
 end if;
 update music_library.cleanup_jobs set state='running',lease_token=p_worker,lease_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1,last_error=null where upload_id=r.id;
 return jsonb_build_object('id',r.id,'ownerId',r.owner_id,'path',r.object_path,'objectId',j.object_id,'version',j.object_version,'leaseToken',p_worker);
end $$;
create function public.check_music_upload_cleanup(p_upload uuid,p_worker uuid) returns text language plpgsql security definer set search_path='' as $$
declare r music_library.uploads; j music_library.cleanup_jobs; o storage.objects;
begin
 select * into r from music_library.uploads where id=p_upload for update;
 select * into j from music_library.cleanup_jobs where upload_id=p_upload for update;
 if r.id is null or r.status<>'purging' or r.sound_id is not null or r.verified_duration is not null
 or j.state is distinct from 'running' or j.lease_token is distinct from p_worker or j.lease_until<=clock_timestamp() then return 'denied';end if;
 select * into o from storage.objects where bucket_id='music-audio' and name=r.object_path;
 if not found then return 'absent';end if;
 if o.id is distinct from j.object_id or o.version is distinct from j.object_version or coalesce(o.owner_id,o.owner::text) is distinct from r.owner_id::text then
  update music_library.cleanup_jobs set state='review',last_error='object_changed',lease_token=null,lease_until=null where upload_id=p_upload;
  return 'review';
 end if;
 return 'delete';
end $$;
create function public.ack_music_upload_cleanup(p_upload uuid,p_worker uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare r music_library.uploads;
begin
 if public.check_music_upload_cleanup(p_upload,p_worker) is distinct from 'absent' then return false;end if;
 update music_library.uploads set status='purged',purged_at=clock_timestamp() where id=p_upload returning * into r;
 update music_library.cleanup_jobs set state='complete',completed_at=clock_timestamp(),lease_token=null,lease_until=null where upload_id=p_upload;
 insert into music_library.events(action,detail) values('upload.purged',jsonb_build_object('uploadId',r.id,'reservedBytesReleased',52428800));
 return true;
end $$;
create function public.fail_music_upload_cleanup(p_upload uuid,p_worker uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update music_library.cleanup_jobs set state='pending',lease_token=null,lease_until=null,last_error='storage_unavailable',
 next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,30*(2^least(attempts,7))::integer))
 where upload_id=p_upload and state='running' and lease_token=p_worker and lease_until>clock_timestamp();
end $$;
revoke all on function public.validate_music_maintenance_worker(text),public.set_music_maintenance_ready(boolean,text),public.claim_music_upload_cleanup(uuid),public.check_music_upload_cleanup(uuid,uuid),public.ack_music_upload_cleanup(uuid,uuid),public.fail_music_upload_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function public.validate_music_maintenance_worker(text),public.set_music_maintenance_ready(boolean,text),public.claim_music_upload_cleanup(uuid),public.check_music_upload_cleanup(uuid,uuid),public.ack_music_upload_cleanup(uuid,uuid),public.fail_music_upload_cleanup(uuid,uuid) to service_role;

create function public.admin_stage_music_catalogue(p_actor uuid,p_session uuid,p_request uuid,p_provider text,p_manifest jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare fingerprint text; previous music_library.catalogue_imports; track jsonb; existing music_library.catalogue_tracks;
 draft_id uuid; track_hash text; added integer:=0; total integer;
begin
 perform music_library.require_admin(p_actor,p_session);
 if p_request is null or jsonb_typeof(p_manifest) is distinct from 'object' or octet_length(p_manifest::text)>262144
 or p_manifest->>'version' is distinct from '1' or jsonb_typeof(p_manifest->'tracks') is distinct from 'array'
 or exists(select 1 from jsonb_object_keys(p_manifest) k where k not in ('version','tracks')) then raise exception 'INVALID_CATALOGUE_MANIFEST';end if;
 total:=jsonb_array_length(p_manifest->'tracks');
 if total not between 1 and 100 then raise exception 'CATALOGUE_BATCH_LIMIT';end if;
 if not exists(select 1 from music_library.providers where id=p_provider and status in ('awaiting_license','licensed')) then raise exception 'CATALOGUE_PROVIDER_UNAVAILABLE';end if;
 fingerprint:=encode(extensions.digest(p_manifest::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('music-catalogue:'||p_provider,0));
 select * into previous from music_library.catalogue_imports where id=p_request;
 if found then
  if previous.provider_id<>p_provider or previous.manifest_sha256<>fingerprint then raise exception 'CATALOGUE_IMPORT_CONFLICT';end if;
  return jsonb_build_object('id',previous.id,'tracks',previous.track_count,'replayed',true,'catalogEnabled',false);
 end if;
 if exists(select 1 from jsonb_array_elements(p_manifest->'tracks') x group by x->>'id',x->>'revision' having count(*)>1) then raise exception 'DUPLICATE_CATALOGUE_REVISION';end if;
 insert into music_library.catalogue_imports(id,provider_id,manifest_sha256,track_count,created_by) values(p_request,p_provider,fingerprint,total,p_actor);
 for track in select value from jsonb_array_elements(p_manifest->'tracks') loop
  if jsonb_typeof(track) is distinct from 'object' or exists(select 1 from jsonb_object_keys(track) k where k not in ('id','revision','title','artist','album','isrc','durationSec','assetRef','sha256','licenseReference')) then raise exception 'INVALID_CATALOGUE_TRACK';end if;
  draft_id:=null;
  if nullif(track->>'licenseReference','') is not null then
   select id into draft_id from music_library.license_drafts where provider_id=p_provider and reference=track->>'licenseReference' and status='awaiting_license';
   if draft_id is null then raise exception 'CATALOGUE_RIGHTS_DRAFT_REQUIRED';end if;
  end if;
  track_hash:=encode(extensions.digest(track::text,'sha256'),'hex');
  select * into existing from music_library.catalogue_tracks where provider_id=p_provider and provider_track_id=track->>'id' and revision=track->>'revision';
  if found then
   if existing.metadata_sha256<>track_hash then raise exception 'CATALOGUE_REVISION_IMMUTABLE';end if;
   continue;
  end if;
  insert into music_library.catalogue_tracks(provider_id,provider_track_id,revision,title,artist,album,isrc,duration_sec,asset_ref,asset_sha256,license_draft_id,metadata_sha256,import_id)
  values(p_provider,track->>'id',track->>'revision',trim(track->>'title'),trim(track->>'artist'),nullif(trim(track->>'album'),''),nullif(upper(track->>'isrc'),''),(track->>'durationSec')::numeric,nullif(track->>'assetRef',''),nullif(track->>'sha256',''),draft_id,track_hash,p_request);
  added:=added+1;
 end loop;
 insert into music_library.events(actor_id,action,detail) values(p_actor,'catalogue.staged',jsonb_build_object('importId',p_request,'provider',p_provider,'tracks',total,'added',added,'sha256',fingerprint));
 return jsonb_build_object('id',p_request,'tracks',total,'added',added,'replayed',false,'catalogEnabled',false);
end $$;
revoke all on function public.admin_stage_music_catalogue(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_stage_music_catalogue(uuid,uuid,uuid,text,jsonb) to service_role;

-- These are observed server operations, not listening duration, completed
-- downloads, billable streams or a royalty calculation.
create function music_library.trusted_territory(p_user uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare metadata jsonb; valid_until timestamptz;
begin
 select raw_app_meta_data into metadata from auth.users where id=p_user;
 if metadata->>'music_territory' !~ '^[A-Z]{2}$' then return null;end if;
 begin valid_until:=(metadata->>'music_territory_verified_until')::timestamptz;exception when invalid_datetime_format or datetime_field_overflow then return null;end;
 return case when isfinite(valid_until) and valid_until>clock_timestamp() then metadata->>'music_territory' else null end;
end $$;
create function music_library.record_usage(p_sound uuid,p_event text,p_use text,p_user uuid,p_key text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into music_library.usage_events(event_key,event_type,sound_id,provider_id,provider_track_id,title,use_kind,territory)
 select coalesce(p_key,gen_random_uuid()::text),p_event,s.id,s.catalog_provider,s.provider_track_id,s.title,p_use,music_library.trusted_territory(p_user)
 from public.story_sounds s where s.id=p_sound
 on conflict(event_key) do nothing;
end $$;
create function music_library.record_attachment() returns trigger language plpgsql security definer set search_path='' as $$
declare old_selection jsonb; new_selection jsonb; use_kind text; old_id uuid; new_id uuid;
begin
 if tg_table_name='post_media' then
  use_kind:='post'; if tg_op<>'DELETE' then new_selection:=new.edit->'soundtrack';end if;
  if tg_op in ('UPDATE','DELETE') then old_selection:=old.edit->'soundtrack';end if;
 elsif tg_table_name='stories' then
  use_kind:='story'; if tg_op<>'DELETE' then new_selection:=jsonb_build_object('soundId',new.audio_sound_id,'start',new.media_transform->'audioStartSec','duration',new.audio_duration_sec);end if;
  if tg_op in ('UPDATE','DELETE') then old_selection:=jsonb_build_object('soundId',old.audio_sound_id,'start',old.media_transform->'audioStartSec','duration',old.audio_duration_sec);end if;
 else
  use_kind:='memory_album'; if tg_op<>'DELETE' then new_selection:=new.soundtrack;end if;
  if tg_op in ('UPDATE','DELETE') then old_selection:=old.soundtrack;end if;
 end if;
 if new_selection is not distinct from old_selection then return new;end if;
 old_id:=(old_selection->>'soundId')::uuid;new_id:=(new_selection->>'soundId')::uuid;
 if old_id is not null then perform music_library.record_usage(old_id,'detachment',use_kind,auth.uid());end if;
 if new_id is not null then perform music_library.record_usage(new_id,'attachment',use_kind,auth.uid());end if;
 return new;
end $$;
create trigger music_usage_post after insert or update of edit or delete on public.post_media for each row execute function music_library.record_attachment();
create trigger music_usage_story after insert or update of audio_sound_id,audio_duration_sec,media_transform or delete on public.stories for each row execute function music_library.record_attachment();
create trigger music_usage_book after insert or update of soundtrack or delete on public.memory_albums for each row execute function music_library.record_attachment();

alter function public.resolve_media_delivery(text,text,text) rename to resolve_media_delivery_before_music_operations;
revoke all on function public.resolve_media_delivery_before_music_operations(text,text,text) from public,anon,authenticated,service_role;
create function public.resolve_media_delivery(p_token text,p_bucket text,p_path text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; ticket media_delivery.tickets; sound uuid;
begin
 result:=public.resolve_media_delivery_before_music_operations(p_token,p_bucket,p_path);
 if result is not null and p_bucket='music-audio' then
  select * into ticket from media_delivery.tickets where token_digest=extensions.digest(p_token,'sha256');
  select sound_id into sound from music_library.uploads where object_path=p_path and status='ready';
  if sound is not null then perform music_library.record_usage(sound,'delivery_authorization',case ticket.source_kind when 'post' then 'post' when 'memory_album' then 'memory_album' when 'story' then 'story' else 'preview' end,ticket.user_id,'delivery:'||encode(ticket.token_digest,'hex'));end if;
 end if;
 return result;
end $$;
revoke all on function public.resolve_media_delivery(text,text,text) from public,anon,authenticated;
grant execute on function public.resolve_media_delivery(text,text,text) to service_role;

alter function public.authorize_original_audio_export(uuid,text) rename to authorize_original_audio_export_before_operations;
revoke all on function public.authorize_original_audio_export_before_operations(uuid,text) from public,anon,authenticated,service_role;
create function public.authorize_original_audio_export(p_sound_id uuid,p_use text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.authorize_original_audio_export_before_operations(p_sound_id,p_use);
 perform music_library.record_usage(p_sound_id,'export_authorization',p_use,auth.uid());
 return result;
end $$;
revoke all on function public.authorize_original_audio_export(uuid,text) from public,anon,service_role;
grant execute on function public.authorize_original_audio_export(uuid,text) to authenticated;

create function public.admin_music_operations_snapshot(p_actor uuid,p_session uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform music_library.require_admin(p_actor,p_session);
 return jsonb_build_object('version',1,'catalogEnabled',false,'maintenance',(select jsonb_build_object('enabled',enabled,'lastSeenAt',last_seen_at) from music_library.maintenance_worker where singleton),
 'cleanup',jsonb_build_object('pending',(select count(*) from music_library.cleanup_jobs where state in ('pending','running')),'review',(select count(*) from music_library.cleanup_jobs where state='review'),'complete',(select count(*) from music_library.cleanup_jobs where state='complete')),
 'catalogueTotal',(select count(*) from music_library.catalogue_tracks),
 'catalogue',coalesce((select jsonb_agg(to_jsonb(t)) from (select c.id,c.provider_id,c.provider_track_id,c.revision,c.title,c.artist,c.isrc,c.duration_sec,c.status,l.reference as license_reference from music_library.catalogue_tracks c left join music_library.license_drafts l on l.id=c.license_draft_id order by c.created_at desc,c.id limit 100)t),'[]'));
end $$;
create function public.admin_music_usage_report(p_actor uuid,p_session uuid,p_start timestamptz,p_end timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform music_library.require_admin(p_actor,p_session);
 if p_start is null or p_end is null or p_end<=p_start or p_end>p_start+interval '31 days' then raise exception 'MUSIC_REPORT_WINDOW_REQUIRED';end if;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from (
  select to_char(occurred_at at time zone 'UTC','YYYY-MM-DD') as day,event_type,provider_id,provider_track_id,title,use_kind,coalesce(territory,'Unknown') as territory,count(*)::text as operations
  from music_library.usage_events where occurred_at>=p_start and occurred_at<p_end
  group by 1,2,3,4,5,6,7 order by 1,2,3,4,5,6,7 limit 10001
 )r;
 if jsonb_array_length(result)>10000 then raise exception 'MUSIC_REPORT_TOO_LARGE_USE_SHORTER_WINDOW';end if;
 return jsonb_build_object('start',p_start,'endExclusive',p_end,'metric','server_operations_not_plays_or_royalties','rows',result);
end $$;
revoke all on function public.admin_music_operations_snapshot(uuid,uuid),public.admin_music_usage_report(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_music_operations_snapshot(uuid,uuid),public.admin_music_usage_report(uuid,uuid,timestamptz,timestamptz) to service_role;
revoke all on all functions in schema music_library from public,anon,authenticated,service_role;
commit;
