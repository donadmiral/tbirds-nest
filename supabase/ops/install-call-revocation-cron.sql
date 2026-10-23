-- Execute as the project database owner after applying the scoped credential
-- migration and deploying daily-reconcile with --no-verify-jwt.
-- Credentials stay in Vault. This file does not contain, read back or print them.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='project_url') OR
    NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='call_reconcile_secret') THEN
   RAISE EXCEPTION 'Apply the scoped worker credential migration and configure Vault project_url before installing the call revocation schedule';
 END IF;
 IF NOT public.validate_call_worker_token((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='call_reconcile_secret')) THEN
   RAISE EXCEPTION 'Vault worker credential does not match its stored digest';
 END IF;
 IF (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url') !~ '^https://[a-z0-9]+[.]supabase[.]co$' THEN
   RAISE EXCEPTION 'project_url must be this Supabase project HTTPS origin';
 END IF;
END;
$$;
SELECT cron.schedule('platinum-call-revocations','* * * * *', $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url') || '/functions/v1/daily-reconcile',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='call_reconcile_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);
COMMIT;
-- A named schedule is updated on re-run, rather than creating duplicate workers.
SELECT jobid,jobname,schedule,active FROM cron.job WHERE jobname='platinum-call-revocations';
