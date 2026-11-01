-- Run only after metadata confirms cron.job exists. Never return command text,
-- request headers/body, Vault plaintext, bearer values or digest values.
begin read only;
set local search_path=pg_catalog;
set local statement_timeout='10s';
select jsonb_build_object(
 'observedAt',clock_timestamp(),'readOnly',current_setting('transaction_read_only')='on',
 'erasureCron',(select coalesce(jsonb_agg(jsonb_build_object(
  'jobId',jobid,'jobName',jobname,'schedule',schedule,'active',active,'username',username,
  'commandMd5',md5(command),'readsDecryptedVault',position('vault.decrypted_secrets'in command)>0,
  'usesReusableErasureSecretName',position('account_erasure_worker_secret'in command)>0,
  'usesProviderHttp',position('net.http_post'in command)>0,
  'usesOneUseDispatcher',position('account_erasure.enqueue_worker_run'in command)>0
 )order by jobid),'[]'::jsonb)from cron.job where jobname='platinum-account-storage-erasure'),
 'otherErasureHttpCronCount',(select count(*)from cron.job where jobname<>'platinum-account-storage-erasure'and(command like '%account-storage-erasure%'or command like '%account_erasure_worker_secret%')),
 'erasureVaultSecretCount',(select count(*)from vault.secrets where name='account_erasure_worker_secret'),
 'erasureVaultOriginCount',(select count(*)from vault.secrets where name='account_erasure_project_url')
)as observation;
rollback;
