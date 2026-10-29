-- Read-only preflight for 20261029213000_admin_support_review_contracts.sql.
-- The migration creates a new private namespace and must not overwrite an
-- independently installed broader admin layer.
with expected(table_schema,table_name,columns) as (values
 ('auth','sessions',array['id','user_id','aal','not_after']),
 ('auth','users',array['id','deleted_at','banned_until']),
 ('public','admin_users',array['user_id','role','active']),
 ('public','profiles',array['id','full_name']),
 ('public','support_tickets',array['id','status','created_at']),
 ('public','support_messages',array['id','ticket_id','sender','created_at']),
 ('public','admin_audit_log',array['admin_id','action','target_kind','target_id','reason','before','after']),
 ('public','seller_reviews',array['id','seller_id','reviewer_id','rating','comment','moderation_status','order_id','content_version','updated_at']),
 ('public','seller_review_reports',array['id','review_id','reporter_id','status','created_at','resolved_by','resolved_at','review_version'])
), column_checks as (
 select e.table_schema||'.'||e.table_name name,
   not exists(select 1 from unnest(e.columns) required(column_name)
     where not exists(select 1 from information_schema.columns c
       where c.table_schema=e.table_schema and c.table_name=e.table_name and c.column_name=required.column_name)) ready
 from expected e
), targets(signature) as (values
 ('public.admin_support_triage_read(uuid[])'),
 ('public.admin_support_triage_update(uuid,uuid,uuid,uuid,integer,uuid,text,text,boolean,text)'),
 ('public.admin_seller_review_reports(uuid,uuid,timestamp with time zone,uuid,text)'),
 ('public.moderate_seller_review(uuid,uuid,uuid,uuid,text,text,integer)')
), installed_quality(signature) as (values
 ('public.my_application_page(text,timestamp with time zone,uuid,integer)'),
 ('public.set_comment_pinned(uuid,boolean)'),
 ('public.report_client_error(jsonb)')
)
select jsonb_build_object(
 'admin_namespace_absent',to_regnamespace('admin_ops') is null,
 'target_contracts_absent',(select jsonb_object_agg(signature,to_regprocedure(signature) is null) from targets),
 'required_columns',(select jsonb_object_agg(name,ready) from column_checks),
 'applied_quality_contracts',(select jsonb_object_agg(signature,to_regprocedure(signature) is not null) from installed_quality),
 'native_session_check',(select jsonb_build_object(
   'signature',p.oid::regprocedure::text,'security_definer',p.prosecdef,
   'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),
   'definition_md5',md5(pg_get_functiondef(p.oid)),
   'definition',pg_get_functiondef(p.oid))
   from pg_proc p where p.oid=to_regprocedure('public.triniti_admin_session_check(uuid,uuid)')),
 'support_index',(select pg_get_indexdef(c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='support_messages_latest_idx')
) as preflight;
