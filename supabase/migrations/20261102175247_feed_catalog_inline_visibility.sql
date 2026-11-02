-- Keep every caller's existing posts/profiles RLS and canonical authority.
-- Only inline the exact reviewed visibility SELECT at the catalog policy
-- boundary. A later canonical-function change automatically uses that function.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $guard$
declare f pg_proc%rowtype;p pg_policy%rowtype;
begin
 select * into f from pg_proc where oid=to_regprocedure('public.get_feed_visibility(uuid[])');
 if f.oid is null or md5(f.prosrc)<>'bd469b35c28c5f71bf6d84faed221c42'
   or f.prosecdef or f.provolatile<>'s' or f.prolang<>(select oid from pg_language where lanname='plpgsql')
   or f.proconfig is distinct from array['search_path=""']::text[]
   or not has_function_privilege('authenticated',f.oid,'execute')
   or has_function_privilege('anon',f.oid,'execute')
   or not (select relrowsecurity from pg_class where oid='feed_ranking.catalog'::regclass)
   or to_regprocedure('feed_ranking.visibility_contract_current()') is not null then
   raise exception 'FEED_VISIBILITY_BASELINE_REQUIRES_REVIEW';
 end if;
 select * into p from pg_policy where polrelid='feed_ranking.catalog'::regclass and polname='feed_catalog_visible';
 if p.oid is null or not p.polpermissive or p.polcmd<>'r' or p.polwithcheck is not null
   or p.polroles is distinct from array[(select oid from pg_roles where rolname='authenticated')]::oid[]
   or replace(regexp_replace(pg_get_expr(p.polqual,p.polrelid),'[[:space:]]+','','g'),'public.','')
      <>'(EXISTS(SELECT1FROMget_feed_visibility(ARRAY[catalog.post_id])v(post_id,snapshot_eligible)))'
   or (select count(*) from pg_policy where polrelid=p.polrelid)<>1 then
   raise exception 'FEED_CATALOG_POLICY_REQUIRES_REVIEW';
 end if;
end $guard$;

-- The initplan executes once per policy-bearing query, not once per catalog row.
-- Keep SECURITY INVOKER; no role or caller authority changes occur here.
create function feed_ranking.visibility_contract_current()
returns boolean language sql stable security invoker set search_path='' as $contract$
 select auth.uid() is not null and coalesce((select
   md5(p.prosrc)='bd469b35c28c5f71bf6d84faed221c42'
   and not p.prosecdef and p.provolatile='s'
   and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
   and p.proconfig=array['search_path=""']::text[]
   and pg_catalog.has_function_privilege(p.oid,'execute')
   from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.get_feed_visibility(uuid[])')),false);
$contract$;
revoke all on function feed_ranking.visibility_contract_current() from public,anon,authenticated,service_role;
grant execute on function feed_ranking.visibility_contract_current() to authenticated;

do $inline$
declare body text;query text;start_at integer;stop_at integer;
begin
 select prosrc into body from pg_proc where oid='public.get_feed_visibility(uuid[])'::regprocedure;
 start_at:=position('  return query' in body)+length('  return query');
 stop_at:=position(E'\nend;' in body);
 if start_at<=length('  return query') or stop_at<=start_at then raise exception 'FEED_VISIBILITY_ANCHOR_REQUIRES_REVIEW';end if;
 query:=rtrim(btrim(substring(body from start_at for stop_at-start_at)),';');
 if (length(query)-length(replace(query,'p_ids','')))/length('p_ids')<>1 then raise exception 'FEED_VISIBILITY_ARGUMENT_REQUIRES_REVIEW';end if;
 query:=replace(query,'p_ids','array[catalog.post_id]');
 execute 'alter policy feed_catalog_visible on feed_ranking.catalog using (
   case when (select feed_ranking.visibility_contract_current()) then exists ('||query||')
   else exists(select 1 from public.get_feed_visibility(array[catalog.post_id])) end)';
end $inline$;
notify pgrst,'reload schema';
commit;
