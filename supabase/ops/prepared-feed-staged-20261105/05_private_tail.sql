begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin if obj_description('prepared_feed'::regnamespace,'pg_namespace') is distinct from 'prepared-feed:f6efa6982b921d1f8495b82868880d61f52ab15d9b856962329cdb8ac32af8dc:4' then raise exception 'PREPARED_FEED_STAGE_MISMATCH';end if;end$$;
do $$declare result_type text;projection text;begin select t.result_type,t.projection into result_type,projection from prepared_feed.install_contract t; execute format('create function prepared_feed.tail(p_mode text,p_key double precision,p_id uuid,p_limit integer,p_exclude uuid[])
 returns %s language plpgsql volatile security invoker set search_path='''' as $tail$
 declare cursor_key double precision:=p_key;cursor_id uuid:=p_id;remaining integer:=p_limit;emitted integer;next_key double precision;next_id uuid;
 begin
  -- At most 200 prepared IDs can overlap the recalculated tail. Five bounded
  -- 50-row reads cover those overlaps plus the largest requested page.
  for batch in 1..5 loop
   return query select c.* from prepared_feed.canonical(p_mode,cursor_key,cursor_id,50)c
    where not(c.post_id=any(p_exclude)) order by c.sort_key desc,c.post_id desc limit remaining;
   get diagnostics emitted=row_count;remaining:=remaining-emitted;exit when remaining<=0;
   select c.sort_key,c.post_id into next_key,next_id from prepared_feed.canonical(p_mode,cursor_key,cursor_id,50)c
    order by c.sort_key,c.post_id limit 1;
   exit when next_id is null or (next_key,next_id) is not distinct from (cursor_key,cursor_id);
   cursor_key:=next_key;cursor_id:=next_id;
  end loop;
 end $tail$',result_type);
end$$;
revoke all on schema prepared_feed from public,anon,authenticated,service_role;
revoke all on all tables in schema prepared_feed from public,anon,authenticated,service_role;
revoke all on all functions in schema prepared_feed from public,anon,authenticated,service_role;
comment on schema prepared_feed is 'prepared-feed:f6efa6982b921d1f8495b82868880d61f52ab15d9b856962329cdb8ac32af8dc:5';
commit;
