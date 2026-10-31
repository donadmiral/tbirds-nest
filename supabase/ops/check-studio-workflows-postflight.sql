-- Read-only aggregate/metadata evidence after applying the reviewed candidate.
with functions as (
 select p.*,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='studio_workflow' or (n.nspname='public' and p.proname in(
  'studio_newsroom_list','studio_newsroom_get','studio_newsroom_save','studio_newsroom_transition',
  'studio_partnerships_list','studio_partnership_get','studio_partnership_save','studio_partnership_transition','studio_partnership_deliver','studio_partnership_permission',
  'studio_role','studio_bind_member','studio_list_members','studio_create_member','studio_set_member_active','studio_set_member_role',
  'create_business_access_member','studio_set_device','studio_business_info','studio_get_business'))
)
select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'hash',md5(pg_get_functiondef(p.oid)),
  'owner',pg_get_userbyid(p.proowner),'private',p.nspname='studio_workflow','search_path',p.proconfig,
  'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'app_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.nspname,p.oid::regprocedure::text) from functions p),
 'tables',(select jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,'owner',pg_get_userbyid(c.relowner),
  'policies',(select count(*) from pg_policy where polrelid=c.oid),
  'anon_access',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'app_access',has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'service_access',has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) order by c.relname)
  from pg_class c where c.relnamespace='studio_workflow'::regnamespace and c.relkind='r'),
 'business_tables_private',not exists(select 1 from pg_class c where c.oid in ('public.business_access_members'::regclass,'public.business_devices'::regclass,
  'public.business_signin_log'::regclass,'public.studio_session_members'::regclass) and (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))),
 'publishing_guard',(select jsonb_build_object('enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) from pg_trigger t where tgrelid='public.studio_scheduled_posts'::regclass and tgname='studio_editorial_post_guard'),
 'new_rows',jsonb_build_object('newsroom',(select count(*) from studio_workflow.newsroom),'partnerships',(select count(*) from studio_workflow.partnerships),
  'deliverables',(select count(*) from studio_workflow.deliverables),'events',(select count(*) from studio_workflow.events),'commands',(select count(*) from studio_workflow.commands),'access_events',(select count(*) from studio_workflow.access_events)),
 'data_counts',jsonb_build_object('auth_users',(select count(*) from auth.users),'profiles',(select count(*) from public.profiles),
  'auth_sessions',(select count(*) from auth.sessions),'staff',(select count(*) from public.admin_users),'storage_objects',(select count(*) from storage.objects),
  'members',(select count(*) from public.business_access_members),'bindings',(select count(*) from public.studio_session_members),'scheduled_posts',(select count(*) from public.studio_scheduled_posts))
) postflight;
