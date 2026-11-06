-- Read-only preflight for the bounded prepared-selector query migrations.
-- Run separately on QA and production after the unchanged isolated load gate.
-- Expected selector chain:
-- 81dd45f216d9ea8b7a08745d95539549 -> final boundary proof
-- b563cb26f012861f068f7b2294bd0342 -> exact integer mass seek
-- ca6989eca29221e2397793daf1b53b43 -> both installed
-- f3e559184b64210f3399d35a0dd44ab6 -> statement score reuse installed (hosted marketplace contract)
-- 04e8e5e6a7c965331b92c7504bffe704 -> complete bounded affinity cohort installed
-- This script changes no DDL, flags, scheduler, quota, or application rows.
begin read only;
set local statement_timeout='3s';
set local lock_timeout='1s';

select jsonb_build_object(
 'observed_at',clock_timestamp(),
 'postgres_version',version(),
 'max_connections',current_setting('max_connections'),
 'selector',(
  select jsonb_build_object(
   'source_md5',md5(f.prosrc),
   'migration_state',case md5(f.prosrc)
    when '81dd45f216d9ea8b7a08745d95539549' then 'final_proof_then_mass_seek_required'
    when 'b563cb26f012861f068f7b2294bd0342' then 'mass_seek_required'
    when 'ca6989eca29221e2397793daf1b53b43' then 'statement_score_cache_required'
    when 'f3e559184b64210f3399d35a0dd44ab6' then 'affinity_cohort_required'
    when '04e8e5e6a7c965331b92c7504bffe704' then 'all_query_migrations_installed'
    else 'stop_unreviewed_baseline' end,
   'owner',pg_get_userbyid(f.proowner),
   'security_definer',f.prosecdef,
   'volatility',f.provolatile,
   'language',l.lanname,
   'settings',f.proconfig,
   'acl',f.proacl,
   'worker_can_execute',has_function_privilege('prepared_feed_reader',f.oid,'execute'),
   'authenticated_can_execute',has_function_privilege('authenticated',f.oid,'execute'),
   'anonymous_can_execute',has_function_privilege('anon',f.oid,'execute'),
   'service_can_execute',has_function_privilege('service_role',f.oid,'execute'))
  from pg_proc f join pg_language l on l.oid=f.prolang
  where f.oid=to_regprocedure('prepared_feed.select_page(text,double precision,uuid,integer)')),
 'unchanged_function_fingerprints',(
  select jsonb_object_agg(f.oid::regprocedure::text,md5(f.prosrc)) from pg_proc f
  where f.oid in(
   to_regprocedure('public.get_feed(text,double precision,uuid,integer)'),
   to_regprocedure('feed_ranking.select_page(text,double precision,uuid,integer)'),
   to_regprocedure('feed_ranking.score(uuid[],text)'),
   to_regprocedure('prepared_feed.rank(jsonb,text)'),
   to_regprocedure('prepared_feed.exact_ids(text)'))),
 'catalog',(
  select jsonb_build_object(
   'rls_enabled',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
   'estimated_rows',c.reltuples,'total_bytes',pg_total_relation_size(c.oid),
   'mass_units_exists',exists(
    select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='mass_units' and not a.attisdropped),
   'mass_units_definition',(
    select jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'generated',a.attgenerated,
     'expression',pg_get_expr(d.adbin,d.adrelid))
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=c.oid and a.attname='mass_units' and not a.attisdropped),
   'exact_constraint',(
    select pg_get_constraintdef(con.oid) from pg_constraint con
    where con.conrelid=c.oid and con.conname='feed_catalog_mass_units_exact'),
   'policy_fingerprints',(
    select jsonb_object_agg(p.polname,md5(pg_get_expr(p.polqual,p.polrelid)))
    from pg_policy p where p.polrelid=c.oid))
  from pg_class c where c.oid=to_regclass('feed_ranking.catalog')),
 'mass_rows_incompatible_with_exact_integer',(
  select count(*) from feed_ranking.catalog
  where mass*2<>trunc(mass*2) or mass*2>9223372036854775807::numeric or mass*2<(-9223372036854775808)::numeric),
 'ranking_indexes',(
  select jsonb_agg(jsonb_build_object('name',i.indexname,'definition',i.indexdef)order by i.indexname)
  from pg_indexes i where i.schemaname='feed_ranking' and i.tablename='catalog'
   and i.indexname in('feed_catalog_mass_units','feed_catalog_innovation_mass_units','feed_catalog_author')),
 'prepared_feed_enabled',(select enabled from prepared_feed.settings where singleton),
 'indexed_feed_enabled',(select enabled from feed_ranking.settings where singleton)
) as preflight;

rollback;
