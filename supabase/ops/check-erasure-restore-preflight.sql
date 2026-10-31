-- Read-only metadata guard. No identity, object name, or secret is returned.
select jsonb_build_object(
 'admin_command_matches',md5(pg_get_functiondef(to_regprocedure('public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)')))='e70f392fe433810f1f1dbf9bb384dbcb',
 'account_erasure_installed',to_regclass('account_erasure.jobs') is not null,
 'service_only',has_function_privilege('service_role','public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)','EXECUTE')
   and not has_function_privilege('anon','public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)','EXECUTE')
   and not has_function_privilege('authenticated','public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)','EXECUTE'),
 'data_counts',jsonb_build_object('auth_users',(select count(*) from auth.users),'profiles',(select count(*) from public.profiles),
  'admin_users',(select count(*) from public.admin_users),'storage_objects',(select count(*) from storage.objects),
  'erasure_jobs',(select count(*) from account_erasure.jobs))
) preflight;
