-- Read-only. For trusted release operators; never include receipts or filenames.
select jsonb_build_object(
 'workerConfigured',(select secret_digest is not null from account_erasure.worker where singleton),
 'workerSeenAt',(select last_seen_at from account_erasure.worker where singleton),
 'workerHealthy',(select last_seen_at>clock_timestamp()-interval '15 minutes' from account_erasure.worker where singleton),
 'queue',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from(
  select state,reason,count(*) requests,min(created_at) oldest_request,max(attempts) highest_attempts
  from account_erasure.jobs group by state,reason order by state,reason) s),
 'unfencedApplicationTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','creator_finance','marketplace_ops') and c.relkind='r'
   and not exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='account_erasure_actor_write' and t.tgenabled='O')),
 'privateTables',(select jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,
  'anonAccess',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
  'appAccess',has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
  'serviceDirectAccess',has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')) order by c.relname)
  from pg_class c where c.relnamespace='account_erasure'::regnamespace and c.relkind='r')
);
