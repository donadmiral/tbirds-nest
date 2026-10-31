-- Read-only. No credentials, private object paths or personal audio are returned.
select uploads_enabled from music_library.service_state where singleton;
select ingestion_enabled,playback_enabled from music_library.catalogue_service where singleton;
select count(*) as provider_credentials,count(*)filter(where enabled)as enabled_provider_credentials from music_library.catalogue_credentials;
select count(*)as grants,count(*)filter(where hosting_allowed and revoked_at is null and starts_at<=clock_timestamp()and ends_at>clock_timestamp())as current_hosting_grants from music_library.catalogue_grants;
select enabled,last_seen_at,secret_digest is not null as credential_configured from music_library.maintenance_worker where singleton;
select 'original' as kind,state,count(*) as jobs from music_library.cleanup_jobs group by state
union all select 'catalogue',state,count(*)from music_library.catalogue_cleanup_jobs group by state;
select status,count(*) as uploads from music_library.uploads group by status;
select status,count(*)as assets from music_library.catalogue_assets group by status;
select count(*) as staged_catalogue_tracks from music_library.catalogue_tracks;
select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='music_library' and c.relkind='r' order by c.relname;
select tgname,tgenabled from pg_trigger where tgrelid='storage.objects'::regclass and tgname='music_catalogue_storage_write';
select p.proname,has_function_privilege('anon',p.oid,'execute') as anon_execute,
has_function_privilege('authenticated',p.oid,'execute') as user_execute,
has_function_privilege('service_role',p.oid,'execute') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
('claim_music_upload_cleanup','check_music_upload_cleanup','ack_music_upload_cleanup','fail_music_upload_cleanup','validate_music_maintenance_worker','set_music_maintenance_ready','admin_stage_music_catalogue','admin_music_operations_snapshot','admin_music_usage_report','reserve_catalogue_audio','catalogue_audio_object','finish_catalogue_audio','authorize_music_audio_export','claim_catalogue_upload_cleanup','check_catalogue_upload_cleanup','ack_catalogue_upload_cleanup','fail_catalogue_upload_cleanup')order by p.proname;
