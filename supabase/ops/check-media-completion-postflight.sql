-- Read-only catalog evidence after the media/erasure candidates, before any
-- subsequent database-hardening projection. No filenames, identities, tokens,
-- Vault material, or queue receipt values are returned.
select jsonb_build_object(
 'catalog',jsonb_build_object(
  'schemas',(select jsonb_agg(nspname order by nspname) from pg_namespace where nspname in('account_erasure','media_delivery')),
  'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(pg_get_functiondef(p.oid)),'acl',coalesce(p.proacl::text,'')) order by p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('account_erasure','media_delivery') or
      (n.nspname='content_media_legacy' and p.proname='allows_read') or
      (n.nspname='public' and p.proname in(
        'delete_user_account','request_account_erasure','account_erasure_status',
        'validate_account_erasure_worker','claim_account_erasure','check_account_erasure_object',
        'ack_account_erasure_object','prepare_account_erasure_identity','finish_account_erasure',
        'private_media_cutover_readiness','chat_locator_unrestricted','guard_limited_chat_object_reuse',
        'private_content_upload_allowed','guard_legacy_chat_reference','can_read_legacy_chat_object',
        'open_legacy_chat_media','claim_chat_media_view','consume_media_view',
        'issue_content_media_delivery','issue_chat_media_delivery','issue_chat_object_delivery',
        'resolve_media_delivery','read_legacy_chat_media','close_legacy_chat_media',
        'admin_bound_content_media_object','admin_bound_content_media_manifest',
        'triniti_admin_deletion_requests','content_media_manifest','content_media_document',
        'content_media_manifest_before_sound_rights','creator_has_active_subscription','sound_rights_allow'))),
  'policies',(select jsonb_agg(jsonb_build_object('name',polname,'cmd',polcmd,'permissive',polpermissive,
    'roles',coalesce((select jsonb_agg(rolname order by rolname) from pg_roles where oid=any(polroles)),'["public"]'::jsonb),
    'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) order by polname)
    from pg_policy where polrelid='storage.objects'::regclass and (polname like 'chat_private_%' or polname like 'private_content_%')),
  'privateTables',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'rls',c.relrowsecurity,
    'anonAccess',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
    'appAccess',has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
    'serviceDirectAccess',has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')) order by n.nspname,c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('account_erasure','media_delivery') and c.relkind='r'),
  'triggers',(select jsonb_agg(jsonb_build_object('name',tgname,'table',tgrelid::regclass::text,'definition',pg_get_triggerdef(oid),'enabled',tgenabled) order by tgrelid::regclass::text,tgname)
    from pg_trigger where not tgisinternal and tgname in('channel_private_reference_guard','group_private_reference_guard',
      'application_legacy_reference_guard','chat_limited_object_reuse_guard','bind_legacy_media_delivery','account_erasure_storage_write'))
 ),
 'observations',jsonb_build_object(
  'counts',jsonb_build_object('auth',(select count(*) from auth.users),'staff',(select count(*) from public.admin_users),
    'profiles',(select count(*) from public.profiles),'objects',(select count(*) from storage.objects)),
  'buckets',(select jsonb_agg(jsonb_build_object('id',id,'public',public) order by id) from storage.buckets where id in('post-media','story-media','media','chat-media','chat-files')),
  'unfencedApplicationTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in('public','creator_finance','marketplace_ops') and c.relkind='r'
      and not exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='account_erasure_actor_write' and t.tgenabled='O')),
  'workerConfigured',(select secret_digest is not null from account_erasure.worker where singleton),
  'workerHealthy',(select coalesce(last_seen_at>clock_timestamp()-interval '15 minutes',false) from account_erasure.worker where singleton),
  'queueStates',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from(select state,count(*) requests from account_erasure.jobs group by state order by state) s)
 )
) as postflight;
