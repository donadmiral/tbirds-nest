-- Read-only fingerprints. Run before resuming and after the visual-only release;
-- all hashes/counts must match. No catalogue values or user URLs are returned.
WITH catalogue AS (
  SELECT count(*) AS existing_catalogue_rows,
    md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb)::text) AS catalogue_data_md5
  FROM public.story_sounds s
), columns AS (
  SELECT table_name,column_name,data_type,is_nullable,column_default,ordinal_position
  FROM information_schema.columns WHERE table_schema='public'
    AND (table_name ~ '(sound|music)' OR column_name ~ '(audio|soundtrack|music)')
), functions AS (
  SELECT proname,pg_get_function_identity_arguments(oid) AS arguments,
    pg_get_functiondef(oid) AS definition,proacl::text AS permissions
  FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname ~ '(sound|music)'
), policies AS (
  SELECT policyname,permissive,roles,cmd,qual,with_check FROM pg_policies
  WHERE schemaname='public' AND tablename='story_sounds'
), relations AS (
  SELECT relname,relkind,relrowsecurity,relacl::text AS permissions FROM pg_class
  WHERE relnamespace='public'::regnamespace AND relname ~ '(sound|music)'
)
SELECT catalogue.*,
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY table_name,ordinal_position),'[]'::jsonb)::text) FROM columns c) AS existing_music_columns_md5,
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY proname,arguments),'[]'::jsonb)::text) FROM functions p) AS existing_music_functions_md5,
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY policyname),'[]'::jsonb)::text) FROM policies p) AS existing_catalogue_policies_md5,
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY relname),'[]'::jsonb)::text) FROM relations c) AS existing_music_relation_acl_md5
FROM catalogue;
