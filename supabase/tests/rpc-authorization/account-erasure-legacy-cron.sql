
  select net.http_post(
   url:=(select decrypted_secret from vault.decrypted_secrets where name='account_erasure_project_url')||'/functions/v1/account-storage-erasure',
   headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='account_erasure_worker_secret'),'Content-Type','application/json'),
   body:='{}'::jsonb,timeout_milliseconds:=60000);
 