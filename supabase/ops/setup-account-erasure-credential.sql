-- Run only after reviewing the account-erasure migration and worker. The
-- plaintext credential is created and kept in Vault, never returned to a client.
begin;
do $$
declare token text;
begin
 perform pg_advisory_xact_lock(hashtextextended('platinum:account-erasure:credential',0));
 if (select count(*) from vault.secrets where name='account_erasure_worker_secret')>1 then
  raise exception 'Duplicate account erasure credentials';
 end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='account_erasure_worker_secret';
 if token is null then
  token:='pc_erase_'||encode(extensions.gen_random_bytes(32),'hex');
  perform vault.create_secret(token,'account_erasure_worker_secret','Scoped account Storage erasure worker');
 end if;
 if token !~ '^pc_erase_[0-9a-f]{64}$' then raise exception 'Invalid erasure credential'; end if;
 update account_erasure.worker set secret_digest=extensions.digest(token,'sha256') where singleton;
end $$;
commit;
