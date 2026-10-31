-- Read-only definition/ACL receipt after the narrow admin support/review apply.
-- Compare definition_md5 fields with ADMIN_SUPPORT_REVIEW_GATE_20261029.json.
with required(signature) as (values
 ('admin_ops.require_session(uuid,uuid,text)'),
 ('public.admin_support_triage_read(uuid[])'),
 ('public.admin_support_triage_update(uuid,uuid,uuid,uuid,integer,uuid,text,text,boolean,text)'),
 ('public.admin_seller_review_reports(uuid,uuid,timestamp with time zone,uuid,text)'),
 ('public.moderate_seller_review(uuid,uuid,uuid,uuid,text,text,integer)')
), held(signature) as (values
 ('public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)'),
 ('public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)'),
 ('public.triniti_admin_deletion_requests(uuid,uuid,integer)')
), private_tables(name) as (values ('admin_ops.commands'),('admin_ops.support_triage'))
select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object(
   'signature',r.signature,'exists',p.oid is not null,
   'definition_md5',md5(pg_get_functiondef(p.oid)),'security_definer',p.prosecdef,'config',p.proconfig,
   'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
   'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
   'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by r.signature)
   from required r left join pg_proc p on p.oid=to_regprocedure(r.signature)),
 'private_tables',(select jsonb_agg(jsonb_build_object(
   'name',t.name,'exists',c.oid is not null,'rls',c.relrowsecurity,
   'anon_access',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
   'authenticated_access',has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
   'service_direct_access',has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')) order by t.name)
   from private_tables t left join pg_class c on c.oid=to_regclass(t.name)),
 'held_contracts_absent',(select jsonb_object_agg(signature,to_regprocedure(signature) is null) from held),
 'assignee_delete_sets_null',(select c.confdeltype='n' from pg_constraint c
   where c.conrelid=to_regclass('admin_ops.support_triage') and c.confrelid='public.admin_users'::regclass and c.contype='f'),
 'native_session_check_md5',(select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid=to_regprocedure('public.triniti_admin_session_check(uuid,uuid)')),
 'support_commands_available',coalesce(has_function_privilege('service_role',to_regprocedure('public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)'),'EXECUTE'),false)
) as postflight;
