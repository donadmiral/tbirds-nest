select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(pg_get_functiondef(p.oid)),
  'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'security_definer',p.prosecdef,
  'anon_execute',has_function_privilege('anon',p.oid,'execute'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'execute'),
  'service_execute',has_function_privilege('service_role',p.oid,'execute')) order by p.oid::regprocedure::text)
  from pg_proc p where p.oid in('public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)'::regprocedure,
   'account_erasure.assert_writable(uuid)'::regprocedure,'admin_ops.enforce_staff_social_shell()'::regprocedure,
   'public.triniti_admin_session_check(uuid,uuid)'::regprocedure,'admin_ops.require_session(uuid,uuid,text)'::regprocedure)),
 'registry',(select jsonb_build_object('owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'acl',c.relacl::text,
  'rows',(select count(*) from admin_ops.staff_social_shells),'policies',(select count(*) from pg_policy where polrelid=c.oid),
  'anon_access',has_table_privilege('anon',c.oid,'select,insert,update,delete,truncate,references,trigger'),
  'authenticated_access',has_table_privilege('authenticated',c.oid,'select,insert,update,delete,truncate,references,trigger'),
  'service_access',has_table_privilege('service_role',c.oid,'select,insert,update,delete,truncate,references,trigger'))
  from pg_class c where c.oid='admin_ops.staff_social_shells'::regclass),
 'profile_trigger',(select jsonb_build_object('definition',pg_get_triggerdef(oid),'enabled',tgenabled)
  from pg_trigger where tgrelid='public.profiles'::regclass and tgname='enforce_staff_social_shell'),
 'data_counts',jsonb_build_object('auth_users',(select count(*) from auth.users),'profiles',(select count(*) from public.profiles),
  'admin_users',(select count(*) from public.admin_users),'storage_objects',(select count(*) from storage.objects),
  'provisions',(select count(*) from admin_ops.provisions))
) postflight;
