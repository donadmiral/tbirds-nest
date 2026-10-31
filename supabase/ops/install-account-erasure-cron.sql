-- The project URL is operator-configured in Vault. No keys are printed or
-- embedded in cron.job. Requires pg_cron, pg_net, and the scoped credential.
begin;
do $$
declare existing bigint; endpoint text;
begin
 if (select count(*) from vault.secrets where name='account_erasure_project_url')<>1 then
  raise exception 'Set the exact project https URL in Vault account_erasure_project_url first';
 end if;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='account_erasure_project_url';
 if endpoint !~ '^https://[a-z0-9]+[.]supabase[.]co$' then raise exception 'Invalid project URL'; end if;
 if not exists(select 1 from account_erasure.worker where secret_digest is not null) then raise exception 'Set up worker credential first'; end if;
 select jobid into existing from cron.job where jobname='platinum-account-storage-erasure';
 if existing is not null then perform cron.unschedule(existing); end if;
 perform cron.schedule('platinum-account-storage-erasure','* * * * *',$cron$
  select net.http_post(
   url:=(select decrypted_secret from vault.decrypted_secrets where name='account_erasure_project_url')||'/functions/v1/account-storage-erasure',
   headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='account_erasure_worker_secret'),'Content-Type','application/json'),
   body:='{}'::jsonb,timeout_milliseconds:=60000);
 $cron$);
end $$;
commit;
