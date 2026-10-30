-- Creates a scoped worker credential inside Vault without printing it.
-- Does not activate cleanup or uploads. Review and deploy the exact worker first.
begin;
do $$ declare token text; begin
 perform pg_advisory_xact_lock(hashtextextended('platinum:music-maintenance:credential',0));
 if (select count(*) from vault.secrets where name='music_maintenance_worker_secret')>1 then raise exception 'Duplicate music credentials';end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='music_maintenance_worker_secret';
 if token is null then
  token:='pc_music_'||encode(extensions.gen_random_bytes(32),'hex');
  perform vault.create_secret(token,'music_maintenance_worker_secret','Scoped abandoned original-audio cleanup worker');
 end if;
 if token !~ '^pc_music_[0-9a-f]{64}$' then raise exception 'Invalid music credential';end if;
 update music_library.maintenance_worker set secret_digest=extensions.digest(token,'sha256'),updated_at=now() where singleton;
end $$;
commit;
