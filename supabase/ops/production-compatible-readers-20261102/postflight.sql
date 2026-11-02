-- Read-only immediate postflight, before the separate content-ticket package.
with expected(signature,body_md5) as(values
 ('public.get_memory_book(uuid)','e81581dd9ed47c8f11705fdd8d62b1a5'),
 ('public.get_memory_albums(uuid)','2ff77aa54267e0e31f96757d5c220487'),
 ('public.validate_memory_book_cover()','c564cf37800f4b0ecb26ade7fcab3bb8'),
 ('public.can_view_memory_book(uuid)','dc1c8ae9412c152162184370f24631c0')
), contracts(signature,service_only) as(values
 ('public.get_paged_reader_capabilities()',false),('public.configure_paged_readers(boolean,boolean)',true),
 ('public.get_memory_book_page_v2(uuid,jsonb,integer)',false),('public.get_memory_books_page_v2(uuid,jsonb,integer)',false),
 ('public.get_next_memory_book_v2(uuid,boolean)',false),
 ('public.get_inbox_page_v2(text,jsonb,integer,text,text,boolean,boolean,boolean,uuid[],text,text,text,boolean,boolean)',false),
 ('public.get_inbox_unread_totals_v2()',false),('public.get_context_inbox_page_v2(text,jsonb,integer,uuid[])',false),
 ('public.get_business_inbox_page_v2(uuid,text,jsonb,integer,uuid[])',false),
 ('public.get_inbox_mentions_v2(uuid[],timestamp with time zone)',false),
 ('public.get_memory_book_window_v3(uuid,uuid,text,integer,integer)',false),('public.get_default_memory_book_page_v3(uuid)',false)
), public_acl as(
 select c.*,p.oid,p.proconfig,p.prosecdef,
  p.oid is not null and p.proowner='postgres'::regrole
   and not has_function_privilege('anon',p.oid,'execute')
   and has_function_privilege('authenticated',p.oid,'execute')=not c.service_only
   and has_function_privilege('service_role',p.oid,'execute')=c.service_only
   and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') matches
 from contracts c left join pg_proc p on p.oid=to_regprocedure(c.signature)
), private_acl as(
 select n.nspname,p.oid::regprocedure::text signature,p.proowner='postgres'::regrole
  and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')
  and has_function_privilege('authenticated',p.oid,'execute')=(p.oid in(to_regprocedure('read_paging.inbox_unread(uuid[])'),to_regprocedure('read_paging.inbox_has_unread(uuid)')))
  and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') matches
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('read_paging_support','read_paging')
)
select jsonb_build_object(
 'observed_at',clock_timestamp(),'installed',to_regnamespace('read_paging_support') is not null and to_regnamespace('read_paging') is not null,
 'canonical_readers_unchanged',(select bool_and(p.oid is not null and md5(p.prosrc)=e.body_md5 and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[]) from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)),
 'public_contracts_valid',(select bool_and(matches) from public_acl),'private_contracts_valid',(select bool_and(matches) from private_acl),
 'public_contracts',(select jsonb_agg(jsonb_build_object('signature',signature,'service_only',service_only,'matches',matches,'definer',prosecdef,'config',proconfig) order by signature) from public_acl),
 'private_contracts',(select jsonb_agg(jsonb_build_object('signature',signature,'matches',matches) order by signature) from private_acl),
 'settings',(select to_jsonb(s) from read_paging.settings s where singleton),
 'default_off',(select not books_ready and not inbox_ready from read_paging.settings where singleton),
 'private_tables',(select jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,'api_access',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')) order by c.relname) from pg_class c where c.relnamespace='read_paging'::regnamespace and c.relkind='r'),
 'full_packages_not_fabricated',not exists(select 1 from unnest(array['memory_creative','music_library','account_erasure','media_delivery','business_auth']) n where to_regnamespace(n) is not null),
 'existing_functions_md5',(select md5(coalesce(string_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,''),E'\n' order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','auth') and not exists(select 1 from contracts c where p.oid=to_regprocedure(c.signature))),
 'existing_policies_md5',(select md5(coalesce(string_agg(to_jsonb(p)::text,E'\n' order by schemaname,tablename,policyname),'')) from pg_policies p where schemaname in('public','storage')),
 'existing_columns_md5',(select md5(coalesce(string_agg(jsonb_build_array(table_schema,table_name,column_name,data_type,column_default,is_nullable)::text,E'\n' order by table_schema,table_name,ordinal_position),'')) from information_schema.columns where table_schema in('public','auth','storage')),
 'buckets',(select jsonb_agg(jsonb_build_object('id',id,'public',public) order by id) from storage.buckets),
 'revision_triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'function',t.tgfoid::regprocedure::text) order by t.tgname) from pg_trigger t where t.tgname in('paged_book_revision','paged_page_revision','paged_story_revision') and not t.tgisinternal)
) postflight;
