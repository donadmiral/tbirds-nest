-- Equal raw scores within one author previously received unspecified window
-- positions. That made even two legitimate equal timestamps force the full
-- canonical scan. Resolve only those peers with the feed's existing UUID-desc
-- final order, in BOTH ranking paths. All score weights, diversity multipliers,
-- visibility predicates, cursor comparisons and strict frontier bounds remain.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare
 f pg_proc%rowtype;signature text;expected text[];definition text;
 old_order constant text:='row_number() over (partition by b.user_id order by b.raw_score desc)';
 new_order constant text:='row_number() over (partition by b.user_id order by b.raw_score desc, b.id desc)';
 old_guard constant text:='   -- The legacy query has no tie breaker inside its author window. Keep that
   -- exact plan for equal raw scores rather than introducing a new tie policy.
   if has_tie then return jsonb_build_object(''fallback'',true,''candidates'',cardinality(candidates),''reason'',''legacy_tie'');end if;';
begin
 foreach signature in array array[
   'feed_ranking.fallback(text,double precision,uuid,integer)',
   'feed_ranking.score(uuid[],text)'
 ] loop
   -- The second baseline is the identical installed QA/production definition,
   -- with only the existing 20261029074217 home marketplace exclusion added.
   -- Keep that environment-specific predicate intact. Unknown bodies fail closed.
   expected:=case when signature like 'feed_ranking.fallback(%'
     then array['0d22cdf3ff7a6c9fdbb76ac87e7c5947','bc277d8c14638c03e75bfc0f06d1eab0']
     else array['a5fe7a2ac910bb3b3786d9cca978e704','8f8bf0dc8d2085bda193c3bc13ed9609'] end;
   select * into f from pg_proc where oid=to_regprocedure(signature);
   if f.oid is null or not(md5(f.prosrc)=any(expected)) or f.prosecdef or f.provolatile<>'s'
     or f.prolang<>(select oid from pg_language where lanname='sql')
     or f.proconfig is distinct from array['search_path=public']::text[]
     or not has_function_privilege('authenticated',f.oid,'execute')
     or has_function_privilege('anon',f.oid,'execute') then
     raise exception 'FEED_AUTHOR_TIE_BASELINE_REQUIRES_REVIEW: %',signature;
   end if;
   if (length(f.prosrc)-length(replace(f.prosrc,old_order,'')))/length(old_order)<>1 then
     raise exception 'FEED_AUTHOR_TIE_ANCHOR_REQUIRES_REVIEW: %',signature;
   end if;
   definition:=pg_get_functiondef(f.oid);
   execute replace(definition,old_order,new_order);
 end loop;

 select * into f from pg_proc where oid=to_regprocedure('feed_ranking.select_page(text,double precision,uuid,integer)');
 if f.oid is null or md5(f.prosrc)<>'014705c6f587aaa7adaf43e2f408f1d0' or f.prosecdef or f.provolatile<>'s'
   or f.prolang<>(select oid from pg_language where lanname='plpgsql')
   or f.proconfig is distinct from array['search_path=""']::text[]
   or not has_function_privilege('authenticated',f.oid,'execute')
   or has_function_privilege('anon',f.oid,'execute') then
   raise exception 'FEED_AUTHOR_TIE_FRONTIER_REQUIRES_REVIEW';
 end if;
 if (length(f.prosrc)-length(replace(f.prosrc,old_guard,'')))/length(old_guard)<>1 then
   raise exception 'FEED_AUTHOR_TIE_GUARD_REQUIRES_REVIEW';
 end if;
 definition:=pg_get_functiondef(f.oid);
 execute replace(definition,old_guard,'   -- Equal author scores now use the same UUID-desc order in both paths.');
end $migration$;
notify pgrst,'reload schema';
commit;
