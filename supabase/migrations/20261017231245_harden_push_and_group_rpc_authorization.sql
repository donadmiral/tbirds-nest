-- PRIVATE REVIEW CANDIDATE: three confirmed callable-RPC authorization gaps.
-- Apply through one atomic migration transaction, isolated QA first.
-- Exact source definitions/owners/ACLs must match; unknown drift fails closed.
-- No data rewrite, client/UI change, secret, outbound call, or new public grant.

-- PRIVATE REVIEW CANDIDATE. Apply to isolated QA before production review.
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='5s';
DO $push_preflight$
DECLARE target oid := to_regprocedure('public.save_push_token(uuid,text,text,text)');
BEGIN
  IF target IS NULL OR (SELECT md5(pg_get_functiondef(target))) IS DISTINCT FROM '9f833a61f74da9f64f6996af04fb1196'
     OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'postgres'::regrole::oid THEN
    RAISE EXCEPTION 'save_push_token source changed; review before applying';
  END IF;
  IF (SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=target)<>5
     OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=target
       AND (a.grantee<>ALL(ARRAY[0::oid,'postgres'::regrole::oid,'anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid])
         OR a.grantor<>'postgres'::regrole::oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'save_push_token ACL changed; review before applying';
  END IF;
END;
$push_preflight$;

CREATE OR REPLACE FUNCTION public.save_push_token(
  p_user_id uuid,
  p_token text,
  p_device_name text DEFAULT NULL::text,
  p_platform text DEFAULT 'ios'::text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $push_guard$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'A user is required' USING ERRCODE = '22023';
  END IF;
  -- Normal clients can register only their own device. Preserve the explicit
  -- server service-role contract; a definer's current_user is always postgres.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Cannot register a device for another account' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL OR p_token = '' THEN RETURN; END IF;
  INSERT INTO public.user_push_tokens (user_id, expo_push_token, device_name, platform, updated_at)
  VALUES (p_user_id, p_token, p_device_name, p_platform, now())
  ON CONFLICT (user_id, expo_push_token)
  DO UPDATE SET device_name = EXCLUDED.device_name, platform = EXCLUDED.platform, updated_at = now();
END;
$push_guard$;

REVOKE ALL ON FUNCTION public.save_push_token(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_push_token(uuid,text,text,text) TO postgres, authenticated, service_role;

DO $push_postflight$
BEGIN
  IF has_function_privilege('anon','public.save_push_token(uuid,text,text,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.save_push_token(uuid,text,text,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.save_push_token(uuid,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'save_push_token authorization ACL verification failed';
  END IF;
  IF md5(pg_get_functiondef('public.save_push_token(uuid,text,text,text)'::regprocedure)) IS DISTINCT FROM '58b6505e591d48b25630474bb0699d54'
     OR (SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.save_push_token(uuid,text,text,text)'::regprocedure) <> 3 THEN
    RAISE EXCEPTION 'save_push_token exact definition/ACL verification failed';
  END IF;
END;
$push_postflight$;


SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='5s';
DO $community_group_preflight$
DECLARE v_signature text; v_expected text; v_oid oid;
BEGIN
  FOR v_signature, v_expected IN SELECT * FROM (VALUES
    ('public.get_or_create_group_conversation(text,uuid,text,text,uuid)', '175d102d7144124ecd57a87e9d2634e7'),
    ('public.community_admit(uuid,uuid,uuid)', 'bd8c75ce328111a56f26f3a44bf43a0d')
  ) AS expected(signature, definition_md5)
  LOOP
    v_oid := to_regprocedure(v_signature);
    IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM v_expected
       OR (SELECT proowner FROM pg_proc WHERE oid=v_oid) IS DISTINCT FROM 'postgres'::regrole::oid THEN
      RAISE EXCEPTION 'Community/group source changed: %', v_signature;
    END IF;
    IF (SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=v_oid)<>5
       OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=v_oid
         AND (a.grantee<>ALL(ARRAY[0::oid,'postgres'::regrole::oid,'anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid])
           OR a.grantor<>'postgres'::regrole::oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
      RAISE EXCEPTION 'Community/group ACL changed: %', v_signature;
    END IF;
  END LOOP;
END;
$community_group_preflight$;

-- PRIVATE REVIEW CANDIDATE. No hosted execution by this agent.
-- Preserve the shared RPC signature and moderator/service trigger calls.
-- Every synchronized user must already hold the authoritative group membership.
CREATE OR REPLACE FUNCTION public.get_or_create_group_conversation(
  p_group_type text, p_group_id uuid, p_group_name text, p_group_emoji text, p_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $group_guard$
DECLARE
  v_conv_id uuid;
  v_group_name text;
  v_group_emoji text;
BEGIN
  IF p_group_type IS NULL OR p_group_type NOT IN ('community', 'club') THEN
    RAISE EXCEPTION 'Unsupported group type' USING ERRCODE='22023';
  END IF;
  IF p_group_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Group membership required' USING ERRCODE='42501';
  END IF;

  -- A shared internal helper also runs for moderator-approved and service-created
  -- memberships. The target's authoritative membership, not caller-supplied IDs
  -- alone, determines entitlement. No JWT-role or trigger-depth bypass is used.
  -- Serialize this existing find/create contract without changing its return type.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platinum:group-conversation:' || p_group_type || ':' || p_group_id::text, 0));

  IF p_group_type = 'community' THEN
    SELECT c.name, coalesce(c.emoji, '🌐') INTO v_group_name, v_group_emoji
    FROM public.community_members m
    JOIN public.communities c ON c.id = m.community_id
    WHERE m.community_id = p_group_id AND m.user_id = p_user_id
      AND m.status IN ('active', 'limited') AND c.status = 'active'
    FOR UPDATE OF m;
  ELSE
    SELECT c.name, coalesce(c.emoji, '🎯') INTO v_group_name, v_group_emoji
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    WHERE m.club_id = p_group_id AND m.user_id = p_user_id
    FOR UPDATE OF m;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group membership required' USING ERRCODE='42501';
  END IF;

  SELECT id INTO v_conv_id FROM public.conversations
  WHERE type = 'group' AND group_type = p_group_type AND group_ref_id = p_group_id
  LIMIT 1;
  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (
      user_1, user_2, type, is_group, group_name, group_emoji,
      group_type, group_ref_id, last_message, last_message_time
    ) VALUES (
      p_user_id, NULL, 'group', true, v_group_name, v_group_emoji,
      p_group_type, p_group_id, 'Group created', now()
    ) RETURNING id INTO v_conv_id;
  END IF;
  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (v_conv_id, p_user_id, 'member') ON CONFLICT DO NOTHING;
  RETURN v_conv_id;
END;
$group_guard$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_group_conversation(text,uuid,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_group_conversation(text,uuid,text,text,uuid) TO authenticated, service_role;

-- Internal admission is reached through the existing checked SECURITY DEFINER
-- wrappers. Their postgres-owner calls continue to work; direct client bypass
-- of invite/approval checks is removed. The body is deliberately unchanged.
REVOKE EXECUTE ON FUNCTION public.community_admit(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_admit(uuid,uuid,uuid) TO service_role;

DO $community_group_postflight$
BEGIN
  IF has_function_privilege('anon','public.get_or_create_group_conversation(text,uuid,text,text,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.get_or_create_group_conversation(text,uuid,text,text,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.get_or_create_group_conversation(text,uuid,text,text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.community_admit(uuid,uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.community_admit(uuid,uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.community_admit(uuid,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Community/group authorization ACL verification failed';
  END IF;
  IF md5(pg_get_functiondef('public.get_or_create_group_conversation(text,uuid,text,text,uuid)'::regprocedure)) IS DISTINCT FROM '70e63e6529edf42d58358cc750e3123a' THEN
    RAISE EXCEPTION 'Group helper definition verification failed';
  END IF;
  IF (SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.get_or_create_group_conversation(text,uuid,text,text,uuid)'::regprocedure) <> 3
     OR (SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.community_admit(uuid,uuid,uuid)'::regprocedure) <> 2 THEN
    RAISE EXCEPTION 'Community/group exact ACL count verification failed';
  END IF;
  IF md5(pg_get_functiondef('public.community_admit(uuid,uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'bd8c75ce328111a56f26f3a44bf43a0d' THEN
    RAISE EXCEPTION 'Internal community admission body unexpectedly changed';
  END IF;
END;
$community_group_postflight$;
