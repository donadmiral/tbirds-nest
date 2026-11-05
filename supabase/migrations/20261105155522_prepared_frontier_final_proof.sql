-- The prepared selector used to discard its final fetched batch before trying
-- the exact score proof, then repeat ranking over the entire eligible feed.
-- Score this already-fetched boundary once. If it cannot prove the result,
-- retain the canonical fallback. The public selector and score are unchanged.
-- At most the existing two 64-row reads extend the 10,000-candidate boundary.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare
 original pg_proc%rowtype; installed pg_proc%rowtype; body text;
 budget_guard constant text:=E'   if cardinality(candidates)>maximum_candidates then\n     return jsonb_build_object(''fallback'',true,''candidates'',cardinality(candidates),''reason'',''proof_budget'');end if;';
 defer_guard constant text:='coalesce(cardinality(candidates),0)<score_at then';
 next_score constant text:='   score_at:=greatest(';
begin
 select * into original from pg_proc where oid=to_regprocedure('prepared_feed.select_page(text,double precision,uuid,integer)');
 if original.oid is null or md5(original.prosrc)<>'81dd45f216d9ea8b7a08745d95539549'
  or original.prosecdef or original.provolatile<>'s'
  or original.prolang<>(select oid from pg_language where lanname='plpgsql')
  or original.proconfig is distinct from array['search_path=""']::text[]
  or not has_function_privilege('prepared_feed_reader',original.oid,'execute')
  or has_function_privilege('authenticated',original.oid,'execute')
  or has_function_privilege('anon',original.oid,'execute')
  or has_function_privilege('service_role',original.oid,'execute') then
   raise exception 'PREPARED_FINAL_PROOF_BASELINE_REQUIRES_REVIEW';
 end if;
 if (length(original.prosrc)-length(replace(original.prosrc,budget_guard,'')))/length(budget_guard)<>1
  or (length(original.prosrc)-length(replace(original.prosrc,defer_guard,'')))/length(defer_guard)<>1
  or (length(original.prosrc)-length(replace(original.prosrc,next_score,'')))/length(next_score)<>1 then
   raise exception 'PREPARED_FINAL_PROOF_ANCHORS_REQUIRE_REVIEW';
 end if;
 body:=replace(original.prosrc,budget_guard,'');
 body:=replace(body,defer_guard,'coalesce(cardinality(candidates),0)<score_at and cardinality(candidates)<maximum_candidates then');
 body:=replace(body,next_score,replace(budget_guard,'>maximum_candidates','>=maximum_candidates')||E'\n'||next_score);
 execute replace(pg_get_functiondef(original.oid),original.prosrc,body);
 select * into installed from pg_proc where oid=original.oid;
 if installed.proowner<>original.proowner or installed.proacl is distinct from original.proacl
  or installed.proconfig is distinct from original.proconfig or installed.prosecdef is distinct from original.prosecdef then
   raise exception 'PREPARED_FINAL_PROOF_AUTHORITY_CHANGED';
 end if;
end $migration$;
commit;
