-- Restored, unshipped media release. A playback catalogue is not a reuse licence.
-- No commercial rights or allowed import origins are enabled by this migration.
alter table public.story_sounds
 add column if not exists artist text,
 add column if not exists catalog_provider text not null default 'platinum',
 add column if not exists provider_track_id text,
 add column if not exists license_ref text,
 add column if not exists licensor text,
 add column if not exists permitted_uses text[] not null default array['story','post','memory_album'],
 add column if not exists territories text[] not null default array['*'],
 add column if not exists rights_start timestamptz,
 add column if not exists rights_end timestamptz,
 add column if not exists revoked_at timestamptz,
 add column if not exists max_excerpt_sec integer not null default 30,
 add column if not exists asset_sha256 text;
alter table public.story_sounds add constraint sound_excerpt_bounds check(max_excerpt_sec between 1 and 600);
alter table public.story_sounds add constraint sound_rights_window check(rights_end is null or rights_start is null or rights_end>rights_start);
alter table public.story_sounds add constraint sound_permitted_uses check(permitted_uses <@ array['story','post','memory_album','advertisement']::text[] and cardinality(permitted_uses)>0 and array_position(permitted_uses,null) is null);
alter table public.story_sounds add constraint sound_territories check(cardinality(territories)>0 and array_position(territories,null) is null and array_to_string(territories,',') ~ '^(\*|[A-Z]{2})(,(\*|[A-Z]{2}))*$');
alter table public.story_sounds add constraint sound_asset_digest check(asset_sha256 is null or asset_sha256 ~ '^[a-f0-9]{64}$');
revoke insert, update, delete on public.story_sounds from public, anon, authenticated;
create unique index if not exists story_sound_catalog_identity on public.story_sounds(catalog_provider,provider_track_id) where provider_track_id is not null;
create index if not exists story_sound_asset_lookup on public.story_sounds(url);

create table public.music_asset_origins(origin text primary key check(origin ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$'));
alter table public.music_asset_origins enable row level security;
revoke all on public.music_asset_origins from public,anon,authenticated;
grant select,insert,update,delete on public.music_asset_origins to service_role;
create policy music_asset_origins_service on public.music_asset_origins to service_role using(true) with check(true);

create or replace function public.sound_asset_origin_allowed(p_url text)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(p_url ~ '^https://[^/]+/storage/v1/object/public/story-media/[^?#]+$'
 and split_part(p_url,'/story-media/',2) !~ '(%|\\|(^|/)\.\.?(/|$)|//)'
 and (
  (split_part(p_url,'/storage/v1/object/public/',1)=regexp_replace(auth.jwt()->>'iss','/auth/v1/?$','')
   and coalesce(auth.jwt()->>'iss','') ~ '^https://[^/]+/auth/v1/?$')
  or exists(select 1 from public.music_asset_origins where origin=split_part(p_url,'/storage/v1/object/public/',1))
 ),false);
$$;
revoke all on function public.sound_asset_origin_allowed(text) from public,anon,authenticated;

-- The URL is a versioned asset identity. Rights revocation must continue to
-- cover media already attached to published content, including retained books.
create or replace function public.keep_sound_asset_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if new.url is distinct from old.url then raise exception 'SOUND_ASSET_IMMUTABLE_PUBLISH_NEW_VERSION'; end if;
 return new;
end $$;
revoke all on function public.keep_sound_asset_immutable() from public,anon,authenticated;
create trigger sound_asset_immutable before update of url on public.story_sounds for each row execute function public.keep_sound_asset_immutable();

create or replace function public.sound_rights_allow(p_sound_id uuid,p_use text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare sound public.story_sounds; verified_until timestamptz;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
 or not exists(select 1 from public.profiles where id=auth.uid() and deactivated_at is null) then return false; end if;
 select * into sound from public.story_sounds where id=p_sound_id;
 if not found or not public.sound_asset_origin_allowed(sound.url)
 or p_use is null or not (p_use=any(sound.permitted_uses)) or sound.revoked_at is not null
 or (sound.rights_start is not null and sound.rights_start>now()) or (sound.rights_end is not null and sound.rights_end<=now())
 or sound.duration_sec is null or sound.duration_sec<1
 or not (sound.rights_status='creator_attested' or (sound.rights_status='licensed'
  and nullif(trim(sound.license_ref),'') is not null and nullif(trim(sound.licensor),'') is not null and sound.asset_sha256 is not null))
 or not exists(select 1 from public.profiles where id=sound.owner_id and deactivated_at is null)
 or exists(select 1 from public.blocked_users b where (b.blocker_id=auth.uid() and b.blocked_id=sound.owner_id) or (b.blocker_id=sound.owner_id and b.blocked_id=auth.uid())) then return false; end if;
 if not ('*'=any(sound.territories)) then
  -- app_metadata is server-managed. User-editable profile/user_metadata and
  -- arbitrary client country headers are not territorial authorization.
  if not coalesce(upper(auth.jwt()#>>'{app_metadata,music_territory}')=any(sound.territories),false) then return false; end if;
  begin verified_until:=(auth.jwt()#>>'{app_metadata,music_territory_verified_until}')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then return false; end;
  if verified_until is null or verified_until<=now() then return false; end if;
 end if;
 return true;
end $$;
revoke all on function public.sound_rights_allow(uuid,text) from public,anon;
grant execute on function public.sound_rights_allow(uuid,text) to authenticated;

drop policy if exists story_sounds_select on public.story_sounds;
create policy story_sounds_select on public.story_sounds for select to authenticated using(
 owner_id=(select auth.uid()) or public.sound_rights_allow(id,'story') or public.sound_rights_allow(id,'post') or public.sound_rights_allow(id,'memory_album')
);
create or replace function public.list_playable_sounds(p_use text default 'story',p_query text default '',p_limit integer default 40)
returns table(id uuid,title text,artist text,url text,duration_sec integer,source text,max_excerpt_sec integer)
language sql stable security definer set search_path='' as $$
 select s.id,s.title,s.artist,s.url,s.duration_sec,s.source,s.max_excerpt_sec from public.story_sounds s
 where public.sound_rights_allow(s.id,p_use)
 and (trim(coalesce(p_query,''))='' or position(lower(left(trim(p_query),100)) in lower(concat_ws(' ',s.title,s.artist)))>0)
 order by s.use_count desc nulls last,s.id limit greatest(1,least(coalesce(p_limit,40),100));
$$;
create or replace function public.get_playable_sound(p_sound_id uuid,p_use text default 'story')
returns table(id uuid,title text,artist text,url text,duration_sec integer,source text,max_excerpt_sec integer)
language sql stable security definer set search_path='' as $$
 select s.id,s.title,s.artist,s.url,s.duration_sec,s.source,s.max_excerpt_sec from public.story_sounds s where s.id=p_sound_id and public.sound_rights_allow(s.id,p_use);
$$;
revoke all on function public.list_playable_sounds(text,text,integer),public.get_playable_sound(uuid,text) from public,anon;
grant execute on function public.list_playable_sounds(text,text,integer),public.get_playable_sound(uuid,text) to authenticated;

create or replace function public.validate_soundtrack(p_selection jsonb,p_use text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare track public.story_sounds; start_sec numeric; duration numeric; volume numeric; original_volume numeric;
begin
 if p_selection is null or p_selection='null'::jsonb then return null; end if;
 if jsonb_typeof(p_selection)<>'object' then raise exception 'INVALID_SOUNDTRACK'; end if;
 select * into track from public.story_sounds where id=(p_selection->>'soundId')::uuid;
 if not found or not public.sound_rights_allow(track.id,p_use) then raise exception 'SOUND_UNAVAILABLE' using errcode='42501'; end if;
 start_sec:=coalesce((p_selection->>'startSec')::numeric,0);
 duration:=coalesce((p_selection->>'durationSec')::numeric,least(track.duration_sec,track.max_excerpt_sec));
 volume:=coalesce((p_selection->>'volume')::numeric,0.7);
 original_volume:=coalesce((p_selection->>'originalVolume')::numeric,1);
 if start_sec<0 or duration<1 or duration>track.max_excerpt_sec or start_sec+duration>track.duration_sec
 or volume not between 0 and 1 or original_volume not between 0 and 1
 or start_sec::text in ('NaN','Infinity','-Infinity') or duration::text in ('NaN','Infinity','-Infinity')
 or volume::text in ('NaN','Infinity','-Infinity') or original_volume::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_SOUNDTRACK_RANGE' using errcode='22023'; end if;
 return jsonb_build_object('soundId',track.id,'startSec',start_sec,'durationSec',duration,'volume',volume,'originalVolume',original_volume);
end $$;
revoke all on function public.validate_soundtrack(jsonb,text) from public,anon;
grant execute on function public.validate_soundtrack(jsonb,text) to authenticated;

create or replace function public.check_post_soundtrack() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('post-soundtrack:'||new.post_id::text,0));
 if new.edit ? 'soundtrack' then
  if new.sort_order is distinct from 0 then raise exception 'SOUNDTRACK_BELONGS_ON_FIRST_SLIDE'; end if;
  if new.edit->'soundtrack'<>'null'::jsonb and exists(select 1 from public.promoted_posts where post_id=new.post_id) then raise exception 'PAID_SOUNDTRACK_NOT_ENABLED'; end if;
  new.edit:=jsonb_set(new.edit,'{soundtrack}',coalesce(public.validate_soundtrack(new.edit->'soundtrack','post'),'null'::jsonb));
 end if;
 return new;
end $$;
revoke all on function public.check_post_soundtrack() from public,anon,authenticated;
create trigger validate_post_soundtrack before insert or update of edit,sort_order,post_id on public.post_media for each row execute function public.check_post_soundtrack();
create or replace function public.check_paid_soundtrack() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('post-soundtrack:'||new.post_id::text,0));
 if exists(select 1 from public.post_media where post_id=new.post_id and edit->'soundtrack' is not null and edit->'soundtrack'<>'null'::jsonb) then raise exception 'PAID_SOUNDTRACK_NOT_ENABLED'; end if;
 return new;
end $$;
revoke all on function public.check_paid_soundtrack() from public,anon,authenticated;
create trigger guard_paid_soundtrack before insert or update of post_id on public.promoted_posts for each row execute function public.check_paid_soundtrack();

alter table public.stories add column if not exists audio_sound_id uuid references public.story_sounds(id) on delete set null;
update public.stories s set audio_sound_id=(select min(a.id::text)::uuid from public.story_sounds a where a.url=s.audio_url) where s.audio_sound_id is null and exists(select 1 from public.story_sounds a where a.url=s.audio_url);
create or replace function public.check_story_sound_rights() returns trigger language plpgsql security definer set search_path='' as $$
declare sound_id uuid; excerpt_duration integer;
begin
 if new.audio_url is null then new.audio_sound_id:=null; return new; end if;
 if not public.sound_asset_origin_allowed(new.audio_url) then raise exception 'AUDIO_FIRST_PARTY_ORIGIN_REQUIRED' using errcode='42501'; end if;
 select id,least(duration_sec,max_excerpt_sec,30) into sound_id,excerpt_duration from public.story_sounds where url=new.audio_url order by id limit 1;
 if sound_id is not null then
  if not public.sound_rights_allow(sound_id,'story') then raise exception 'SOUND_UNAVAILABLE' using errcode='42501'; end if;
  new.audio_sound_id:=sound_id;
  new.audio_duration_sec:=excerpt_duration;
 elsif new.audio_sound_id is not null then raise exception 'SOUND_ASSET_MISMATCH';
 end if;
 return new;
end $$;
revoke all on function public.check_story_sound_rights() from public,anon,authenticated;
create trigger validate_story_sound_rights before insert or update of audio_url,audio_sound_id on public.stories for each row execute function public.check_story_sound_rights();

-- Recheck content rights before issuing media capabilities, including retained
-- story/book pages. Already issued short-lived URLs keep their existing expiry.
alter function public.content_media_manifest(jsonb) rename to content_media_manifest_before_sound_rights;
revoke all on function public.content_media_manifest_before_sound_rights(jsonb) from public,anon,authenticated;
create or replace function public.content_media_manifest(p_references jsonb)
returns table(entity_kind text,entity_id uuid,media_url text)
language plpgsql stable security definer set search_path='' as $$
declare r record; use_kind text;
begin
 for r in select * from public.content_media_manifest_before_sound_rights(p_references) loop
  use_kind:=case r.entity_kind when 'post' then 'post' when 'memory_album' then 'memory_album' else 'story' end;
  if exists(select 1 from public.story_sounds s where s.url=r.media_url and not (
   public.sound_rights_allow(s.id,use_kind) or (r.entity_kind='sound' and (public.sound_rights_allow(s.id,'post') or public.sound_rights_allow(s.id,'memory_album')))
  )) then continue; end if;
  entity_kind:=r.entity_kind;entity_id:=r.entity_id;media_url:=r.media_url;return next;
 end loop;
end $$;
revoke all on function public.content_media_manifest(jsonb) from public,anon;
grant execute on function public.content_media_manifest(jsonb) to authenticated;

create table public.music_rights_events(
 id bigint generated always as identity primary key,sound_id uuid not null,changed_at timestamptz not null default now(),
 actor_id uuid,previous_rights jsonb,new_rights jsonb
);
alter table public.music_rights_events enable row level security;
revoke all on public.music_rights_events from public,anon,authenticated;
create function public.audit_music_rights() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.music_rights_events(sound_id,actor_id,previous_rights,new_rights) values(new.id,auth.uid(),
 case when tg_op='UPDATE' then jsonb_build_object('status',old.rights_status,'license',old.license_ref,'revoked',old.revoked_at,'uses',old.permitted_uses,'territories',old.territories,'start',old.rights_start,'end',old.rights_end,'sha256',old.asset_sha256) end,
 jsonb_build_object('status',new.rights_status,'license',new.license_ref,'revoked',new.revoked_at,'uses',new.permitted_uses,'territories',new.territories,'start',new.rights_start,'end',new.rights_end,'sha256',new.asset_sha256));
 return new;
end $$;
revoke all on function public.audit_music_rights() from public,anon,authenticated;
create trigger record_music_rights after insert or update of rights_status,license_ref,licensor,revoked_at,permitted_uses,territories,rights_start,rights_end,asset_sha256 on public.story_sounds for each row execute function public.audit_music_rights();

-- A trusted ingestion service verifies and uploads an actual cleared asset,
-- then records the agreement here. Apple/Spotify playback URLs are rejected.
create or replace function public.ingest_licensed_sound(p_owner uuid,p_track jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid; asset text; location text[];
begin
 if jsonb_typeof(p_track) is distinct from 'object' or p_owner is null
 or nullif(trim(p_track->>'provider'),'') is null or nullif(trim(p_track->>'providerTrackId'),'') is null
 or nullif(trim(p_track->>'licenseRef'),'') is null or nullif(trim(p_track->>'licensor'),'') is null
 or nullif(trim(p_track->>'title'),'') is null or coalesce(p_track->>'sha256','') !~ '^[a-f0-9]{64}$'
 or coalesce((p_track->>'durationSec')::integer,0) not between 1 and 86400
 or jsonb_typeof(p_track->'uses') is distinct from 'array' or jsonb_typeof(p_track->'territories') is distinct from 'array'
 or jsonb_array_length(p_track->'uses')=0 or jsonb_array_length(p_track->'territories')=0 then raise exception 'COMPLETE_LICENSE_METADATA_REQUIRED'; end if;
 asset:=p_track->>'url';location:=regexp_match(asset,'^https://[^/]+/storage/v1/object/public/(story-media)/([^?#]+)$');
 if location is null or not exists(select 1 from public.music_asset_origins where origin=split_part(asset,'/storage/v1/object/public/',1)) or location[2] ~ '(%|\\|(^|/)\.\.?(/|$)|//)' or not exists(select 1 from storage.objects where bucket_id=location[1] and name=location[2] and coalesce(owner_id,owner::text)=p_owner::text) then raise exception 'CLEARED_FIRST_PARTY_ASSET_REQUIRED'; end if;
 insert into public.story_sounds(owner_id,title,artist,url,duration_sec,source,rights_status,catalog_provider,provider_track_id,license_ref,licensor,permitted_uses,territories,rights_start,rights_end,max_excerpt_sec,asset_sha256)
 values(p_owner,left(p_track->>'title',200),left(p_track->>'artist',200),asset,(p_track->>'durationSec')::integer,'library','licensed',p_track->>'provider',p_track->>'providerTrackId',p_track->>'licenseRef',p_track->>'licensor',
 array(select jsonb_array_elements_text(p_track->'uses')),array(select upper(jsonb_array_elements_text(p_track->'territories'))),(p_track->>'startsAt')::timestamptz,(p_track->>'endsAt')::timestamptz,coalesce((p_track->>'maxExcerptSec')::integer,30),p_track->>'sha256')
 on conflict(catalog_provider,provider_track_id) where provider_track_id is not null do update set title=excluded.title,artist=excluded.artist,url=excluded.url,duration_sec=excluded.duration_sec,rights_status='licensed',license_ref=excluded.license_ref,licensor=excluded.licensor,permitted_uses=excluded.permitted_uses,territories=excluded.territories,rights_start=excluded.rights_start,rights_end=excluded.rights_end,max_excerpt_sec=excluded.max_excerpt_sec,asset_sha256=excluded.asset_sha256,revoked_at=null
 returning id into sid;
 return sid;
end $$;
revoke all on function public.ingest_licensed_sound(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_licensed_sound(uuid,jsonb) to service_role;
