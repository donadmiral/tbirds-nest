-- Original audio is independent of commercial catalogue licensing. No catalogue
-- provider or licence is activated by this migration. Canonical URLs are object
-- identifiers in a PRIVATE bucket, never public playback endpoints.
begin;
set local lock_timeout='3s';
do $preflight$ begin
 if to_regprocedure('media_delivery.require_session()') is null
 or to_regprocedure('account_erasure.assert_writable(uuid)') is null
 or to_regprocedure('account_erasure.guard_actor_write()') is null
 or to_regprocedure('account_erasure.review_reason(uuid)') is null then
  raise exception 'MUSIC_PREREQUISITES_REQUIRED: install verified bounded media delivery and account erasure first';
 end if;
end $preflight$;

-- Production deliberately omitted the former music release. Install its reviewed
-- rights primitives only when absent; QA already carries these contracts.
do $bootstrap$ begin
 if to_regprocedure('public.publish_story_sound(uuid,boolean)') is null then
  execute $music_dependency$
-- An Apple Music catalog entitlement is not a soundtrack/reuse license.
-- Existing sounds need review; this migration grants no rights retroactively.
alter table public.story_sounds
  add column if not exists rights_status text not null default 'unverified'
    check (rights_status in ('unverified', 'creator_attested', 'licensed', 'blocked')),
  add column if not exists rights_attested_at timestamptz,
  add column if not exists origin_story_id uuid references public.stories(id) on delete set null;
create unique index if not exists story_sounds_origin_story_unique on public.story_sounds(origin_story_id) where origin_story_id is not null;
create index if not exists story_sounds_available_popularity on public.story_sounds(source, use_count desc, id)
  where rights_status in ('creator_attested', 'licensed');

drop policy if exists story_sounds_select on public.story_sounds;
create policy story_sounds_select on public.story_sounds for select to authenticated
  using (rights_status in ('creator_attested', 'licensed') or owner_id = (select auth.uid()));
-- Only this RPC may create creator-attested sounds, from a published owned voiceover.
drop policy if exists story_sounds_insert on public.story_sounds;
revoke insert, update on public.story_sounds from anon, authenticated;

create or replace function public.publish_story_sound(p_story_id uuid, p_rights_attested boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_story public.stories; v_sound_id uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Sign in to share an original sound' using errcode = '42501';
  end if;
  if p_rights_attested is distinct from true then
    raise exception 'Confirm that you own and can license this original sound' using errcode = '22023';
  end if;
  select * into v_story from public.stories where id = p_story_id;
  if not found or not public.can_act_as(v_story.user_id) then
    raise exception 'You cannot share sound from this story' using errcode = '42501';
  end if;
  if v_story.audio_source is distinct from 'voiceover' or v_story.audio_url is null
     or v_story.audio_duration_sec is null or v_story.audio_duration_sec not between 1 and 30 then
    raise exception 'Record an original voiceover of 1 to 30 seconds first' using errcode = '22023';
  end if;
  insert into public.story_sounds(owner_id, title, url, duration_sec, source, rights_status, rights_attested_at, origin_story_id)
    values (auth.uid(), coalesce(nullif(left(v_story.audio_title, 200), ''), 'Original sound'), v_story.audio_url,
      v_story.audio_duration_sec, 'original', 'creator_attested', now(), p_story_id)
    on conflict (origin_story_id) where origin_story_id is not null do nothing returning id into v_sound_id;
  if v_sound_id is null then select id into v_sound_id from public.story_sounds where origin_story_id = p_story_id; end if;
  return v_sound_id;
end $$;
revoke all on function public.publish_story_sound(uuid, boolean) from public, anon;
grant execute on function public.publish_story_sound(uuid, boolean) to authenticated;

comment on function public.publish_story_sound(uuid, boolean) is 'Records creator ownership/reuse attestation once per published story. Does not certify third-party rights.';

$music_dependency$;
 end if;
 if to_regprocedure('public.sound_rights_allow(uuid,text)') is null then
  execute $music_dependency$
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

$music_dependency$;
 end if;
end $bootstrap$;
alter table public.memory_albums add column if not exists soundtrack jsonb;

create schema music_library;
revoke all on schema music_library from public,anon,authenticated,service_role;
create table music_library.uploads(
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 object_path text not null unique, origin text not null, title text not null check(length(title) between 1 and 200),
 mime text not null check(mime in ('audio/wav','audio/mpeg','audio/mp4')),
 byte_size integer not null check(byte_size between 44 and 52428800),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 reuse_allowed boolean not null default false, rights_attested_at timestamptz not null,
 sound_id uuid unique references public.story_sounds(id) on delete cascade,
 object_id uuid, object_version text, verified_duration numeric,
 status text not null default 'reserved' check(status in ('reserved','ready','revoked')),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '24 hours',
 check(status<>'ready' or (sound_id is not null and object_id is not null and object_version is not null and verified_duration between 1 and 600))
);
create index music_upload_owner on music_library.uploads(owner_id,created_at desc);
create table music_library.favorites(
 user_id uuid not null references auth.users(id) on delete cascade,
 sound_id uuid not null references public.story_sounds(id) on delete cascade,
 created_at timestamptz not null default now(), primary key(user_id,sound_id)
);
create table music_library.providers(
 id text primary key check(id ~ '^[a-z0-9_-]{1,60}$'), name text not null check(length(name) between 1 and 150),
 status text not null default 'awaiting_license' check(status in ('awaiting_license','suspended')),
 contact_ref text, notes text, updated_at timestamptz not null default now()
);
create table music_library.license_drafts(
 id uuid primary key default gen_random_uuid(), provider_id text not null references music_library.providers(id),
 reference text not null check(length(reference) between 1 and 200), unique(provider_id,reference), licensor text not null check(length(licensor) between 1 and 200),
 territories text[] not null, permitted_uses text[] not null, export_allowed boolean not null default false,
 starts_at timestamptz, ends_at timestamptz, evidence_ref text, status text not null default 'awaiting_license' check(status in ('awaiting_license','rejected')),
 created_by uuid not null, created_at timestamptz not null default now(),
 check(ends_at is null or starts_at is null or ends_at>starts_at),
 check(cardinality(territories)>0 and array_position(territories,null) is null and array_to_string(territories,',') ~ '^(\*|[A-Z]{2})(,(\*|[A-Z]{2}))*$'),
 check(cardinality(permitted_uses)>0 and array_position(permitted_uses,null) is null and permitted_uses <@ array['story','post','memory_album','advertisement']::text[])
);
create table music_library.events(
 id bigint generated always as identity primary key, actor_id uuid references auth.users(id) on delete set null, sound_id uuid references public.story_sounds(id) on delete set null, action text not null,
 detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create table music_library.service_state(singleton boolean primary key default true check(singleton), uploads_enabled boolean not null default false, updated_at timestamptz not null default now());
insert into music_library.service_state(singleton) values(true);
alter table music_library.service_state enable row level security;
alter table music_library.uploads enable row level security;
alter table music_library.favorites enable row level security;
alter table music_library.providers enable row level security;
alter table music_library.license_drafts enable row level security;
alter table music_library.events enable row level security;
revoke all on all tables in schema music_library from public,anon,authenticated,service_role;
do $write_fences$ declare t text;begin
 foreach t in array array['uploads','favorites','providers','license_drafts','events','service_state'] loop
  execute format('create trigger account_erasure_actor_write before insert or update or delete on music_library.%I for each statement execute function account_erasure.guard_actor_write()',t);
 end loop;
end $write_fences$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('music-audio','music-audio',false,52428800,array['audio/wav','audio/mpeg','audio/mp4'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create function music_library.require_user() returns uuid language plpgsql stable security definer set search_path='' as $$
declare business_allowed boolean;
begin
 perform media_delivery.require_session();
 if not exists(select 1 from public.profiles where id=auth.uid() and deactivated_at is null) then raise exception 'ACTIVE_ACCOUNT_REQUIRED' using errcode='42501'; end if;
 if to_regprocedure('public.business_session_allowed()') is not null then
  execute 'select public.business_session_allowed()' into business_allowed;
  if business_allowed is distinct from true then raise exception 'BUSINESS_SESSION_REQUIRED' using errcode='42501';end if;
 elsif exists(select 1 from public.profiles where id=auth.uid() and account_type='business') then
  raise exception 'BUSINESS_SESSION_REQUIRED' using errcode='42501';
 end if;
 return auth.uid();
end $$;
-- Schema installation alone does not enable a worker-dependent upload flow.
-- Operations enables this only after the exact finalizer is deployed and checked.
create function public.get_original_audio_capabilities() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform music_library.require_user();
 return jsonb_build_object('version',1,'uploadsEnabled',(select uploads_enabled from music_library.service_state where singleton),
  'catalogEnabled',false,'maxBytes',52428800,'maxDurationSec',600,'recordingDurationSec',30,'mimeTypes',jsonb_build_array('audio/wav','audio/mpeg','audio/mp4'));
end $$;
revoke all on function public.get_original_audio_capabilities() from public,anon;
grant execute on function public.get_original_audio_capabilities() to authenticated;
create function public.set_original_audio_service_ready(p_ready boolean,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_ready is null or nullif(trim(p_reason),'') is null or length(p_reason) not between 5 and 1000 then raise exception 'SERVICE_READINESS_REASON_REQUIRED';end if;
 update music_library.service_state set uploads_enabled=p_ready,updated_at=now() where singleton;
 insert into music_library.events(action,detail) values('service.readiness',jsonb_build_object('ready',p_ready,'reason',p_reason));
end $$;
revoke all on function public.set_original_audio_service_ready(boolean,text) from public,anon,authenticated;
grant execute on function public.set_original_audio_service_ready(boolean,text) to service_role;
create function public.music_upload_permitted(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from music_library.uploads where object_path=p_path and owner_id=music_library.require_user()
  and status='reserved' and expires_at>now() and (select uploads_enabled from music_library.service_state where singleton));
$$;
revoke all on function public.music_upload_permitted(text) from public,anon;
grant execute on function public.music_upload_permitted(text) to authenticated;
create policy music_audio_reserved_insert on storage.objects for insert to authenticated
 with check(bucket_id='music-audio' and coalesce(owner_id,owner::text)=auth.uid()::text and public.music_upload_permitted(name));
-- Restrictive guards also constrain any pre-existing generic storage policy.
create policy music_audio_no_direct_read on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'music-audio');
create policy music_audio_no_overwrite on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'music-audio') with check(bucket_id<>'music-audio');
create policy music_audio_no_direct_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'music-audio');
create policy music_audio_insert_guard on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'music-audio' or public.music_upload_permitted(name));

create function public.reserve_original_audio(p_request_id uuid,p_expected_user uuid,p_title text,p_mime text,p_bytes integer,p_sha256 text,p_reuse boolean,p_rights_attested boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=music_library.require_user(); existing music_library.uploads; origin text; ext text;
begin
 if not (select uploads_enabled from music_library.service_state where singleton) then raise exception 'ORIGINAL_AUDIO_SERVICE_NOT_READY' using errcode='55000';end if;
 if u is distinct from p_expected_user or p_request_id is null then raise exception 'ACCOUNT_CHANGED' using errcode='42501'; end if;
 if p_rights_attested is distinct from true then raise exception 'AUDIO_RIGHTS_REQUIRED' using errcode='22023'; end if;
 if p_bytes is null or p_bytes not between 44 and 52428800 or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$'
 or p_mime is null or p_mime not in ('audio/wav','audio/mpeg','audio/mp4') or nullif(trim(p_title),'') is null or length(p_title)>200 then raise exception 'INVALID_AUDIO_UPLOAD';end if;
 perform pg_advisory_xact_lock(hashtextextended('music-upload:'||u::text,0));
 select * into existing from music_library.uploads where id=p_request_id;
 if found then
  if existing.owner_id<>u or existing.sha256<>p_sha256 or existing.byte_size<>p_bytes or existing.mime<>p_mime or existing.reuse_allowed<>coalesce(p_reuse,false) then raise exception 'AUDIO_UPLOAD_CONFLICT';end if;
  if existing.status='revoked' then raise exception 'AUDIO_REVOKED';end if;
  if existing.status='reserved' then update music_library.uploads set expires_at=now()+interval '24 hours' where id=p_request_id returning * into existing;end if;
  return jsonb_build_object('id',existing.id,'path',existing.object_path,'status',existing.status,'soundId',existing.sound_id);
 end if;
 -- Retained capacity does not reset with the rolling rate limit. Until byte
 -- verification succeeds, every path can hold the bucket's full 50 MiB, even
 -- when the client declares fewer bytes. Expiry and revocation delete no bytes.
 if (select count(*) from music_library.uploads where owner_id=u)>=1000
 or (select coalesce(sum(case
      when status in ('ready','revoked') and object_id is not null
       and object_version is not null and verified_duration between 1 and 600
      then byte_size else 52428800 end),0)
     from music_library.uploads where owner_id=u)+52428800>1073741824
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
create function public.get_original_audio_upload(p_request_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=music_library.require_user();r music_library.uploads;
begin
 select * into r from music_library.uploads where id=p_request_id and owner_id=u and status<>'revoked' and (status='ready' or expires_at>now());
 if not found then return null;end if;
 return jsonb_build_object('id',r.id,'ownerId',r.owner_id,'path',r.object_path,'mime',r.mime,'bytes',r.byte_size,'sha256',r.sha256,'status',r.status,'soundId',r.sound_id,'objectVersion',(select o.version from storage.objects o where o.bucket_id='music-audio' and o.name=r.object_path and coalesce(o.owner_id,o.owner::text)=u::text and (o.metadata->>'size')::bigint=r.byte_size));
end $$;
create function public.finish_original_audio_upload(p_request_id uuid,p_owner uuid,p_duration numeric,p_sha256 text,p_object_version text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r music_library.uploads;o storage.objects; sid uuid;
begin
 perform account_erasure.assert_writable(p_owner);
 select * into r from music_library.uploads where id=p_request_id and owner_id=p_owner for update;
 if not found or r.status='revoked' or (r.status='reserved' and r.expires_at<=now()) then raise exception 'AUDIO_UPLOAD_EXPIRED';end if;
 if r.status='ready' then return r.sound_id;end if;
 if p_duration is null or p_duration not between 1 and 600 or p_duration::text in ('NaN','Infinity','-Infinity') or p_sha256 is distinct from r.sha256 then raise exception 'AUDIO_VALIDATION_FAILED';end if;
 select * into o from storage.objects where bucket_id='music-audio' and name=r.object_path and coalesce(owner_id,owner::text)=p_owner::text;
 if not found or o.version is null or o.version is distinct from p_object_version or (o.metadata->>'size')::bigint is distinct from r.byte_size::bigint then raise exception 'AUDIO_OBJECT_CHANGED';end if;
 if not exists(select 1 from public.profiles where id=p_owner and deactivated_at is null) then raise exception 'ACTIVE_ACCOUNT_REQUIRED';end if;
 insert into public.story_sounds(owner_id,title,url,duration_sec,source,rights_status,rights_attested_at,asset_sha256,max_excerpt_sec,permitted_uses)
 values(p_owner,r.title,r.origin||'/storage/v1/object/public/music-audio/'||r.object_path,floor(p_duration)::integer,'original','creator_attested',r.rights_attested_at,p_sha256,least(600,floor(p_duration)::integer),array['story','post','memory_album']) returning id into sid;
 update music_library.uploads set status='ready',sound_id=sid,object_id=o.id,object_version=o.version,verified_duration=p_duration where id=p_request_id;
 insert into music_library.events(actor_id,sound_id,action,detail) values(p_owner,sid,'original.verified',jsonb_build_object('bytes',r.byte_size,'duration',p_duration,'reuse',r.reuse_allowed));
 return sid;
end $$;
revoke all on function public.reserve_original_audio(uuid,uuid,text,text,integer,text,boolean,boolean),public.get_original_audio_upload(uuid),public.finish_original_audio_upload(uuid,uuid,numeric,text,text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_original_audio(uuid,uuid,text,text,integer,text,boolean,boolean),public.get_original_audio_upload(uuid) to authenticated;
grant execute on function public.finish_original_audio_upload(uuid,uuid,numeric,text,text) to service_role;

-- Keep the previous catalogue checks, with a separate release gate. Licence
-- drafting cannot activate music; activation requires the later licensing work.
alter function public.sound_rights_allow(uuid,text) rename to sound_rights_allow_before_original_library;
revoke all on function public.sound_rights_allow_before_original_library(uuid,text) from public,anon,authenticated,service_role;
create or replace function public.sound_asset_origin_allowed(p_url text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from music_library.uploads u join storage.objects o on o.id=u.object_id and o.version=u.object_version
  and o.bucket_id='music-audio' and o.name=u.object_path and coalesce(o.owner_id,o.owner::text)=u.owner_id::text
  where u.status='ready' and p_url=u.origin||'/storage/v1/object/public/music-audio/'||u.object_path)
 or coalesce(p_url ~ '^https://[^/]+/storage/v1/object/public/story-media/[^?#]+$'
 and split_part(p_url,'/story-media/',2) !~ '(%|\\|(^|/)\.\.?(/|$)|//)'
 and (split_part(p_url,'/storage/v1/object/public/',1)=regexp_replace(auth.jwt()->>'iss','/auth/v1/?$','')
  or exists(select 1 from public.music_asset_origins where origin=split_part(p_url,'/storage/v1/object/public/',1))),false);
$$;
create function music_library.reusable(p_sound uuid,p_use text) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 perform music_library.require_user();
 return exists(select 1 from public.story_sounds s where s.id=p_sound and s.rights_status='creator_attested'
 and public.sound_rights_allow_before_original_library(s.id,p_use)
 and exists(select 1 from music_library.uploads u where u.sound_id=s.id and u.status='ready' and (u.owner_id=auth.uid() or u.reuse_allowed)));
end $$;
create function public.sound_rights_allow(p_sound_id uuid,p_use text) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 perform music_library.require_user();
 if music_library.reusable(p_sound_id,p_use) then return true;end if;
 -- A private original is playable only through a content audience that can see
 -- it. This does not give that viewer permission to attach it to new content.
 if not exists(select 1 from music_library.uploads where sound_id=p_sound_id and status='ready')
 or not public.sound_rights_allow_before_original_library(p_sound_id,p_use) then return false;end if;
 if p_use='post' then return exists(select 1 from public.post_media m
  join public.posts p on p.id=m.post_id where m.edit#>>'{soundtrack,soundId}'=p_sound_id::text
  and (p.archived_at is null or p.user_id=auth.uid()) and public.can_view_post(p.id)
  and exists(select 1 from public.content_media_manifest_before_music(jsonb_build_array(jsonb_build_object('kind','post','id',p.id)))));
 elsif p_use='story' then return exists(select 1 from public.stories s where s.audio_sound_id=p_sound_id and (s.user_id=auth.uid() or public.viewer_can_see_story(s.id)));
 elsif p_use='memory_album' then return exists(select 1 from public.memory_albums a where a.soundtrack->>'soundId'=p_sound_id::text and public.can_view_memory_book(a.id))
  or exists(select 1 from public.memory_pages mp join public.memory_albums a on a.id=mp.album_id and a.user_id=mp.user_id
   join public.stories st on st.id=mp.story_id and st.user_id=a.user_id where st.audio_sound_id=p_sound_id and public.can_view_memory_book(a.id));end if;
 return false;
end $$;
revoke all on function public.sound_rights_allow(uuid,text) from public,anon;
grant execute on function public.sound_rights_allow(uuid,text) to authenticated;
-- Rebind the policy after renaming the previous rights function: PostgreSQL
-- stores its OID in a policy, so CREATE FUNCTION alone does not replace it.
-- The owner metadata branch must also require a current, approved identity.
create function public.sound_metadata_visible(p_sound_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 perform music_library.require_user();
 return exists(select 1 from public.story_sounds s where s.id=p_sound_id and
  (s.owner_id=auth.uid() or public.sound_rights_allow(s.id,'story') or public.sound_rights_allow(s.id,'post') or public.sound_rights_allow(s.id,'memory_album')));
end $$;
revoke all on function public.sound_metadata_visible(uuid) from public,anon,service_role;
grant execute on function public.sound_metadata_visible(uuid) to authenticated;
drop policy if exists story_sounds_select on public.story_sounds;
create policy story_sounds_select on public.story_sounds for select to authenticated using(public.sound_metadata_visible(id));
create or replace function public.list_playable_sounds(p_use text default 'story',p_query text default '',p_limit integer default 40)
returns table(id uuid,title text,artist text,url text,duration_sec integer,source text,max_excerpt_sec integer)
language sql stable security definer set search_path='' as $$
 select s.id,s.title,s.artist,s.url,s.duration_sec,s.source,s.max_excerpt_sec from public.story_sounds s
 where music_library.reusable(s.id,p_use) and (trim(coalesce(p_query,''))='' or position(lower(left(trim(p_query),100)) in lower(concat_ws(' ',s.title,s.artist)))>0)
 order by (s.owner_id=auth.uid()) desc,s.created_at desc,s.id limit greatest(1,least(coalesce(p_limit,40),100));
$$;
-- Validate attachment rights separately from the audience's playback rights.
alter function public.validate_soundtrack(jsonb,text) rename to validate_soundtrack_before_original_library;
revoke all on function public.validate_soundtrack_before_original_library(jsonb,text) from public,anon,authenticated,service_role;
create function public.validate_soundtrack(p_selection jsonb,p_use text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_selection is null or p_selection='null'::jsonb then return null;end if;
 if not music_library.reusable((p_selection->>'soundId')::uuid,p_use) then raise exception 'SOUND_REUSE_NOT_ALLOWED' using errcode='42501';end if;
 return public.validate_soundtrack_before_original_library(p_selection,p_use);
end $$;
revoke all on function public.validate_soundtrack(jsonb,text) from public,anon;
grant execute on function public.validate_soundtrack(jsonb,text) to authenticated;
create function public.list_sound_favorites() returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(f.sound_id order by f.created_at desc),'{}'::uuid[]) from music_library.favorites f where f.user_id=music_library.require_user();
$$;
create function public.set_sound_favorite(p_sound_id uuid,p_saved boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid:=music_library.require_user();
begin
 if p_saved is distinct from true then delete from music_library.favorites where user_id=u and sound_id=p_sound_id;return false;end if;
 if not (music_library.reusable(p_sound_id,'story') or music_library.reusable(p_sound_id,'post') or music_library.reusable(p_sound_id,'memory_album')) then raise exception 'SOUND_UNAVAILABLE' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('music-favorite:'||u::text,0));
 if (select count(*) from music_library.favorites where user_id=u)>=200 and not exists(select 1 from music_library.favorites where user_id=u and sound_id=p_sound_id) then raise exception 'FAVORITE_LIMIT';end if;
 insert into music_library.favorites(user_id,sound_id) values(u,p_sound_id) on conflict do nothing;return true;
end $$;
create function public.revoke_original_audio(p_sound_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=music_library.require_user();
begin
 if not exists(select 1 from music_library.uploads where owner_id=u and sound_id=p_sound_id) then raise exception 'SOUND_NOT_OWNED' using errcode='42501';end if;
 update music_library.uploads set status='revoked' where sound_id=p_sound_id;
 update public.story_sounds set revoked_at=coalesce(revoked_at,now()) where id=p_sound_id;
 delete from media_delivery.tickets where source_kind='sound' and source_id=p_sound_id;
 insert into music_library.events(actor_id,sound_id,action) values(u,p_sound_id,'original.revoked');
end $$;
create function public.set_original_audio_reuse(p_sound_id uuid,p_allowed boolean) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=music_library.require_user();
begin
 update music_library.uploads set reuse_allowed=coalesce(p_allowed,false) where sound_id=p_sound_id and owner_id=u and status='ready';
 if not found then raise exception 'SOUND_NOT_OWNED' using errcode='42501';end if;
 insert into music_library.events(actor_id,sound_id,action,detail) values(u,p_sound_id,'original.reuse_changed',jsonb_build_object('allowed',coalesce(p_allowed,false)));
end $$;
revoke all on function public.list_sound_favorites(),public.set_sound_favorite(uuid,boolean),public.revoke_original_audio(uuid),public.set_original_audio_reuse(uuid,boolean) from public,anon,service_role;
grant execute on function public.list_sound_favorites(),public.set_sound_favorite(uuid,boolean),public.revoke_original_audio(uuid),public.set_original_audio_reuse(uuid,boolean) to authenticated;

-- A sound reference gets the same short-lived, session- and object-bound byte
-- delivery as visual media. Every range request re-evaluates rights and audience.
alter function public.content_media_manifest(jsonb) rename to content_media_manifest_before_music;
revoke all on function public.content_media_manifest_before_music(jsonb) from public,anon,authenticated,service_role;
create function public.content_media_manifest(p_references jsonb) returns table(entity_kind text,entity_id uuid,media_url text)
language plpgsql stable security definer set search_path='' as $$
declare r record;
begin
 perform music_library.require_user();
 if jsonb_typeof(p_references) is distinct from 'array' or jsonb_array_length(p_references)>100 then raise exception 'INVALID_MEDIA_REFERENCES';end if;
 return query select * from public.content_media_manifest_before_music(p_references);
 for r in select x->>'kind' kind,(x->>'id')::uuid id from jsonb_array_elements(p_references) x loop
  if r.kind='sound' then
   return query select 'sound'::text,s.id,s.url from public.story_sounds s where s.id=r.id and (public.sound_rights_allow(s.id,'story') or public.sound_rights_allow(s.id,'post') or public.sound_rights_allow(s.id,'memory_album'));
  elsif r.kind='story' then
   return query select 'story'::text,s.id,s.audio_url from public.stories s where s.id=r.id and s.audio_url is not null
    and (s.user_id=auth.uid() or public.viewer_can_see_story(s.id)) and public.sound_rights_allow(s.audio_sound_id,'story');
  elsif r.kind='memory_album' then
   return query select 'memory_album'::text,a.id,s.url from public.memory_albums a join public.story_sounds s on s.id::text=a.soundtrack->>'soundId'
    where a.id=r.id and public.can_view_memory_book(a.id) and public.sound_rights_allow(s.id,'memory_album');
   return query select 'memory_album'::text,a.id,st.audio_url from public.memory_albums a
    join public.memory_pages mp on mp.album_id=a.id and mp.user_id=a.user_id
    join public.stories st on st.id=mp.story_id and st.user_id=a.user_id
    where a.id=r.id and public.can_view_memory_book(a.id) and st.audio_url is not null and public.sound_rights_allow(st.audio_sound_id,'memory_album');
  end if;
 end loop;
end $$;
revoke all on function public.content_media_manifest(jsonb) from public,anon;
grant execute on function public.content_media_manifest(jsonb) to authenticated;
alter function media_delivery.content_provenance(text,uuid,text,text,text,text) rename to content_provenance_before_music;
create function media_delivery.content_provenance(p_kind text,p_id uuid,p_url text,p_bucket text,p_path text,p_owner text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if p_bucket='music-audio' then return exists(select 1 from music_library.uploads u join public.story_sounds s on s.id=u.sound_id
  where u.status='ready' and u.object_path=p_path and u.owner_id::text=p_owner and s.url=p_url
  and ((p_kind='sound' and s.id=p_id) or (p_kind='story' and exists(select 1 from public.stories st where st.id=p_id and st.audio_sound_id=s.id))
   or (p_kind='memory_album' and (exists(select 1 from public.memory_albums a where a.id=p_id and a.soundtrack->>'soundId'=s.id::text)
    or exists(select 1 from public.memory_pages mp join public.memory_albums a on a.id=mp.album_id and a.user_id=mp.user_id
     join public.stories st on st.id=mp.story_id and st.user_id=a.user_id where a.id=p_id and st.audio_sound_id=s.id)))));end if;
 return media_delivery.content_provenance_before_music(p_kind,p_id,p_url,p_bucket,p_path,p_owner);
end $$;
-- Keep the current session/client guard body, changing only the bucket parser.
do $$declare body text;begin
 body:=pg_get_functiondef('media_delivery.issue(text,text,uuid,uuid)'::regprocedure);
 if position('(post-media|story-media|media|chat-media|chat-files)' in body)=0 then raise exception 'UNEXPECTED_MEDIA_DELIVERY_IMPLEMENTATION';end if;
 execute replace(body,'(post-media|story-media|media|chat-media|chat-files)','(post-media|story-media|media|chat-media|chat-files|music-audio)');
end $$;

create or replace function public.resolve_story_soundtrack(p_audio jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare chosen public.story_sounds;selection jsonb;
begin
 if p_audio is null or p_audio='null'::jsonb then return null;end if;
 perform music_library.require_user();
 if jsonb_typeof(p_audio)<>'object' then raise exception 'INVALID_AUDIO';end if;
 select * into chosen from public.story_sounds where id=nullif(p_audio->>'soundId','')::uuid;
 if not found or not music_library.reusable(chosen.id,'story') then raise exception 'VERIFIED_ORIGINAL_AUDIO_REQUIRED' using errcode='42501';end if;
 selection:=public.validate_soundtrack(jsonb_build_object('soundId',chosen.id,'startSec',coalesce((p_audio->>'startSec')::numeric,0),
  'durationSec',least(30,coalesce((p_audio->>'durationSec')::numeric,chosen.duration_sec)),'volume',1,'originalVolume',1),'story');
 return jsonb_build_object('url',chosen.url,'title',chosen.title,'source',chosen.source,'duration',(selection->>'durationSec')::numeric,
  'startSec',(selection->>'startSec')::numeric,'soundId',chosen.id,'publish_sound',false);
end $$;
revoke all on function public.resolve_story_soundtrack(jsonb) from public,anon,authenticated;
grant execute on function public.resolve_story_soundtrack(jsonb) to service_role;
create or replace function public.check_story_sound_rights() returns trigger language plpgsql security definer set search_path='' as $$
declare chosen public.story_sounds;start_sec numeric;
begin
 if new.audio_url is null then new.audio_sound_id:=null;return new;end if;
 select * into chosen from public.story_sounds where url=new.audio_url;
 if not found or not music_library.reusable(chosen.id,'story') then raise exception 'VERIFIED_ORIGINAL_AUDIO_REQUIRED' using errcode='42501';end if;
 start_sec:=coalesce((new.media_transform->>'audioStartSec')::numeric,0);
 new.audio_sound_id:=chosen.id;new.audio_duration_sec:=least(coalesce(new.audio_duration_sec,chosen.duration_sec),30,chosen.max_excerpt_sec);
 perform public.validate_soundtrack(jsonb_build_object('soundId',chosen.id,'startSec',start_sec,'durationSec',new.audio_duration_sec,'volume',1,'originalVolume',1),'story');
 return new;
end $$;
-- Preserve all visual publication checks and its idempotency record while adding
-- the verified sound resolution. Abort instead of replacing an unknown body.
do $$declare body text;old_block text;begin
 body:=pg_get_functiondef('public.publish_story_v2(uuid,uuid,jsonb)'::regprocedure);
 old_block:=$patch$if p_story->'audio_draft' is not null and p_story->'audio_draft'<>'null'::jsonb then
  raise exception 'MUSIC_UNAVAILABLE' using errcode='22023';
 end if;$patch$;
 if position(old_block in body)=0 or position('draft uuid; mix_value jsonb;' in body)=0 then raise exception 'UNEXPECTED_STORY_PUBLISHER';end if;
 body:=replace(body,'draft uuid; mix_value jsonb;','draft uuid; mix_value jsonb; audio jsonb;');
 body:=replace(body,old_block,$patch$audio:=public.resolve_story_soundtrack(p_story->'audio_draft');$patch$);
 body:=replace(body,$patch$nullif(p_story->'media_transform','null'::jsonb),nullif(p_story->'text_background'$patch$,$patch$(coalesce(nullif(p_story->'media_transform','null'::jsonb),'{}'::jsonb)||case when audio is not null then jsonb_build_object('audioStartSec',(audio->>'startSec')::numeric) else '{}'::jsonb end),nullif(p_story->'text_background'$patch$);
 body:=replace(body,'duration_sec,allow_replies)','duration_sec,allow_replies,audio_url,audio_title,audio_source,audio_duration_sec)');
 body:=replace(body,$patch$coalesce((p_story->>'allow_replies')::boolean,true));$patch$,$patch$coalesce((p_story->>'allow_replies')::boolean,true),audio->>'url',audio->>'title',audio->>'source',(audio->>'duration')::integer);$patch$);
 execute body;
end $$;

-- Include new private originals in the existing retryable account-erasure plan.
do $$declare body text;anchor text:='''post-media'',''story-media''';begin
 body:=pg_get_functiondef('account_erasure.review_reason(uuid)'::regprocedure);
 if (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 then raise exception 'MUSIC_ERASURE_CONTRACT_CHANGED';end if;
 execute replace(body,anchor,'''music-audio'',''post-media'',''story-media''');
end $$;
-- The old story-to-sound publication shortcut cannot verify uploaded bytes and
-- is retired. Existing callers receive an actionable failure without minting
-- unverified sound rows from stale sessions or incomplete recordings.
create or replace function public.publish_story_sound(p_story_id uuid,p_rights_attested boolean) returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform music_library.require_user();
 raise exception 'ORIGINAL_AUDIO_UPLOAD_REQUIRED: upload or record the original audio in the current app' using errcode='22023';
end $$;
revoke all on function public.publish_story_sound(uuid,boolean) from public,anon;
grant execute on function public.publish_story_sound(uuid,boolean) to authenticated;
-- Preserve the existing table-returning readers and their audience predicates.
-- The extra verified ID travels in the existing recipe field, so installed
-- clients retain the same RPC return signature while new players can recheck
-- revocation after an audio element has buffered its bytes.
do $readers$
declare identity text; body text;
begin
 foreach identity in array array['public.get_user_stories(uuid)','public.get_highlight_stories(uuid)'] loop
  if to_regprocedure(identity) is not null then
   body:=pg_get_functiondef(to_regprocedure(identity));
   if position('s.media_transform' in body)=0 then raise exception 'MUSIC_STORY_READER_CONTRACT_CHANGED: %',identity;end if;
   body:=replace(body,'s.media_transform', '(case when jsonb_typeof(s.media_transform)=''object'' then s.media_transform else ''{}''::jsonb end)||jsonb_build_object(''audioSoundId'',s.audio_sound_id)');
   execute body;
  end if;
 end loop;
end $readers$;

create function public.list_my_original_audio() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') from (
 select u.sound_id id,u.title,u.verified_duration duration_sec,u.reuse_allowed,u.status,u.created_at from music_library.uploads u
 where u.owner_id=music_library.require_user() and u.sound_id is not null order by u.created_at desc limit 200) r;
$$;
create function public.save_memory_book_soundtrack(p_album uuid,p_soundtrack jsonb) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=music_library.require_user();checked jsonb;
begin
 if not exists(select 1 from public.memory_albums where id=p_album and user_id=u) then raise exception 'BOOK_NOT_OWNED' using errcode='42501';end if;
 checked:=public.validate_soundtrack(p_soundtrack,'memory_album');
 update public.memory_albums set soundtrack=checked where id=p_album and user_id=u;
end $$;
create function public.check_memory_book_soundtrack() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.soundtrack is not null and (tg_op='INSERT' or new.soundtrack is distinct from old.soundtrack) then new.soundtrack:=public.validate_soundtrack(new.soundtrack,'memory_album');end if;return new;
end $$;
create trigger music_book_attachment before insert or update of soundtrack on public.memory_albums for each row execute function public.check_memory_book_soundtrack();
alter function public.get_memory_book(uuid) rename to get_memory_book_before_music;
revoke all on function public.get_memory_book_before_music(uuid) from public,anon,authenticated,service_role;
create function public.get_memory_book(p_album uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;pgs jsonb;
begin
 result:=public.get_memory_book_before_music(p_album);
 if result is null or not public.can_view_memory_book(p_album) then return result;end if;
 select coalesce(jsonb_agg(e.value||jsonb_build_object('audio_sound_id',st.audio_sound_id,'audio_duration_sec',st.audio_duration_sec,
  'audio_title',st.audio_title,'audio_url',case when st.audio_sound_id is not null and public.sound_rights_allow(st.audio_sound_id,'memory_album') then st.audio_url end) order by e.ordinality),'[]') into pgs
 from jsonb_array_elements(coalesce(result->'pages','[]')) with ordinality e(value,ordinality)
 left join public.memory_pages mp on mp.id::text=e.value->>'id' and mp.album_id=p_album
 left join public.memory_albums a on a.id=mp.album_id and a.user_id=mp.user_id
 left join public.stories st on st.id=mp.story_id and st.user_id=a.user_id;
 return result||jsonb_build_object('soundtrack',(select soundtrack from public.memory_albums where id=p_album),'pages',pgs);
end $$;
create function public.authorize_original_audio_export(p_sound_id uuid,p_use text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=music_library.require_user();s public.story_sounds;
begin
 if not exists(select 1 from music_library.uploads where sound_id=p_sound_id and owner_id=u and status='ready')
 or not music_library.reusable(p_sound_id,p_use) then raise exception 'AUDIO_EXPORT_RIGHTS_REQUIRED' using errcode='42501';end if;
 select * into s from public.story_sounds where id=p_sound_id;
 return jsonb_build_object('id',s.id,'title',s.title,'url',s.url,'duration_sec',s.duration_sec,'source',s.source,'max_excerpt_sec',s.max_excerpt_sec);
end $$;
revoke all on function public.list_my_original_audio(),public.save_memory_book_soundtrack(uuid,jsonb),public.get_memory_book(uuid),public.authorize_original_audio_export(uuid,text) from public,anon,service_role;
grant execute on function public.list_my_original_audio(),public.save_memory_book_soundtrack(uuid,jsonb),public.get_memory_book(uuid),public.authorize_original_audio_export(uuid,text) to authenticated;
revoke all on function public.check_memory_book_soundtrack() from public,anon,authenticated,service_role;

create function music_library.require_admin(p_actor uuid,p_session uuid) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if public.triniti_admin_session_check(p_actor,p_session) is distinct from true or not exists(select 1 from public.admin_users where user_id=p_actor and active and role in ('super_admin','platform_admin','trust_safety')) then raise exception 'MUSIC_ADMIN_REQUIRED' using errcode='42501';end if;
end $$;
create function public.admin_music_snapshot(p_actor uuid,p_session uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform music_library.require_admin(p_actor,p_session);
 return jsonb_build_object('catalogEnabled',false,
 'providers',coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from music_library.providers p),'[]'),
 'licenses',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from music_library.license_drafts l),'[]'),
 'originals',coalesce((select jsonb_agg(to_jsonb(r)) from (select s.id,s.owner_id,s.title,s.duration_sec,s.rights_status,s.revoked_at,s.created_at,u.reuse_allowed,u.byte_size from public.story_sounds s join music_library.uploads u on u.sound_id=s.id order by s.created_at desc limit 200)r),'[]'),
 'events',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from music_library.events order by created_at desc limit 100)r),'[]'));
end $$;
create function public.admin_music_command(p_actor uuid,p_session uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result uuid;provider text;reason text;
begin
 perform music_library.require_admin(p_actor,p_session);
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>20000 then raise exception 'INVALID_MUSIC_COMMAND';end if;
 if p_action='provider.save' then
  provider:=p_payload->>'id';
  insert into music_library.providers(id,name,contact_ref,notes) values(provider,p_payload->>'name',left(p_payload->>'contact',500),left(p_payload->>'notes',4000))
  on conflict(id) do update set name=excluded.name,contact_ref=excluded.contact_ref,notes=excluded.notes,updated_at=now();
 elsif p_action='license.draft' then
  insert into music_library.license_drafts(provider_id,reference,licensor,territories,permitted_uses,export_allowed,starts_at,ends_at,evidence_ref,created_by)
  values(p_payload->>'providerId',p_payload->>'reference',p_payload->>'licensor',array(select jsonb_array_elements_text(p_payload->'territories')),
   array(select jsonb_array_elements_text(p_payload->'uses')),coalesce((p_payload->>'exportAllowed')::boolean,false),nullif(p_payload->>'startsAt','')::timestamptz,nullif(p_payload->>'endsAt','')::timestamptz,left(p_payload->>'evidence',2000),p_actor) on conflict(provider_id,reference) do update set licensor=excluded.licensor,territories=excluded.territories,permitted_uses=excluded.permitted_uses,export_allowed=excluded.export_allowed,starts_at=excluded.starts_at,ends_at=excluded.ends_at,evidence_ref=excluded.evidence_ref returning id into result;
 elsif p_action='sound.revoke' then
  result:=(p_payload->>'soundId')::uuid;reason:=trim(p_payload->>'reason');
  if reason is null or length(reason) not between 5 and 1000 then raise exception 'REVOCATION_REASON_REQUIRED';end if;
  update public.story_sounds set revoked_at=coalesce(revoked_at,now()),rights_status='blocked' where id=result;
  if not found then raise exception 'SOUND_NOT_FOUND';end if;
  update music_library.uploads set status='revoked' where sound_id=result;
  delete from media_delivery.tickets where source_kind='sound' and source_id=result;
 else raise exception 'MUSIC_COMMAND_NOT_SUPPORTED';end if;
 insert into music_library.events(actor_id,sound_id,action,detail) values(p_actor,case when p_action='sound.revoke' then result end,p_action,p_payload);
 return jsonb_build_object('ok',true,'id',result,'catalogEnabled',false);
end $$;
revoke all on function public.admin_music_snapshot(uuid,uuid),public.admin_music_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_music_snapshot(uuid,uuid),public.admin_music_command(uuid,uuid,text,jsonb) to service_role;

create function public.admin_original_audio_object(p_actor uuid,p_session uuid,p_sound_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform music_library.require_admin(p_actor,p_session);
 select jsonb_build_object('bucket','music-audio','path',u.object_path,'version',u.object_version,'mime',u.mime,'bytes',u.byte_size)
 into result from music_library.uploads u join storage.objects o on o.id=u.object_id and o.version=u.object_version and o.bucket_id='music-audio'
 and o.name=u.object_path and coalesce(o.owner_id,o.owner::text)=u.owner_id::text where u.sound_id=p_sound_id;
 return result;
end $$;
revoke all on function public.admin_original_audio_object(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_original_audio_object(uuid,uuid,uuid) to service_role;

revoke all on all functions in schema music_library from public,anon,authenticated,service_role;
revoke all on function media_delivery.content_provenance(text,uuid,text,text,text,text) from public,anon,authenticated,service_role;
commit;
