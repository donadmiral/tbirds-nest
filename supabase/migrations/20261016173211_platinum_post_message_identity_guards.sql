DO $guard$ BEGIN
IF md5(pg_get_functiondef('public.can_act_as(uuid)'::regprocedure)) <> 'e4dd6da22fb2dd16b0a5c75750330e32' THEN RAISE EXCEPTION 'Identity helper changed since review'; END IF;
IF NOT (select relrowsecurity from pg_class where oid='public.posts'::regclass) OR NOT (select relrowsecurity from pg_class where oid='public.messages'::regclass) THEN RAISE EXCEPTION 'Row security is not enabled'; END IF;
END $guard$;
-- Narrow additive guards. Keep existing permissive/restrictive policies intact.
-- can_act_as is the established server helper for personal/business authorship.
-- Applies to PUBLIC so unauthenticated INSERT cannot use an existing permissive policy.
-- Service-role/payment workers and owner security-definer triggers retain their existing bypass behavior.
CREATE POLICY posts_require_author_identity
ON public.posts
AS RESTRICTIVE
FOR INSERT
TO PUBLIC
WITH CHECK (
  (SELECT auth.uid()) IS NOT NULL
  AND user_id IS NOT NULL
  AND public.can_act_as(user_id)
);

CREATE POLICY messages_require_sender_identity
ON public.messages
AS RESTRICTIVE
FOR INSERT
TO PUBLIC
WITH CHECK (
  (SELECT auth.uid()) IS NOT NULL
  AND sender_id IS NOT NULL
  AND public.can_act_as(sender_id)
);

-- Safe enforcement tests: copy deployed guard expressions onto temporary probe tables.
-- Real Supabase anon/authenticated roles and real can_act_as helper are used.
-- No public posts/messages/users/notifications are inserted, and no triggers are copied.
-- A permissive TRUE policy recreates the broad policy the guards must constrain.

SET LOCAL statement_timeout = '5s';
CREATE TEMP TABLE pc_posts_ownership_probe (user_id uuid) ON COMMIT DROP;
CREATE TEMP TABLE pc_messages_ownership_probe (sender_id uuid) ON COMMIT DROP;
ALTER TABLE pc_posts_ownership_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_messages_ownership_probe ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON pc_posts_ownership_probe, pc_messages_ownership_probe TO anon, authenticated;
CREATE POLICY broad_insert ON pc_posts_ownership_probe FOR INSERT TO PUBLIC WITH CHECK (true);
CREATE POLICY broad_insert ON pc_messages_ownership_probe FOR INSERT TO PUBLIC WITH CHECK (true);

DO $setup$
DECLARE
  p text;
  m text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id IN
      ('00000000-0000-4000-8000-0000000000a1'::uuid,'00000000-0000-4000-8000-0000000000b2'::uuid)) THEN
    RAISE EXCEPTION 'Synthetic fixture IDs already exist';
  END IF;
  SELECT pg_get_expr(polwithcheck,polrelid) INTO p FROM pg_policy
  WHERE polrelid='public.posts'::regclass AND polname='posts_require_author_identity'
    AND NOT polpermissive AND polcmd='a' AND polroles=ARRAY[0::oid];
  SELECT pg_get_expr(polwithcheck,polrelid) INTO m FROM pg_policy
  WHERE polrelid='public.messages'::regclass AND polname='messages_require_sender_identity'
    AND NOT polpermissive AND polcmd='a' AND polroles=ARRAY[0::oid];
  IF p IS NULL OR m IS NULL THEN RAISE EXCEPTION 'Expected restrictive PUBLIC INSERT policies missing'; END IF;
  EXECUTE format('CREATE POLICY identity_guard ON pg_temp.pc_posts_ownership_probe AS RESTRICTIVE FOR INSERT TO PUBLIC WITH CHECK (%s)',p);
  EXECUTE format('CREATE POLICY identity_guard ON pg_temp.pc_messages_ownership_probe AS RESTRICTIVE FOR INSERT TO PUBLIC WITH CHECK (%s)',m);
END;
$setup$;

SET LOCAL ROLE authenticated;
DO $authenticated_tests$
DECLARE
  a constant uuid := '00000000-0000-4000-8000-0000000000a1';
  b constant uuid := '00000000-0000-4000-8000-0000000000b2';
  rejected boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
  INSERT INTO pg_temp.pc_posts_ownership_probe(user_id) VALUES(a);
  INSERT INTO pg_temp.pc_messages_ownership_probe(sender_id) VALUES(a);

  rejected := false;
  BEGIN INSERT INTO pg_temp.pc_posts_ownership_probe(user_id) VALUES(b);
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Unrelated post author accepted'; END IF;

  rejected := false;
  BEGIN INSERT INTO pg_temp.pc_messages_ownership_probe(sender_id) VALUES(b);
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Unrelated message sender accepted'; END IF;

  rejected := false;
  BEGIN INSERT INTO pg_temp.pc_posts_ownership_probe(user_id) VALUES(NULL);
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Null post author accepted'; END IF;

  rejected := false;
  BEGIN INSERT INTO pg_temp.pc_messages_ownership_probe(sender_id) VALUES(NULL);
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Null message sender accepted'; END IF;
END;
$authenticated_tests$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $anonymous_tests$
DECLARE
  a constant uuid := '00000000-0000-4000-8000-0000000000a1';
  rejected boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  rejected := false;
  BEGIN INSERT INTO pg_temp.pc_posts_ownership_probe(user_id) VALUES(a);
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Anonymous post author accepted'; END IF;

  rejected := false;
  BEGIN INSERT INTO pg_temp.pc_messages_ownership_probe(sender_id) VALUES(a);
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Anonymous message sender accepted'; END IF;
END;
$anonymous_tests$;
RESET ROLE;

SELECT 'Eight INSERT identity enforcement checks passed on temporary probes using deployed expressions and real roles' AS result;
