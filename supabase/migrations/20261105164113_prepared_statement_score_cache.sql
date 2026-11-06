-- Score every candidate once within this STABLE selector statement. Rebuild
-- the exact author window from those raw scores at each proof checkpoint.
-- No score, card, authorization result, or viewer data survives the call.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare
 original pg_proc%rowtype;installed pg_proc%rowtype;scorer pg_proc%rowtype;body text;guard text;
 declaration constant text:=' score_at integer:=200;';
 scoring constant text:='   with scored as materialized(select * from feed_ranking.score(candidates,p_mode)),page as(';
 auth_guard constant text:=' if auth.uid() is null then raise exception ''Authentication required'' using errcode=''42501'';end if;';
begin
 select * into original from pg_proc where oid='prepared_feed.select_page(text,double precision,uuid,integer)'::regprocedure;
 select * into scorer from pg_proc where oid='feed_ranking.score(uuid[],text)'::regprocedure;
 if md5(original.prosrc)<>'ca6989eca29221e2397793daf1b53b43'
  or original.prosecdef or original.provolatile<>'s'
  or original.prolang<>(select oid from pg_language where lanname='plpgsql')
  or original.proconfig is distinct from array['search_path=""']::text[]
  or not has_function_privilege('prepared_feed_reader',original.oid,'execute')
  or has_function_privilege('authenticated',original.oid,'execute')
  or has_function_privilege('anon',original.oid,'execute')
  or has_function_privilege('service_role',original.oid,'execute')
  or not(md5(scorer.prosrc)=any(array['4188367673ffd8723f43b8d998dba435','91a9a925f0c61c31a8d8e5f533f5c89c']))
  or scorer.prosecdef or scorer.provolatile<>'s'
  or scorer.prolang<>(select oid from pg_language where lanname='sql')
  or scorer.proconfig is distinct from array['search_path=public']::text[] then
  raise exception 'PREPARED_STATEMENT_SCORE_BASELINE_REQUIRED';
 end if;
 if (length(original.prosrc)-length(replace(original.prosrc,declaration,'')))/length(declaration)<>1
  or (length(original.prosrc)-length(replace(original.prosrc,scoring,'')))/length(scoring)<>1
  or (length(original.prosrc)-length(replace(original.prosrc,auth_guard,'')))/length(auth_guard)<>1 then
  raise exception 'PREPARED_STATEMENT_SCORE_ANCHORS_REQUIRED';
 end if;
 -- The derivation below relies on this exact canonical raw score and 0.55
 -- author-diversity contract. A later scorer edit uses the canonical fallback
 -- until its corresponding selector change is reviewed.
 guard:=format($guard$
 if not exists(select 1 from pg_catalog.pg_proc p
  where p.oid='feed_ranking.score(uuid[],text)'::regprocedure and md5(p.prosrc)=%L
   and not p.prosecdef and p.provolatile='s'
   and p.prolang=(select oid from pg_catalog.pg_language where lanname='sql')
   and p.proconfig=array['search_path=public']::text[]) then
  return jsonb_build_object('fallback',true,'candidates',0,'reason','score_contract_changed');
 end if;
$guard$,md5(scorer.prosrc));
 body:=replace(original.prosrc,auth_guard,auth_guard||guard);
 body:=replace(body,declaration,$declarations$
 score_at integer:=200;
 scored_ids uuid[]:='{}';scored_authors uuid[]:='{}';scored_raws numeric[]:='{}';processed_ids uuid[]:='{}';
 fresh_ids uuid[];fresh_authors uuid[];fresh_raws numeric[];new_candidates uuid[];
$declarations$);
 body:=replace(body,scoring,$scoring$
   -- The selector is STABLE, so each checkpoint sees the same statement
   -- snapshot. Keep evaluated-but-ineligible IDs in processed_ids as well.
   select coalesce(array_agg(v),'{}') into new_candidates from(
    select unnest(candidates)v except select unnest(processed_ids)v
   )fresh;
   select coalesce(array_agg(id order by id),'{}'),coalesce(array_agg(author_id order by id),'{}'),coalesce(array_agg(raw_score order by id),'{}')
   into fresh_ids,fresh_authors,fresh_raws from feed_ranking.score(new_candidates,p_mode);
   scored_ids:=scored_ids||fresh_ids;scored_authors:=scored_authors||fresh_authors;scored_raws:=scored_raws||fresh_raws;processed_ids:=candidates;
   with scored as materialized(
    select b.id,b.author_id,b.raw_score,
     (b.raw_score*power(0.55::double precision,row_number()over(partition by b.author_id order by b.raw_score desc,b.id desc)-1))::double precision sort_key,
     count(*)over(partition by b.author_id,b.raw_score)>1 tied
    from unnest(scored_ids,scored_authors,scored_raws)b(id,author_id,raw_score)
   ),page as(
$scoring$);
 execute replace(pg_get_functiondef(original.oid),original.prosrc,body);
 select * into installed from pg_proc where oid=original.oid;
 if installed.proowner<>original.proowner or installed.proacl is distinct from original.proacl
  or installed.proconfig is distinct from original.proconfig or installed.prosecdef<>original.prosecdef
  or installed.provolatile<>original.provolatile then raise exception 'PREPARED_STATEMENT_SCORE_AUTHORITY_CHANGED';end if;
end $migration$;
notify pgrst,'reload schema';
commit;
