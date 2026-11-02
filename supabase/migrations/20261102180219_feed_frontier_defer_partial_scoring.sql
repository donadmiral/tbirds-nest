-- A partial frontier with fewer candidates than the requested page cannot meet
-- the existing page-size termination condition. Score only after it can, or
-- after all visible frontiers are exhausted. Ranking, RLS and cursors are exact.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare
 f pg_proc%rowtype;definition text;
 anchor constant text:='   with scored as materialized(select * from feed_ranking.score(candidates,p_mode)),page as(';
 replacement constant text:='   select max(b) into best from unnest(bounds)b;
   if best>=0 and coalesce(cardinality(candidates),0)<p_limit then
     continue;
   end if;
   with scored as materialized(select * from feed_ranking.score(candidates,p_mode)),page as(';
begin
 select * into f from pg_proc where oid=to_regprocedure('feed_ranking.select_page(text,double precision,uuid,integer)');
 if f.oid is null or md5(f.prosrc)<>'8e3e33eea56bd706327398f5b46cfc7d'
   or f.prosecdef or f.provolatile<>'s' or f.prolang<>(select oid from pg_language where lanname='plpgsql')
   or f.proconfig is distinct from array['search_path=""']::text[]
   or not has_function_privilege('authenticated',f.oid,'execute')
   or has_function_privilege('anon',f.oid,'execute') then
   raise exception 'FEED_FRONTIER_BASELINE_REQUIRES_REVIEW';
 end if;
 if (length(f.prosrc)-length(replace(f.prosrc,anchor,'')))/length(anchor)<>1 then
   raise exception 'FEED_FRONTIER_SCORING_ANCHOR_REQUIRES_REVIEW';
 end if;
 definition:=pg_get_functiondef(f.oid);
 execute replace(definition,anchor,replacement);
end $migration$;
notify pgrst,'reload schema';
commit;
