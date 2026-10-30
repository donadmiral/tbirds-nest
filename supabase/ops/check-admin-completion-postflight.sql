-- Read-only installed-definition/privilege receipt for the completed admin contracts.
select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object(
  'signature',p.oid::regprocedure::text,'md5',md5(pg_get_functiondef(p.oid)),
  'security_definer',p.prosecdef,'config',p.proconfig,
  'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by n.nspname,p.proname)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='public' and p.proname in ('triniti_platinum_admin_command','triniti_admin_provision','triniti_admin_deletion_requests','update_comment_count','sync_post_comment_count','sync_post_comments_count'))
   or (n.nspname='admin_ops' and p.proname in ('require_session','capture_removal','guard_removed_content','validate_verification_evidence','guard_profile_verification','guard_verification_application','sync_verification_revocation'))),
 'private_tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,
  'anon_access',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
  'authenticated_access',has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
  'service_direct_access',has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')) order by c.relname)
  from pg_class c where c.relnamespace=to_regnamespace('admin_ops') and c.relkind='r'),
 'triggers',(select jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by t.tgname)
  from pg_trigger t where not t.tgisinternal and t.tgname in ('capture_admin_removal','admin_removed_post_guard','admin_removed_story_guard','admin_removed_comment_guard','admin_removed_listing_guard','guard_profile_verification','guard_verification_application','sync_verification_revocation')),
 'verification_constraint',(select jsonb_agg(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.verification_applications'::regclass and contype='c'),
 'verification_status_write_denied',not has_table_privilege('authenticated','public.verification_applications','UPDATE,DELETE,TRUNCATE'),
 'preserved_support_review_functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(pg_get_functiondef(p.oid))) order by p.proname)
  from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('admin_support_triage_read','admin_support_triage_update','admin_seller_review_reports','moderate_seller_review')),
 'support_commands_available',(select to_regprocedure('public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)') is not null and has_function_privilege('service_role','public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)','EXECUTE')),
 'native_session_check_md5',md5(pg_get_functiondef('public.triniti_admin_session_check(uuid,uuid)'::regprocedure))
) postflight;
