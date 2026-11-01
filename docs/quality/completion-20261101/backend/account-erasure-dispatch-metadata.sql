-- Read-only metadata: never reads net queue payloads/headers, Vault values,
-- worker digest values, Auth keys, private object paths or user records.
begin read only;
set local search_path=pg_catalog;
set local lock_timeout='3s';
set local statement_timeout='20s';
select jsonb_build_object(
 'observedAt',clock_timestamp(),'readOnly',current_setting('transaction_read_only')='on','executor',current_user,
 'worker',(select coalesce(jsonb_agg(jsonb_build_object('singleton',singleton,'credentialConfigured',secret_digest is not null,'lastSeenAt',last_seen_at)),'[]'::jsonb)from account_erasure.worker),
 'jobCounts',(select coalesce(jsonb_object_agg(state,total),'{}'::jsonb)from(select state,count(*)total from account_erasure.jobs group by state)x),
 'activeLeaseCount',(select count(*)from account_erasure.jobs where lease_until>clock_timestamp()),
 'queueRelations',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'acl',c.relacl::text,'anonSchemaUsage',has_schema_privilege('anon',n.oid,'USAGE'),'memberSchemaUsage',has_schema_privilege('authenticated',n.oid,'USAGE'),'anonRead',has_table_privilege('anon',c.oid,'SELECT'),'memberRead',has_table_privilege('authenticated',c.oid,'SELECT'),'serviceRead',has_table_privilege('service_role',c.oid,'SELECT'))order by c.relname),'[]'::jsonb)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='net'and c.relname in('http_request_queue','_http_response')),
 'cronJobCatalogPresent',to_regclass('cron.job')is not null,
 'cronScheduleApiPresent',to_regprocedure('cron.schedule(text,text,text)')is not null,
 'providerHttpApiPresent',to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)')is not null,
 'dispatchInstalled',to_regclass('account_erasure.dispatch')is not null,
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')','definitionMd5',md5(pg_get_functiondef(p.oid)),'bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),'memberExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE'))order by n.nspname,p.proname),'[]'::jsonb)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='public'and p.proname in('request_account_erasure','account_erasure_status','validate_account_erasure_worker','claim_account_erasure','check_account_erasure_object','ack_account_erasure_object','prepare_account_erasure_identity','finish_account_erasure','triniti_admin_erasure_review','respond_offer','make_offer','offer_response_capabilities','send_member_support_reply'))or(n.nspname='account_erasure'and p.proname in('review_reason','erase_app_records'))),
 'marketAlertCount',(select count(*)from public.market_alerts),
 'interactionTriggers',(select coalesce(jsonb_agg(jsonb_build_object('relation',n.nspname||'.'||c.relname,'trigger',t.tgname,'enabled',t.tgenabled,'definitionMd5',md5(pg_get_triggerdef(t.oid)),'argumentCount',t.tgnargs,'function',pn.nspname||'.'||p.proname,'functionDefinitionMd5',md5(pg_get_functiondef(p.oid)),'sourceContainsNetworkCall',p.prosrc~*'(net[.]http|http_post|pg_net|requests[.])','sourceMentionsPushOrNotification',p.prosrc~*'(push_token|notification|expo)')order by c.relname,t.tgname),'[]'::jsonb)from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace where not t.tgisinternal and n.nspname='public'and c.relname in('listing_offers','marketplace_listings','messages','notifications','conversations','conversation_members','member_support_threads','member_support_messages','support_threads','support_tickets','support_messages')),
 'otherActiveOrOpenClientTransactions',(select count(*)from pg_stat_activity where pid<>pg_backend_pid()and backend_type='client backend'and state in('active','idle in transaction','idle in transaction (aborted)')),
 'scope','Metadata only. Queue ACLs do not by themselves assert REST exposure. No credential, queued header, user data, worker invocation or outbound message is read or sent.'
)as observation;
rollback;
