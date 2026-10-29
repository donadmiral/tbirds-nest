-- Read-only checks AFTER every reviewed production unit has committed.
-- Match these results to production-rollout-20261029.json and the release log.

WITH required(signature) AS (VALUES
  ('public.publish_story_v2(uuid,uuid,jsonb)'),
  ('public.content_media_manifest(jsonb)'),
  ('public.content_upload_manifest(jsonb)'),
  ('public.get_memory_albums(uuid)'),
  ('public.get_memory_book(uuid)'),
  ('public.create_memory_book_presentation(text,text,text,text,uuid[],uuid)'),
  ('public.save_memory_book_presentation(uuid,text,text,text,text,text,uuid)'),
  ('public.open_legacy_chat_media(uuid,uuid)'),
  ('public.consume_media_view(uuid)'),
  ('public.start_group_call_membership(uuid,boolean)'),
  ('public.account_export_snapshot()')
)
SELECT r.signature, p.oid IS NOT NULL AS exists,
  pg_get_function_result(p.oid) AS result_shape,
  coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false) AS anon_can_execute,
  coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) AS authenticated_can_execute
FROM required r LEFT JOIN pg_proc p ON p.oid = to_regprocedure(r.signature)
ORDER BY r.signature;

-- All pre-existing public buckets must retain their original visibility.
-- Newly created application-cvs and channel-media must be private.
SELECT id, public FROM storage.buckets ORDER BY id;

-- Production must have ten exact snapshots: five post and five story pairs.
-- The separate preflight SQL proves the ten current object fingerprints.
SELECT entity_kind, count(*) AS reviewed_pairs,
  count(*) FILTER (WHERE revoked_at IS NULL) AS active_pairs
FROM content_media_legacy.snapshots GROUP BY entity_kind ORDER BY entity_kind;

SELECT to_regnamespace('private_media') IS NULL AS private_cutover_held,
  to_regproc('public.triniti_admin_single_owner_access') IS NULL AS qa_exception_excluded;

-- These stay disabled. This release creates no monetary transfer or worker job.
SELECT enrollment_open FROM creator_finance.program;
SELECT id, payouts_enabled FROM creator_finance.providers ORDER BY id;
SELECT (to_jsonb(c)->>'sandbox_enabled')::boolean AS sandbox_enabled
FROM creator_finance.commerce_config c;

-- Confirm the legacy entry point retains the installed app's original shape.
SELECT pg_get_function_result('public.consume_media_view(uuid)'::regprocedure)
  = 'TABLE(url text, remaining integer)' AS legacy_result_compatible;

-- No direct client may read/write the finite exception registry.
SELECT has_table_privilege('authenticated', 'content_media_legacy.snapshots', 'SELECT') AS client_can_read_snapshot,
  has_table_privilege('authenticated', 'content_media_legacy.snapshots', 'INSERT') AS client_can_add_snapshot,
  has_table_privilege('authenticated', 'public.content_media_bindings', 'INSERT') AS client_can_forge_binding;

-- The existing video webhook has a service-only lease API; clients get no
-- processing capabilities, and all final writes pass through the version guard.
WITH worker(signature) AS (VALUES
  ('public.claim_faststart_video_remux(text,text,uuid,text)'),
  ('public.check_faststart_video_remux(uuid)'),
  ('public.release_faststart_video_remux(uuid)')
)
SELECT w.signature, p.oid IS NOT NULL AS exists,
  coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) AS authenticated_can_execute,
  coalesce(has_function_privilege('service_role', p.oid, 'EXECUTE'), false) AS service_can_execute
FROM worker w LEFT JOIN pg_proc p ON p.oid = to_regprocedure(w.signature)
ORDER BY w.signature;
