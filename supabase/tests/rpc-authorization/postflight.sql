-- Read-only verification of the sealed three-RPC patch. No real user IDs/data.
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
DO $rpc_postflight$
DECLARE expected record; target oid;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('public.save_push_token(uuid,text,text,text)', '58b6505e591d48b25630474bb0699d54', true, 3),
    ('public.get_or_create_group_conversation(text,uuid,text,text,uuid)', '70e63e6529edf42d58358cc750e3123a', true, 3),
    ('public.community_admit(uuid,uuid,uuid)', 'bd8c75ce328111a56f26f3a44bf43a0d', false, 2)
  ) AS v(signature, definition_md5, authenticated_execute, acl_count)
  LOOP
    target := to_regprocedure(expected.signature);
    IF target IS NULL
       OR md5(pg_get_functiondef(target)) IS DISTINCT FROM expected.definition_md5
       OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'postgres'::regrole::oid
       OR has_function_privilege('anon',target,'EXECUTE')
       OR has_function_privilege('authenticated',target,'EXECUTE') IS DISTINCT FROM expected.authenticated_execute
       OR NOT has_function_privilege('service_role',target,'EXECUTE')
       OR (SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=target) <> expected.acl_count
       OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=target
          AND (a.grantee<>ALL(ARRAY['postgres'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid])
            OR a.grantor<>'postgres'::regrole::oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
      RAISE EXCEPTION 'RPC postflight mismatch: %', expected.signature;
    END IF;
  END LOOP;

  -- Expected ACL denials, additionally protected by transaction read-only mode.
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.save_push_token(NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'Anonymous push execution unexpectedly permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_or_create_group_conversation('community',NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'Anonymous group execution unexpectedly permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.community_admit(NULL,NULL,NULL);
    RAISE EXCEPTION 'Anonymous direct admission unexpectedly permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.community_admit(NULL,NULL,NULL);
    RAISE EXCEPTION 'Authenticated direct admission unexpectedly permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.save_push_token('10000000-0000-4000-8000-000000000002','synthetic-denial-probe',NULL,'ios');
    RAISE EXCEPTION 'Cross-account push registration unexpectedly permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_or_create_group_conversation('community',NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'Missing group membership unexpectedly permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
END;
$rpc_postflight$;

SELECT p.oid::regprocedure::text AS signature,
       md5(pg_get_functiondef(p.oid)) AS definition_md5,
       pg_get_userbyid(p.proowner) AS owner, p.proacl::text AS acl,
       has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') AS service_role_execute
FROM pg_proc p
WHERE p.oid IN ('public.save_push_token(uuid,text,text,text)'::regprocedure,
  'public.get_or_create_group_conversation(text,uuid,text,text,uuid)'::regprocedure,
  'public.community_admit(uuid,uuid,uuid)'::regprocedure)
ORDER BY signature;
ROLLBACK;
