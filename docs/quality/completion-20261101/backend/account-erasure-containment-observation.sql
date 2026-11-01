-- Exact, read-only containment pre/post projection. No secret values, queue
-- headers, cron command text, user IDs, Auth rows or object paths are returned.
begin read only;
set local search_path=pg_catalog;
set local lock_timeout='3s';
set local statement_timeout='15s';
select jsonb_build_object(
 'observedAt',clock_timestamp(),'executor',current_user,'readOnly',current_setting('transaction_read_only')='on',
 'dispatchAbsent',to_regclass('account_erasure.dispatch')is null,
 'worker',(select coalesce(jsonb_agg(jsonb_build_object('singleton',singleton,'credentialConfigured',secret_digest is not null,'lastSeenAt',last_seen_at)),'[]'::jsonb)from account_erasure.worker),
 'jobCount',(select count(*)from account_erasure.jobs),
 'activeLeaseCount',(select count(*)from account_erasure.jobs where lease_until>clock_timestamp()),
 'cronApiAvailable',coalesce(has_function_privilege('postgres',to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)'),'EXECUTE'),false),
 'cron',(select coalesce(jsonb_agg(jsonb_build_object('jobName',jobname,'schedule',schedule,'username',username,'active',active,'commandMd5',md5(command))order by jobid),'[]'::jsonb)from cron.job where jobname='platinum-account-storage-erasure'),
 'otherErasureCronCount',(select count(*)from cron.job where jobname<>'platinum-account-storage-erasure'and(command like '%account-storage-erasure%'or command like '%account_erasure_worker_secret%')),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',signature,'bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'volatility',p.provolatile::text,'config',p.proconfig,'acl',p.proacl::text)order by signature),'[]'::jsonb)from(values('public.validate_account_erasure_worker(text)'),('public.claim_account_erasure(uuid)'),('public.request_account_erasure(uuid,text)'),('public.triniti_admin_erasure_review(uuid,uuid,uuid,text,uuid,text,text,text,text)'))s(signature)left join pg_proc p on p.oid=to_regprocedure(s.signature)),
 'journal',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'queryBytes',octet_length(array_to_string(statements,E'\n')),'querySha256',encode(sha256(convert_to(array_to_string(statements,E'\n'),'UTF8')),'hex'))order by version),'[]'::jsonb)from supabase_migrations.schema_migrations where name='account_erasure_legacy_dispatch_containment'),
 'otherActiveOrOpenClientTransactions',(select count(*)from pg_stat_activity where pid<>pg_backend_pid()and backend_type='client backend'and state in('active','idle in transaction','idle in transaction (aborted)')),
 'preparedTransactions',(select count(*)from pg_prepared_xacts),
 'scope','Only the exact legacy schedule and reusable worker credential are contained. No job, identity, Storage, Vault, provider queue or application row is erased. A late already-authenticated no-job claim can update heartbeat, but cannot restore the null credential or readiness.'
)as observation;
rollback;
