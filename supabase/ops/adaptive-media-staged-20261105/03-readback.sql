select jsonb_build_object(
 'functions', (select jsonb_agg(jsonb_build_object('name',oid::regprocedure::text,'bodyMd5',md5(prosrc),'securityDefiner',prosecdef,'config',proconfig,'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),'service',has_function_privilege('service_role',oid,'EXECUTE'))) from pg_proc where oid in (to_regprocedure('media_renditions.source_added()'),to_regprocedure('public.backfill_media_renditions_v2(uuid,integer,boolean)'))),
 'triggers', (select jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid))) from pg_trigger where tgname in ('enqueue_adaptive_uploaded_source','enqueue_adaptive_media')),
 'migrationNames', (select jsonb_agg(jsonb_build_object('version',version,'name',name)) from supabase_migrations.schema_migrations where name in ('adaptive_media_admission_triggers_v2','adaptive_media_bounded_backfill_v2','adaptive_media_admission_backfill_v2'))
) as proof;
