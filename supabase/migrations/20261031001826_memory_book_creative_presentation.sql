-- Creative book storage and validation. Public creative RPCs remain absent
-- until the final projection/activation unit; legacy books keep original timing.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
begin
 if current_user<>'postgres' then raise exception 'MEMORY_CREATIVE_POSTGRES_REQUIRED';end if;
 if not exists(select 1 from pg_trigger t join pg_proc f on f.oid=t.tgfoid
  where t.tgrelid='public.memory_albums'::regclass and t.tgname='memory_book_cover'
   and t.tgenabled='O' and not t.tgisinternal and t.tgtype=23 and t.tgqual is null
   and f.oid=to_regprocedure('public.validate_memory_book_cover()')
   and f.proowner='postgres'::regrole and f.prosecdef and f.proconfig=array['search_path=""']::text[]
   and md5(f.prosrc)='c564cf37800f4b0ecb26ade7fcab3bb8'
   and (select array_agg(a.attname::text order by a.attname) from unnest(t.tgattr) x(attnum)
    join pg_attribute a on a.attrelid=t.tgrelid and a.attnum=x.attnum)=array['cover_story_id','user_id']::text[])
  then raise exception 'MEMORY_COVER_GUARD_REQUIRED';end if;
 if to_regnamespace('memory_creative') is not null then raise exception 'MEMORY_CREATIVE_ALREADY_EXISTS';end if;
 if to_regprocedure('media_delivery.require_session()') is null
  or to_regprocedure('account_erasure.assert_writable(uuid)') is null
  or to_regprocedure('public.add_memory_page(uuid,text,text,uuid)') is null
  or to_regprocedure('public.can_view_memory_book(uuid)') is null
  or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='memory_albums' and column_name='cover_story_id') then
  raise exception 'MEMORY_CREATIVE_PREREQUISITE_REQUIRED';end if;
end $preflight$;
create schema memory_creative;
revoke all on schema memory_creative from public,anon,authenticated,service_role;
create table memory_creative.installation(singleton boolean primary key default true check(singleton),stage integer not null check(stage between 1 and 3));
insert into memory_creative.installation(singleton,stage) values(true,1);
create table memory_creative.create_requests(
 request_id uuid primary key,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 creation_hash bytea not null check(octet_length(creation_hash)=32),
 response jsonb not null check(jsonb_typeof(response)='object'),
 created_at timestamptz not null default clock_timestamp()
);
create index memory_creative_request_owner on memory_creative.create_requests(owner_id);
alter table memory_creative.installation enable row level security;
alter table memory_creative.create_requests enable row level security;
revoke all on all tables in schema memory_creative from public,anon,authenticated,service_role;

create function memory_creative.valid_text(p_text text,p_limit integer)
returns boolean language sql immutable set search_path='' as $$
 select p_text is not null and length(p_text)<=p_limit and not exists(
  select 1 from generate_series(1,length(p_text)) i
  where ascii(substr(p_text,i,1))=127
   or (ascii(substr(p_text,i,1))<32 and ascii(substr(p_text,i,1)) not in(9,10,13)));
$$;
create function memory_creative.cover(p jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare photo jsonb;x numeric;y numeric;scale numeric;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>4096 then raise exception 'INVALID_MEMORY_COVER_ARTWORK';end if;
 if not(p ?& array['version','inscription','inscriptionStyle','inscriptionPosition','postmark','showDate','photo'])
  or p-array['version','inscription','inscriptionStyle','inscriptionPosition','postmark','showDate','photo']<>'{}'::jsonb
  or p->'version' is distinct from '1'::jsonb
  or jsonb_typeof(p->'inscription') is distinct from 'string'
  or not memory_creative.valid_text(p->>'inscription',160)
  or jsonb_typeof(p->'postmark') is distinct from 'string'
  or not memory_creative.valid_text(p->>'postmark',32)
  or ((p->>'inscriptionStyle') in('handwritten','serif','sans')) is not true
  or ((p->>'inscriptionPosition') in('top','bottom')) is not true
  or jsonb_typeof(p->'showDate') is distinct from 'boolean'
  or jsonb_typeof(p->'photo') is distinct from 'object' then raise exception 'INVALID_MEMORY_COVER_ARTWORK';end if;
 photo:=p->'photo';
 if not(photo ?& array['x','y','scale']) or photo-array['x','y','scale']<>'{}'::jsonb
  or jsonb_typeof(photo->'x') is distinct from 'number'
  or jsonb_typeof(photo->'y') is distinct from 'number'
  or jsonb_typeof(photo->'scale') is distinct from 'number' then raise exception 'INVALID_MEMORY_COVER_ARTWORK';end if;
 x:=(photo->>'x')::numeric;y:=(photo->>'y')::numeric;scale:=(photo->>'scale')::numeric;
 if x not between 0 and 1 or y not between 0 and 1 or scale not between 1 and 2.5 then raise exception 'INVALID_MEMORY_COVER_ARTWORK';end if;
 return jsonb_build_object('version',1,'inscription',p->>'inscription','inscriptionStyle',p->>'inscriptionStyle',
  'inscriptionPosition',p->>'inscriptionPosition','postmark',p->>'postmark','showDate',p->'showDate',
  'photo',jsonb_build_object('x',x::double precision,'y',y::double precision,'scale',scale::double precision));
end $$;
create function memory_creative.film(p jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>1024 then raise exception 'INVALID_MEMORY_FILM_SETTINGS';end if;
 if not(p ?& array['version','mode','style','length','order','titleCard','originalAudio'])
  or p-array['version','mode','style','length','order','titleCard','originalAudio']<>'{}'::jsonb
  or p->'version' is distinct from '1'::jsonb
  or ((p->>'mode') in('automatic','original')) is not true
  or ((p->>'style') in('reflective','bright','cinematic')) is not true
  or ((p->>'length') in('short','standard','full')) is not true
  or ((p->>'order') in('book','chronological')) is not true
  or jsonb_typeof(p->'titleCard') is distinct from 'boolean'
  or jsonb_typeof(p->'originalAudio') is distinct from 'boolean' then raise exception 'INVALID_MEMORY_FILM_SETTINGS';end if;
 return p||jsonb_build_object('version',1);
end $$;
alter table public.memory_albums
 add column cover_artwork jsonb not null default '{"version":1,"inscription":"","inscriptionStyle":"handwritten","inscriptionPosition":"bottom","postmark":"","showDate":true,"photo":{"x":0.5,"y":0.5,"scale":1}}',
 add column film_settings jsonb not null default '{"version":1,"mode":"original","style":"reflective","length":"full","order":"book","titleCard":false,"originalAudio":true}',
 add column presentation_revision integer not null default 0 check(presentation_revision>=0);
create function memory_creative.actor(p_lock boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;p public.profiles%rowtype;allowed boolean;
begin
 if auth.role() is distinct from 'authenticated' then raise exception 'MEMORY_AUTHENTICATED_SESSION_REQUIRED' using errcode='42501';end if;
 sid:=media_delivery.require_session();
 if p_lock then
  select * into p from public.profiles where id=uid and deactivated_at is null for share;
 else select * into p from public.profiles where id=uid and deactivated_at is null;end if;
 if p.id is null then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501';end if;
 if p_lock then
  perform 1 from auth.sessions where id=sid and user_id=uid for share;
  if not found then raise exception 'ACTIVE_SESSION_REQUIRED' using errcode='42501';end if;
  perform media_delivery.require_session();
 end if;
 perform account_erasure.assert_writable(uid);
 if to_regprocedure('public.business_session_allowed()') is not null then execute 'select public.business_session_allowed()' into allowed;
 elsif p.account_type='business' then allowed:=false;else allowed:=true;end if;
 if not coalesce(allowed,false) then raise exception 'BUSINESS_SESSION_REQUIRED' using errcode='42501';end if;
 return uid;
end $$;
create function memory_creative.validate_presentation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.role()='authenticated' then perform memory_creative.actor(true);end if;
 if tg_op='DELETE' then return old;end if;
 new.cover_artwork:=memory_creative.cover(new.cover_artwork);
 new.film_settings:=memory_creative.film(new.film_settings);
 if tg_op='INSERT' then new.presentation_revision:=0;
 elsif row(new.title,new.subtitle,new.cover_color,new.cover_design,new.audience,new.cover_story_id,new.cover_artwork,new.film_settings,new.id,new.user_id)
  is distinct from row(old.title,old.subtitle,old.cover_color,old.cover_design,old.audience,old.cover_story_id,old.cover_artwork,old.film_settings,old.id,old.user_id)
  or new.presentation_revision is distinct from old.presentation_revision then
  if old.presentation_revision=2147483647 then raise exception 'MEMORY_BOOK_REVISION_EXHAUSTED';end if;
  new.presentation_revision:=old.presentation_revision+1;
 else new.presentation_revision:=old.presentation_revision;end if;
 return new;
end $$;
create trigger memory_creative_presentation before insert or update or delete on public.memory_albums
 for each row execute function memory_creative.validate_presentation();
revoke all on all functions in schema memory_creative from public,anon,authenticated,service_role;
commit;
