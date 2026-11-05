-- A sparse affinity cohort must not inflate the bound of every unseen author.
-- Only when every eligible post of every affinity author fits in this bounded
-- preload can the remaining unseen population use the zero-affinity bound.
-- The canonical score retains the real affinity boost and exact author window.
-- Preloaded IDs count toward the existing total candidate limit. Larger
-- cohorts retain the original conservative bound and canonical fallback.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare
 original pg_proc%rowtype;installed pg_proc%rowtype;body text;
 declaration constant text:='affinity_max integer;';
 affinity constant text:=$affinity$ select coalesce(max(a.n),0) into affinity_max from(
   select p.user_id,count(*) n from public.post_likes l join public.posts p on p.id=l.post_id
   where l.user_id=(select auth.uid()) and l.created_at>now()-interval '30 days' group by p.user_id
 )a;$affinity$;
begin
 select * into original from pg_proc where oid='prepared_feed.select_page(text,double precision,uuid,integer)'::regprocedure;
 if not(md5(original.prosrc)=any(array['f650d84638339d79e73f410cd4dbe2b7','f3e559184b64210f3399d35a0dd44ab6']))
  or original.prosecdef or original.provolatile<>'s'
  or original.prolang<>(select oid from pg_language where lanname='plpgsql')
  or original.proconfig is distinct from array['search_path=""']::text[]
  or not has_function_privilege('prepared_feed_reader',original.oid,'execute')
  or has_function_privilege('authenticated',original.oid,'execute')
  or has_function_privilege('anon',original.oid,'execute')
  or has_function_privilege('service_role',original.oid,'execute')
  or not(select relrowsecurity from pg_class where oid='feed_ranking.catalog'::regclass) then
  raise exception 'PREPARED_AFFINITY_COHORT_BASELINE_REQUIRED';
 end if;
 if (length(original.prosrc)-length(replace(original.prosrc,declaration,'')))/length(declaration)<>1
  or (length(original.prosrc)-length(replace(original.prosrc,affinity,'')))/length(affinity)<>1 then
  raise exception 'PREPARED_AFFINITY_COHORT_ANCHORS_REQUIRED';
 end if;
 create index feed_catalog_author on feed_ranking.catalog(user_id,post_id);
 body:=replace(original.prosrc,declaration,'affinity_max integer;affinity_author_count bigint;affinity_authors uuid[];affinity_candidates uuid[];');
 body:=replace(body,affinity,$cohort$ select coalesce(max(a.n),0),count(*),array_agg(a.user_id)filter(where a.ordinal<=8)
 into affinity_max,affinity_author_count,affinity_authors from(
   select p.user_id,count(*) n,row_number()over() ordinal from public.post_likes l join public.posts p on p.id=l.post_id
   where l.user_id=(select auth.uid()) and l.created_at>now()-interval '30 days' group by p.user_id
 )a;
 if affinity_author_count between 1 and 8 then
   select coalesce(array_agg(c.post_id),'{}') into affinity_candidates from(
    select cohort.post_id from unnest(affinity_authors)author(id)
    cross join lateral(
     select c.post_id from feed_ranking.catalog c where c.user_id=author.id
      and c.created_at>minimum_time and (p_mode<>'innovation' or c.channel='innovation') limit 513
    )cohort limit 513
   )c;
   if cardinality(affinity_candidates)<=512 then candidates:=affinity_candidates;affinity_max:=0;end if;
 end if;$cohort$);
 execute replace(pg_get_functiondef(original.oid),original.prosrc,body);
 select * into installed from pg_proc where oid=original.oid;
 if installed.proowner<>original.proowner or installed.proacl is distinct from original.proacl
  or installed.proconfig is distinct from original.proconfig or installed.prosecdef<>original.prosecdef
  or installed.provolatile<>original.provolatile then raise exception 'PREPARED_AFFINITY_COHORT_AUTHORITY_CHANGED';end if;
end $migration$;
notify pgrst,'reload schema';
commit;
