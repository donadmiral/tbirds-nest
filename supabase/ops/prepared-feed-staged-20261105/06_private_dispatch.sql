begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare result_type text;projection text;begin select t.result_type,t.projection into result_type,projection from prepared_feed.install_contract t; execute format('create function prepared_feed.dispatch(p_mode text default ''for_you'',p_cursor_key double precision default null,p_cursor_id uuid default null,p_limit integer default 20)
 returns %s language plpgsql volatile security invoker set search_path='''' as $body$
 declare saved prepared_feed.snapshots; actor uuid:=auth.uid();cache_scope text:=prepared_feed.scope();lim integer:=least(coalesce(p_limit,20),50);emitted integer;
 begin
  if actor is null then raise exception ''Authentication required'' using errcode=''42501'';end if;
  if not prepared_feed.enabled() or p_mode is null or p_mode not in(''for_you'',''following'',''trending'',''innovation'') then
   if p_cursor_key<=-4000000000000000 then raise exception ''PREPARED_FEED_CURSOR_EXPIRED'' using errcode=''22023'';end if;
   return query select * from prepared_feed.canonical(p_mode,p_cursor_key,p_cursor_id,p_limit);return;
  end if;
  perform prepared_feed.request(p_mode);
  if p_cursor_key is null and p_cursor_id is null then
   select s.* into saved from prepared_feed.snapshots s join prepared_feed.demand d
    on (d.viewer_id,d.scope,d.mode,d.revision)=(s.viewer_id,s.scope,s.mode,s.revision)
    where s.viewer_id=actor and s.scope=cache_scope and s.mode=p_mode and s.fresh_until>clock_timestamp()
    order by s.created_at desc,s.id desc limit 1;
  elsif p_cursor_key<=-4000000000000000 and p_cursor_id is not null then
   select s.* into saved from prepared_feed.snapshots s
    where s.viewer_id=actor and s.scope=cache_scope and s.mode=p_mode and s.expires_at>clock_timestamp()
    and s.cursor_serial=floor((-4000000000000000-p_cursor_key)/256)::bigint
    and exists(select 1 from unnest(s.ids) with ordinality u(id,ord) where u.id=p_cursor_id and (-4000000000000000-s.cursor_serial*256-u.ord)::double precision=p_cursor_key)
    order by s.created_at desc,s.id desc limit 1;
  end if;
  if saved.id is null and p_cursor_key<=-4000000000000000 then raise exception ''PREPARED_FEED_CURSOR_EXPIRED'' using errcode=''22023'';end if;
  if saved.id is null then
   return query select * from prepared_feed.canonical(p_mode,p_cursor_key,p_cursor_id,p_limit);return;
  end if;
  if p_cursor_key=(-4000000000000000-saved.cursor_serial*256-cardinality(saved.ids))::double precision then
   return query select * from prepared_feed.tail(p_mode,saved.keys[cardinality(saved.keys)],p_cursor_id,p_limit,saved.ids);return;
  end if;
  -- At most 200 IDs, split into two canonical hydration batches. Rechecking
  -- beyond the visible page fills gaps left by revoked/deleted/hidden rows.
  return query with candidates as materialized(
   select u.id,(-4000000000000000-saved.cursor_serial*256-u.ord)::double precision key,u.ord
   from unnest(saved.ids) with ordinality u(id,ord)
   where p_cursor_key is null or (-4000000000000000-saved.cursor_serial*256-u.ord)::double precision<p_cursor_key
  ),chunks as(select array_agg(id order by ord) ids from candidates group by (ord-1)/100),
  cards as materialized(select c.* from chunks cross join lateral public.get_feed_rows_by_ids_v1(chunks.ids)c),
  chosen as(select p.* from candidates p join cards c on c.post_id=p.id order by p.ord limit lim)
  select %s from chosen join cards card on card.post_id=chosen.id order by chosen.ord;
  get diagnostics emitted=row_count;
  if emitted<lim and cardinality(saved.ids)=200 then
   return query select * from prepared_feed.tail(p_mode,saved.keys[200],saved.ids[200],lim-emitted,saved.ids);
  end if;
 end $body$',result_type,projection);
end$$;
revoke all on function prepared_feed.dispatch(text,double precision,uuid,integer) from public,anon,authenticated,service_role;
comment on schema prepared_feed is 'prepared-feed:f6efa6982b921d1f8495b82868880d61f52ab15d9b856962329cdb8ac32af8dc:6';
commit;
