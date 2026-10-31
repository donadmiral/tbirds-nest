-- QA ONLY. The service key travels from the deployed Edge environment directly
-- to this narrow authenticated RPC. It is never returned, logged, placed in a
-- migration, sent through an MCP argument or accepted from the setup caller.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
begin
 if current_user<>'postgres' then raise exception 'NOTIFICATION_POSTGRES_REQUIRED';end if;
 if (select count(*) from vault.secrets where name='project_url')<>1
  or (select count(*) from vault.decrypted_secrets where name='project_url'
  and rtrim(decrypted_secret,'/')='https://uaulhuelcfkjwojtymmw.supabase.co')<>1
  or to_regclass('notification_delivery.settings') is null then raise exception 'EXACT_QA_NOTIFICATION_PREREQUISITE_REQUIRED';end if;
 if to_regprocedure('public.install_qa_notification_dispatch_credential(text,text)') is not null then raise exception 'QA_NOTIFICATION_INSTALLER_ALREADY_EXISTS';end if;
end $preflight$;
create function public.install_qa_notification_dispatch_credential(p_nonce_hash text,p_service_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare config notification_delivery.settings%rowtype;headers jsonb;credential_id uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';end if;
 select * into config from notification_delivery.settings where singleton for update;
 if not found or config.enabled or config.setup_used_at is not null then raise exception 'QA_SETUP_UNAVAILABLE';end if;
 if p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$'
  or config.setup_nonce_digest is distinct from decode(p_nonce_hash,'hex')
  or config.setup_armed_at is null or config.setup_armed_at>clock_timestamp()
  or config.setup_expires_at is null or config.setup_expires_at<=clock_timestamp() then raise exception 'QA_SETUP_NONCE_EXPIRED_OR_INVALID';end if;
 if config.ordinary_handler_sha256 is null or config.call_handler_sha256 is null
  or config.project_origin is distinct from 'https://uaulhuelcfkjwojtymmw.supabase.co'
  or (select count(*) from vault.secrets where name='project_url')<>1
  or (select count(*) from vault.decrypted_secrets where name='project_url'
   and rtrim(decrypted_secret,'/')=config.project_origin)<>1 then raise exception 'QA_SETUP_TARGET_OR_READBACK_REQUIRED';end if;
 if p_service_key is null or length(p_service_key) not between 32 and 4096 or p_service_key ~ '[[:space:]]' then raise exception 'QA_SETUP_CREDENTIAL_INVALID';end if;
 headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
 if regexp_replace(coalesce(headers->>'authorization',''),'^Bearer ','','i') is distinct from p_service_key then raise exception 'QA_SETUP_CREDENTIAL_IDENTITY_MISMATCH';end if;
 if exists(select 1 from vault.secrets where name='notification_dispatch_service_key') then raise exception 'QA_SETUP_CREDENTIAL_ALREADY_PRESENT';end if;
 select vault.create_secret(p_service_key,'notification_dispatch_service_key','QA notification dispatch; installed from the exact Edge service identity') into credential_id;
 if credential_id is null then raise exception 'QA_SETUP_CREDENTIAL_WRITE_FAILED';end if;
 update notification_delivery.settings set setup_used_at=clock_timestamp(),enabled=true where singleton;
 return jsonb_build_object('installed',true,'project_ref','uaulhuelcfkjwojtymmw','ordinary',true,'calls',true);
end $$;
revoke all on function public.install_qa_notification_dispatch_credential(text,text) from public,anon,authenticated,service_role;
grant execute on function public.install_qa_notification_dispatch_credential(text,text) to service_role;
notify pgrst,'reload schema';
commit;
