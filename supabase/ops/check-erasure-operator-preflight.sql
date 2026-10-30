select jsonb_build_object(
 'queue_matches',md5(pg_get_functiondef(to_regprocedure('public.triniti_admin_deletion_requests(uuid,uuid,integer)')))='51f6ddc192afd05e47136daef63f69b7',
 'review_absent',to_regprocedure('public.triniti_admin_erasure_review(uuid,uuid,uuid,text,uuid,text,text,text,text)') is null and to_regclass('account_erasure.reviews') is null,
 'account_erasure_installed',to_regclass('account_erasure.jobs') is not null,
 'admin_queue_installed',to_regclass('admin_ops.deletion_requests') is not null,
 'data_counts',jsonb_build_object('auth_users',(select count(*) from auth.users),'profiles',(select count(*) from public.profiles),
  'admin_users',(select count(*) from public.admin_users),'storage_objects',(select count(*) from storage.objects),
  'erasure_jobs',(select count(*) from account_erasure.jobs),'admin_requests',(select count(*) from admin_ops.deletion_requests))
) preflight;
