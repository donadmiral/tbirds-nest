-- Read-only metadata and aggregate counts. Do not return credentials or users.
with expected(signature,hash,acl) as(values
 ('studio_workflow.context(uuid)','88f2b41f172b80b323ad1b20fdf983db','{postgres=X/postgres}'),
 ('public.studio_role()','955f1c432cc78baa8af374a1b7764c1b','{postgres=X/postgres,authenticated=X/postgres}'),
 ('public.studio_bind_member(text)','725e31f7b81626e606a75618c87c969b','{postgres=X/postgres,authenticated=X/postgres}'),
 ('public.studio_set_device(uuid,text)','47239a4b49b3408379d3314fda0a089a','{postgres=X/postgres,authenticated=X/postgres}'),
 ('public.resolve_media_delivery(text,text,text)','c0f3550b138e1e1476a345f7094fbed7','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)','69d07d257bb8a9c59ae27d7a4e8e79cd','{postgres=X/postgres,service_role=X/postgres}'))
select jsonb_build_object(
 'schema_absent',to_regnamespace('business_auth') is null,
 'provider_contracts_absent',not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in('triniti_business_signin_check','triniti_business_owner_access','triniti_business_finish_signin','triniti_business_cancel_signin')),
 'request_hook_absent',not exists(select 1 from pg_db_role_setting cross join lateral unnest(setconfig) c where c like 'pgrst.db_pre_request=%' and c<>'pgrst.db_pre_request='),
 'authenticator_exists',exists(select 1 from pg_roles where rolname='authenticator'),
 'auth_session_timestamp',exists(select 1 from information_schema.columns where table_schema='auth' and table_name='sessions' and column_name='created_at' and data_type='timestamp with time zone'),
 'baseline_matches',(select bool_and(p.oid is not null and md5(pg_get_functiondef(p.oid))=e.hash and p.proacl::text=e.acl and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=""']::text[]) from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)),
 'functions',(select jsonb_agg(jsonb_build_object('signature',e.signature,'hash',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text,'search_path',p.proconfig) order by e.signature) from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)),
 'unfenced_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','creator_finance','marketplace_ops','storage') and c.relkind='r' and not c.relrowsecurity and has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')),
 'unbound_business_sessions',(select count(*) from auth.sessions s join public.profiles p on p.id=s.user_id where p.account_type='business'),
 'protected_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and c.relrowsecurity and (n.nspname in('public','creator_finance','marketplace_ops','storage') or (n.nspname='realtime' and c.relname='messages'))),
 'extension_functions',jsonb_build_object('digest',to_regprocedure('extensions.digest(text,text)') is not null,'random_bytes',to_regprocedure('extensions.gen_random_bytes(integer)') is not null),
 'data_counts',jsonb_build_object('auth_users',(select count(*) from auth.users),'auth_sessions',(select count(*) from auth.sessions),'profiles',(select count(*) from public.profiles),'business_profiles',(select count(*) from public.profiles where account_type='business'),'business_members',(select count(*) from public.business_access_members),'business_devices',(select count(*) from public.business_devices),'studio_bindings',(select count(*) from public.studio_session_members),'storage_objects',(select count(*) from storage.objects),'staff',(select count(*) from public.admin_users),'pending_provisions',(select count(*) from admin_ops.provisions where completed_at is null)),
 'buckets',(select jsonb_agg(jsonb_build_object('id',id,'public',public) order by id) from storage.buckets where id in('chat-media','chat-files','post-media','story-media','media'))
);
