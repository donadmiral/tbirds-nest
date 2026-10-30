select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(pg_get_functiondef(p.oid)),
  'config',p.proconfig,'acl',p.proacl::text) order by p.oid::regprocedure::text) from pg_proc p
  where p.oid in('account_erasure.keep_identity_phase()'::regprocedure,'account_erasure.complete_admin_request()'::regprocedure,
   'account_erasure.admin_review_snapshot(text,uuid)'::regprocedure,'public.triniti_admin_deletion_requests(uuid,uuid,integer)'::regprocedure,
   'public.triniti_admin_erasure_review(uuid,uuid,uuid,text,uuid,text,text,text,text)'::regprocedure)),
 'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t where t.tgrelid='account_erasure.jobs'::regclass
  and t.tgname in('account_erasure_identity_phase','account_erasure_admin_completion')),
 'reviews_private',(select relrowsecurity and not has_table_privilege('anon',oid,'SELECT') and not has_table_privilege('authenticated',oid,'SELECT')
  and not has_table_privilege('service_role',oid,'SELECT') from pg_class where oid='account_erasure.reviews'::regclass),
 'data_counts',jsonb_build_object('auth_users',(select count(*) from auth.users),'profiles',(select count(*) from public.profiles),
  'admin_users',(select count(*) from public.admin_users),'storage_objects',(select count(*) from storage.objects),
  'erasure_jobs',(select count(*) from account_erasure.jobs),'admin_requests',(select count(*) from admin_ops.deletion_requests))
) postflight;
