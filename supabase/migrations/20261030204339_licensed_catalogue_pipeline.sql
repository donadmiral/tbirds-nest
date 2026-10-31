-- Provider-neutral, verified byte ingestion and current-rights delivery.
-- No credential, grant, provider activation or catalogue activation is installed.
begin;
set local lock_timeout='3s';
do $$ begin
 if to_regprocedure('public.admin_stage_music_catalogue(uuid,uuid,uuid,text,jsonb)') is null then raise exception 'MUSIC_OPERATIONS_REQUIRED';end if;
end $$;
alter table music_library.providers drop constraint providers_status_check;
alter table music_library.providers add constraint providers_status_check check(status in ('awaiting_license','licensed','suspended'));
create table music_library.catalogue_service(singleton boolean primary key default true check(singleton),ingestion_enabled boolean not null default false,playback_enabled boolean not null default false);
insert into music_library.catalogue_service(singleton) values(true);
create table music_library.catalogue_credentials(
 provider_id text primary key references music_library.providers(id),
 secret_digest bytea not null unique check(octet_length(secret_digest)=32),enabled boolean not null default false,
 max_retained_bytes bigint not null default 10737418240 check(max_retained_bytes between 1073741824 and 1099511627776)
);
create table music_library.catalogue_grants(
 id uuid primary key default gen_random_uuid(),provider_id text not null references music_library.providers(id),
 reference text not null check(length(reference) between 1 and 200),revision text not null check(length(revision) between 1 and 100),
 licensor text not null check(length(licensor) between 1 and 200),
 evidence_ref text not null check(length(evidence_ref) between 1 and 2000),evidence_sha256 text not null check(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 territories text[] not null,permitted_uses text[] not null,
 starts_at timestamptz not null,ends_at timestamptz not null check(ends_at>starts_at and isfinite(starts_at) and isfinite(ends_at)),
 hosting_allowed boolean not null default false,export_allowed boolean not null default false,
 max_excerpt_sec integer not null check(max_excerpt_sec between 1 and 600),
 reviewed_by uuid references auth.users(id) on delete set null,reviewed_at timestamptz not null default now(),revoked_at timestamptz,
 unique(provider_id,reference,revision),
 check(cardinality(territories)>0 and array_position(territories,null) is null and array_to_string(territories,',') ~ '^(\*|[A-Z]{2})(,(\*|[A-Z]{2}))*$'),
 check(cardinality(permitted_uses)>0 and array_position(permitted_uses,null) is null and permitted_uses <@ array['story','post','memory_album','advertisement']::text[])
);
-- Platform catalogue assets have no personal-account owner. Originals retain
-- their required owner, and personal erasure cannot delete platform recordings.
alter table public.story_sounds alter column owner_id drop not null;
alter table public.story_sounds add constraint original_audio_requires_owner check(owner_id is not null or source='library');
alter table music_library.catalogue_tracks add column grant_id uuid references music_library.catalogue_grants(id);
create table music_library.catalogue_assets(
 track_id uuid primary key references music_library.catalogue_tracks(id),
 grant_id uuid not null references music_library.catalogue_grants(id),
 provider_id text not null references music_library.providers(id),
 object_path text not null unique,origin text not null,
 mime text not null check(mime in ('audio/wav','audio/mpeg','audio/mp4')),
 byte_size integer not null check(byte_size between 44 and 52428800),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 status text not null default 'reserved' check(status in ('reserved','ready','purging','purged')),
 sound_id uuid unique references public.story_sounds(id),object_id uuid,object_version text,verified_duration numeric,
 created_at timestamptz not null default now(),last_attempt_at timestamptz not null default now(),purged_at timestamptz,
 check(status<>'ready' or (sound_id is not null and object_id is not null and object_version is not null and verified_duration between 1 and 600))
);
-- Storage's service role bypasses RLS. This narrowly scoped trigger binds its
-- catalogue metadata writes to the same row lock used by reservation/cleanup.
-- The trigger function lives outside the managed schema, as does all state.
-- No Storage object is uploaded or deleted with SQL.
create function music_library.guard_catalogue_storage_write() returns trigger language plpgsql security definer set search_path='' as $$
declare a music_library.catalogue_assets;
begin
 if tg_op='UPDATE' and old.bucket_id='music-audio' and old.name like 'catalogue/%'
  and(new.bucket_id is distinct from old.bucket_id or new.name is distinct from old.name or new.id is distinct from old.id)then raise exception 'CATALOGUE_STORAGE_IMMUTABLE';end if;
 if new.bucket_id<>'music-audio' or new.name not like 'catalogue/%' then return new;end if;
 select * into a from music_library.catalogue_assets where object_path=new.name for share;
 if not found or a.status<>'reserved' or a.last_attempt_at<=clock_timestamp()-interval '48 hours'
 or new.owner_id is not null or new.owner is not null then raise exception 'CATALOGUE_STORAGE_IMMUTABLE';end if;
 if not coalesce((select ingestion_enabled from music_library.catalogue_service where singleton),false)
 or not exists(select 1 from music_library.providers where id=a.provider_id and status='licensed')
 or not exists(select 1 from music_library.catalogue_grants where id=a.grant_id and provider_id=a.provider_id and hosting_allowed and revoked_at is null and starts_at<=clock_timestamp()and ends_at>clock_timestamp())then raise exception 'CATALOGUE_SIGNED_GRANT_REQUIRED';end if;
 if new.metadata->>'size' is not null and(new.metadata->>'size')::bigint is distinct from a.byte_size::bigint then raise exception 'CATALOGUE_STORAGE_SIZE_MISMATCH';end if;
 return new;
end $$;
create trigger music_catalogue_storage_write before insert or update of bucket_id,name,id,owner_id,owner,version,metadata on storage.objects for each row execute function music_library.guard_catalogue_storage_write();

create index catalogue_asset_provider on music_library.catalogue_assets(provider_id,created_at);
do $$ declare t text;begin
 foreach t in array array['catalogue_service','catalogue_credentials','catalogue_grants','catalogue_assets'] loop
  execute format('alter table music_library.%I enable row level security',t);
  execute format('revoke all on music_library.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger account_erasure_actor_write before insert or update or delete on music_library.%I for each statement execute function account_erasure.guard_actor_write()',t);
 end loop;
end $$;
create function music_library.immutable_catalogue_grant() returns trigger language plpgsql set search_path='' as $$
begin
 if to_jsonb(new)-'revoked_at'-'reviewed_by' is distinct from to_jsonb(old)-'revoked_at'-'reviewed_by' or (new.reviewed_by is distinct from old.reviewed_by and new.reviewed_by is not null) or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then raise exception 'CATALOGUE_GRANT_IMMUTABLE';end if;
 return new;
end $$;
create trigger immutable_catalogue_grant before update on music_library.catalogue_grants for each row execute function music_library.immutable_catalogue_grant();
create function music_library.catalogue_provider_for_token(p_token text) returns text language plpgsql stable security definer set search_path='' as $$
declare provider text;
begin
 if p_token is null or p_token !~ '^pc_catalogue_[0-9a-f]{64}$' or not coalesce((select ingestion_enabled from music_library.catalogue_service where singleton),false) then return null;end if;
 select c.provider_id into provider from music_library.catalogue_credentials c join music_library.providers p on p.id=c.provider_id
 where c.enabled and c.secret_digest=extensions.digest(p_token,'sha256') and p.status='licensed';
 return provider;
end $$;
create function public.reserve_catalogue_audio(p_token text,p_track uuid,p_bytes integer,p_mime text,p_sha256 text,p_origin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare provider text:=music_library.catalogue_provider_for_token(p_token);t music_library.catalogue_tracks;g music_library.catalogue_grants;a music_library.catalogue_assets;ext text;
begin
 if provider is null then raise exception 'CATALOGUE_INGESTION_UNAVAILABLE' using errcode='42501';end if;
 select * into t from music_library.catalogue_tracks where id=p_track and provider_id=provider;
 select * into g from music_library.catalogue_grants where id=t.grant_id and provider_id=provider and hosting_allowed and revoked_at is null and starts_at<=clock_timestamp() and ends_at>clock_timestamp();
 if t.id is null or g.id is null then raise exception 'CATALOGUE_SIGNED_GRANT_REQUIRED' using errcode='42501';end if;
 if p_bytes is null or p_bytes not between 44 and 52428800 or p_mime is null or p_mime not in ('audio/wav','audio/mpeg','audio/mp4')
 or p_sha256 is null or p_sha256 is distinct from t.asset_sha256 or p_origin is null or p_origin !~ '^https://[a-z0-9]+[.]supabase[.]co$' then raise exception 'INVALID_CATALOGUE_ASSET';end if;
 perform pg_advisory_xact_lock(hashtextextended('catalogue-asset:'||provider,0));
 select * into a from music_library.catalogue_assets where track_id=p_track for update;
 if found then
  if a.status in ('purging','purged') then raise exception 'CATALOGUE_ASSET_EXPIRED_USE_NEW_REVISION';end if;
  if a.status='reserved' then update music_library.catalogue_assets set last_attempt_at=clock_timestamp() where track_id=p_track;end if;
  if a.sha256<>p_sha256 or a.byte_size<>p_bytes or a.mime<>p_mime or a.grant_id<>g.id or a.origin<>p_origin then raise exception 'CATALOGUE_ASSET_CONFLICT';end if;
  if a.status='ready' and not exists(select 1 from storage.objects o where o.id=a.object_id and o.version=a.object_version and o.bucket_id='music-audio' and o.name=a.object_path and o.owner_id is null and o.owner is null) then raise exception 'CATALOGUE_OBJECT_CHANGED';end if;
 else
  if (select count(*) from music_library.catalogue_assets where provider_id=provider and status='reserved')>=20
  or (select coalesce(sum(case when status='ready' then byte_size else 52428800 end),0) from music_library.catalogue_assets where provider_id=provider and status<>'purged')+52428800>(select max_retained_bytes from music_library.catalogue_credentials where provider_id=provider)
  then raise exception 'CATALOGUE_STORAGE_LIMIT';end if;
  ext:=case p_mime when 'audio/wav' then 'wav' when 'audio/mpeg' then 'mp3' else 'm4a' end;
  insert into music_library.catalogue_assets(track_id,grant_id,provider_id,object_path,origin,mime,byte_size,sha256)
  values(p_track,g.id,provider,'catalogue/'||provider||'/'||p_track::text||'/'||p_sha256||'.'||ext,p_origin,p_mime,p_bytes,p_sha256) returning * into a;
 end if;
 return jsonb_build_object('trackId',a.track_id,'providerId',a.provider_id,'path',a.object_path,'mime',a.mime,'bytes',a.byte_size,'sha256',a.sha256,'status',a.status,'soundId',a.sound_id);
end $$;
create function public.catalogue_audio_object(p_token text,p_track uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare provider text:=music_library.catalogue_provider_for_token(p_token);result jsonb;
begin
 if provider is null then return null;end if;
 select jsonb_build_object('id',o.id,'version',o.version,'bytes',o.metadata->>'size') into result
 from music_library.catalogue_assets a join storage.objects o on o.bucket_id='music-audio' and o.name=a.object_path and o.owner_id is null and o.owner is null
 where a.track_id=p_track and a.provider_id=provider and o.version is not null;
 return result;
end $$;
create function public.finish_catalogue_audio(p_token text,p_track uuid,p_duration numeric,p_sha256 text,p_object_version text)
returns uuid language plpgsql security definer set search_path='' as $$
declare provider text:=music_library.catalogue_provider_for_token(p_token);a music_library.catalogue_assets;t music_library.catalogue_tracks;g music_library.catalogue_grants;o storage.objects;sid uuid;
begin
 if provider is null then raise exception 'CATALOGUE_INGESTION_UNAVAILABLE' using errcode='42501';end if;
 select * into a from music_library.catalogue_assets where track_id=p_track and provider_id=provider for update;
 select * into t from music_library.catalogue_tracks where id=p_track;
 select * into g from music_library.catalogue_grants where id=a.grant_id and provider_id=provider and hosting_allowed and revoked_at is null and starts_at<=clock_timestamp() and ends_at>clock_timestamp();
 if a.track_id is null or a.status not in ('reserved','ready') or g.id is null then raise exception 'CATALOGUE_SIGNED_GRANT_REQUIRED' using errcode='42501';end if;
 if a.status='ready' then return a.sound_id;end if;
 if p_duration is null or p_duration not between 1 and 600 or p_duration::text in ('NaN','Infinity','-Infinity') or abs(p_duration-t.duration_sec)>1 or p_sha256 is distinct from a.sha256 then raise exception 'CATALOGUE_VALIDATION_FAILED';end if;
 select * into o from storage.objects where bucket_id='music-audio' and name=a.object_path and owner_id is null and owner is null;
 if not found or o.version is null or o.version is distinct from p_object_version or (o.metadata->>'size')::bigint is distinct from a.byte_size::bigint then raise exception 'CATALOGUE_OBJECT_CHANGED';end if;
 insert into public.story_sounds(owner_id,title,artist,url,duration_sec,source,rights_status,catalog_provider,provider_track_id,license_ref,licensor,permitted_uses,territories,rights_start,rights_end,max_excerpt_sec,asset_sha256)
 values(null,t.title,t.artist,a.origin||'/storage/v1/object/public/music-audio/'||a.object_path,floor(p_duration)::integer,'library','licensed',provider,t.provider_track_id||'@'||t.revision,g.reference,g.licensor,g.permitted_uses,g.territories,g.starts_at,g.ends_at,least(floor(p_duration)::integer,g.max_excerpt_sec),p_sha256) returning id into sid;
 update music_library.catalogue_assets set status='ready',sound_id=sid,object_id=o.id,object_version=o.version,verified_duration=p_duration where track_id=p_track;
 insert into music_library.events(sound_id,action,detail) values(sid,'catalogue.verified',jsonb_build_object('provider',provider,'trackId',p_track,'grantId',g.id,'bytes',a.byte_size,'sha256',p_sha256));
 return sid;
end $$;
revoke all on function public.reserve_catalogue_audio(text,uuid,integer,text,text,text),public.catalogue_audio_object(text,uuid),public.finish_catalogue_audio(text,uuid,numeric,text,text) from public,anon,authenticated;
grant execute on function public.reserve_catalogue_audio(text,uuid,integer,text,text,text),public.catalogue_audio_object(text,uuid),public.finish_catalogue_audio(text,uuid,numeric,text,text) to service_role;

create function music_library.catalogue_rights_allow(p_sound uuid,p_use text,p_export boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare u uuid:=music_library.require_user();a music_library.catalogue_assets;g music_library.catalogue_grants;s public.story_sounds;
begin
 if not coalesce((select playback_enabled from music_library.catalogue_service where singleton),false) then return false;end if;
 select * into a from music_library.catalogue_assets where sound_id=p_sound and status='ready';
 select * into g from music_library.catalogue_grants where id=a.grant_id and provider_id=a.provider_id;
 select * into s from public.story_sounds where id=p_sound;
 return a.track_id is not null and s.source='library' and s.rights_status='licensed' and s.revoked_at is null
 and g.id is not null and g.hosting_allowed and g.revoked_at is null and g.starts_at<=clock_timestamp() and g.ends_at>clock_timestamp()
 and coalesce(p_use=any(g.permitted_uses),false) and (not p_export or g.export_allowed)
 and ('*'=any(g.territories) or coalesce(music_library.trusted_territory(u)=any(g.territories),false))
 and exists(select 1 from music_library.providers where id=a.provider_id and status='licensed')
 and s.url=a.origin||'/storage/v1/object/public/music-audio/'||a.object_path and s.asset_sha256=a.sha256
 and exists(select 1 from storage.objects o where o.id=a.object_id and o.version=a.object_version and o.bucket_id='music-audio' and o.name=a.object_path and o.owner_id is null and o.owner is null);
end $$;
create or replace function music_library.reusable(p_sound uuid,p_use text) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 perform music_library.require_user();
 if exists(select 1 from music_library.catalogue_assets where sound_id=p_sound) then return coalesce(music_library.catalogue_rights_allow(p_sound,p_use),false);end if;
 return exists(select 1 from public.story_sounds s where s.id=p_sound and s.rights_status='creator_attested'
 and public.sound_rights_allow_before_original_library(s.id,p_use)
 and exists(select 1 from music_library.uploads u where u.sound_id=s.id and u.status='ready' and (u.owner_id=auth.uid() or u.reuse_allowed)));
end $$;
create or replace function public.get_original_audio_capabilities() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform music_library.require_user();
 return jsonb_build_object('version',2,'uploadsEnabled',(select uploads_enabled from music_library.service_state where singleton),
 'catalogEnabled',coalesce((select playback_enabled from music_library.catalogue_service where singleton),false),'maxBytes',52428800,'maxDurationSec',600,'recordingDurationSec',30,'mimeTypes',jsonb_build_array('audio/wav','audio/mpeg','audio/mp4'));
end $$;
create function public.authorize_music_audio_export(p_sound_id uuid,p_use text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.story_sounds;
begin
 perform music_library.require_user();
 select * into s from public.story_sounds where id=p_sound_id;
 if s.source='original' then return public.authorize_original_audio_export(p_sound_id,p_use);end if;
 if s.source is distinct from 'library' or music_library.catalogue_rights_allow(p_sound_id,p_use,true) is distinct from true then raise exception 'AUDIO_EXPORT_RIGHTS_REQUIRED' using errcode='42501';end if;
 perform music_library.record_usage(p_sound_id,'export_authorization',p_use,auth.uid());
 return jsonb_build_object('id',s.id,'title',s.title,'url',s.url,'duration_sec',s.duration_sec,'source',s.source,'max_excerpt_sec',s.max_excerpt_sec);
end $$;
revoke all on function public.authorize_music_audio_export(uuid,text) from public,anon,service_role;
grant execute on function public.authorize_music_audio_export(uuid,text) to authenticated;

alter function media_delivery.content_provenance(text,uuid,text,text,text,text) rename to content_provenance_before_catalogue;
create function media_delivery.content_provenance(p_kind text,p_id uuid,p_url text,p_bucket text,p_path text,p_owner text) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if p_bucket='music-audio' and p_path like 'catalogue/%' then return p_owner is null and exists(
  select 1 from music_library.catalogue_assets a join public.story_sounds s on s.id=a.sound_id
  where a.status='ready' and a.object_path=p_path and s.url=p_url and s.source='library'
  and ((p_kind='sound' and s.id=p_id)
   or (p_kind='post' and exists(select 1 from public.post_media m where m.post_id=p_id and m.edit#>>'{soundtrack,soundId}'=s.id::text))
   or (p_kind='story' and exists(select 1 from public.stories st where st.id=p_id and st.audio_sound_id=s.id))
   or (p_kind='memory_album' and (exists(select 1 from public.memory_albums b where b.id=p_id and b.soundtrack->>'soundId'=s.id::text)
    or exists(select 1 from public.memory_pages mp join public.memory_albums b on b.id=mp.album_id and b.user_id=mp.user_id join public.stories st on st.id=mp.story_id and st.user_id=b.user_id where b.id=p_id and st.audio_sound_id=s.id)))));
 end if;
 return media_delivery.content_provenance_before_catalogue(p_kind,p_id,p_url,p_bucket,p_path,p_owner);
end $$;
create or replace function public.resolve_media_delivery(p_token text,p_bucket text,p_path text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;ticket media_delivery.tickets;sound uuid;
begin
 result:=public.resolve_media_delivery_before_music_operations(p_token,p_bucket,p_path);
 if result is not null and p_bucket='music-audio' then
  select * into ticket from media_delivery.tickets where token_digest=extensions.digest(p_token,'sha256');
  select id into sound from (
   select sound_id as id from music_library.uploads where object_path=p_path and status='ready'
   union all select sound_id from music_library.catalogue_assets where object_path=p_path and status='ready'
  )a limit 1;
  if sound is not null then perform music_library.record_usage(sound,'delivery_authorization',case ticket.source_kind when 'post' then 'post' when 'memory_album' then 'memory_album' when 'story' then 'story' else 'preview' end,ticket.user_id,'delivery:'||encode(ticket.token_digest,'hex'));end if;
 end if;
 return result;
end $$;
create table music_library.catalogue_cleanup_jobs(
 track_id uuid primary key references music_library.catalogue_assets(track_id),
 state text not null check(state in ('pending','running','complete','review')),
 object_id uuid,object_version text,lease_token uuid,lease_until timestamptz,
 attempts integer not null default 0,next_attempt_at timestamptz not null default now(),
 last_error text check(last_error in ('storage_unavailable','object_changed')),
 created_at timestamptz not null default now(),completed_at timestamptz
);
alter table music_library.catalogue_cleanup_jobs enable row level security;
revoke all on music_library.catalogue_cleanup_jobs from public,anon,authenticated,service_role;
create trigger account_erasure_actor_write before insert or update or delete on music_library.catalogue_cleanup_jobs for each statement execute function account_erasure.guard_actor_write();
create function public.claim_catalogue_upload_cleanup(p_worker uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a music_library.catalogue_assets;j music_library.catalogue_cleanup_jobs;o storage.objects;
begin
 if p_worker is null then raise exception 'WORKER_REQUIRED';end if;
 if not exists(select 1 from music_library.maintenance_worker where singleton and enabled and last_seen_at>clock_timestamp()-interval '2 minutes') then return null;end if;
 select c.* into a from music_library.catalogue_assets c left join music_library.catalogue_cleanup_jobs pending on pending.track_id=c.track_id
 where c.sound_id is null and c.verified_duration is null and (
  (c.status='reserved' and c.last_attempt_at<clock_timestamp()-interval '48 hours' and pending.track_id is null)
  or(c.status='purging' and pending.state in ('pending','running') and pending.next_attempt_at<=clock_timestamp() and (pending.lease_until is null or pending.lease_until<clock_timestamp())))
 order by c.last_attempt_at,c.track_id for update of c skip locked limit 1;
 if not found then return null;end if;
 select * into o from storage.objects where bucket_id='music-audio' and name=a.object_path;
 insert into music_library.catalogue_cleanup_jobs(track_id,state,object_id,object_version)values(a.track_id,'pending',o.id,o.version)on conflict(track_id)do nothing;
 select * into j from music_library.catalogue_cleanup_jobs where track_id=a.track_id for update;
 update music_library.catalogue_assets set status='purging' where track_id=a.track_id;
 if o.id is not null and (o.owner_id is not null or o.owner is not null or o.version is null
  or(j.object_id is not null and(o.id is distinct from j.object_id or o.version is distinct from j.object_version)))then
  update music_library.catalogue_cleanup_jobs set state='review',last_error='object_changed',lease_token=null,lease_until=null where track_id=a.track_id;
  return jsonb_build_object('review',true);
 end if;
 update music_library.catalogue_cleanup_jobs set state='running',lease_token=p_worker,lease_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1,last_error=null where track_id=a.track_id;
 return jsonb_build_object('kind','catalogue','id',a.track_id,'providerId',a.provider_id,'sha256',a.sha256,'path',a.object_path,'objectId',j.object_id,'version',j.object_version,'leaseToken',p_worker);
end $$;
create function public.check_catalogue_upload_cleanup(p_track uuid,p_worker uuid) returns text language plpgsql security definer set search_path='' as $$
declare a music_library.catalogue_assets;j music_library.catalogue_cleanup_jobs;o storage.objects;
begin
 select * into a from music_library.catalogue_assets where track_id=p_track for update;
 select * into j from music_library.catalogue_cleanup_jobs where track_id=p_track for update;
 if a.track_id is null or a.status<>'purging' or a.sound_id is not null or a.verified_duration is not null
 or j.state is distinct from 'running' or j.lease_token is distinct from p_worker or j.lease_until<=clock_timestamp()then return 'denied';end if;
 select * into o from storage.objects where bucket_id='music-audio' and name=a.object_path;
 if not found then return 'absent';end if;
 if o.id is distinct from j.object_id or o.version is distinct from j.object_version or o.owner_id is not null or o.owner is not null then
  update music_library.catalogue_cleanup_jobs set state='review',last_error='object_changed',lease_token=null,lease_until=null where track_id=p_track;return 'review';
 end if;
 return 'delete';
end $$;
create function public.ack_catalogue_upload_cleanup(p_track uuid,p_worker uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if public.check_catalogue_upload_cleanup(p_track,p_worker) is distinct from 'absent' then return false;end if;
 update music_library.catalogue_assets set status='purged',purged_at=clock_timestamp()where track_id=p_track;
 update music_library.catalogue_cleanup_jobs set state='complete',completed_at=clock_timestamp(),lease_token=null,lease_until=null where track_id=p_track;
 insert into music_library.events(action,detail)values('catalogue.upload_purged',jsonb_build_object('trackId',p_track,'reservedBytesReleased',52428800));
 return true;
end $$;
create function public.fail_catalogue_upload_cleanup(p_track uuid,p_worker uuid)returns void language plpgsql security definer set search_path='' as $$
begin
 update music_library.catalogue_cleanup_jobs set state='pending',lease_token=null,lease_until=null,last_error='storage_unavailable',
 next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,30*(2^least(attempts,7))::integer))
 where track_id=p_track and state='running' and lease_token=p_worker and lease_until>clock_timestamp();
end $$;
revoke all on function public.claim_catalogue_upload_cleanup(uuid),public.check_catalogue_upload_cleanup(uuid,uuid),public.ack_catalogue_upload_cleanup(uuid,uuid),public.fail_catalogue_upload_cleanup(uuid,uuid)from public,anon,authenticated;
grant execute on function public.claim_catalogue_upload_cleanup(uuid),public.check_catalogue_upload_cleanup(uuid,uuid),public.ack_catalogue_upload_cleanup(uuid,uuid),public.fail_catalogue_upload_cleanup(uuid,uuid)to service_role;

create or replace function public.admin_music_operations_snapshot(p_actor uuid,p_session uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform music_library.require_admin(p_actor,p_session);
 return jsonb_build_object('version',2,'catalogEnabled',coalesce((select playback_enabled from music_library.catalogue_service where singleton),false),
 'catalogueService',(select jsonb_build_object('ingestionEnabled',ingestion_enabled,'playbackEnabled',playback_enabled)from music_library.catalogue_service where singleton),
 'maintenance',(select jsonb_build_object('enabled',enabled,'lastSeenAt',last_seen_at)from music_library.maintenance_worker where singleton),
 'cleanup',jsonb_build_object('pending',(select count(*)from music_library.cleanup_jobs where state in('pending','running')),'review',(select count(*)from music_library.cleanup_jobs where state='review'),'complete',(select count(*)from music_library.cleanup_jobs where state='complete')),
 'catalogueCleanup',jsonb_build_object('pending',(select count(*)from music_library.catalogue_cleanup_jobs where state in('pending','running')),'review',(select count(*)from music_library.catalogue_cleanup_jobs where state='review'),'complete',(select count(*)from music_library.catalogue_cleanup_jobs where state='complete')),
 'catalogueTotal',(select count(*)from music_library.catalogue_tracks),
 'catalogue',coalesce((select jsonb_agg(to_jsonb(t))from(
  select c.id,c.provider_id,c.provider_track_id,c.revision,c.title,c.artist,c.isrc,c.duration_sec,
   case when g.revoked_at is not null then 'revoked' when g.id is null then 'awaiting_license' when g.starts_at>clock_timestamp()then 'not_started' when g.ends_at<=clock_timestamp()then 'expired' else 'grant_recorded' end as status,
   coalesce(g.reference,l.reference)as license_reference,coalesce(a.status,'not_uploaded')as asset_status,g.export_allowed,g.starts_at,g.ends_at
  from music_library.catalogue_tracks c left join music_library.license_drafts l on l.id=c.license_draft_id
  left join music_library.catalogue_grants g on g.id=c.grant_id left join music_library.catalogue_assets a on a.track_id=c.id
  order by c.created_at desc,c.id limit 100)t),'[]'));
end $$;

revoke all on all functions in schema music_library from public,anon,authenticated,service_role;
revoke all on function media_delivery.content_provenance(text,uuid,text,text,text,text),media_delivery.content_provenance_before_catalogue(text,uuid,text,text,text,text) from public,anon,authenticated,service_role;
commit;
