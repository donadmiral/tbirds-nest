-- Read-only pre/post fingerprint for the SMALL VISUAL release, after units1–7.
-- Returns only counts/digests/metadata. No payment, application or user values.
-- Compare before and after. Investigate differences; concurrent real activity
-- can legitimately change data hashes and is not permission to rewrite records.
WITH scoped_relations AS (
  SELECT c.oid,n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relacl::text AS permissions
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p','v','m') AND (n.nspname in ('creator_finance','marketplace_ops','admin_ops') or (n.nspname='public' and c.relname ~ '^(chat_payments$|job_|jobs$|studio_applicant|studio_campaign|marketplace_|listing_|seller_review|business_|promoted_posts$|verification_|kyc_|admin_|support_)'))
), scoped_columns AS (
  SELECT r.nspname,r.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_value
  FROM scoped_relations r JOIN pg_attribute a ON a.attrelid=r.oid
  LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum
  WHERE a.attnum>0 AND NOT a.attisdropped
), scoped_constraints AS (
  SELECT r.nspname,r.relname,c.conname,pg_get_constraintdef(c.oid) AS definition
  FROM scoped_relations r JOIN pg_constraint c ON c.conrelid=r.oid
), scoped_policies AS (
  SELECT p.* FROM pg_policies p JOIN scoped_relations r ON r.nspname=p.schemaname AND r.relname=p.tablename
), scoped_triggers AS (
  SELECT r.nspname,r.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition
  FROM scoped_relations r JOIN pg_trigger t ON t.tgrelid=r.oid WHERE NOT t.tgisinternal
), scoped_functions AS (
  SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_get_functiondef(p.oid) AS definition,p.proacl::text AS permissions
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prokind='f' AND (n.nspname in ('creator_finance','marketplace_ops','admin_ops') or (n.nspname='public' and p.proname ~ '(creator_|payment|payout|receivable|subscription|market|seller_|listing|hiring|applica|studio_(set_stage|schedule_interview|applicant|update_application)|business_(catalog|receipt)|promotion|admin_|triniti_)'))
), scoped_data AS (
  SELECT 'creator_finance.balances'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM creator_finance.balances t
  UNION ALL
  SELECT 'creator_finance.enrollments'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM creator_finance.enrollments t
  UNION ALL
  SELECT 'creator_finance.ledger'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM creator_finance.ledger t
  UNION ALL
  SELECT 'creator_finance.payout_accounts'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM creator_finance.payout_accounts t
  UNION ALL
  SELECT 'creator_finance.payouts'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM creator_finance.payouts t
  UNION ALL
  SELECT 'creator_finance.program'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM creator_finance.program t
  UNION ALL
  SELECT 'creator_finance.providers'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM creator_finance.providers t
  UNION ALL
  SELECT 'creator_finance.receipts'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM creator_finance.receipts t
  UNION ALL
  SELECT 'marketplace_ops.events'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM marketplace_ops.events t
  UNION ALL
  SELECT 'marketplace_ops.orders'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM marketplace_ops.orders t
  UNION ALL
  SELECT 'public.chat_payments'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM public.chat_payments t
  UNION ALL
  SELECT 'public.marketplace_listings'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM public.marketplace_listings t
  UNION ALL
  SELECT 'public.jobs'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM public.jobs t
  UNION ALL
  SELECT 'public.job_applications'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM public.job_applications t
  UNION ALL
  SELECT 'public.seller_reviews'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM public.seller_reviews t
  UNION ALL
  SELECT 'public.business_applications'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM public.business_applications t
  UNION ALL
  SELECT 'public.studio_campaigns'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM public.studio_campaigns t
  UNION ALL
  SELECT 'public.verification_applications'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM public.verification_applications t
  UNION ALL
  SELECT 'public.support_tickets'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM public.support_tickets t
  UNION ALL
  SELECT 'public.support_messages'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM public.support_messages t
  UNION ALL
  SELECT 'public.support_transactions'::text AS name,count(*) AS rows,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS data_md5 FROM public.support_transactions t
)
SELECT jsonb_build_object(
  'relation_metadata_md5',(SELECT md5(coalesce(jsonb_agg(to_jsonb(r)-'oid' ORDER BY nspname,relname),'[]'::jsonb)::text) FROM scoped_relations r),
  'column_metadata_md5',(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY nspname,relname,attnum),'[]'::jsonb)::text) FROM scoped_columns c),
  'constraints_md5',(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY nspname,relname,conname),'[]'::jsonb)::text) FROM scoped_constraints c),
  'policies_md5',(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname),'[]'::jsonb)::text) FROM scoped_policies p),
  'triggers_md5',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY nspname,relname,tgname),'[]'::jsonb)::text) FROM scoped_triggers t),
  'functions_md5',(SELECT md5(coalesce(jsonb_agg(to_jsonb(f) ORDER BY nspname,proname,arguments),'[]'::jsonb)::text) FROM scoped_functions f),
  'data',(SELECT jsonb_agg(to_jsonb(d) ORDER BY name) FROM scoped_data d),
  'storage_buckets_md5',(SELECT md5(coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]'::jsonb)::text) FROM storage.buckets b),
  'storage_policies_md5',(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname),'[]'::jsonb)::text) FROM pg_policies p WHERE schemaname='storage'),
  'held_relations',jsonb_build_object(
    'revenue_policies_absent',to_regclass('creator_finance.revenue_policies') IS NULL,
    'commerce_config_absent',to_regclass('creator_finance.commerce_config') IS NULL,
    'subscription_periods_absent',to_regclass('creator_finance.subscription_periods') IS NULL,
    'review_commands_absent',to_regclass('creator_finance.review_commands') IS NULL,
    'admin_commands_absent',to_regclass('admin_ops.commands') IS NULL,
    'publishing_requests_absent',to_regclass('marketplace_ops.publishing_requests') IS NULL,
    'application_events_absent',to_regclass('public.job_application_events') IS NULL,
    'seller_review_reports_absent',to_regclass('public.seller_review_reports') IS NULL,
    'remux_leases_absent',to_regclass('content_media_processing.faststart_leases') IS NULL
  ),
  'access_contracts',jsonb_build_object(
    'can_view_post_md5',md5(pg_get_functiondef('public.can_view_post(uuid)'::regprocedure)),
    'can_act_as_md5',md5(pg_get_functiondef('public.can_act_as(uuid)'::regprocedure)),
    'active_subscription_api_absent',to_regproc('public.creator_has_active_subscription') IS NULL
  )
) AS excluded_state;
