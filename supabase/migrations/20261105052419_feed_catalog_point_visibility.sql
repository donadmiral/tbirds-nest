-- A single known non-null catalog ID does not need an array predicate.
-- The correlated ANY(COALESCE(ARRAY[id], ...)) prevented a posts PK lookup
-- under RLS, scanning the full posts table for each candidate. Preserve the
-- complete authorization expression and its canonical fallback verbatim.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare p pg_policy%rowtype;expression text;
 anchor constant text:='p.id = ANY (COALESCE(ARRAY[catalog.post_id], ''{}''::uuid[]))';
begin
 select * into p from pg_policy where polrelid='feed_ranking.catalog'::regclass and polname='feed_catalog_visible';
 expression:=pg_get_expr(p.polqual,p.polrelid);
 if p.oid is null or not p.polpermissive or p.polcmd<>'r'
  or p.polroles is distinct from array[('authenticated'::regrole)::oid]
  or (select count(*) from pg_policy where polrelid=p.polrelid)<>1
  or not(select relrowsecurity from pg_class where oid=p.polrelid)
  or not(select attnotnull from pg_attribute where attrelid=p.polrelid and attname='post_id')
  or position('feed_ranking.visibility_contract_current()' in expression)=0
  or position('get_feed_visibility(ARRAY[catalog.post_id])' in expression)=0
  or (length(expression)-length(replace(expression,anchor,'')))/length(anchor)<>1 then
  raise exception 'FEED_POINT_VISIBILITY_BASELINE_REQUIRED';
 end if;
 execute 'alter policy feed_catalog_visible on feed_ranking.catalog using ('||replace(expression,anchor,'p.id = catalog.post_id')||')';
end $migration$;
notify pgrst,'reload schema';
commit;
