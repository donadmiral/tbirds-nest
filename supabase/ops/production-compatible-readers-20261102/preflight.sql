-- Read-only metadata. Apply only when every gate is true; no user data/credentials.
with expected(signature,body_md5) as(values
 ('public.get_memory_book(uuid)','e81581dd9ed47c8f11705fdd8d62b1a5'),
 ('public.get_memory_albums(uuid)','2ff77aa54267e0e31f96757d5c220487'),
 ('public.validate_memory_book_cover()','c564cf37800f4b0ecb26ade7fcab3bb8'),
 ('public.can_view_memory_book(uuid)','dc1c8ae9412c152162184370f24631c0')
), inspected as(
 select e.*,p.oid,md5(p.prosrc) actual_md5,p.proowner,p.prosecdef,p.proconfig,
  p.oid is not null and md5(p.prosrc)=e.body_md5 and p.proowner='postgres'::regrole
   and p.prosecdef and p.proconfig=array['search_path=""']::text[] matches
 from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
), auth_expected(schema_name,table_name,column_name,data_type) as(values
 ('auth','users','id','uuid'),('auth','users','deleted_at','timestamp with time zone'),
 ('auth','users','banned_until','timestamp with time zone'),('auth','sessions','id','uuid'),
 ('auth','sessions','user_id','uuid'),('auth','sessions','not_after','timestamp with time zone'),
 ('public','profiles','deactivated_at','timestamp with time zone'),('public','profiles','account_type','text')
), core_expected(table_name,column_name) as(
 select 'stories',unnest(array['id','user_id','media_url','media_type','thumbnail_url','caption','text_background',
  'stickers_json','media_transform','filter_id','duration_sec','dual_front_url','audio_duration_sec','audio_title','audio_url'])
 union all select 'memory_albums',unnest(array['id','user_id','is_default','title','subtitle','cover_color','cover_design','cover_story_id','audience','created_at'])
 union all select 'memory_pages',unnest(array['id','album_id','user_id','story_id','sort_order','created_at','style','media_url','media_type','thumbnail_url','caption','taken_at'])
), gates as(select jsonb_build_object(
 'postgres_actor',current_user='postgres',
 'fresh_target',not exists(select 1 from unnest(array['read_paging','read_paging_support','memory_creative','music_library','media_delivery','account_erasure'])n where to_regnamespace(n) is not null),
 'canonical_readers',(select bool_and(matches) from inspected),
 'cover_trigger',exists(select 1 from pg_trigger t where t.tgrelid='public.memory_albums'::regclass and t.tgname='memory_book_cover'
  and t.tgenabled='O' and not t.tgisinternal and t.tgtype=23 and t.tgqual is null
  and t.tgfoid=to_regprocedure('public.validate_memory_book_cover()')
  and (select array_agg(a.attname::text order by a.attname) from unnest(t.tgattr)x(attnum)
   join pg_attribute a on a.attrelid=t.tgrelid and a.attnum=x.attnum)=array['cover_story_id','user_id']::text[]),
 'auth_column_types',not exists(select 1 from auth_expected e where not exists(select 1 from information_schema.columns c
  where c.table_schema=e.schema_name and c.table_name=e.table_name and c.column_name=e.column_name and c.data_type=e.data_type)),
 'core_columns',not exists(select 1 from core_expected e where not exists(select 1 from information_schema.columns c
  where c.table_schema='public' and c.table_name=e.table_name and c.column_name=e.column_name)),
 'support_helpers',not exists(select 1 from unnest(array['public.get_context_unread()','public.get_unread_counts()',
  'public.is_business_member(uuid)','auth.uid()','auth.role()','auth.jwt()'])f where to_regprocedure(f) is null),
 'icu_collation',to_regcollation('pg_catalog."und-x-icu"') is not null,
 'visual_only_shape',to_regprocedure('public.sound_rights_allow(uuid,text)') is null and not exists(select 1 from information_schema.columns c
  where c.table_schema='public' and ((c.table_name='memory_albums' and c.column_name in('cover_artwork','film_settings','presentation_revision','soundtrack'))
   or (c.table_name='stories' and c.column_name='audio_sound_id')))
 ) value)
select jsonb_build_object(
 'observed_at',clock_timestamp(),'all_gates_passed',(select bool_and(value='true'::jsonb) from jsonb_each(gates.value)),
 'gates',gates.value,'canonical_functions',(select jsonb_agg(jsonb_build_object('signature',signature,'body_md5',actual_md5,'matches',matches) order by signature) from inspected),
 'auth_columns',(select jsonb_agg(jsonb_build_object('schema',e.schema_name,'table',e.table_name,'column',e.column_name,'type',c.data_type) order by e.schema_name,e.table_name,e.column_name)
  from auth_expected e left join information_schema.columns c on c.table_schema=e.schema_name and c.table_name=e.table_name and c.column_name=e.column_name),
 'core_columns',(select jsonb_agg(jsonb_build_object('table',e.table_name,'column',e.column_name,'type',c.data_type) order by e.table_name,e.column_name)
  from core_expected e left join information_schema.columns c on c.table_schema='public' and c.table_name=e.table_name and c.column_name=e.column_name),
 'existing_functions_md5',(select md5(coalesce(string_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,''),E'\n' order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','auth')),
 'existing_policies_md5',(select md5(coalesce(string_agg(to_jsonb(p)::text,E'\n' order by schemaname,tablename,policyname),'')) from pg_policies p where schemaname in('public','storage')),
 'existing_columns_md5',(select md5(coalesce(string_agg(jsonb_build_array(table_schema,table_name,column_name,data_type,column_default,is_nullable)::text,E'\n' order by table_schema,table_name,ordinal_position),'')) from information_schema.columns where table_schema in('public','auth','storage')),
 'buckets',(select jsonb_agg(jsonb_build_object('id',id,'public',public) order by id) from storage.buckets),
 'install_order',jsonb_build_array('production_compatible_paged_readers','production_additive_content_tickets'),
 'default_readiness',jsonb_build_object('books',false,'inbox',false)
) preflight from gates;
