-- Build one exact, narrow snapshot instead of four hydrated cursor pages.
-- Public RPC limits and the original selector remain unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare f pg_proc%rowtype;body text;prefix text;stop integer;
 partial constant text:='coalesce(cardinality(candidates),0)<p_limit';
 proof_end constant text:='   end if;
 end loop;
 return jsonb_build_object(''fallback'',true';
begin
 select * into f from pg_proc where oid='feed_ranking.select_page(text,double precision,uuid,integer)'::regprocedure;
 if f.prosecdef or f.provolatile<>'s' or position('p_limit>50' in f.prosrc)=0
  or position(partial in f.prosrc)=0 or position('reason'',''legacy_tie' in f.prosrc)>0
  or position(proof_end in f.prosrc)=0 then raise exception 'PREPARED_FRONTIER_BASELINE_REQUIRED';end if;
 body:=replace(f.prosrc,'p_limit>50','p_limit>200');
 body:=replace(body,E'declare\n',E'declare\n score_at integer:=200;\n');
 body:=replace(body,partial,'coalesce(cardinality(candidates),0)<score_at');
 body:=replace(body,proof_end,'   end if;
   score_at:=greatest(cardinality(candidates)+256,ceil(cardinality(candidates)*1.5)::integer);
 end loop;
 return jsonb_build_object(''fallback'',true');
 execute format('create function prepared_feed.select_page(p_mode text,p_cursor_key double precision,p_cursor_id uuid,p_limit integer)
 returns jsonb language plpgsql stable security invoker set search_path='''' as $selector$%s$selector$',body);

 select prosrc into body from pg_proc where oid='feed_ranking.fallback(text,double precision,uuid,integer)'::regprocedure;
 stop:=position(', page as materialized (' in body);
 if stop=0 or position('row_number() over (partition by b.user_id order by b.raw_score desc, b.id desc)' in body)=0
  then raise exception 'PREPARED_EXACT_BASELINE_REQUIRED';end if;
 prefix:=substring(body from 1 for stop-1);
 -- This is the identical canonical CTE chain through diversity, ending before
 -- its card hydration. Every audience/mode/hidden/block predicate is retained.
 execute format('create function prepared_feed.exact_ids(p_mode text)
 returns jsonb language sql stable security invoker set search_path=public as $exact$%s
 select coalesce(jsonb_agg(jsonb_build_object(''id'',id,''key'',sort_key)order by sort_key desc,id desc),''[]''::jsonb)
 from(select id,sort_key from diversified order by sort_key desc,id desc limit 200)selected$exact$',prefix);
end $migration$;
revoke all on function prepared_feed.select_page(text,double precision,uuid,integer),prepared_feed.exact_ids(text) from public,anon,authenticated,service_role;
grant execute on function prepared_feed.select_page(text,double precision,uuid,integer),prepared_feed.exact_ids(text) to prepared_feed_reader;
commit;
