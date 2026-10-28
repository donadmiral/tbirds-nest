-- Install only after compatible clients, migration, scoped credential and worker.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
DO $$BEGIN
 IF (SELECT count(*) FROM vault.secrets WHERE name='private_media_cleanup_secret')<>1 OR (SELECT count(*) FROM vault.secrets WHERE name='project_url')<>1 THEN RAISE EXCEPTION 'Unique project URL and cleanup credential required';END IF;
 IF NOT public.validate_private_media_cleanup_token((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='private_media_cleanup_secret')) THEN RAISE EXCEPTION 'Cleanup credential mismatch';END IF;
 IF (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url')!~'^https://[a-z0-9]+[.]supabase[.]co$' THEN RAISE EXCEPTION 'Invalid project origin';END IF;
END$$;
SELECT cron.schedule('platinum-private-media-cleanup','* * * * *',$job$SELECT net.http_post(url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url')||'/functions/v1/private-media-cleanup',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='private_media_cleanup_secret')),body:='{}'::jsonb,timeout_milliseconds:=60000);$job$);
COMMIT;
SELECT jobid,jobname,schedule,active FROM cron.job WHERE jobname='platinum-private-media-cleanup';
