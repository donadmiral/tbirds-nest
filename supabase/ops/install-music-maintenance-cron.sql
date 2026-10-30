-- Requires pg_cron, pg_net, a deployed worker and reviewed readiness activation.
-- Set music_maintenance_project_url in Vault to this project's exact https URL.
begin;
do $$ declare existing bigint; endpoint text; begin
 if (select count(*) from vault.secrets where name='music_maintenance_project_url')<>1 then raise exception 'Set the project URL in Vault first';end if;
 if (select count(*) from vault.secrets where name='music_maintenance_worker_secret')<>1 then raise exception 'Set up worker credential first';end if;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='music_maintenance_project_url';
 if endpoint !~ '^https://[a-z0-9]+[.]supabase[.]co$' then raise exception 'Invalid project URL';end if;
 if not exists(select 1 from music_library.maintenance_worker where enabled and secret_digest is not null) then raise exception 'Verify and activate music maintenance first';end if;
 select jobid into existing from cron.job where jobname='platinum-music-maintenance';
 if existing is not null then perform cron.unschedule(existing);end if;
 perform cron.schedule('platinum-music-maintenance','*/5 * * * *',$cron$
  select net.http_post(
   url:=(select decrypted_secret from vault.decrypted_secrets where name='music_maintenance_project_url')||'/functions/v1/music-maintenance',
   headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='music_maintenance_worker_secret'),'Content-Type','application/json'),
   body:='{}'::jsonb,timeout_milliseconds:=50000);
 $cron$);
end $$;
commit;
