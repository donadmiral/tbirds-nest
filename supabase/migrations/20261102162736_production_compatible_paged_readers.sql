-- Production-compatible additive readers. Existing reader, account deletion,
-- media upload, storage policy and business-session contracts are not replaced.
-- Sources and exact adaptations: supabase/ops/production-compatible-readers-20261102.
-- This package REPLACES installation of the five source reader migrations on
-- the captured visual-only production baseline. Do not subsequently replay them.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
declare expected record;
begin
 if current_user<>'postgres' then raise exception 'PRODUCTION_READERS_POSTGRES_REQUIRED';end if;
 if to_regnamespace('read_paging') is not null or to_regnamespace('read_paging_support') is not null
  or to_regnamespace('memory_creative') is not null or to_regnamespace('music_library') is not null
  or to_regnamespace('media_delivery') is not null or to_regnamespace('account_erasure') is not null then
  raise exception 'PRODUCTION_READERS_FRESH_VISUAL_BASELINE_REQUIRED';end if;
 for expected in select * from(values
  ('public.get_memory_book(uuid)','e81581dd9ed47c8f11705fdd8d62b1a5'),
  ('public.get_memory_albums(uuid)','2ff77aa54267e0e31f96757d5c220487'),
  ('public.validate_memory_book_cover()','c564cf37800f4b0ecb26ade7fcab3bb8'),
  ('public.can_view_memory_book(uuid)','dc1c8ae9412c152162184370f24631c0')
 )v(signature,body_md5) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(expected.signature)
   and md5(p.prosrc)=expected.body_md5 and p.proowner='postgres'::regrole and p.prosecdef
   and p.proconfig=array['search_path=""']::text[]) then
   raise exception 'PRODUCTION_READER_BASELINE_CHANGED: %',expected.signature;end if;
 end loop;
 if not exists(select 1 from pg_trigger t where t.tgrelid='public.memory_albums'::regclass
  and t.tgname='memory_book_cover' and t.tgenabled='O' and not t.tgisinternal and t.tgtype=23
  and t.tgqual is null and t.tgfoid=to_regprocedure('public.validate_memory_book_cover()')
  and (select array_agg(a.attname::text order by a.attname) from unnest(t.tgattr)x(attnum)
   join pg_attribute a on a.attrelid=t.tgrelid and a.attnum=x.attnum)=array['cover_story_id','user_id']::text[]) then
  raise exception 'PRODUCTION_READER_COVER_GUARD_REQUIRED';end if;
 if exists(select 1 from(values
  ('auth','users','id','uuid'),('auth','users','deleted_at','timestamp with time zone'),
  ('auth','users','banned_until','timestamp with time zone'),('auth','sessions','id','uuid'),
  ('auth','sessions','user_id','uuid'),('auth','sessions','not_after','timestamp with time zone'),
  ('public','profiles','deactivated_at','timestamp with time zone'),('public','profiles','account_type','text')
 )v(schema_name,table_name,column_name,data_type)
 where not exists(select 1 from information_schema.columns c where c.table_schema=v.schema_name
  and c.table_name=v.table_name and c.column_name=v.column_name and c.data_type=v.data_type)) then
  raise exception 'PRODUCTION_READER_AUTH_COLUMNS_REQUIRED';end if;
 if to_regprocedure('public.get_context_unread()') is null
  or to_regprocedure('public.get_unread_counts()') is null
  or to_regprocedure('public.is_business_member(uuid)') is null
  or to_regprocedure('auth.uid()') is null or to_regprocedure('auth.role()') is null
  or to_regprocedure('auth.jwt()') is null or to_regcollation('pg_catalog."und-x-icu"') is null
  or to_regprocedure('public.sound_rights_allow(uuid,text)') is not null
  or exists(select 1 from information_schema.columns where table_schema='public'
   and ((table_name='memory_albums' and column_name in('cover_artwork','film_settings','presentation_revision','soundtrack'))
    or (table_name='stories' and column_name='audio_sound_id'))) then
  raise exception 'PRODUCTION_READER_PREREQUISITE_CHANGED';end if;
end $preflight$;

create schema read_paging_support;
revoke all on schema read_paging_support from public,anon,authenticated,service_role;

-- Exact reviewed media_delivery.require_session checks, isolated from media
-- ticket issuance and every Storage/client cutover.
create function read_paging_support.require_session() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare session_id uuid;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'MEDIA_SESSION_REQUIRED' using errcode='42501'; end if;
 begin session_id:=(auth.jwt()->>'session_id')::uuid;exception when others then session_id:=null;end;
 if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id where s.id=session_id
  and s.user_id=auth.uid() and (s.not_after is null or s.not_after>clock_timestamp()) and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=clock_timestamp())) then raise exception 'MEDIA_SESSION_REQUIRED' using errcode='42501'; end if;
 return session_id;
end $$;

-- No erasure workflow is installed here. Until that complete private schema is
-- installed, retain the exact identity and shared-lock part of its guard.
-- Once installed, use its current complete guard, including queued-job fences.
-- A partial/unknown erasure schema fails closed; it never takes this fallback.
create function read_paging_support.assert_writable(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if to_regprocedure('account_erasure.assert_writable(uuid)') is not null then
  execute 'select account_erasure.assert_writable($1)' using p_user;return;
 end if;
 if to_regnamespace('account_erasure') is not null then
  raise exception 'ACCOUNT_ERASURE_GUARD_UNAVAILABLE' using errcode='42501';end if;
 if p_user is null then return;end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('account-erasure:'||p_user::text,0));
 if not exists(select 1 from auth.users where id=p_user and deleted_at is null) then
  raise exception 'ACCOUNT_ERASURE_IDENTITY_UNAVAILABLE' using errcode='42501';end if;
end $$;

-- The fallback retains every reviewed creative actor check. Business identities
-- remain unsupported until the real business-session authority is installed.
-- Full creative installation takes over directly without changing old APIs.
create function read_paging_support.actor(p_lock boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;p public.profiles%rowtype;allowed boolean;
begin
 if to_regprocedure('memory_creative.actor(boolean)') is not null then
  execute 'select memory_creative.actor($1)' into uid using p_lock;return uid;
 end if;
 if to_regnamespace('memory_creative') is not null then
  raise exception 'MEMORY_CREATIVE_ACTOR_UNAVAILABLE' using errcode='42501';end if;
 if auth.role() is distinct from 'authenticated' then raise exception 'MEMORY_AUTHENTICATED_SESSION_REQUIRED' using errcode='42501';end if;
 sid:=read_paging_support.require_session();
 if p_lock then
  select * into p from public.profiles where id=uid and deactivated_at is null for share;
 else select * into p from public.profiles where id=uid and deactivated_at is null;end if;
 if p.id is null then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501';end if;
 if p_lock then
  perform 1 from auth.sessions where id=sid and user_id=uid for share;
  if not found then raise exception 'ACTIVE_SESSION_REQUIRED' using errcode='42501';end if;
  perform read_paging_support.require_session();
 end if;
 perform read_paging_support.assert_writable(uid);
 if to_regprocedure('public.business_session_allowed()') is not null then execute 'select public.business_session_allowed()' into allowed;
 elsif p.account_type='business' then allowed:=false;else allowed:=true;end if;
 if not coalesce(allowed,false) then raise exception 'BUSINESS_SESSION_REQUIRED' using errcode='42501';end if;
 return uid;
end $$;

-- Advertising an unsupported identity would force an installed client onto a
-- reader that rejects it. Only authorization denials become a false capability;
-- unexpected database errors retain their ordinary error semantics.
create function read_paging_support.eligible() returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 return read_paging_support.actor(false) is not null;
exception when insufficient_privilege then return false;
end $$;

-- Production's existing visual readers omit creative/audio fields. Do not
-- fabricate stored presentation state or public rights primitives. Delegation
-- starts only when the real private/public helper contracts become available.
create function read_paging_support.ack(a public.memory_albums) returns jsonb
language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
 if to_regprocedure('memory_creative.ack(public.memory_albums)') is null then return '{}'::jsonb;end if;
 execute 'select memory_creative.ack($1)' into result using a;
 return result;
end $$;
create function read_paging_support.audio(s public.stories,p_audio boolean) returns jsonb
language plpgsql stable set search_path='' as $$
declare fields jsonb;sound uuid;allowed boolean:=false;
begin
 if not p_audio or to_regprocedure('public.sound_rights_allow(uuid,text)') is null then return '{}'::jsonb;end if;
 fields:=to_jsonb(s);sound:=(fields->>'audio_sound_id')::uuid;
 if sound is not null then execute 'select public.sound_rights_allow($1,$2)' into allowed using sound,'memory_album';end if;
 return jsonb_build_object('audio_sound_id',fields->'audio_sound_id','audio_duration_sec',fields->'audio_duration_sec',
  'audio_title',fields->'audio_title','audio_url',case when allowed then fields->'audio_url' else 'null'::jsonb end);
end $$;
create function read_paging_support.soundtrack(a public.memory_albums) returns jsonb
language plpgsql stable set search_path='' as $$
begin
 if to_regprocedure('public.sound_rights_allow(uuid,text)') is null then return '{}'::jsonb;end if;
 return jsonb_build_object('soundtrack',to_jsonb(a)->'soundtrack');
end $$;

-- Source-specific story projection invalidation. Counter-only updates perform
-- direct field comparisons and never touch owner revisions or serialize whole
-- story rows. The guarded optional-field expression is prepared only after the
-- real column exists; ALTER TABLE invalidates its cached row descriptor.
create function read_paging_support.story_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner uuid;old_owner uuid;new_owner uuid;
begin
 if tg_op='UPDATE' then
  if row(old.id,old.user_id,old.media_url,old.media_type,old.thumbnail_url,old.caption,old.text_background,
   old.stickers_json,old.media_transform,old.filter_id,old.duration_sec,old.dual_front_url,
   old.audio_duration_sec,old.audio_title,old.audio_url)
   is not distinct from
   row(new.id,new.user_id,new.media_url,new.media_type,new.thumbnail_url,new.caption,new.text_background,
   new.stickers_json,new.media_transform,new.filter_id,new.duration_sec,new.dual_front_url,
   new.audio_duration_sec,new.audio_title,new.audio_url) then
   if not exists(select 1 from pg_attribute where attrelid=tg_relid and attname='audio_sound_id' and attnum>0 and not attisdropped) then return null;end if;
   if old.audio_sound_id is not distinct from new.audio_sound_id then return null;end if;
  end if;
 end if;
 if tg_op<>'INSERT' then old_owner:=old.user_id;end if;
 if tg_op<>'DELETE' then new_owner:=new.user_id;end if;
 for owner in select distinct u from unnest(array[old_owner,new_owner])u where u is not null order by u loop
  insert into read_paging.library_revision(owner_id,revision)
   select owner,1 where exists(select 1 from public.profiles where id=owner)
   on conflict(owner_id) do update set revision=read_paging.library_revision.revision+1;
 end loop;
 return null;
end $$;
revoke all on all functions in schema read_paging_support from public,anon,authenticated,service_role;

-- BEGIN REVIEWED READER SOURCE: 20261102064915_bounded_book_and_inbox_readers.sql
-- Additive readers. Existing public APIs and their clients remain untouched.
-- Enable each capability only after the corresponding client has passed QA.
-- The production-specific baseline and isolated guards are checked above.

create schema read_paging;
revoke all on schema read_paging from public, anon, authenticated, service_role;
create table read_paging.settings (
  singleton boolean primary key default true check(singleton),
  books_ready boolean not null default false,
  inbox_ready boolean not null default false
);
insert into read_paging.settings(singleton) values(true);
create table read_paging.library_revision (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  revision bigint not null check(revision >= 0)
);
alter table read_paging.settings enable row level security;
alter table read_paging.library_revision enable row level security;
revoke all on all tables in schema read_paging from public, anon, authenticated, service_role;

create function public.get_paged_reader_capabilities()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version',1,'books',s.books_ready and read_paging_support.eligible(),
    'inbox',s.inbox_ready and read_paging_support.eligible(),'book_page_limit',40,'inbox_page_limit',50)
  from read_paging.settings s where s.singleton;
$$;
create function public.configure_paged_readers(p_books_ready boolean,p_inbox_ready boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role',true) is distinct from 'service_role'
    or auth.role() is distinct from 'service_role' or auth.jwt()->>'role' is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if p_books_ready is null or p_inbox_ready is null then
    raise exception 'EXPLICIT_READINESS_REQUIRED' using errcode='22023';
  end if;
  update read_paging.settings set books_ready=p_books_ready,inbox_ready=p_inbox_ready where singleton;
end $$;
revoke all on function public.get_paged_reader_capabilities(),public.configure_paged_readers(boolean,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.get_paged_reader_capabilities() to authenticated;
grant execute on function public.configure_paged_readers(boolean,boolean) to service_role;

-- A single owner-library revision prevents a reordered/edited book from being
-- silently continued with a stale cursor. It avoids a lookup/fanout to every
-- book containing an edited story. Unrelated story counters never fire it.
create function read_paging.library_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner uuid; old_owner uuid; new_owner uuid;
begin
  if tg_op='UPDATE' and to_jsonb(old) is not distinct from to_jsonb(new) then return null; end if;
  if tg_op<>'INSERT' then old_owner:=old.user_id; end if;
  if tg_op<>'DELETE' then new_owner:=new.user_id; end if;
  for owner in select distinct u from unnest(array[old_owner,new_owner]) u
    where u is not null order by u
  loop
    -- A profile cascade may already have removed the owner and its revision.
    insert into read_paging.library_revision(owner_id,revision)
      select owner,1 where exists(select 1 from public.profiles where id=owner)
      on conflict(owner_id) do update set revision=read_paging.library_revision.revision+1;
  end loop;
  return null;
end $$;
create trigger paged_book_revision after insert or update or delete on public.memory_albums
  for each row execute function read_paging.library_changed();
create trigger paged_page_revision after insert or update or delete on public.memory_pages
  for each row execute function read_paging.library_changed();
create trigger paged_story_revision after delete or update on public.stories
  for each row execute function read_paging_support.story_changed();

-- The existing (album_id,sort_order) index cannot seek through equal sort keys.
create index memory_pages_reader_seek_idx
  on public.memory_pages(album_id,user_id,sort_order,created_at,id);

create function read_paging.page_json(mp public.memory_pages,s public.stories,p_audio boolean)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',mp.id,'story_id',mp.story_id,'sort_order',mp.sort_order,
    'style',mp.style,'media_url',coalesce(s.media_url,mp.media_url),'media_type',coalesce(s.media_type,mp.media_type),
    'thumbnail_url',coalesce(s.thumbnail_url,mp.thumbnail_url),'caption',mp.caption,'taken_at',mp.taken_at,
    'story_caption',s.caption,'text_background',s.text_background,'stickers',s.stickers_json,
    'media_transform',s.media_transform,'filter_id',s.filter_id,'duration_sec',s.duration_sec,'dual_front_url',s.dual_front_url)
  || read_paging_support.audio(s,p_audio);
$$;

create function public.get_memory_book_page_v2(p_album uuid,p_cursor jsonb default null,p_limit integer default 24)
returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare
  viewer uuid:=read_paging_support.actor(false); a public.memory_albums%rowtype;
  rev text; cursor_sort integer; cursor_time timestamptz; cursor_id uuid;
  rows_json jsonb; pages jsonb; last_row jsonb; next_cursor jsonb;
  total bigint; cover_page jsonb; metadata jsonb:='{}'::jsonb; has_more boolean;
begin
  if not exists(select 1 from read_paging.settings where singleton and books_ready) then
    raise exception 'PAGED_BOOK_READER_NOT_READY' using errcode='55000';
  end if;
  if p_album is null or p_limit is null or p_limit not between 1 and 40 then
    raise exception 'INVALID_BOOK_PAGE_REQUEST' using errcode='22023';
  end if;
  select * into a from public.memory_albums where id=p_album;
  if not found or not public.can_view_memory_book(p_album) then
    return jsonb_build_object('version',2,'can_view',false,'is_owner',false,'count',0,
      'pages','[]'::jsonb,'next_cursor',null,'has_more',false,'metadata_included',true);
  end if;
  select coalesce((select revision from read_paging.library_revision where owner_id=a.user_id),0)::text into rev;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048
      or p_cursor->>'version' is distinct from '2' or p_cursor->>'album' is distinct from a.id::text
      or p_cursor->>'viewer' is distinct from viewer::text then
      raise exception 'INVALID_BOOK_CURSOR' using errcode='22023';
    end if;
    if p_cursor->>'revision' is distinct from rev then
      raise exception 'MEMORY_BOOK_CHANGED' using errcode='40001';
    end if;
    begin
      cursor_sort:=(p_cursor->>'sort_order')::integer;
      cursor_time:=(p_cursor->>'created_at')::timestamptz;
      cursor_id:=(p_cursor->>'id')::uuid;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
      raise exception 'INVALID_BOOK_CURSOR' using errcode='22023';
    end;
    if cursor_sort is null or cursor_time is null or not isfinite(cursor_time) or cursor_id is null then
      raise exception 'INVALID_BOOK_CURSOR' using errcode='22023';
    end if;
  else
    -- Exact count and original cover selection are first-page metadata, never
    -- inferred from the current page. This one-time work is scoped to this book.
    select count(*) into total from public.memory_pages mp
      join public.stories s on s.id=mp.story_id and s.user_id=a.user_id
      where mp.album_id=a.id and mp.user_id=a.user_id;
    select read_paging.page_json(mp,s,false) into cover_page from public.memory_pages mp
      join public.stories s on s.id=mp.story_id and s.user_id=a.user_id
      where mp.album_id=a.id and mp.user_id=a.user_id
      order by (mp.story_id=a.cover_story_id) desc nulls last,
        (coalesce(s.media_type,mp.media_type) in('image','video')) desc nulls last,
        mp.sort_order,mp.created_at,mp.id limit 1;
    metadata:=jsonb_build_object('user_id',a.user_id,'is_default',a.is_default,'title',a.title,
      'subtitle',a.subtitle,'cover_color',a.cover_color,'cover_design',a.cover_design,
      'cover_story_id',a.cover_story_id,'cover_page',cover_page,'audience',a.audience,
      'count',total)||read_paging_support.soundtrack(a)||read_paging_support.ack(a);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('page',read_paging.page_json(q.mp,q.s,true),
    'sort_order',(q.mp).sort_order,'created_at',(q.mp).created_at,'id',(q.mp).id)
    order by (q.mp).sort_order,(q.mp).created_at,(q.mp).id),'[]'::jsonb) into rows_json
  from (
    select mp,s from public.memory_pages mp join public.stories s on s.id=mp.story_id and s.user_id=a.user_id
    where mp.album_id=a.id and mp.user_id=a.user_id
      and (p_cursor is null or (mp.sort_order,mp.created_at,mp.id)>(cursor_sort,cursor_time,cursor_id))
    order by mp.sort_order,mp.created_at,mp.id limit p_limit+1
  ) q;
  has_more:=jsonb_array_length(rows_json)>p_limit;
  select coalesce(jsonb_agg(e.value->'page' order by e.ordinality),'[]'::jsonb) into pages
    from jsonb_array_elements(rows_json) with ordinality e(value,ordinality) where e.ordinality<=p_limit;
  if has_more then
    last_row:=rows_json->(p_limit-1);
    next_cursor:=jsonb_build_object('version',2,'album',a.id,'viewer',viewer,'revision',rev,
      'sort_order',last_row->'sort_order','created_at',last_row->'created_at','id',last_row->'id');
  end if;
  return metadata||jsonb_build_object('version',2,'id',a.id,'can_view',true,'is_owner',a.user_id=viewer,
    'revision',rev,'metadata_included',p_cursor is null,'pages',pages,'has_more',has_more,'next_cursor',next_cursor);
end $$;
revoke all on function public.get_memory_book_page_v2(uuid,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_memory_book_page_v2(uuid,jsonb,integer) to authenticated;

create index memory_albums_reader_seek_idx on public.memory_albums
  (user_id,(case when is_default then 0 else 1 end),created_at,id);
create function read_paging.book_summary(a public.memory_albums)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',a.id,'title',a.title,'subtitle',a.subtitle,'cover_color',a.cover_color,
    'cover_design',a.cover_design,'cover_story_id',a.cover_story_id,'audience',a.audience,'is_default',a.is_default,
    'count',(select count(*) from public.memory_pages mp join public.stories s on s.id=mp.story_id and s.user_id=a.user_id
      where mp.album_id=a.id and mp.user_id=a.user_id),
    'cover_page',(select jsonb_build_object('id',mp.id,'story_id',mp.story_id,'media_url',coalesce(s.media_url,mp.media_url),
      'media_type',coalesce(s.media_type,mp.media_type),'thumbnail_url',coalesce(s.thumbnail_url,mp.thumbnail_url),
      'caption',mp.caption,'taken_at',mp.taken_at,'stickers',s.stickers_json,'media_transform',s.media_transform,'filter_id',s.filter_id)
      from public.memory_pages mp join public.stories s on s.id=mp.story_id and s.user_id=a.user_id
      where mp.album_id=a.id and mp.user_id=a.user_id
      order by (mp.story_id=a.cover_story_id) desc nulls last,
        (coalesce(s.media_type,mp.media_type) in('image','video')) desc nulls last,mp.sort_order,mp.created_at,mp.id limit 1))
    ||read_paging_support.ack(a);
$$;
create function public.get_memory_books_page_v2(p_owner uuid,p_cursor jsonb default null,p_limit integer default 12)
returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare viewer uuid:=read_paging_support.actor(false);rev text;cursor_rank integer;cursor_time timestamptz;cursor_id uuid;
  selected jsonb;books jsonb;last_row jsonb;next_cursor jsonb;has_more boolean;
begin
  if not exists(select 1 from read_paging.settings where singleton and books_ready) then
    raise exception 'PAGED_BOOK_READER_NOT_READY' using errcode='55000';end if;
  if p_owner is null or p_limit is null or p_limit not between 1 and 12 then
    raise exception 'INVALID_SHELF_PAGE_REQUEST' using errcode='22023';end if;
  -- A hidden library has the same fixed empty envelope as a nonexistent or
  -- empty library. Do this before inspecting the private owner's revision or
  -- comparing a prior cursor: neither its value nor a changed-cursor error may
  -- disclose activity in books the caller cannot view.
  if not exists(select 1 from public.memory_albums a where a.user_id=p_owner and public.can_view_memory_book(a.id)) then
    return jsonb_build_object('version',2,'is_owner',viewer=p_owner,'can_view',false,'books','[]'::jsonb,
      'revision','0','next_cursor',null,'has_more',false);
  end if;
  select coalesce((select revision from read_paging.library_revision where owner_id=p_owner),0)::text into rev;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048
      or p_cursor->>'version' is distinct from '2' or p_cursor->>'owner' is distinct from p_owner::text
      or p_cursor->>'viewer' is distinct from viewer::text then raise exception 'INVALID_SHELF_CURSOR' using errcode='22023';end if;
    if p_cursor->>'revision' is distinct from rev then raise exception 'MEMORY_BOOK_CHANGED' using errcode='40001';end if;
    begin
      cursor_rank:=(p_cursor->>'rank')::integer;cursor_time:=(p_cursor->>'created_at')::timestamptz;cursor_id:=(p_cursor->>'id')::uuid;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
      raise exception 'INVALID_SHELF_CURSOR' using errcode='22023';end;
    if cursor_rank is null or cursor_rank not in(0,1) or cursor_time is null or not isfinite(cursor_time) or cursor_id is null then
      raise exception 'INVALID_SHELF_CURSOR' using errcode='22023';end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('book',read_paging.book_summary(q.a),'rank',q.rank,
    'created_at',(q.a).created_at,'id',(q.a).id) order by q.rank,(q.a).created_at,(q.a).id),'[]'::jsonb) into selected
  from(select a,case when a.is_default then 0 else 1 end rank from public.memory_albums a
    where a.user_id=p_owner and public.can_view_memory_book(a.id)
      and(p_cursor is null or (case when a.is_default then 0 else 1 end,a.created_at,a.id)>(cursor_rank,cursor_time,cursor_id))
    order by case when a.is_default then 0 else 1 end,a.created_at,a.id limit p_limit+1) q;
  has_more:=jsonb_array_length(selected)>p_limit;
  select coalesce(jsonb_agg(e.value->'book' order by e.ordinality),'[]'::jsonb) into books
    from jsonb_array_elements(selected) with ordinality e(value,ordinality) where e.ordinality<=p_limit;
  if has_more then last_row:=selected->(p_limit-1);next_cursor:=jsonb_build_object('version',2,'owner',p_owner,
    'viewer',viewer,'revision',rev,'rank',last_row->'rank','created_at',last_row->'created_at','id',last_row->'id');end if;
  return jsonb_build_object('version',2,'is_owner',viewer=p_owner,'can_view',jsonb_array_length(books)>0,
    'books',books,'revision',rev,'next_cursor',next_cursor,'has_more',has_more);
end $$;
create function public.get_next_memory_book_v2(p_album uuid,p_include_empty boolean default true)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=read_paging_support.actor(false);a public.memory_albums%rowtype;next_book public.memory_albums%rowtype;
begin
  if not exists(select 1 from read_paging.settings where singleton and books_ready) then
    raise exception 'PAGED_BOOK_READER_NOT_READY' using errcode='55000';end if;
  if p_include_empty is null then raise exception 'INVALID_SHELF_PAGE_REQUEST' using errcode='22023';end if;
  select * into a from public.memory_albums where id=p_album;
  if not found or not public.can_view_memory_book(a.id) then return null;end if;
  select n.* into next_book from public.memory_albums n where n.user_id=a.user_id and public.can_view_memory_book(n.id)
    and(case when n.is_default then 0 else 1 end,n.created_at,n.id)>(case when a.is_default then 0 else 1 end,a.created_at,a.id)
    and(p_include_empty or exists(select 1 from public.memory_pages mp join public.stories s on s.id=mp.story_id and s.user_id=n.user_id
      where mp.album_id=n.id and mp.user_id=n.user_id))
    order by case when n.is_default then 0 else 1 end,n.created_at,n.id limit 1;
  if not found then return null;end if;
  return read_paging.book_summary(next_book);
end $$;
revoke all on function public.get_memory_books_page_v2(uuid,jsonb,integer),public.get_next_memory_book_v2(uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.get_memory_books_page_v2(uuid,jsonb,integer),public.get_next_memory_book_v2(uuid,boolean) to authenticated;

-- Only actual unread rows for the requested conversation window are counted.
-- The two branches intentionally match get_unread_counts(), including their
-- additive overlap for a direct chat that also has a membership row.
create index messages_inbox_unread_window_idx on public.messages(receiver_id,conversation_id)
  where read_at is null and deleted_at is null;
create function read_paging.inbox_unread(p_ids uuid[])
returns table(conversation_id uuid,unread bigint)
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid();
begin
  if viewer is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  if p_ids is null or coalesce(array_ndims(p_ids),1)<>1 or cardinality(p_ids)>50
    or array_position(p_ids,null) is not null then
    raise exception 'INVALID_INBOX_WINDOW' using errcode='22023';
  end if;
  return query
  with allowed as materialized (
    select c.id from public.conversations c where c.id=any(p_ids)
      and ((not c.is_group and (c.user_1=viewer or c.user_2=viewer))
        or exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=viewer))
  ), counts as (
    select m.conversation_id,count(*)::bigint n from allowed a join public.messages m on m.conversation_id=a.id
      where m.receiver_id=viewer and m.sender_id<>viewer and m.read_at is null and m.deleted_at is null
      group by m.conversation_id
    union all
    select m.conversation_id,count(*)::bigint n from allowed a
      join public.conversation_members cm on cm.conversation_id=a.id and cm.user_id=viewer
      join public.messages m on m.conversation_id=a.id and m.created_at>cm.last_read_at
      where m.sender_id<>viewer and m.deleted_at is null group by m.conversation_id
  ) select c.conversation_id,sum(c.n)::bigint from counts c group by c.conversation_id;
end $$;

-- Search's unread tab only needs existence, not a recount of the entire
-- history for every candidate. Keep the same two branches as the old badge.
create function read_paging.inbox_has_unread(p_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid();
begin
  if viewer is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501';end if;
  if not exists(select 1 from public.conversations c where c.id=p_id
    and ((not c.is_group and (c.user_1=viewer or c.user_2=viewer))
      or exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=viewer))) then
    return false;
  end if;
  return exists(select 1 from public.messages m where m.conversation_id=p_id and m.receiver_id=viewer
    and m.sender_id<>viewer and m.read_at is null and m.deleted_at is null)
    or exists(select 1 from public.conversation_members cm join public.messages m on m.conversation_id=cm.conversation_id
      and m.created_at>cm.last_read_at where cm.conversation_id=p_id and cm.user_id=viewer
      and m.sender_id<>viewer and m.deleted_at is null);
end $$;

create function public.get_inbox_page_v2(
  p_context text default null,p_cursor jsonb default null,p_limit integer default 30,
  p_order text default 'pinned',p_folder text default 'all',p_include_groups boolean default true,
  p_include_deleted boolean default false,p_include_badges boolean default false,
  p_ids uuid[] default null,p_search text default null,p_search_mode text default 'web',
  p_filter text default 'all',p_exclude_community boolean default false,p_exclude_requests boolean default false
)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare
  viewer uuid:=auth.uid(); filters jsonb; cursor_pin integer; cursor_time timestamptz; cursor_id uuid;
  selected jsonb; items jsonb; last_row jsonb; next_cursor jsonb; has_more boolean; badges jsonb;
  search_value text; skip_ui_filters boolean;
begin
  if viewer is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  if (public.get_paged_reader_capabilities()->>'inbox') is distinct from 'true' then
    raise exception 'PAGED_INBOX_READER_NOT_READY' using errcode='55000';
  end if;
  if p_limit is null or p_limit not between 1 and 50 or (p_context is not null and p_context not in('personal','market','jobs'))
    or p_order is null or p_order not in('pinned','activity') or p_folder is null or p_folder not in('all','active','archived')
    or p_include_groups is null or p_include_deleted is null or p_include_badges is null
    or p_search_mode is null or p_search_mode not in('native','web') or p_filter is null or p_filter not in('all','groups','unread')
    or p_exclude_community is null or p_exclude_requests is null
    or (p_ids is not null and (coalesce(array_ndims(p_ids),1)<>1 or cardinality(p_ids)>50 or array_position(p_ids,null) is not null)) then
    raise exception 'INVALID_INBOX_PAGE_REQUEST' using errcode='22023';
  end if;
  if p_ids is not null then select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into p_ids from unnest(p_ids) x;end if;
  -- JS trim removes only leading/trailing whitespace. Native search does not
  -- trim; both use literal includes, so %, _ and backslash are ordinary text.
  search_value:=coalesce(p_search,'');
  if p_search_mode='web' then search_value:=regexp_replace(search_value,
    U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+|[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+$', '', 'g');end if;
  search_value:=lower(search_value collate pg_catalog."und-x-icu");
  skip_ui_filters:=p_ids is not null or (p_search_mode='native' and p_folder='archived');
  filters:=jsonb_build_object('context',p_context,'order',p_order,'folder',p_folder,
    'include_groups',p_include_groups,'include_deleted',p_include_deleted,'ids',p_ids,
    'search',p_search,'search_mode',p_search_mode,'filter',p_filter,
    'exclude_community',p_exclude_community,'exclude_requests',p_exclude_requests);
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>4096
      or p_cursor->>'version' is distinct from '2' or p_cursor->>'viewer' is distinct from viewer::text
      or p_cursor->'filters' is distinct from filters then
      raise exception 'INVALID_INBOX_CURSOR' using errcode='22023';
    end if;
    begin
      cursor_pin:=(p_cursor->>'pin')::integer;cursor_time:=(p_cursor->>'activity_at')::timestamptz;
      cursor_id:=(p_cursor->>'id')::uuid;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
      raise exception 'INVALID_INBOX_CURSOR' using errcode='22023';
    end;
    if cursor_pin is null or cursor_pin not in(0,1) or (p_order='activity' and cursor_pin<>0)
      or cursor_time is null or not isfinite(cursor_time) or cursor_id is null then
      raise exception 'INVALID_INBOX_CURSOR' using errcode='22023';
    end if;
  end if;
  -- Resolve membership first, using existing user_1/user_2/member indexes.
  -- Profile search and unread existence may inspect the viewer's candidate
  -- set, but full profile projection and unread counts run only for this page.
  with mine as materialized (
    select c.id from public.conversations c where c.user_1=viewer and not c.is_group and (p_ids is null or c.id=any(p_ids))
    union select c.id from public.conversations c where c.user_2=viewer and not c.is_group and (p_ids is null or c.id=any(p_ids))
    union select c.id from public.conversation_members cm join public.conversations c on c.id=cm.conversation_id
      where cm.user_id=viewer and c.is_group and p_include_groups and (p_ids is null or c.id=any(p_ids))
  ), candidate_window as materialized (
    select c.*,coalesce(cs.is_pinned,false) pinned,coalesce(cs.is_muted,false) muted,
      coalesce(cs.is_archived,false) archived,coalesce(cs.is_deleted,false) deleted,
      coalesce(cs.manually_unread,false) marked_unread,
      case when p_order='pinned' and coalesce(cs.is_pinned,false) then 1 else 0 end pin,
      date_trunc('milliseconds',coalesce(c.last_message_time,'epoch'::timestamptz)) activity_at
    from mine join public.conversations c on c.id=mine.id
      left join public.conversation_settings cs on cs.conversation_id=c.id and cs.user_id=viewer
      left join public.profiles search_profile on not c.is_group and search_value<>'' and not skip_ui_filters
        and search_profile.id=case when c.user_1=viewer then c.user_2 else c.user_1 end
    where (p_context is null or coalesce(c.context,'personal')=p_context)
      and (p_include_deleted or not coalesce(cs.is_deleted,false))
      and (p_ids is not null or p_folder='all' or (p_folder='archived')=coalesce(cs.is_archived,false))
      and (skip_ui_filters or (
        (not p_exclude_community or not coalesce(c.is_group and c.group_type='community',false))
        and (not p_exclude_requests or not coalesce(not c.is_group and c.request_status='pending'
          and c.request_sender_id=case when c.user_1=viewer then c.user_2 else c.user_1 end,false))
        and (p_filter='all' or (p_filter='groups' and c.is_group) or (p_filter='unread' and read_paging.inbox_has_unread(c.id)))
        and (search_value='' or strpos(lower((
          case when c.is_group then coalesce(nullif(c.group_name,''),'Group') else coalesce(nullif(search_profile.full_name,''),'Member') end
          ||case when p_search_mode='web' then ' '||case when not c.is_group then coalesce(search_profile.username,'') else '' end else '' end
        ) collate pg_catalog."und-x-icu"),search_value)>0)
      ))
      and (p_cursor is null or (
        case when p_order='pinned' and coalesce(cs.is_pinned,false) then 1 else 0 end,
        date_trunc('milliseconds',coalesce(c.last_message_time,'epoch'::timestamptz)),c.id
      )<(cursor_pin,cursor_time,cursor_id))
    order by pin desc,activity_at desc,c.id desc limit p_limit+1
  ), chosen as materialized (select * from candidate_window order by pin desc,activity_at desc,id desc limit p_limit),
  unread as materialized (
    select * from read_paging.inbox_unread(coalesce((select array_agg(id) from chosen),'{}'::uuid[]))
  )
  select jsonb_build_object('has_more',(select count(*)>p_limit from candidate_window),
    'summary',(select jsonb_build_object('total',count(*),'archived_personal',count(*) filter(where coalesce(c.context,'personal')='personal' and coalesce(cs.is_archived,false)))
      from mine join public.conversations c on c.id=mine.id
      left join public.conversation_settings cs on cs.conversation_id=c.id and cs.user_id=viewer
      where (p_context is null or coalesce(c.context,'personal')=p_context) and (p_include_deleted or not coalesce(cs.is_deleted,false))),
    'rows',coalesce(jsonb_agg(jsonb_build_object('pin',w.pin,'activity_at',w.activity_at,'id',w.id,
      'item',jsonb_build_object('id',w.id,'is_group',w.is_group,
        'other_id',case when not w.is_group then case when w.user_1=viewer then w.user_2 else w.user_1 end end,
        'title',case when w.is_group then coalesce(nullif(w.group_name,''),'Group') else coalesce(nullif(pr.full_name,''),'Member') end,
        'username',case when not w.is_group then pr.username end,
        'avatar',case when w.is_group then w.group_avatar_url else pr.avatar_url end,
        'other_is_verified',case when not w.is_group then coalesce(pr.is_verified,false) else false end,
        'other_verified_tier',case when not w.is_group then pr.verified_tier end,
        'last_message',coalesce(w.last_message,''),'last_message_time',w.last_message_time,
        'unread',coalesce(u.unread,0),'context',coalesce(w.context,'personal'),'context_ref_id',w.context_ref_id,
        'group_emoji',case when w.is_group then coalesce(nullif(w.group_emoji,''),'💬') end,
        'group_type',case when w.is_group then w.group_type end,'group_ref_id',case when w.is_group then w.group_ref_id end,
        'request_pending',coalesce(not w.is_group and w.request_status='pending'
          and w.request_sender_id=case when w.user_1=viewer then w.user_2 else w.user_1 end,false),
        'is_request',w.is_request,'request_status',w.request_status,
        'is_pinned',w.pinned,'is_muted',w.muted,'is_archived',w.archived,
        'is_deleted',w.deleted,'manually_unread',w.marked_unread))
      order by w.pin desc,w.activity_at desc,w.id desc),'[]'::jsonb)) into selected
  from chosen w left join public.profiles pr
    on not w.is_group and pr.id=case when w.user_1=viewer then w.user_2 else w.user_1 end
    left join unread u on u.conversation_id=w.id;
  has_more:=(selected->>'has_more')::boolean;
  select coalesce(jsonb_agg(e.value->'item' order by e.ordinality),'[]'::jsonb) into items
    from jsonb_array_elements(selected->'rows') with ordinality e(value,ordinality);
  if has_more then
    last_row:=(selected->'rows')->(p_limit-1);
    next_cursor:=jsonb_build_object('version',2,'viewer',viewer,'filters',filters,
      'pin',last_row->'pin','activity_at',last_row->'activity_at','id',last_row->'id');
  end if;
  -- Full badge semantics remain independent of pagination and retain the
  -- established get_context_unread RLS/receiver rules. Never sum the page.
  if p_include_badges then badges:=public.get_context_unread(); end if;
  return jsonb_build_object('version',2,'items',items,'has_more',has_more,'next_cursor',next_cursor,
    'badges_included',p_include_badges,'badges',badges,'summary',selected->'summary','ordering','live');
end $$;

-- The web market badge historically sums both get_unread_counts branches for
-- every RLS-visible conversation in that context. It must not sum a page or
-- switch to get_context_unread, whose established receiver/deletion rules differ.
create function public.get_inbox_unread_totals_v2()
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501';end if;
  if (public.get_paged_reader_capabilities()->>'inbox') is distinct from 'true' then
    raise exception 'PAGED_INBOX_READER_NOT_READY' using errcode='55000';end if;
  return (with counts as materialized(select * from public.get_unread_counts()),
    totals as(select coalesce(c.context,'personal') context,sum(u.unread)::bigint n
      from public.conversations c join counts u on u.conversation_id=c.id
      where (not c.is_group and (c.user_1=(select auth.uid()) or c.user_2=(select auth.uid())))
        or (c.is_group and exists(select 1 from public.conversation_members m where m.conversation_id=c.id and m.user_id=(select auth.uid())))
      group by coalesce(c.context,'personal'))
    select jsonb_build_object('version',2,'personal',coalesce((select n from totals where context='personal'),0),
      'market',coalesce((select n from totals where context='market'),0),'jobs',coalesce((select n from totals where context='jobs'),0)));
end $$;
revoke all on all functions in schema read_paging from public,anon,authenticated,service_role;
-- The SECURITY INVOKER inbox reader needs only this bounded helper, not tables.
grant usage on schema read_paging to authenticated;
grant execute on function read_paging.inbox_unread(uuid[]),read_paging.inbox_has_unread(uuid) to authenticated;
revoke all on function public.get_inbox_page_v2(text,jsonb,integer,text,text,boolean,boolean,boolean,uuid[],text,text,text,boolean,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.get_inbox_page_v2(text,jsonb,integer,text,text,boolean,boolean,boolean,uuid[],text,text,text,boolean,boolean) to authenticated;
revoke all on function public.get_inbox_unread_totals_v2() from public,anon,authenticated,service_role;
grant execute on function public.get_inbox_unread_totals_v2() to authenticated;
notify pgrst,'reload schema';
-- END REVIEWED READER SOURCE: 20261102064915_bounded_book_and_inbox_readers.sql

-- BEGIN REVIEWED READER SOURCE: 20261102074640_bounded_context_inbox_reader.sql
-- The Market/Jobs inbox has an older, distinct contract: exclude every
-- is_request row; include DM membership; count unread receiver messages even
-- when deleted; retain the subject projection and NULLS LAST activity order.
-- Keep that contract, with detail/count work restricted to at most 50 rows.
-- This uses the existing default-off inbox capability and does not enable it.
create index messages_context_unread_window_idx
  on public.messages(receiver_id,conversation_id) where read_at is null;

create function public.get_context_inbox_page_v2(
  p_context text,p_cursor jsonb default null,p_limit integer default 30,p_ids uuid[] default null
)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare
  viewer uuid:=auth.uid(); cursor_time timestamptz; cursor_id uuid;
  selected jsonb; items jsonb; last_row jsonb; next_cursor jsonb; has_more boolean;
begin
  if viewer is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501';end if;
  if (public.get_paged_reader_capabilities()->>'inbox') is distinct from 'true' then
    raise exception 'PAGED_INBOX_READER_NOT_READY' using errcode='55000';
  end if;
  if p_context is null or p_context not in('market','jobs') or p_limit is null or p_limit not between 1 and 50
    or (p_ids is not null and (coalesce(array_ndims(p_ids),1)<>1 or cardinality(p_ids)>50
      or array_position(p_ids,null) is not null or p_cursor is not null)) then
    raise exception 'INVALID_CONTEXT_INBOX_REQUEST' using errcode='22023';
  end if;
  if p_ids is not null then select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into p_ids from unnest(p_ids) x;end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048
      or p_cursor->>'version' is distinct from '2' or p_cursor->>'kind' is distinct from 'context_inbox'
      or p_cursor->>'viewer' is distinct from viewer::text or p_cursor->>'context' is distinct from p_context
      or not (p_cursor ? 'activity_at') or jsonb_typeof(p_cursor->'activity_at') not in('string','null') then
      raise exception 'INVALID_CONTEXT_INBOX_CURSOR' using errcode='22023';
    end if;
    begin
      cursor_time:=(p_cursor->>'activity_at')::timestamptz;cursor_id:=(p_cursor->>'id')::uuid;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
      raise exception 'INVALID_CONTEXT_INBOX_CURSOR' using errcode='22023';
    end;
    if cursor_id is null or (cursor_time is not null and not isfinite(cursor_time)) then
      raise exception 'INVALID_CONTEXT_INBOX_CURSOR' using errcode='22023';
    end if;
  end if;

  with mine as materialized (
    select c.id from public.conversations c where c.user_1=viewer and (p_ids is null or c.id=any(p_ids))
    union select c.id from public.conversations c where c.user_2=viewer and (p_ids is null or c.id=any(p_ids))
    union select cm.conversation_id from public.conversation_members cm
      where cm.user_id=viewer and (p_ids is null or cm.conversation_id=any(p_ids))
  ), candidate_window as materialized (
    select c.* from mine join public.conversations c on c.id=mine.id
    where coalesce(c.context,'personal')=p_context and not coalesce(c.is_group,false)
      and not coalesce(c.is_request,false)
      and (p_cursor is null or (
        (cursor_time is not null and (c.last_message_time is null or c.last_message_time<cursor_time
          or (c.last_message_time=cursor_time and c.id<cursor_id)))
        or (cursor_time is null and c.last_message_time is null and c.id<cursor_id)
      ))
    order by c.last_message_time desc nulls last,c.id desc limit p_limit+1
  ), chosen as materialized (
    select * from candidate_window order by last_message_time desc nulls last,id desc limit p_limit
  ), unread as materialized (
    select m.conversation_id,count(*)::integer n from chosen c
      join public.messages m on m.conversation_id=c.id
    where m.receiver_id=viewer and m.sender_id<>viewer and m.read_at is null
    group by m.conversation_id
  )
  select jsonb_build_object('has_more',(select count(*)>p_limit from candidate_window),
    'rows',coalesce(jsonb_agg(jsonb_build_object('activity_at',c.last_message_time,'id',c.id,
      'item',jsonb_build_object('id',c.id,'conversation_id',c.id,'is_group',coalesce(c.is_group,false),
        'group_name',c.group_name,'group_avatar_url',c.group_avatar_url,
        'other_id',other.id,'other_name',other.full_name,'other_username',other.username,'other_avatar',other.avatar_url,
        'last_message',c.last_message,'last_message_time',c.last_message_time,'last_message_sender_id',c.last_message_sender_id,
        'unread_count',coalesce(u.n,0),'context',coalesce(c.context,'personal'),'context_ref_id',c.context_ref_id,
        'ref_title',case when c.context='market' then l.title when c.context='jobs' then j.title end,
        'ref_subtitle',case when c.context='market' then coalesce(l.currency,'USD')||' '||l.price::text when c.context='jobs' then j.company end,
        'ref_image',case when c.context='market' then l.images[1] end))
      order by c.last_message_time desc nulls last,c.id desc),'[]'::jsonb)) into selected
  from chosen c
    left join public.profiles other on other.id=case when c.user_1=viewer then c.user_2 else c.user_1 end
    left join public.marketplace_listings l on c.context='market' and l.id=c.context_ref_id
    left join public.jobs j on c.context='jobs' and j.id=c.context_ref_id
    left join unread u on u.conversation_id=c.id;

  has_more:=(selected->>'has_more')::boolean;
  select coalesce(jsonb_agg(e.value->'item' order by e.ordinality),'[]'::jsonb) into items
    from jsonb_array_elements(selected->'rows') with ordinality e(value,ordinality);
  if has_more then
    last_row:=(selected->'rows')->(p_limit-1);
    next_cursor:=jsonb_build_object('version',2,'kind','context_inbox','viewer',viewer,'context',p_context,
      'activity_at',last_row->'activity_at','id',last_row->'id');
  end if;
  return jsonb_build_object('version',2,'items',items,'has_more',has_more,'next_cursor',next_cursor,'ordering','live');
end $$;
revoke all on function public.get_context_inbox_page_v2(text,jsonb,integer,uuid[]) from public,anon,service_role;
grant execute on function public.get_context_inbox_page_v2(text,jsonb,integer,uuid[]) to authenticated;
-- END REVIEWED READER SOURCE: 20261102074640_bounded_context_inbox_reader.sql

-- BEGIN REVIEWED READER SOURCE: 20261102075537_bounded_business_inbox_reader.sql
-- Acting-business access deliberately retains the original SECURITY DEFINER
-- contract and canonical is_business_member gate (including organization and
-- delegated access). Personal inbox RLS/unread/settings rules are different.
-- No readiness flag changes here. Existing complete APIs remain available.
create function public.get_business_inbox_page_v2(
  p_business_id uuid,p_tab text default 'primary',p_cursor jsonb default null,
  p_limit integer default 30,p_ids uuid[] default null
)
returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare
  viewer uuid:=auth.uid(); cursor_time timestamptz; cursor_id uuid;
  selected jsonb; items jsonb; last_row jsonb; next_cursor jsonb; has_more boolean;
begin
  if viewer is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501';end if;
  if (public.get_paged_reader_capabilities()->>'inbox') is distinct from 'true' then
    raise exception 'PAGED_INBOX_READER_NOT_READY' using errcode='55000';
  end if;
  if p_business_id is null or p_tab is null or p_tab not in('primary','requests')
    or p_limit is null or p_limit not between 1 and 50
    or (p_ids is not null and (coalesce(array_ndims(p_ids),1)<>1 or cardinality(p_ids)>50
      or array_position(p_ids,null) is not null or p_cursor is not null)) then
    raise exception 'INVALID_BUSINESS_INBOX_REQUEST' using errcode='22023';
  end if;
  -- An inaccessible business returns the same empty collection as the old
  -- API, with fixed totals and no existence or message metadata disclosure.
  if not coalesce(public.is_business_member(p_business_id),false) then
    return jsonb_build_object('version',2,'can_view',false,'items','[]'::jsonb,'has_more',false,'next_cursor',null,
      'summary',jsonb_build_object('primary',0,'requests',0),'ordering','live');
  end if;
  if p_ids is not null then select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into p_ids from unnest(p_ids) x;end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048
      or p_cursor->>'version' is distinct from '2' or p_cursor->>'kind' is distinct from 'business_inbox'
      or p_cursor->>'viewer' is distinct from viewer::text or p_cursor->>'business' is distinct from p_business_id::text
      or p_cursor->>'tab' is distinct from p_tab or not (p_cursor ? 'activity_at')
      or jsonb_typeof(p_cursor->'activity_at') not in('string','null') then
      raise exception 'INVALID_BUSINESS_INBOX_CURSOR' using errcode='22023';
    end if;
    begin
      cursor_time:=(p_cursor->>'activity_at')::timestamptz;cursor_id:=(p_cursor->>'id')::uuid;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
      raise exception 'INVALID_BUSINESS_INBOX_CURSOR' using errcode='22023';
    end;
    if cursor_id is null or (cursor_time is not null and not isfinite(cursor_time)) then
      raise exception 'INVALID_BUSINESS_INBOX_CURSOR' using errcode='22023';
    end if;
  end if;

  with mine as materialized (
    select c.id from public.conversations c where c.user_1=p_business_id and c.type='direct' and (p_ids is null or c.id=any(p_ids))
    union select c.id from public.conversations c where c.user_2=p_business_id and c.type='direct' and (p_ids is null or c.id=any(p_ids))
  ), base as materialized (
    select c.id,c.context,other.id other_id,lm.id last_message_id,lm.created_at last_at,
      not exists(select 1 from public.messages mb where mb.conversation_id=c.id and mb.sender_id=p_business_id) is_request
    from mine join public.conversations c on c.id=mine.id
      join public.profiles other on other.id=case when c.user_1=p_business_id then c.user_2 else c.user_1 end
      left join lateral (
        select m.id,m.created_at from public.messages m where m.conversation_id=c.id
        order by m.created_at desc limit 1
      ) lm on true
  ), candidate_window as materialized (
    select b.* from base b where (p_ids is not null or b.is_request=(p_tab='requests'))
      and (p_cursor is null or (
        (cursor_time is not null and (b.last_at is null or b.last_at<cursor_time or (b.last_at=cursor_time and b.id<cursor_id)))
        or (cursor_time is null and b.last_at is null and b.id<cursor_id)
      ))
    order by b.last_at desc nulls last,b.id desc limit p_limit+1
  ), chosen as materialized (
    select * from candidate_window order by last_at desc nulls last,id desc limit p_limit
  ), unread as materialized (
    select m.conversation_id,count(*)::integer n from chosen c join public.messages m on m.conversation_id=c.id
    where m.receiver_id=p_business_id and m.sender_id<>p_business_id and m.read_at is null
    group by m.conversation_id
  )
  select jsonb_build_object('has_more',(select count(*)>p_limit from candidate_window),
    'summary',(select jsonb_build_object('primary',count(*) filter(where not is_request),'requests',count(*) filter(where is_request)) from base),
    'rows',coalesce(jsonb_agg(jsonb_build_object('activity_at',c.last_at,'id',c.id,
      'item',jsonb_build_object('id',c.id,'conversation_id',c.id,'context',c.context,
        'other_id',c.other_id,'other_name',other.full_name,'other_username',other.username,'other_avatar',other.avatar_url,
        'last_text',lm.text,'last_at',c.last_at,'last_sender',lm.sender_id,
        'unread',coalesce(u.n,0),'is_request',c.is_request)) order by c.last_at desc nulls last,c.id desc),'[]'::jsonb)) into selected
    from chosen c join public.profiles other on other.id=c.other_id
      left join public.messages lm on lm.id=c.last_message_id
      left join unread u on u.conversation_id=c.id;
  has_more:=(selected->>'has_more')::boolean;
  select coalesce(jsonb_agg(e.value->'item' order by e.ordinality),'[]'::jsonb) into items
    from jsonb_array_elements(selected->'rows') with ordinality e(value,ordinality);
  if has_more then
    last_row:=(selected->'rows')->(p_limit-1);
    next_cursor:=jsonb_build_object('version',2,'kind','business_inbox','viewer',viewer,'business',p_business_id,'tab',p_tab,
      'activity_at',last_row->'activity_at','id',last_row->'id');
  end if;
  return jsonb_build_object('version',2,'can_view',true,'items',items,'has_more',has_more,'next_cursor',next_cursor,
    'summary',selected->'summary','ordering','live');
end $$;
revoke all on function public.get_business_inbox_page_v2(uuid,text,jsonb,integer,uuid[]) from public,anon,service_role;
grant execute on function public.get_business_inbox_page_v2(uuid,text,jsonb,integer,uuid[]) to authenticated;
-- END REVIEWED READER SOURCE: 20261102075537_bounded_business_inbox_reader.sql

-- BEGIN REVIEWED READER SOURCE: 20261102075616_bounded_inbox_mentions.sql
-- The client supplies only its loaded conversations. Keep both existing table
-- RLS policies in force; message deletion is deliberately not an extra filter.
-- Fail on an unexpected name collision rather than accepting a different index.
create index message_mentions_recipient_created_message_idx
  on public.message_mentions (mentioned_user_id, created_at desc, message_id);

create function public.get_inbox_mentions_v2(
  p_conversation_ids uuid[],
  p_since timestamptz default (now() - interval '7 days')
) returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
  v_items jsonb;
  v_since timestamptz;
begin
  if v_viewer is null then
    raise exception 'AUTHENTICATED_SESSION_REQUIRED' using errcode = '42501';
  end if;
  -- An authenticated caller cannot expand this purpose-specific reader into
  -- an arbitrary historical scan. A later client cutoff stays exact.
  v_since := greatest(p_since, transaction_timestamp() - interval '7 days');
  if (public.get_paged_reader_capabilities()->>'inbox') is distinct from 'true' then
    raise exception 'INBOX_READER_NOT_READY' using errcode = '55000';
  end if;
  if p_conversation_ids is null or coalesce(array_ndims(p_conversation_ids), 1) <> 1
    or cardinality(p_conversation_ids) > 50 or array_position(p_conversation_ids, null) is not null
    or p_since is null or not isfinite(p_since) then
    raise exception 'INVALID_INBOX_MENTION_WINDOW' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'conversation_id', latest.conversation_id,
    'latest_mention_at', latest.created_at
  ) order by latest.conversation_id), '[]'::jsonb)
  into v_items
  from (
    select m.conversation_id, max(mm.created_at) as created_at
    from public.message_mentions mm
    join public.messages m on m.id = mm.message_id
    where mm.mentioned_user_id = v_viewer
      and mm.created_at > v_since
      and m.conversation_id = any(p_conversation_ids)
    group by m.conversation_id
  ) latest;

  return jsonb_build_object('version', 1, 'since', v_since, 'items', v_items);
end;
$$;

revoke all on function public.get_inbox_mentions_v2(uuid[], timestamptz) from public, anon, service_role;
grant execute on function public.get_inbox_mentions_v2(uuid[], timestamptz) to authenticated;
-- END REVIEWED READER SOURCE: 20261102075616_bounded_inbox_mentions.sql

-- BEGIN REVIEWED READER SOURCE: 20261102091728_bounded_memory_book_windows.sql
-- Bidirectional seek windows for ordinary book reading. Complete export and
-- editing readers retain their explicit forward-completion contract.
create function public.get_memory_book_window_v3(p_album uuid,p_anchor uuid,p_revision text,
 p_before integer default 12,p_after integer default 35) returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare viewer uuid:=read_paging_support.actor(false);a public.memory_albums;anchor public.memory_pages;
 rev text;left_rows jsonb;right_rows jsonb;left_pages jsonb;right_pages jsonb;anchor_page jsonb;
 last_row jsonb;next_cursor jsonb;has_previous boolean;has_more boolean;
begin
 if not exists(select 1 from read_paging.settings where singleton and books_ready) then
  raise exception 'PAGED_BOOK_READER_NOT_READY' using errcode='55000';
 end if;
 if p_album is null or p_anchor is null or p_revision is null or p_revision!~'^[0-9]{1,20}$'
  or p_before is null or p_after is null or p_before<0 or p_after<0 or p_before+p_after>47 then
  raise exception 'INVALID_BOOK_WINDOW' using errcode='22023';
 end if;
 select * into a from public.memory_albums where id=p_album;
 if not found or not public.can_view_memory_book(p_album) then
  return jsonb_build_object('version',3,'can_view',false,'pages','[]'::jsonb);
 end if;
 select coalesce((select revision from read_paging.library_revision where owner_id=a.user_id),0)::text into rev;
 if rev is distinct from p_revision then raise exception 'MEMORY_BOOK_CHANGED' using errcode='40001';end if;
 select mp.* into anchor from public.memory_pages mp join public.stories s on s.id=mp.story_id and s.user_id=a.user_id
  where mp.id=p_anchor and mp.album_id=a.id and mp.user_id=a.user_id;
 if not found then raise exception 'MEMORY_BOOK_CHANGED' using errcode='40001';end if;
 select read_paging.page_json(anchor,s,true) into anchor_page from public.stories s where s.id=anchor.story_id and s.user_id=a.user_id;
 select coalesce(jsonb_agg(jsonb_build_object('page',read_paging.page_json(q.mp,q.s,true),
  'sort_order',(q.mp).sort_order,'created_at',(q.mp).created_at,'id',(q.mp).id)
  order by (q.mp).sort_order desc,(q.mp).created_at desc,(q.mp).id desc),'[]'::jsonb) into left_rows
 from (select mp,s from public.memory_pages mp join public.stories s on s.id=mp.story_id and s.user_id=a.user_id
  where mp.album_id=a.id and mp.user_id=a.user_id
   and (mp.sort_order,mp.created_at,mp.id)<(anchor.sort_order,anchor.created_at,anchor.id)
  order by mp.sort_order desc,mp.created_at desc,mp.id desc limit p_before+1) q;
 select coalesce(jsonb_agg(jsonb_build_object('page',read_paging.page_json(q.mp,q.s,true),
  'sort_order',(q.mp).sort_order,'created_at',(q.mp).created_at,'id',(q.mp).id)
  order by (q.mp).sort_order,(q.mp).created_at,(q.mp).id),'[]'::jsonb) into right_rows
 from (select mp,s from public.memory_pages mp join public.stories s on s.id=mp.story_id and s.user_id=a.user_id
  where mp.album_id=a.id and mp.user_id=a.user_id
   and (mp.sort_order,mp.created_at,mp.id)>(anchor.sort_order,anchor.created_at,anchor.id)
  order by mp.sort_order,mp.created_at,mp.id limit p_after+1) q;
 has_previous:=jsonb_array_length(left_rows)>p_before;
 has_more:=jsonb_array_length(right_rows)>p_after;
 select coalesce(jsonb_agg(e.value->'page' order by e.ordinality desc),'[]'::jsonb) into left_pages
  from jsonb_array_elements(left_rows) with ordinality e(value,ordinality) where e.ordinality<=p_before;
 select coalesce(jsonb_agg(e.value->'page' order by e.ordinality),'[]'::jsonb) into right_pages
  from jsonb_array_elements(right_rows) with ordinality e(value,ordinality) where e.ordinality<=p_after;
 if has_more then
  last_row:=case when p_after>0 then right_rows->(p_after-1) else
   jsonb_build_object('sort_order',anchor.sort_order,'created_at',anchor.created_at,'id',anchor.id) end;
  next_cursor:=jsonb_build_object('version',2,'album',a.id,'viewer',viewer,'revision',rev,
   'sort_order',last_row->'sort_order','created_at',last_row->'created_at','id',last_row->'id');
 end if;
 return jsonb_build_object('version',3,'id',a.id,'can_view',true,'revision',rev,
  'pages',left_pages||jsonb_build_array(anchor_page)||right_pages,'anchor_index',jsonb_array_length(left_pages),
  'has_previous',has_previous,'has_more',has_more,'next_cursor',next_cursor);
end $$;
revoke all on function public.get_memory_book_window_v3(uuid,uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_memory_book_window_v3(uuid,uuid,text,integer,integer) to authenticated;
create function public.get_default_memory_book_page_v3(p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=read_paging_support.actor(false);book_id uuid;
begin
 if not exists(select 1 from read_paging.settings where singleton and books_ready) then
  raise exception 'PAGED_BOOK_READER_NOT_READY' using errcode='55000';
 end if;
 select a.id into book_id from public.memory_albums a where a.user_id=p_owner and a.is_default order by a.created_at,a.id limit 1;
 if book_id is null or not public.can_view_memory_book(book_id) then
  return jsonb_build_object('version',2,'can_view',false,'is_owner',false,'count',0,
   'pages','[]'::jsonb,'next_cursor',null,'has_more',false,'metadata_included',true);
 end if;
 return public.get_memory_book_page_v2(book_id,null,24);
end $$;
revoke all on function public.get_default_memory_book_page_v3(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_default_memory_book_page_v3(uuid) to authenticated;
create or replace function public.get_paged_reader_capabilities()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',1,'books',s.books_ready and read_paging_support.eligible(),
  'books_window',s.books_ready and read_paging_support.eligible(),
  'inbox',s.inbox_ready and read_paging_support.eligible(),'book_page_limit',40,'book_window_limit',48,'inbox_page_limit',50)
 from read_paging.settings s where s.singleton;
$$;
-- END REVIEWED READER SOURCE: 20261102091728_bounded_memory_book_windows.sql

-- Private implementation remains unreachable to every API role. Existing
-- public functions, grants, policies, hooks and buckets were not touched.
revoke all on all functions in schema read_paging_support from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
