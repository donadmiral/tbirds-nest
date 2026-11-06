-- Re-scoring every small daily frontier repeats the complete visibility and
-- affinity joins. Use the same geometric scoring schedule as the prepared
-- selector. This changes only when the exact proof is evaluated, never the
-- candidate bounds, score formula, cursor order, or public page limit.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare f pg_proc%rowtype;body text;definition text;
 partial constant text:='coalesce(cardinality(candidates),0)<p_limit';
 proof_end constant text:='   end if;
 end loop;
 return jsonb_build_object(''fallback'',true';
begin
 select * into f from pg_proc where oid='feed_ranking.select_page(text,double precision,uuid,integer)'::regprocedure;
 if md5(f.prosrc)<>'4e1f1c94929807bd03cde8255c8d21cc' or f.prosecdef or f.provolatile<>'s'
   or f.proconfig is distinct from array['search_path=""']::text[]
   or position(partial in f.prosrc)=0 or position(proof_end in f.prosrc)=0 then
   raise exception 'AMORTIZED_FEED_FRONTIER_BASELINE_REQUIRED';
 end if;
 body:=replace(f.prosrc,E'declare\n',E'declare\n score_at integer:=200;\n');
 body:=replace(body,partial,'coalesce(cardinality(candidates),0)<score_at');
 body:=replace(body,proof_end,'   end if;
   score_at:=greatest(cardinality(candidates)+256,ceil(cardinality(candidates)*1.5)::integer);
 end loop;
 return jsonb_build_object(''fallback'',true');
 definition:=pg_get_functiondef(f.oid);
 execute replace(definition,f.prosrc,body);
end $migration$;
notify pgrst,'reload schema';
commit;
