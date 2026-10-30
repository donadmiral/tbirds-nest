-- Read-only: no identity, contact address, token or object name is returned.
select jsonb_build_object(
 'fresh_target',to_regclass('admin_ops.staff_social_shells') is null and to_regprocedure('admin_ops.enforce_staff_social_shell()') is null
  and not exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass and tgname='enforce_staff_social_shell'),
 'provision_matches',md5(pg_get_functiondef(to_regprocedure('public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)')))='06bc23c46b912a538427a6e0d49d01b1',
 'write_guard_matches',md5(pg_get_functiondef(to_regprocedure('account_erasure.assert_writable(uuid)')))='4cb940a9d477eb574a8208d048de9cc0',
 'session_check_matches',md5(pg_get_functiondef(to_regprocedure('public.triniti_admin_session_check(uuid,uuid)')))='ba2e1c694288129ee94d8b6d06746eef',
 'permission_check_matches',md5(pg_get_functiondef(to_regprocedure('admin_ops.require_session(uuid,uuid,text)')))='2a59dac44760254e1f2e730c6154d9a9',
 'execution_grants_match',(select count(*)=6 from (values
  ('public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)','{postgres=X/postgres,service_role=X/postgres}'),
  ('account_erasure.assert_writable(uuid)','{postgres=X/postgres}'),
  ('account_erasure.guard_actor_write()','{postgres=X/postgres}'),
  ('account_erasure.guard_storage_write()','{postgres=X/postgres}'),
  ('public.triniti_admin_session_check(uuid,uuid)','{postgres=X/postgres,service_role=X/postgres}'),
  ('admin_ops.require_session(uuid,uuid,text)','{postgres=X/postgres,service_role=X/postgres}')
 ) expected(signature,acl) join pg_proc p on p.oid=to_regprocedure(expected.signature)
  where p.proacl::text=expected.acl and pg_get_userbyid(p.proowner)='postgres'),
 'storage_guard_matches',md5(pg_get_functiondef(to_regprocedure('account_erasure.guard_storage_write()')))='38698dbd1ea2f85095fb2a17bdf56eb7'
  and exists(select 1 from pg_trigger where tgrelid='storage.objects'::regclass and tgname='account_erasure_storage_write'
   and tgenabled='O' and tgfoid='account_erasure.guard_storage_write()'::regprocedure),
 'no_pending_staff_setup',not exists(select 1 from admin_ops.provisions where kind='staff' and completed_at is null),
 'profile_visibility_matches',(select relrowsecurity from pg_class where oid='public.profiles'::regclass)
  and (select md5(jsonb_agg(jsonb_build_object('name',policyname,'cmd',cmd,'permissive',permissive,'roles',roles,'qual',qual,'check',with_check) order by policyname)::text)
   from pg_policies where schemaname='public' and tablename='profiles')='a048f406fa129d4e7e08c71dc1c0f44a',
 'write_coverage_complete',not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in('public','creator_finance','marketplace_ops') and c.relkind='r'
  and not exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='account_erasure_actor_write'
   and t.tgenabled='O' and t.tgfoid='account_erasure.guard_actor_write()'::regprocedure)),
 'data_counts',jsonb_build_object('auth_users',(select count(*) from auth.users),'profiles',(select count(*) from public.profiles),
  'admin_users',(select count(*) from public.admin_users),'storage_objects',(select count(*) from storage.objects),
  'provisions',(select count(*) from admin_ops.provisions))
) preflight;
