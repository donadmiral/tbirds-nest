-- Final atomic activation: preserve the reviewed reader bodies, enrich only
-- authorized books, then expose the exact owner/session-scoped client contract.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
declare p pg_proc%rowtype;item record;definition text;
begin
 if current_user<>'postgres' or (select stage from memory_creative.installation where singleton) is distinct from 2
  or to_regprocedure('public.get_memory_book_creative_capabilities()') is not null then raise exception 'MEMORY_CREATIVE_STAGE_MISMATCH';end if;
 if not exists(select 1 from pg_trigger t join pg_proc f on f.oid=t.tgfoid
  where t.tgrelid='public.memory_albums'::regclass and t.tgname='memory_book_cover'
   and t.tgenabled='O' and not t.tgisinternal and t.tgtype=23 and t.tgqual is null
   and f.oid=to_regprocedure('public.validate_memory_book_cover()')
   and f.proowner='postgres'::regrole and f.prosecdef and f.proconfig=array['search_path=""']::text[]
   and md5(f.prosrc)='c564cf37800f4b0ecb26ade7fcab3bb8'
   and (select array_agg(a.attname::text order by a.attname) from unnest(t.tgattr) x(attnum)
    join pg_attribute a on a.attrelid=t.tgrelid and a.attnum=x.attnum)=array['cover_story_id','user_id']::text[])
  then raise exception 'MEMORY_COVER_GUARD_REQUIRED';end if;
 if exists(select 1 from pg_proc private_proc join pg_namespace n on n.oid=private_proc.pronamespace where n.nspname='memory_creative'
  and (has_function_privilege('anon',private_proc.oid,'execute') or has_function_privilege('authenticated',private_proc.oid,'execute')
   or has_function_privilege('service_role',private_proc.oid,'execute'))) then raise exception 'MEMORY_CREATIVE_PRIVATE_ACL_REQUIRED';end if;
 for item in select * from(values
  ('get_memory_book','base_book','e81581dd9ed47c8f11705fdd8d62b1a5'),
  ('get_memory_albums','base_shelf','2ff77aa54267e0e31f96757d5c220487')
 )v(name,copy_name,body_md5) loop
  select * into p from pg_proc where oid=to_regprocedure('public.'||item.name||'(uuid)');
  if p.oid is null or not p.prosecdef or p.proowner<>'postgres'::regrole
   or p.proconfig is distinct from array['search_path=""']::text[] or p.prorettype<>'jsonb'::regtype then raise exception 'MEMORY_READER_BASELINE_CHANGED';end if;
  if md5(p.prosrc)<>item.body_md5 then
   if item.name<>'get_memory_book' or md5(p.prosrc)<>'f2eab351bf9e4f85742ba1990831f1f0'
    or not exists(select 1 from pg_proc where oid=to_regprocedure('public.get_memory_book_before_music(uuid)')
      and md5(prosrc)=item.body_md5 and prosecdef and proowner='postgres'::regrole)
    then raise exception 'MEMORY_READER_BASELINE_CHANGED';end if;
  end if;
  definition:=pg_get_functiondef(p.oid);
  if position('CREATE OR REPLACE FUNCTION public.'||item.name||'(' in definition)<>1 then raise exception 'MEMORY_READER_HEADER_CHANGED';end if;
  -- Exact inspected bodies are copied, not rewritten. Later music wrappers can
  -- wrap this public reader without losing creative fields or signed-media gates.
  execute replace(definition,'CREATE OR REPLACE FUNCTION public.'||item.name||'(',
   'CREATE FUNCTION memory_creative.'||item.copy_name||'(');
 end loop;
end $preflight$;
revoke all on all functions in schema memory_creative from public,anon,authenticated,service_role;

create or replace function public.get_memory_book(p_album uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;a public.memory_albums%rowtype;
begin
 perform memory_creative.actor(false);
 result:=memory_creative.base_book(p_album);
 if result is null or result->'can_view' is distinct from 'true'::jsonb
  or not public.can_view_memory_book(p_album) then return result;end if;
 select * into a from public.memory_albums where id=p_album;
 if not found then return jsonb_build_object('can_view',false,'is_owner',false,'count',0,'pages','[]'::jsonb);end if;
 return result||memory_creative.ack(a);
end $$;
create or replace function public.get_memory_albums(p_owner uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;books jsonb;
begin
 perform memory_creative.actor(false);
 result:=memory_creative.base_shelf(p_owner);
 select coalesce(jsonb_agg(e.value||memory_creative.ack(a) order by e.ordinality),'[]'::jsonb) into books
 from jsonb_array_elements(coalesce(result->'books','[]'::jsonb)) with ordinality e(value,ordinality)
 join public.memory_albums a on a.id::text=e.value->>'id' and a.user_id=p_owner
 where public.can_view_memory_book(a.id);
 return result||jsonb_build_object('books',books,'can_view',jsonb_array_length(books)>0);
end $$;
create function public.get_memory_book_creative_capabilities()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform memory_creative.actor(false);
 if (select stage from memory_creative.installation where singleton) is distinct from 3 then raise exception 'MEMORY_CREATIVE_NOT_READY';end if;
 return jsonb_build_object('version',1,'supported',true);
end $$;
create function public.save_memory_book_creative_presentation(p_album uuid,p_expected_revision integer,p_title text,p_subtitle text,p_cover_color text,p_cover_design text,p_audience text,p_cover_story_id uuid,p_cover_artwork jsonb,p_film_settings jsonb)
returns jsonb language sql security definer set search_path='' as $$
 select memory_creative.save_book(p_album,p_expected_revision,p_title,p_subtitle,p_cover_color,p_cover_design,p_audience,p_cover_story_id,p_cover_artwork,p_film_settings);
$$;
create function public.create_memory_book_creative_presentation(p_request_id uuid,p_title text,p_subtitle text,p_cover_color text,p_cover_design text,p_story_ids uuid[],p_cover_story_id uuid,p_cover_artwork jsonb,p_film_settings jsonb)
returns jsonb language sql security definer set search_path='' as $$
 select memory_creative.create_book(p_request_id,p_title,p_subtitle,p_cover_color,p_cover_design,p_story_ids,p_cover_story_id,p_cover_artwork,p_film_settings);
$$;
revoke all on function public.get_memory_book_creative_capabilities(),
 public.save_memory_book_creative_presentation(uuid,integer,text,text,text,text,text,uuid,jsonb,jsonb),
 public.create_memory_book_creative_presentation(uuid,text,text,text,text,uuid[],uuid,jsonb,jsonb),
 public.get_memory_book(uuid),public.get_memory_albums(uuid),public.get_memory_album(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.get_memory_book_creative_capabilities(),
 public.save_memory_book_creative_presentation(uuid,integer,text,text,text,text,text,uuid,jsonb,jsonb),
 public.create_memory_book_creative_presentation(uuid,text,text,text,text,uuid[],uuid,jsonb,jsonb),
 public.get_memory_book(uuid),public.get_memory_albums(uuid),public.get_memory_album(uuid)
 to authenticated;
update memory_creative.installation set stage=3 where singleton and stage=2;
notify pgrst,'reload schema';
commit;
