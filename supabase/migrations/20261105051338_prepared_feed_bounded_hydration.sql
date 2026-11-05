-- Hydrate only the next requested window. Revoked rows are refilled within the
-- same immutable snapshot, inspecting at most its original200 IDs.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare f pg_proc%rowtype;body text;definition text;projection text;start_at integer;end_at integer;replacement text;
begin
 select * into f from pg_proc where oid='public.get_feed(text,double precision,uuid,integer)'::regprocedure;
 if md5(f.prosrc)<>'bbb8276d573e8111fa1e10273b710f9a' or f.prosecdef or f.provolatile<>'v'
  then raise exception 'PREPARED_HYDRATION_BASELINE_REQUIRED';end if;
 body:=f.prosrc;
 start_at:=position('  -- At most 200 IDs' in body);
 end_at:=position('  if emitted<lim and cardinality(saved.ids)=200 then' in body);
 if start_at=0 or end_at<=start_at then raise exception 'PREPARED_HYDRATION_ANCHORS_REQUIRED';end if;
 select string_agg(case when name='sort_key' then 'chosen.key' else 'card.'||quote_ident(name) end,', ' order by ord)
 into projection from unnest(f.proargnames,f.proargmodes)with ordinality a(name,mode,ord)where mode='t';
 replacement:=format($window$
  if lim<0 then perform 1 limit lim;end if;
  emitted:=0;
  inspected:=coalesce(array_position(saved.ids,p_cursor_id),0);
  while emitted<lim and inspected<cardinality(saved.ids) loop
   window_size:=least(greatest(lim-emitted,20),cardinality(saved.ids)-inspected);
   window_ids:=saved.ids[inspected+1:inspected+window_size];
   return query with chosen as(
    select u.id,(-4000000000000000-saved.cursor_serial*256-inspected-u.ord)::double precision key,u.ord
    from unnest(window_ids)with ordinality u(id,ord)
   ),cards as materialized(select * from public.get_feed_rows_by_ids_v1(window_ids))
   select %s from chosen join cards card on card.post_id=chosen.id order by chosen.ord limit lim-emitted;
   get diagnostics batch_emitted=row_count;
   emitted:=emitted+batch_emitted;
   inspected:=inspected+window_size;
  end loop;
$window$,projection);
 body:=substring(body from 1 for start_at-1)||replacement||substring(body from end_at);
 body:=replace(body,'emitted integer;','emitted integer;inspected integer;window_size integer;window_ids uuid[];batch_emitted integer;');
 definition:=pg_get_functiondef(f.oid);
 execute replace(definition,f.prosrc,body);
end $migration$;
notify pgrst,'reload schema';
commit;
