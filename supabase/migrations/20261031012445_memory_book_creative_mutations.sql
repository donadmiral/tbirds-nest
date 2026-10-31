-- Private implementation only. The final unit grants the reviewed public RPCs.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
begin
 if current_user<>'postgres' or (select stage from memory_creative.installation where singleton) is distinct from 1
  or to_regprocedure('memory_creative.actor(boolean)') is null
  or to_regprocedure('memory_creative.save_book(uuid,integer,text,text,text,text,text,uuid,jsonb,jsonb)') is not null then raise exception 'MEMORY_CREATIVE_STAGE_MISMATCH';end if;
end $preflight$;
create function memory_creative.settings(p_title text,p_subtitle text,p_color text,p_design text,p_audience text)
returns void language plpgsql immutable set search_path='' as $$
begin
 if p_title is null or length(trim(p_title)) not between 1 and 30
  or p_subtitle is null or length(p_subtitle)>120
  or (p_color in('blush','rose','pearl','cream','sage','sky','lilac','ink')) is not true
  or (p_design in('keepsake','postcard','editorial','field_notes','night_film','daybook','botanical','classic')) is not true
  or (p_audience in('profile','followers','custom','only_me')) is not true then raise exception 'INVALID_BOOK_SETTINGS';end if;
end $$;
create function memory_creative.ack(a public.memory_albums)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',a.id,'presentation_revision',a.presentation_revision,'cover_artwork',a.cover_artwork,'film_settings',a.film_settings);
$$;
create function memory_creative.save_book(p_album uuid,p_expected_revision integer,p_title text,p_subtitle text,p_cover_color text,p_cover_design text,p_audience text,p_cover_story_id uuid,p_cover_artwork jsonb,p_film_settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=memory_creative.actor(true);a public.memory_albums%rowtype;cover jsonb;film jsonb;
begin
 if p_expected_revision is null or p_expected_revision<0 then raise exception 'MEMORY_BOOK_CHANGED';end if;
 perform memory_creative.settings(p_title,p_subtitle,p_cover_color,p_cover_design,p_audience);
 cover:=memory_creative.cover(p_cover_artwork);film:=memory_creative.film(p_film_settings);
 select * into a from public.memory_albums where id=p_album and user_id=uid for update;
 if not found then raise exception 'BOOK_NOT_OWNED' using errcode='42501';end if;
 if a.presentation_revision<>p_expected_revision then raise exception 'MEMORY_BOOK_CHANGED';end if;
 perform memory_creative.actor(false);
 if a.presentation_revision=2147483647 then raise exception 'MEMORY_BOOK_REVISION_EXHAUSTED';end if;
 update public.memory_albums set title=trim(p_title),subtitle=trim(p_subtitle),cover_color=p_cover_color,
  cover_design=p_cover_design,audience=p_audience,cover_story_id=p_cover_story_id,cover_artwork=cover,
  film_settings=film,presentation_revision=a.presentation_revision+1
 where id=p_album and user_id=uid and presentation_revision=p_expected_revision returning * into a;
 if not found then raise exception 'MEMORY_BOOK_CHANGED';end if;
 return memory_creative.ack(a);
end $$;
create function memory_creative.create_book(p_request_id uuid,p_title text,p_subtitle text,p_cover_color text,p_cover_design text,p_story_ids uuid[],p_cover_story_id uuid,p_cover_artwork jsonb,p_film_settings jsonb)
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
revoke all on all functions in schema memory_creative from public,anon,authenticated,service_role;
update memory_creative.installation set stage=2 where singleton and stage=1;
commit;
