-- Hosted rollback-only checks for the optional-integration foundation.
-- No identities, clips, OAuth grants, provider requests or jobs are created.
-- Run the complete file as one stop-on-error management request.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $acceptance$
DECLARE
  names text[] := ARRAY['integration_runtime','social_connections','oauth_states','transcription_jobs','transcription_limits','transcription_reservations'];
  table_name text;
  role_name text;
  response jsonb;
  rejected boolean;
  checks integer := 0;
BEGIN
  FOREACH table_name IN ARRAY names LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='live_streams' AND c.relname=table_name AND c.relrowsecurity
    ) THEN RAISE EXCEPTION 'OPTIONAL_TABLE_RLS_MISSING'; END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_table_privilege(role_name, 'live_streams.'||table_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
        RAISE EXCEPTION 'OPTIONAL_PRIVATE_TABLE_GRANT';
      END IF;
    END LOOP;
  END LOOP;
  checks := checks + 1;

  IF NOT EXISTS (SELECT 1 FROM live_streams.transcription_limits
    WHERE singleton AND max_provider_active=2 AND max_daily_starts=12 AND max_daily_audio_ms=900000) THEN
    RAISE EXCEPTION 'OPTIONAL_PROVIDER_BUDGET_INVALID';
  END IF;
  checks := checks + 1;

  IF EXISTS (SELECT 1 FROM live_streams.integration_runtime WHERE enabled OR publishing_enabled)
    OR (SELECT count(*) FROM live_streams.integration_runtime) <> 6 THEN
    RAISE EXCEPTION 'OPTIONAL_ADMISSION_NOT_CLOSED';
  END IF;
  checks := checks + 1;

  IF NOT has_function_privilege('authenticated','public.live_integration_context()','EXECUTE')
    OR has_function_privilege('anon','public.live_integration_context()','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.live_transcription_command(uuid,text,jsonb,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.live_transcription_command(uuid,text,jsonb,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'OPTIONAL_USER_RPC_GRANT_INVALID';
  END IF;
  checks := checks + 1;

  IF NOT has_function_privilege('service_role','public.live_oauth_operation(uuid,uuid,text,jsonb)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.live_transcription_worker(text,uuid,uuid,jsonb)','EXECUTE')
    OR has_function_privilege('anon','public.live_oauth_operation(uuid,uuid,text,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.live_oauth_operation(uuid,uuid,text,jsonb)','EXECUTE')
    OR has_function_privilege('anon','public.live_transcription_worker(text,uuid,uuid,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.live_transcription_worker(text,uuid,uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'OPTIONAL_WORKER_RPC_GRANT_INVALID';
  END IF;
  checks := checks + 1;

  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  EXECUTE 'SET LOCAL ROLE service_role';
  response := public.live_transcription_worker('claim',NULL,NULL,'{}');
  IF response->>'error' IS DISTINCT FROM 'INTEGRATION_DISABLED'
    OR response->'items' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'OPTIONAL_DISABLED_WORKER_ADMITTED';
  END IF;
  checks := checks + 1;

  response := public.live_oauth_operation(NULL,NULL,'status','{}');
  IF response->>'error' IS DISTINCT FROM 'AUTH_REQUIRED' THEN
    RAISE EXCEPTION 'OPTIONAL_OAUTH_MISSING_ACTOR_ACCEPTED';
  END IF;
  checks := checks + 1;
  EXECUTE 'RESET ROLE';

  -- Missing-configuration fail-closed behavior is covered by the disposable
  -- local PostgreSQL suite. Hosted checks do not delete configuration rows.

  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  PERFORM set_config('request.jwt.claim.role','anon',true);
  EXECUTE 'SET LOCAL ROLE anon';
  rejected := false;
  BEGIN
    PERFORM public.live_transcription_worker('claim',NULL,NULL,'{}');
  EXCEPTION WHEN insufficient_privilege THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'OPTIONAL_ANONYMOUS_WORKER_EXECUTED'; END IF;
  checks := checks + 1;
  EXECUTE 'RESET ROLE';

  IF checks <> 8 THEN RAISE EXCEPTION 'OPTIONAL_ACCEPTANCE_INCOMPLETE'; END IF;
  PERFORM set_config('qa.live_optional_completed_checks',checks::text,true);
END;
$acceptance$;
SELECT current_setting('qa.live_optional_completed_checks')::integer AS passed_checks;
ROLLBACK;
