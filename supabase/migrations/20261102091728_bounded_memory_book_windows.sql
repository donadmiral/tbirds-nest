-- Bidirectional seek windows for ordinary book reading. Complete export and
-- editing readers retain their explicit forward-completion contract.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.get_memory_book_window_v3(p_album uuid,p_anchor uuid,p_revision text,
 p_before integer default 12,p_after integer default 35) returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare viewer uuid:=memory_creative.actor(false);a public.memory_albums;anchor public.memory_pages;
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
declare viewer uuid:=memory_creative.actor(false);book_id uuid;
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
 select jsonb_build_object('version',1,'books',s.books_ready and auth.uid() is not null,
  'books_window',s.books_ready and auth.uid() is not null,
  'inbox',s.inbox_ready and auth.uid() is not null,'book_page_limit',40,'book_window_limit',48,'inbox_page_limit',50)
 from read_paging.settings s where s.singleton;
$$;
commit;
