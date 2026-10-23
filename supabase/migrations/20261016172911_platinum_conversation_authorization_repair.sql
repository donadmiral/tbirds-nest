DO $guard$ BEGIN
IF md5(pg_get_functiondef('public.mark_conversation_read(uuid,uuid)'::regprocedure)) <> '35f70ba1e4f2fc70261cd4df1fcc37cf' THEN RAISE EXCEPTION 'mark_conversation_read changed since review'; END IF;
IF md5(pg_get_functiondef('public.find_or_create_conversation(uuid,uuid)'::regprocedure)) <> 'b934f9e7e111ad00c7bae683340c5c82' THEN RAISE EXCEPTION 'find_or_create_conversation changed since review'; END IF;
END $guard$;
-- Reviewable DDL payload, not applied. Original signature and return type retained.
-- Existing app uses p_user_id for both personal and authorized business profiles.
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conv_id uuid, p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authenticated';
  END IF;

  IF p_conv_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Conversation and recipient are required';
  END IF;

  IF NOT public.can_act_as(p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Cannot mark another profile messages as read';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conv_id
      AND (
        c.user_1 = p_user_id OR c.user_2 = p_user_id
        OR EXISTS (
          SELECT 1 FROM public.conversation_members cm
          WHERE cm.conversation_id = c.id AND cm.user_id = p_user_id
        )
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Conversation is not available';
  END IF;

  UPDATE public.messages
  SET read_at = now(),
      viewed_at = COALESCE(viewed_at, now()),
      delivered_at = COALESCE(delivered_at, now())
  WHERE conversation_id = p_conv_id
    AND receiver_id = p_user_id
    AND sender_id <> p_user_id
    AND read_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid, uuid) TO authenticated, service_role;

-- Reviewable compatibility payload, not applied. No frontend callers in Sep 12 snapshot.
-- Use the existing canonical personal-DM path rather than the absent legacy table.
CREATE OR REPLACE FUNCTION public.find_or_create_conversation(user_a uuid, user_b uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_other uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authenticated';
  END IF;
  IF user_a IS NULL OR user_b IS NULL OR user_a = user_b THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Two different participants are required';
  END IF;
  IF v_me = user_a THEN
    v_other := user_b;
  ELSIF v_me = user_b THEN
    v_other := user_a;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Cannot create another user conversation';
  END IF;
  RETURN public.start_dm_ctx(v_other, 'personal', NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.find_or_create_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_or_create_conversation(uuid, uuid) TO authenticated, service_role;

-- Run only after applying proposed definitions. Executes no inserts or successful updates.
-- All identities here are synthetic. Entire transaction rolls back.

SET LOCAL statement_timeout = '5s';

DO $tests$
DECLARE
  a constant uuid := '00000000-0000-4000-8000-0000000000a1';
  b constant uuid := '00000000-0000-4000-8000-0000000000b2';
  c constant uuid := '00000000-0000-4000-8000-0000000000c3';
  rejected boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id IN (a,b,c))
     OR EXISTS (SELECT 1 FROM public.conversations WHERE id IN (a,b,c)) THEN
    RAISE EXCEPTION 'Fixture IDs unexpectedly exist. Stop and choose unused synthetic IDs.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  rejected := false;
  BEGIN PERFORM public.mark_conversation_read(c,a);
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Anonymous mark-read was not rejected'; END IF;

  rejected := false;
  BEGIN PERFORM public.find_or_create_conversation(a,b);
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Anonymous create-DM was not rejected'; END IF;

  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  rejected := false;
  BEGIN PERFORM public.mark_conversation_read(c,b);
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Unrelated recipient was not rejected'; END IF;

  rejected := false;
  BEGIN PERFORM public.mark_conversation_read(c,a);
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Nonmember conversation was not rejected'; END IF;

  rejected := false;
  BEGIN PERFORM public.find_or_create_conversation(b,c);
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Third-party create-DM was not rejected'; END IF;

  rejected := false;
  BEGIN PERFORM public.find_or_create_conversation(a,a);
  EXCEPTION WHEN invalid_parameter_value THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Self DM was not rejected'; END IF;

  rejected := false;
  BEGIN PERFORM public.find_or_create_conversation(a,NULL);
  EXCEPTION WHEN invalid_parameter_value THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Missing participant was not rejected'; END IF;

  IF has_function_privilege('anon','public.mark_conversation_read(uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.find_or_create_conversation(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous EXECUTE remained enabled';
  END IF;
  IF NOT has_function_privilege('authenticated','public.mark_conversation_read(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.find_or_create_conversation(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated EXECUTE was removed';
  END IF;
END;
$tests$;

SELECT '7 negative authorization/argument checks and ACL checks passed' AS result;
