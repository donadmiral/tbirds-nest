-- Rollback-only QA acceptance for the installed Live release.
-- Run this entire file as one management SQL request, with stop-on-error behavior.
-- Prerequisite: QA provider/delivery/recording and clip-worker gates remain off.
-- No passwords, real identities, provider requests, or external messages are used.
-- Only the random synthetic stream is moved to a live state to exercise SQL
-- audience/interaction authorization. That state never commits or starts video.
-- The result SELECT is reached only if every assertion in the DO block succeeds.
-- It precedes ROLLBACK so its transaction-local count cannot be fabricated after
-- an aborted block. All Auth/profile/session/command/poll/counter writes roll back.

BEGIN;
SET LOCAL statement_timeout = '45s';
SET LOCAL lock_timeout = '5s';

DO $qa_live_acceptance$
DECLARE
  actor_host uuid := gen_random_uuid();
  actor_viewer uuid := gen_random_uuid();
  host_auth_session uuid := gen_random_uuid();
  viewer_auth_session uuid := gen_random_uuid();
  create_request uuid := gen_random_uuid();
  vote_request uuid := gen_random_uuid();
  public_session uuid;
  private_session uuid;
  poll_id uuid;
  option_id uuid;
  create_payload jsonb := '{"title":"Rollback QA Live","topic":"gaming","audience":"public","recording_enabled":false}'::jsonb;
  vote_payload jsonb;
  first_result jsonb;
  next_result jsonb;
  snapshot jsonb;
  denied boolean;
  checks integer := 0;
BEGIN
  -- 1. Read the real readiness gates; never enable or replace them for the test.
  IF NOT EXISTS (
    SELECT 1 FROM live_streams.settings
    WHERE singleton AND NOT stage_enabled AND NOT delivery_enabled AND NOT recording_enabled
  ) OR NOT EXISTS (
    SELECT 1 FROM live_streams.clip_runtime WHERE singleton AND NOT enabled
  ) THEN
    RAISE EXCEPTION 'QA_LIVE_EXPECTED_DISABLED_READINESS_GATES';
  END IF;
  checks := checks + 1;

  INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  VALUES
    (actor_host, 'live-qa-' || actor_host::text || '@example.invalid',
      jsonb_build_object('full_name', 'Live QA host', 'username', 'ql_' || substr(replace(actor_host::text, '-', ''), 1, 20)),
      '{"provider":"email","providers":["email"]}'::jsonb),
    (actor_viewer, 'live-qa-' || actor_viewer::text || '@example.invalid',
      jsonb_build_object('full_name', 'Live QA viewer', 'username', 'ql_' || substr(replace(actor_viewer::text, '-', ''), 1, 20)),
      '{"provider":"email","providers":["email"]}'::jsonb);

  -- The installed Auth trigger may already have created the profile rows.
  INSERT INTO public.profiles (id, email, username, full_name, profile_visibility, account_type)
  VALUES
    (actor_host, 'live-qa-' || actor_host::text || '@example.invalid',
      'ql_' || substr(replace(actor_host::text, '-', ''), 1, 20), 'Live QA host', 'public', 'personal'),
    (actor_viewer, 'live-qa-' || actor_viewer::text || '@example.invalid',
      'ql_' || substr(replace(actor_viewer::text, '-', ''), 1, 20), 'Live QA viewer', 'public', 'personal')
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    username = EXCLUDED.username,
    full_name = EXCLUDED.full_name,
    profile_visibility = 'public',
    account_type = 'personal';

  INSERT INTO auth.sessions (id, user_id, aal)
  VALUES (host_auth_session, actor_host, 'aal1'), (viewer_auth_session, actor_viewer, 'aal1');

  PERFORM set_config('request.jwt.claim.sub', actor_host::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor_host, 'role', 'authenticated', 'session_id', host_auth_session,
    'aal', 'aal1', 'is_anonymous', false
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- 2. A personal host with a real, synthetic Auth session can create a draft.
  first_result := public.live_command('create', NULL::uuid, create_payload, create_request);
  public_session := (first_result->>'session_id')::uuid;
  IF first_result->>'ok' IS DISTINCT FROM 'true' OR public_session IS NULL THEN
    RAISE EXCEPTION 'QA_LIVE_CREATE_NOT_CONFIRMED';
  END IF;
  snapshot := public.live_session(public_session);
  IF snapshot#>>'{session,state}' IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'QA_LIVE_CREATE_MUST_REMAIN_DRAFT';
  END IF;
  checks := checks + 1;

  -- 3. Retrying the exact request returns the same session and duplicate flag.
  next_result := public.live_command('create', NULL::uuid, create_payload, create_request);
  IF next_result->>'session_id' IS DISTINCT FROM public_session::text
    OR next_result->>'duplicate' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'QA_LIVE_CREATE_IDEMPOTENCY_FAILED';
  END IF;
  checks := checks + 1;

  -- 4. Reusing that request identity with a different payload must fail.
  denied := false;
  BEGIN
    PERFORM public.live_command('create', NULL::uuid,
      create_payload || '{"title":"Changed request"}'::jsonb, create_request);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'IDEMPOTENCY_CONFLICT' THEN RAISE; END IF;
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'QA_LIVE_CHANGED_RETRY_WAS_ACCEPTED'; END IF;
  checks := checks + 1;

  -- 5. A created draft cannot mint a studio grant while the provider gate is off.
  denied := false;
  BEGIN
    PERFORM public.live_provider_access(public_session, 'stage');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'PROVIDER_NOT_READY' THEN RAISE; END IF;
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'QA_LIVE_PROVIDER_READINESS_BYPASSED'; END IF;
  checks := checks + 1;

  next_result := public.live_command('create', NULL::uuid,
    '{"title":"Rollback private QA Live","topic":"gaming","audience":"invite","recording_enabled":false}'::jsonb,
    gen_random_uuid());
  private_session := (next_result->>'session_id')::uuid;
  IF private_session IS NULL THEN RAISE EXCEPTION 'QA_LIVE_PRIVATE_FIXTURE_FAILED'; END IF;

  EXECUTE 'RESET ROLE';
  -- SQL-only fixture state: no provider operation is invoked and nothing commits.
  UPDATE live_streams.sessions SET state = 'live', started_at = now() - interval '1 minute'
  WHERE id IN (public_session, private_session) AND live_streams.sessions.host_id = actor_host;

  PERFORM set_config('request.jwt.claim.sub', actor_viewer::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor_viewer, 'role', 'authenticated', 'session_id', viewer_auth_session,
    'aal', 'aal1', 'is_anonymous', false
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- 6. The ordinary viewer can read the public synthetic stream.
  snapshot := public.live_session(public_session);
  IF snapshot->>'role' IS DISTINCT FROM 'viewer'
    OR snapshot#>>'{session,id}' IS DISTINCT FROM public_session::text THEN
    RAISE EXCEPTION 'QA_LIVE_PUBLIC_VIEWER_READ_FAILED';
  END IF;
  checks := checks + 1;

  -- 7. The same viewer cannot read the invitation-only synthetic stream.
  denied := false;
  BEGIN
    PERFORM public.live_session(private_session);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'LIVE_NOT_AVAILABLE' THEN RAISE; END IF;
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'QA_LIVE_PRIVATE_AUDIENCE_BYPASSED'; END IF;
  checks := checks + 1;

  -- 8. Viewer authentication does not confer poll-management authority.
  denied := false;
  BEGIN
    PERFORM public.live_interaction_command(public_session, 'poll_create',
      '{"question":"Unauthorized poll","options":["A","B"]}'::jsonb, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ACCESS_DENIED' THEN RAISE; END IF;
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'QA_LIVE_VIEWER_MANAGED_POLL'; END IF;
  checks := checks + 1;

  -- 9. Viewer authentication also cannot change creator clip settings.
  denied := false;
  BEGIN
    PERFORM public.live_clip_command(public_session, NULL::uuid, 'settings',
      '{"viewer_clipping":true}'::jsonb, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CLIP_MANAGE_ACCESS_DENIED' THEN RAISE; END IF;
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'QA_LIVE_VIEWER_CHANGED_CLIP_SETTINGS'; END IF;
  checks := checks + 1;

  -- 10. The actual host can create a poll.
  PERFORM set_config('request.jwt.claim.sub', actor_host::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor_host, 'role', 'authenticated', 'session_id', host_auth_session,
    'aal', 'aal1', 'is_anonymous', false
  )::text, true);
  next_result := public.live_interaction_command(public_session, 'poll_create',
    '{"question":"Rollback acceptance choice","options":["First","Second"]}'::jsonb, gen_random_uuid());
  poll_id := (next_result#>>'{poll,id}')::uuid;
  option_id := (next_result#>>'{poll,options,0,id}')::uuid;
  IF next_result->>'ok' IS DISTINCT FROM 'true' OR poll_id IS NULL OR option_id IS NULL
    OR jsonb_array_length(next_result#>'{poll,options}') <> 2 THEN
    RAISE EXCEPTION 'QA_LIVE_HOST_POLL_CREATE_FAILED';
  END IF;
  checks := checks + 1;

  PERFORM set_config('request.jwt.claim.sub', actor_viewer::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor_viewer, 'role', 'authenticated', 'session_id', viewer_auth_session,
    'aal', 'aal1', 'is_anonymous', false
  )::text, true);
  vote_payload := jsonb_build_object('poll_id', poll_id, 'option_id', option_id);

  -- 11. A viewer vote appears in both aggregate and personalized read state.
  PERFORM public.live_interaction_command(public_session, 'poll_vote', vote_payload, vote_request);
  snapshot := public.live_interactions(public_session);
  IF snapshot#>>'{polls,0,id}' IS DISTINCT FROM poll_id::text
    OR snapshot#>>'{polls,0,total_votes}' IS DISTINCT FROM '1'
    OR snapshot#>>'{polls,0,options,0,votes}' IS DISTINCT FROM '1'
    OR snapshot#>>'{polls,0,my_option_id}' IS DISTINCT FROM option_id::text THEN
    RAISE EXCEPTION 'QA_LIVE_VIEWER_VOTE_NOT_REFLECTED';
  END IF;
  checks := checks + 1;

  -- 12. Retrying that vote does not increment counts twice.
  next_result := public.live_interaction_command(public_session, 'poll_vote', vote_payload, vote_request);
  snapshot := public.live_interactions(public_session);
  IF next_result->>'duplicate' IS DISTINCT FROM 'true'
    OR snapshot#>>'{polls,0,total_votes}' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'QA_LIVE_VOTE_RETRY_DOUBLE_COUNTED';
  END IF;
  checks := checks + 1;

  EXECUTE 'RESET ROLE';
  DELETE FROM auth.sessions WHERE id = viewer_auth_session AND user_id = actor_viewer;
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- 13. The still-present JWT claims cannot read after Auth-session revocation.
  denied := false;
  BEGIN
    PERFORM public.live_interactions(public_session);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'AUTH_REQUIRED' THEN RAISE; END IF;
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'QA_LIVE_REVOKED_SESSION_READ_ACCEPTED'; END IF;
  checks := checks + 1;

  -- 14. Revocation is checked before replaying a previously successful request.
  denied := false;
  BEGIN
    PERFORM public.live_interaction_command(public_session, 'poll_vote', vote_payload, vote_request);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'AUTH_REQUIRED' THEN RAISE; END IF;
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'QA_LIVE_REVOKED_SESSION_RETRY_ACCEPTED'; END IF;
  checks := checks + 1;

  EXECUTE 'RESET ROLE';
  IF checks <> 14 THEN RAISE EXCEPTION 'QA_LIVE_CHECK_COUNT_INCOMPLETE'; END IF;
  PERFORM set_config('qa.live_acceptance_completed_checks', checks::text, true);
END;
$qa_live_acceptance$;

SELECT current_setting('qa.live_acceptance_completed_checks')::integer AS passed_checks;
ROLLBACK;
