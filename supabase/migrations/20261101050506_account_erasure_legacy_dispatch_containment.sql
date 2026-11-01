-- Contain the exact active reusable credential path without reading its value.
-- No Auth identity, Storage object, authorized job, receipt or Vault row changes.
begin;
set local search_path=pg_catalog;
set local lock_timeout='3s';
set local statement_timeout='20s';
lock table account_erasure.worker in share row exclusive mode;
-- Existing requests/claims finish before this guard; new requests read the
-- invalidated readiness after commit instead of accepting a stale credential.
lock table account_erasure.jobs in access exclusive mode;
do $containment$
declare target bigint;
begin
 if current_user<>'postgres' then raise exception 'ERASURE_CONTAINMENT_POSTGRES_REQUIRED';end if;
 if to_regclass('account_erasure.dispatch')is not null then raise exception 'ERASURE_CONTAINMENT_ALREADY_ADVANCED';end if;
 if to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)')is null
  or not coalesce(has_function_privilege('postgres',to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)'),'EXECUTE'),false)then
  raise exception 'ERASURE_CONTAINMENT_CRON_API_REQUIRED';
 end if;
 if (select count(*)from account_erasure.worker)<>1
  or not exists(select 1 from account_erasure.worker where singleton and secret_digest is not null)then
  raise exception 'ERASURE_CONTAINMENT_WORKER_STATE_CHANGED';
 end if;
 if exists(select 1 from account_erasure.jobs)then raise exception 'ERASURE_CONTAINMENT_REVIEW_PENDING_JOBS';end if;
 if exists(
  select 1 from(values
   ('public.validate_account_erasure_worker(text)','4f14082ef9e61c34036a2e12b9a6df73','s','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.claim_account_erasure(uuid)','3c720864cb3b0b65f16830792920c341','v','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.request_account_erasure(uuid,text)','32b6ca5fad7b2c6bcc1aff2f89e3588e','v','{postgres=X/postgres,authenticated=X/postgres}'),
   ('public.triniti_admin_erasure_review(uuid,uuid,uuid,text,uuid,text,text,text,text)','b2c1c98f33f5f2b6f0dfc6332946b233','v','{postgres=X/postgres,service_role=X/postgres}')
  )expected(signature,body_md5,volatility,acl)
  left join pg_proc p on p.oid=to_regprocedure(expected.signature)
  where p.oid is null or md5(p.prosrc)<>expected.body_md5 or p.provolatile::text<>expected.volatility
   or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef
   or p.proconfig is distinct from array['search_path=""'] or p.proacl::text is distinct from expected.acl
 )then raise exception 'ERASURE_CONTAINMENT_RPC_CONTRACT_CHANGED';end if;
 if (select count(*)from cron.job where jobname='platinum-account-storage-erasure')<>1
  or not exists(select 1 from cron.job where jobname='platinum-account-storage-erasure'and active
   and username='postgres'and schedule='* * * * *'and md5(command)='d0c0f30abe2c07bdab2eed11ab48e761')
  or exists(select 1 from cron.job where jobname<>'platinum-account-storage-erasure'
   and(command like '%account-storage-erasure%'or command like '%account_erasure_worker_secret%'))then
  raise exception 'ERASURE_CONTAINMENT_CRON_CONTRACT_CHANGED';
 end if;
 select jobid into target from cron.job where jobname='platinum-account-storage-erasure'for update;
 perform cron.alter_job(job_id:=target,active:=false);
 update account_erasure.worker set secret_digest=null,last_seen_at=null where singleton;
 if exists(select 1 from cron.job where jobid=target and active)
  or exists(select 1 from account_erasure.worker where secret_digest is not null or last_seen_at is not null)
  or exists(select 1 from account_erasure.jobs)then raise exception 'ERASURE_CONTAINMENT_POSTCONDITION_FAILED';end if;
end $containment$;
commit;
