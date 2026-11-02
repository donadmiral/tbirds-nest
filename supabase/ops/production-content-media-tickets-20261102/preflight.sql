with expected(signature,source_md5) as(values
 ('public.content_media_manifest(jsonb)','820e23b8bc5ba91b71b0a32997df6911'),
 ('public.content_upload_manifest(jsonb)','73627c8916f1a8b8116ab37af16c0c28'),
 ('content_media_legacy.allows_read(text,uuid,uuid,text,text,text)','79a6d0c6dfa89facfdb96da2cd10e56a'))
select jsonb_build_object('checked_at',clock_timestamp(),'readers_installed',to_regnamespace('read_paging_support') is not null,
 'delivery_schema_absent',to_regnamespace('media_delivery') is null,'business_authority_absent',to_regnamespace('business_auth') is null,
 'target_rpcs_absent',to_regprocedure('public.issue_content_media_delivery(jsonb,jsonb)') is null and to_regprocedure('public.resolve_media_delivery(text,text,text)') is null,
 'canonical_functions',(select jsonb_agg(jsonb_build_object('signature',e.signature,'source_md5',md5(p.prosrc),'hash_matches',md5(p.prosrc)=e.source_md5,'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl) order by e.signature) from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)),
 'source_buckets',(select jsonb_agg(jsonb_build_object('id',id,'public',public) order by id) from storage.buckets where id in('post-media','story-media','media','chat-media','chat-files')),
 'adaptive_gates',(select jsonb_build_object('admission',admission_enabled,'worker',worker_enabled,'delivery',delivery_enabled,'maintenance',maintenance_enabled) from media_renditions.settings where singleton)) as content_ticket_preflight;
