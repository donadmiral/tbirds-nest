-- Read-only checks AFTER the small visual-only production chain commits.
-- One result keeps all checks visible through the hosted SQL connector.
WITH required(signature) AS (VALUES
  ('public.publish_story_v2(uuid,uuid,jsonb)'),
  ('public.content_media_manifest(jsonb)'),
  ('public.content_upload_manifest(jsonb)'),
  ('public.get_feed_visibility(uuid[])'),
  ('public.feed_media_access_allowed(uuid)'),
  ('public.feed_media_json(uuid)'),
  ('public.get_trending_stories(integer)'),
  ('public.get_memory_albums(uuid)'),
  ('public.get_memory_book(uuid)'),
  ('public.create_memory_book_presentation(text,text,text,text,uuid[],uuid)'),
  ('public.save_memory_book_presentation(uuid,text,text,text,text,text,uuid)'),
  ('public.open_legacy_chat_media(uuid,uuid)'),
  ('public.consume_media_view(uuid)'),
  ('public.start_group_call_membership(uuid,boolean)'),
  ('public.join_group_call_membership(uuid)'),
  ('public.leave_group_call_membership(uuid,uuid)')
), rpc_checks AS (
  SELECT r.signature,p.oid IS NOT NULL AS exists,
    pg_get_function_result(p.oid) AS result_shape,
    coalesce(has_function_privilege('anon',p.oid,'EXECUTE'),false) AS anon_can_execute,
    coalesce(has_function_privilege('authenticated',p.oid,'EXECUTE'),false) AS authenticated_can_execute
  FROM required r LEFT JOIN pg_proc p ON p.oid=to_regprocedure(r.signature)
), snapshots AS (
  SELECT entity_kind,count(*) AS reviewed_pairs,
    count(*) FILTER (WHERE revoked_at IS NULL) AS active_pairs
  FROM content_media_legacy.snapshots GROUP BY entity_kind
)
SELECT jsonb_build_object(
  'client_rpc_checks',(SELECT jsonb_agg(to_jsonb(r) ORDER BY signature) FROM rpc_checks r),
  'bucket_visibility',(SELECT jsonb_agg(jsonb_build_object('id',id,'public',public) ORDER BY id) FROM storage.buckets),
  'legacy_snapshots',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY entity_kind) FROM snapshots s),'[]'::jsonb),
  'legacy_result_compatible',pg_get_function_result('public.consume_media_view(uuid)'::regprocedure)='TABLE(url text, remaining integer)',
  'registry_client_permissions',jsonb_build_object(
    'can_read_snapshot',has_table_privilege('authenticated','content_media_legacy.snapshots','SELECT'),
    'can_add_snapshot',has_table_privilege('authenticated','content_media_legacy.snapshots','INSERT'),
    'can_forge_binding',has_table_privilege('authenticated','public.content_media_bindings','INSERT')
  ),
  'held_changes',jsonb_build_object(
    'private_cutover_held',to_regnamespace('private_media') IS NULL,
    'qa_exception_excluded',to_regproc('public.triniti_admin_single_owner_access') IS NULL,
    'music_validator_absent',to_regproc('public.validate_soundtrack') IS NULL,
    'music_origins_absent',to_regclass('public.music_asset_origins') IS NULL,
    'music_events_absent',to_regclass('public.music_rights_events') IS NULL,
    'music_wrapper_absent',to_regprocedure('public.content_media_manifest_before_sound_rights(jsonb)') IS NULL,
    'soundtrack_column_absent',NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='memory_albums' AND column_name='soundtrack'),
    'finance_revenue_policies_absent',to_regclass('creator_finance.revenue_policies') IS NULL,
    'finance_commerce_config_absent',to_regclass('creator_finance.commerce_config') IS NULL,
    'finance_subscription_periods_absent',to_regclass('creator_finance.subscription_periods') IS NULL,
    'active_subscription_api_absent',to_regproc('public.creator_has_active_subscription') IS NULL,
    'admin_commands_absent',to_regclass('admin_ops.commands') IS NULL,
    'new_diagnostics_api_absent',to_regprocedure('public.report_client_error(jsonb)') IS NULL,
    'faststart_schema_absent',to_regnamespace('content_media_processing') IS NULL,
    'faststart_api_absent',to_regproc('public.claim_faststart_video_remux') IS NULL
  )
) AS postflight;
