select jsonb_build_object(
 'admin_command',(select jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(pg_get_functiondef(p.oid)),
  'config',p.proconfig,'acl',p.proacl::text,'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,
  'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'))
  from pg_proc p where p.oid='public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)'::regprocedure),
 'data_counts',jsonb_build_object('auth_users',(select count(*) from auth.users),'profiles',(select count(*) from public.profiles),
  'admin_users',(select count(*) from public.admin_users),'storage_objects',(select count(*) from storage.objects),
  'erasure_jobs',(select count(*) from account_erasure.jobs))
) postflight;
