-- Read-only evidence. Returns aggregate counts and function metadata, never
-- access codes, tokens, identity details or stored media URLs.
with expected(signature,hash) as (values
 ('public.create_business_access_member(text)','cd2dea0933e6d25eb4a466ac54512921'),
 ('public.studio_bind_member(text)','e6a105ea022a3bfdfd3be142360162a3'),
 ('public.studio_business_info()','c2c8e3bcc4e12f7d50a528c2a294b22f'),
 ('public.studio_get_business()','e58a1c829899f0553923ae79d4f09367'),
 ('public.studio_create_member(text,text)','d85fa9f971f74d936cda252c0c79dd58'),
 ('public.studio_list_members()','4420194da77a8aadf542b77d001a316a'),
 ('public.studio_role()','d7f139e152efc0ae60d5d5fe08535509'),
 ('public.studio_set_device(uuid,text)','74854ac23d885f5cf2691a0a4524aea3'),
 ('public.studio_set_member_active(uuid,boolean)','173a48fa8d4c019d23948fbe3ac59161'),
 ('public.studio_set_member_role(uuid,text)','cac5eb83a55075cd0875683a2b01ab29'),
 ('public.studio_publish_row(uuid)','a35cde3e5e2ac5a111b503a265ba18cf'),
 ('public.studio_publish_due()','d7cdc3e707f6a8498f50f458b9811533'),
 ('public.studio_save_post(uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone)','88162d57e80d3d478141bb25807d4df6')
)
select jsonb_build_object(
 'fresh_target',to_regnamespace('studio_workflow') is null,
 'current_baseline',to_regprocedure('account_erasure.assert_writable(uuid)') is not null and to_regclass('admin_ops.staff_social_shells') is not null,
 'definitions_match',(select count(*)=13 from expected e join pg_proc p on p.oid=to_regprocedure(e.signature) where md5(pg_get_functiondef(p.oid))=e.hash and pg_get_userbyid(p.proowner)='postgres'),
 'trusted_schemas',not exists(select 1 from pg_namespace n where n.nspname in('public','extensions') and
  (has_schema_privilege('anon',n.oid,'CREATE') or has_schema_privilege('authenticated',n.oid,'CREATE'))),
 'publisher_internal',not (has_function_privilege('anon','public.studio_publish_row(uuid)','EXECUTE') or has_function_privilege('authenticated','public.studio_publish_row(uuid)','EXECUTE')
  or has_function_privilege('anon','public.studio_publish_due()','EXECUTE') or has_function_privilege('authenticated','public.studio_publish_due()','EXECUTE')),
 'session_bindings_private',(select relrowsecurity from pg_class where oid='public.studio_session_members'::regclass)
  and not exists(select 1 from pg_policy where polrelid='public.studio_session_members'::regclass)
  and not (has_table_privilege('anon','public.studio_session_members','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   or has_table_privilege('authenticated','public.studio_session_members','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
 'configured_teams_have_owner',not exists(select business_id from public.business_access_members group by business_id having count(*) filter(where active and role='owner')=0),
 'data_counts',jsonb_build_object('auth_users',(select count(*) from auth.users),'profiles',(select count(*) from public.profiles),
  'auth_sessions',(select count(*) from auth.sessions),'staff',(select count(*) from public.admin_users),'storage_objects',(select count(*) from storage.objects),
  'members',(select count(*) from public.business_access_members),'bindings',(select count(*) from public.studio_session_members),'scheduled_posts',(select count(*) from public.studio_scheduled_posts))
) preflight;
