-- Hosted rollback-only acceptance. Does not create accounts, jobs or posts.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $acceptance$
DECLARE role_name text; response jsonb; rejected boolean; checks integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='live_streams' AND c.relname='social_publish_jobs' AND c.relrowsecurity) THEN
    RAISE EXCEPTION 'SOCIAL_PRIVATE_TABLE_RLS_MISSING';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_table_privilege(role_name,'live_streams.social_publish_jobs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'SOCIAL_PRIVATE_TABLE_GRANT';
    END IF;
  END LOOP;
  checks := checks+1;
  IF EXISTS (SELECT 1 FROM live_streams.integration_runtime WHERE enabled OR publishing_enabled)
    OR EXISTS (SELECT 1 FROM live_streams.social_publish_jobs) THEN RAISE EXCEPTION 'SOCIAL_ADMISSION_NOT_CLOSED'; END IF;
  checks := checks+1;
  IF NOT has_function_privilege('authenticated','public.live_social_command(uuid,text,jsonb,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.live_social_command(uuid,text,jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'SOCIAL_USER_ACL_INVALID'; END IF;
  checks := checks+1;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_function_privilege(role_name,'public.live_social_credentials(uuid,uuid,text)','EXECUTE')
      OR has_function_privilege(role_name,'public.live_social_worker(text,uuid,uuid,jsonb)','EXECUTE')
      OR has_function_privilege(role_name,'public.live_social_pull_grant(uuid,text,boolean)','EXECUTE') THEN
      RAISE EXCEPTION 'SOCIAL_PRIVILEGED_RPC_EXPOSED';
    END IF;
  END LOOP;
  checks := checks+1;
  IF NOT has_function_privilege('service_role','public.live_social_credentials(uuid,uuid,text)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.live_social_worker(text,uuid,uuid,jsonb)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.live_social_pull_grant(uuid,text,boolean)','EXECUTE') THEN RAISE EXCEPTION 'SOCIAL_SERVICE_ACL_MISSING'; END IF;
  checks := checks+1;
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  EXECUTE 'SET LOCAL ROLE service_role';
  response := public.live_social_worker('claim',NULL,NULL,'{}');
  IF response->'items' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'SOCIAL_UNEXPECTED_JOB'; END IF;
  checks := checks+1;
  response := public.live_social_pull_grant(NULL,repeat('0',64),true);
  IF response IS NOT NULL THEN RAISE EXCEPTION 'SOCIAL_INVALID_CAPABILITY_ACCEPTED'; END IF;
  checks := checks+1;
  rejected := false;
  BEGIN
    PERFORM public.live_social_credentials(NULL,NULL,'x');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='ACCESS_DENIED' THEN rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'SOCIAL_MISSING_ACTOR_ACCEPTED'; END IF;
  checks := checks+1;
  EXECUTE 'RESET ROLE';
  IF checks<>8 THEN RAISE EXCEPTION 'SOCIAL_ACCEPTANCE_INCOMPLETE'; END IF;
  PERFORM set_config('qa.live_social_completed_checks',checks::text,true);
END;
$acceptance$;
SELECT current_setting('qa.live_social_completed_checks')::integer AS passed_checks;
ROLLBACK;
