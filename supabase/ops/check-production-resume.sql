-- Read-only resume gate after the release owner applied units 1–7.
-- A single JSON result preserves every check in connectors that return only
-- the last statement. Every matches/exclusions value must be true.
WITH expected_functions(signature,definition_md5) AS (VALUES
  ('public.get_feed(text,double precision,uuid,integer)','a5ba28b77f27dad8725fd6b0717106ec'),
  ('public.get_memory_albums(uuid)','e8a351ece459652588539597b380d0bf'),
  ('public.get_memory_book(uuid)','5a30eab09e21eb149309d9add37e0892'),
  ('public.get_discover_page(text,boolean,integer,integer,timestamp with time zone)','4fad589831e967fe4cde4c31797d1476'),
  ('public.get_profile_posts_page(uuid,integer,integer,timestamp with time zone)','6f4f24da8506095f7323b707334464e8'),
  ('public.open_legacy_chat_media(uuid,uuid)','7e77610be112c7b1e69dcb2db082758e'),
  ('public.consume_media_view(uuid)','8e3e17e74717f3454b5c0deef3f62566'),
  ('public.claim_chat_media_view(uuid,uuid)','c47a9441784d6c13fd2f3b1d0363837b'),
  ('public.account_export_snapshot()','11c5ea5152feadd8e78ac64e073e6ade'),
  ('public.publish_story_v2(uuid,uuid,jsonb)','358247e1e132eede2dd5e4ec2b6d6624')
), expected_relations(name,expected_present) AS (VALUES
  ('admin_ops.commands',false),
  ('admin_ops.deletion_requests',false),
  ('admin_ops.provisions',false),
  ('admin_ops.removals',false),
  ('admin_ops.support_triage',false),
  ('content_media_legacy.snapshots',false),
  ('content_media_processing.faststart_leases',false),
  ('creator_finance.allocations',false),
  ('creator_finance.balances',true),
  ('creator_finance.commerce_config',false),
  ('creator_finance.commerce_receipts',false),
  ('creator_finance.enrollments',true),
  ('creator_finance.ledger',true),
  ('creator_finance.orders',false),
  ('creator_finance.payout_accounts',true),
  ('creator_finance.payouts',true),
  ('creator_finance.products',false),
  ('creator_finance.program',true),
  ('creator_finance.providers',true),
  ('creator_finance.receipts',true),
  ('creator_finance.receivable_events',false),
  ('creator_finance.receivables',false),
  ('creator_finance.revenue_policies',false),
  ('creator_finance.review_commands',false),
  ('creator_finance.subscription_periods',false),
  ('marketplace_ops.events',true),
  ('marketplace_ops.orders',true),
  ('marketplace_ops.publishing_requests',false),
  ('public.call_provider_revocations',true),
  ('public.chat_media_view_grants',true),
  ('public.content_media_bindings',false),
  ('public.job_application_events',false),
  ('public.music_asset_origins',false),
  ('public.music_rights_events',false),
  ('public.seller_review_reports',false),
  ('story_ops.publications',true)
)
SELECT jsonb_build_object(
  'function_checks', (
    SELECT jsonb_agg(jsonb_build_object('signature',signature,'expected_md5',definition_md5,
      'actual_md5',md5(pg_get_functiondef(to_regprocedure(signature))),
      'matches',coalesce(md5(pg_get_functiondef(to_regprocedure(signature)))=definition_md5,false)) ORDER BY signature)
    FROM expected_functions
  ),
  'relation_checks', (
    SELECT jsonb_agg(jsonb_build_object('name',name,'expected_present',expected_present,
      'actual_present',to_regclass(name) IS NOT NULL,
      'matches',(to_regclass(name) IS NOT NULL)=expected_present) ORDER BY name)
    FROM expected_relations
  ),
  'bucket_visibility', (SELECT jsonb_agg(jsonb_build_object('id',id,'public',public) ORDER BY id) FROM storage.buckets),
  'book_constraints', (
    SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname)
    FROM pg_constraint WHERE conrelid='public.memory_albums'::regclass
      AND conname IN ('memory_albums_title_check','memory_albums_audience_check','memory_albums_cover_color_check')
  ),
  'exclusions', jsonb_build_object(
    'private_cutover_held',to_regnamespace('private_media') IS NULL,
    'music_validator_absent',to_regproc('public.validate_soundtrack') IS NULL,
    'music_origins_absent',to_regclass('public.music_asset_origins') IS NULL,
    'music_events_absent',to_regclass('public.music_rights_events') IS NULL,
    'rejected_music_migration_absent',NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='story_sounds' AND column_name='rights_status'),
    'soundtrack_column_absent',NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='memory_albums' AND column_name='soundtrack')
  )
) AS resume;
