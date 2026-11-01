-- Personalized covers extend the versioned JSON contract; v1 books and RPC
-- signatures are preserved. References stay within already-authorized book pages.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
begin
 if current_user<>'postgres' or (select stage from memory_creative.installation where singleton) is distinct from 3
  or to_regprocedure('memory_creative.cover(jsonb)') is null
  or to_regprocedure('memory_creative.ack(public.memory_albums)') is null
  or to_regprocedure('public.get_memory_book_creative_capabilities()') is null then
  raise exception 'MEMORY_CREATIVE_V1_REQUIRED';end if;
end $preflight$;
create function memory_creative.cover_v1(p jsonb)
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
create or replace function memory_creative.cover(p jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare base jsonb;item jsonb;stroke jsonb;point jsonb;ids jsonb:='[]';strokes jsonb:='[]';points jsonb;
 total_points integer:=0;x numeric;y numeric;w numeric;
begin
 if p->'version'='1'::jsonb then return memory_creative.cover_v1(p);end if;
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>262144
  or p->'version' is distinct from '2'::jsonb
  or not(p ?& array['version','inscription','inscriptionStyle','inscriptionPosition','postmark','showDate','photo','titleStyle','layout','storyIds','strokes','paperColor','inkColor'])
  or p-array['version','inscription','inscriptionStyle','inscriptionPosition','postmark','showDate','photo','titleStyle','layout','storyIds','strokes','paperColor','inkColor']<>'{}'::jsonb
  or ((p->>'titleStyle') in('design','handwritten','serif','sans')) is not true
  or ((p->>'layout') in('single','collage')) is not true
  or jsonb_typeof(p->'storyIds') is distinct from 'array'
  or jsonb_typeof(p->'strokes') is distinct from 'array'
  or (p->'paperColor'<>'null'::jsonb and (jsonb_typeof(p->'paperColor')<>'string' or p->>'paperColor' !~ '^#[0-9a-fA-F]{6}$'))
  or (p->'inkColor'<>'null'::jsonb and (jsonb_typeof(p->'inkColor')<>'string' or p->>'inkColor' !~ '^#[0-9a-fA-F]{6}$')) then raise exception 'INVALID_MEMORY_COVER_ARTWORK';end if;
 base:=memory_creative.cover_v1((p-array['titleStyle','layout','storyIds','strokes','paperColor','inkColor'])||'{"version":1}'::jsonb);
 if jsonb_array_length(p->'storyIds')>4 or jsonb_array_length(p->'strokes')>64 then raise exception 'INVALID_MEMORY_COVER_ARTWORK';end if;
 for item in select value from jsonb_array_elements(p->'storyIds') loop
  if jsonb_typeof(item)<>'string' or item#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or ids ? lower(item#>>'{}') then raise exception 'INVALID_MEMORY_COVER_ARTWORK';end if;
  ids:=ids||to_jsonb(lower(item#>>'{}'));
 end loop;
 for stroke in select value from jsonb_array_elements(p->'strokes') loop
  if jsonb_typeof(stroke)<>'object' or not(stroke ?& array['tool','color','width','points'])
   or stroke-array['tool','color','width','points']<>'{}'::jsonb
   or ((stroke->>'tool') in('pen','marker','highlight','neon','arrow','dot')) is not true
   or jsonb_typeof(stroke->'color')<>'string' or stroke->>'color' !~ '^#[0-9a-fA-F]{6}$'
   or jsonb_typeof(stroke->'width')<>'number' or jsonb_typeof(stroke->'points')<>'array' then raise exception 'INVALID_MEMORY_COVER_ARTWORK';end if;
  w:=(stroke->>'width')::numeric;
  if w not between .5 and 16 or jsonb_array_length(stroke->'points') not between 1 and 512 then raise exception 'INVALID_MEMORY_COVER_ARTWORK';end if;
  total_points:=total_points+jsonb_array_length(stroke->'points');
  if total_points>8192 then raise exception 'INVALID_MEMORY_COVER_ARTWORK';end if;
  points:='[]';
  for point in select value from jsonb_array_elements(stroke->'points') loop
   if jsonb_typeof(point)<>'object' or not(point ?& array['x','y']) or point-array['x','y']<>'{}'::jsonb
    or jsonb_typeof(point->'x')<>'number' or jsonb_typeof(point->'y')<>'number' then raise exception 'INVALID_MEMORY_COVER_ARTWORK';end if;
   x:=(point->>'x')::numeric;y:=(point->>'y')::numeric;
   if x not between 0 and 1 or y not between 0 and 1 then raise exception 'INVALID_MEMORY_COVER_ARTWORK';end if;
   points:=points||jsonb_build_object('x',round(x,4)::double precision,'y',round(y,4)::double precision);
  end loop;
  strokes:=strokes||jsonb_build_object('tool',stroke->>'tool','color',upper(stroke->>'color'),'width',round(w,4)::double precision,'points',points);
 end loop;
 return base||jsonb_build_object('version',2,'titleStyle',p->>'titleStyle','layout',p->>'layout','storyIds',ids,'strokes',strokes,
  'paperColor',upper(p->>'paperColor'),'inkColor',upper(p->>'inkColor'));
end $$;

create function memory_creative.require_cover_sources(p_album uuid,p_owner uuid,p_cover jsonb)
returns void language plpgsql stable set search_path='' as $$
begin
 if exists(select 1 from jsonb_array_elements_text(coalesce(p_cover->'storyIds','[]'::jsonb)) chosen(id)
  where not exists(select 1 from public.memory_pages mp join public.stories s on s.id=mp.story_id and s.user_id=p_owner
   where mp.album_id=p_album and mp.user_id=p_owner and mp.story_id=chosen.id::uuid)) then
  raise exception 'COVER_NOT_IN_OWNED_BOOK';end if;
end $$;

-- Deferred membership permits the existing atomic create RPC to insert the book
-- before its pages, while also validating direct owner writes at transaction end.
create function memory_creative.validate_cover_sources()
returns trigger language plpgsql security definer set search_path='' as $$
declare a public.memory_albums%rowtype;
begin
 select * into a from public.memory_albums where id=new.id;
 if found then perform memory_creative.require_cover_sources(a.id,a.user_id,a.cover_artwork);end if;
 return null;
end $$;
create constraint trigger memory_cover_source_membership after insert or update on public.memory_albums
 deferrable initially deferred for each row execute function memory_creative.validate_cover_sources();

-- A removed/moved page also leaves the collage, without disturbing ink or writing.
create function memory_creative.remove_cover_source()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and row(new.album_id,new.story_id,new.user_id) is not distinct from row(old.album_id,old.story_id,old.user_id) then return new;end if;
 update public.memory_albums a set cover_artwork=jsonb_set(a.cover_artwork,'{storyIds}',
  (select coalesce(jsonb_agg(item order by ordinal),'[]'::jsonb) from jsonb_array_elements(a.cover_artwork->'storyIds') with ordinality source(item,ordinal) where item<>to_jsonb(old.story_id::text)))
 where a.id=old.album_id and a.user_id=old.user_id and a.cover_artwork->'version'='2'::jsonb
  and a.cover_artwork->'storyIds' ? old.story_id::text;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger memory_cover_remove_source after delete or update of album_id,story_id,user_id on public.memory_pages
 for each row execute function memory_creative.remove_cover_source();

-- This private projection is called only after the existing book reader or
-- owner mutation has authorized the album. It cannot project a foreign story.
create function memory_creative.cover_pages(a public.memory_albums)
returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',mp.id,'story_id',mp.story_id,
  'media_url',coalesce(s.media_url,mp.media_url),'media_type',coalesce(s.media_type,mp.media_type),
  'thumbnail_url',coalesce(s.thumbnail_url,mp.thumbnail_url),'caption',mp.caption,'story_caption',s.caption,
  'taken_at',mp.taken_at,'stickers',s.stickers_json,'media_transform',s.media_transform,'filter_id',s.filter_id) order by chosen.ordinal),'[]'::jsonb)
 from jsonb_array_elements_text(coalesce(a.cover_artwork->'storyIds','[]'::jsonb)) with ordinality chosen(id,ordinal)
 join public.memory_pages mp on mp.album_id=a.id and mp.user_id=a.user_id and mp.story_id=chosen.id::uuid
 join public.stories s on s.id=mp.story_id and s.user_id=a.user_id;
$$;
create or replace function memory_creative.ack(a public.memory_albums)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',a.id,'presentation_revision',a.presentation_revision,'cover_artwork',a.cover_artwork,
  'film_settings',a.film_settings,'cover_pages',memory_creative.cover_pages(a));
$$;
create or replace function memory_creative.save_book(p_album uuid,p_expected_revision integer,p_title text,p_subtitle text,p_cover_color text,p_cover_design text,p_audience text,p_cover_story_id uuid,p_cover_artwork jsonb,p_film_settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=memory_creative.actor(true);a public.memory_albums%rowtype;cover jsonb;film jsonb;
begin
 if p_expected_revision is null or p_expected_revision<0 then raise exception 'MEMORY_BOOK_CHANGED';end if;
 perform memory_creative.settings(p_title,p_subtitle,p_cover_color,p_cover_design,p_audience);
 cover:=memory_creative.cover(p_cover_artwork);film:=memory_creative.film(p_film_settings);
 select * into a from public.memory_albums where id=p_album and user_id=uid for update;
 if not found then raise exception 'BOOK_NOT_OWNED' using errcode='42501';end if;
 if a.presentation_revision<>p_expected_revision then raise exception 'MEMORY_BOOK_CHANGED';end if;
 perform memory_creative.require_cover_sources(a.id,uid,cover);
 perform memory_creative.actor(false);
 if a.presentation_revision=2147483647 then raise exception 'MEMORY_BOOK_REVISION_EXHAUSTED';end if;
 update public.memory_albums set title=trim(p_title),subtitle=trim(p_subtitle),cover_color=p_cover_color,
  cover_design=p_cover_design,audience=p_audience,cover_story_id=p_cover_story_id,cover_artwork=cover,
  film_settings=film,presentation_revision=a.presentation_revision+1
 where id=p_album and user_id=uid and presentation_revision=p_expected_revision returning * into a;
 if not found then raise exception 'MEMORY_BOOK_CHANGED';end if;
 return memory_creative.ack(a);
end $$;
create or replace function memory_creative.create_book(p_request_id uuid,p_title text,p_subtitle text,p_cover_color text,p_cover_design text,p_story_ids uuid[],p_cover_story_id uuid,p_cover_artwork jsonb,p_film_settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=memory_creative.actor(true);a public.memory_albums%rowtype;r memory_creative.create_requests%rowtype;
 cover jsonb;film jsonb;fingerprint bytea;story uuid;answer jsonb;
begin
 perform memory_creative.settings(p_title,p_subtitle,p_cover_color,p_cover_design,'profile');
 cover:=memory_creative.cover(p_cover_artwork);film:=memory_creative.film(p_film_settings);
 if p_request_id is null or p_story_ids is null or cardinality(p_story_ids)>80
  or coalesce(array_ndims(p_story_ids),1)<>1
  or exists(select 1 from unnest(p_story_ids)s where s is null)
  or cardinality(p_story_ids)<>(select count(distinct s) from unnest(p_story_ids)s) then raise exception 'INVALID_BOOK_PRESENTATION';end if;
 if p_cover_story_id is not null and not coalesce(p_cover_story_id=any(p_story_ids),false) then raise exception 'COVER_NOT_SELECTED';end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(cover->'storyIds','[]'::jsonb)) item where not(item::uuid=any(p_story_ids))) then raise exception 'COVER_NOT_SELECTED';end if;
 fingerprint:=extensions.digest(jsonb_build_object('title',trim(p_title),'subtitle',trim(p_subtitle),
  'color',p_cover_color,'design',p_cover_design,'stories',to_jsonb(p_story_ids),'cover',p_cover_story_id,
  'artwork',cover,'film',film)::text,'sha256');
 perform pg_advisory_xact_lock(hashtextextended('memory-create:'||p_request_id::text,0));
 select * into r from memory_creative.create_requests where request_id=p_request_id;
 if found then
  select * into a from public.memory_albums where id=p_request_id and user_id=uid for share;
  if r.owner_id<>uid or r.creation_hash<>fingerprint or a.id is null then raise exception 'MEMORY_BOOK_REQUEST_CONFLICT';end if;
  return r.response;
 end if;
 if exists(select 1 from public.memory_albums where id=p_request_id) then raise exception 'MEMORY_BOOK_REQUEST_CONFLICT';end if;
 perform pg_advisory_xact_lock(hashtextextended('memory-book:'||uid::text,0));
 perform memory_creative.actor(false);
 perform 1 from public.stories where id=any(p_story_ids) and user_id=uid order by id for share;
 if (select count(*) from public.stories where id=any(p_story_ids) and user_id=uid)<>cardinality(p_story_ids) then raise exception 'STORY_NOT_OWNED' using errcode='42501';end if;
 insert into public.memory_albums(id,user_id,title,subtitle,cover_color,cover_design,audience,is_default,cover_artwork,film_settings)
 values(p_request_id,uid,trim(p_title),trim(p_subtitle),p_cover_color,p_cover_design,'profile',false,cover,film);
 foreach story in array p_story_ids loop perform public.add_memory_page(story,null,'polaroid',p_request_id);end loop;
 update public.memory_albums set cover_story_id=p_cover_story_id where id=p_request_id and user_id=uid returning * into a;
 answer:=memory_creative.ack(a);
 insert into memory_creative.create_requests(request_id,owner_id,creation_hash,response) values(p_request_id,uid,fingerprint,answer);
 return answer;
end $$;
create or replace function public.get_memory_book_creative_capabilities()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform memory_creative.actor(false);
 if (select stage from memory_creative.installation where singleton) is distinct from 3 then raise exception 'MEMORY_CREATIVE_NOT_READY';end if;
 return jsonb_build_object('version',1,'supported',true,'coverArtworkVersions',jsonb_build_array(1,2));
end $$;
revoke all on function memory_creative.cover_v1(jsonb),memory_creative.require_cover_sources(uuid,uuid,jsonb),
 memory_creative.validate_cover_sources(),memory_creative.remove_cover_source(),memory_creative.cover_pages(public.memory_albums)
 from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
