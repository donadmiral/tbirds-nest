-- Read-only success check for the exact reviewed private stage-4 installation.
-- No DDL, application-function invocation, mutation, lock override or approval bypass.
-- A true installation gate verifies this stage only; it does not cancel prior requests.
begin read only;
set local search_path=pg_catalog;
set local lock_timeout='3s';
set local statement_timeout='20s';
with inventory as (
select 'schema' k,nspname::text n,jsonb_build_array(pg_get_userbyid(nspowner),nspacl::text) v from pg_namespace where nspname='business_auth'
union all select 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',jsonb_build_array(pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),p.proacl::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='business_auth' or (n.nspname,p.proname) in (('studio_workflow','context'),('public','studio_role'),('public','studio_bind_member'),('public','studio_set_device'),('public','resolve_media_delivery'),('public','triniti_admin_provision'),('public','business_session_allowed'),('public','business_auth_request_guard'),('public','triniti_business_signin_check'),('public','triniti_business_owner_access'),('public','triniti_business_finish_signin'),('public','triniti_business_cancel_signin'))
union all select 'relation',c.relname,jsonb_build_array(c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner),c.relacl::text) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='business_auth' and c.relkind in('r','p','v','m','f','S')
union all select 'column',c.relname||'.'||a.attnum::text,jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname='business_auth' and c.relkind in('r','p') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.relname||'.'||t.conname,to_jsonb(pg_get_constraintdef(t.oid)) from pg_constraint t join pg_class c on c.oid=t.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='business_auth' and t.contype<>'n'
union all select 'index',c.relname,to_jsonb(pg_get_indexdef(c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='business_auth' and c.relkind in('i','I')
union all select 'trigger',t.tgrelid::regclass::text||'.'||t.tgname,jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled) from pg_trigger t where not t.tgisinternal and t.tgname like 'business_auth_%'
union all select 'policy',p.polrelid::regclass::text||'.'||p.polname,jsonb_build_array(p.polpermissive,p.polcmd,(select jsonb_agg(r.rolname order by r.rolname) from pg_roles r where r.oid=any(p.polroles)),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) from pg_policy p where p.polname='business_session_required' or p.polrelid in(select oid from pg_class where relnamespace=to_regnamespace('business_auth'))
union all select 'hook',coalesce(r.rolname,'ALL')||':'||coalesce(d.datname,'ALL'),to_jsonb(c) from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole left join pg_database d on d.oid=s.setdatabase cross join lateral unnest(s.setconfig) c where c like 'pgrst.db_pre_request=%' and c<>'pgrst.db_pre_request='
), private_counts(name,rows) as (
 values ('accounts',(select count(*) from business_auth.accounts)),
        ('attempts',(select count(*) from business_auth.attempts)),
        ('device_keys',(select count(*) from business_auth.device_keys)),
        ('events',(select count(*) from business_auth.events)),
        ('grants',(select count(*) from business_auth.grants)),
        ('owner_seats',(select count(*) from business_auth.owner_seats)),
        ('sessions',(select count(*) from business_auth.sessions))
), other_client_activity as (
 select pid,usename,state,backend_type,wait_event_type,wait_event,
        xact_start,query_start,md5(query) as query_digest
 from pg_stat_activity
 where pid<>pg_backend_pid() and backend_type='client backend'
   and state in('active','idle in transaction','idle in transaction (aborted)')
), function_index as (
 select i.indisunique and i.indisvalid and i.indimmediate
        and i.indpred is null and i.indexprs is null as enforced,
        (select array_agg(a.attname::text order by k.ordinality)
         from unnest(i.indkey) with ordinality k(attnum,ordinality)
         join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum) as columns,
        pg_get_indexdef(i.indexrelid) as definition
 from pg_index i
 where i.indexrelid='pg_catalog.pg_proc_proname_args_nsp_index'::regclass
), state as (
 select clock_timestamp() as observed_at,current_user::text as executor,
  current_setting('transaction_read_only')='on' as read_only,
  (select md5(coalesce(jsonb_agg(jsonb_build_array(k,n,v) order by k,n)::text,'[]')) from inventory) as fingerprint,
  obj_description(to_regnamespace('business_auth'),'pg_namespace') as marker,
  (select count(*) from inventory) as catalog_rows,
  (select jsonb_object_agg(name,rows order by name) from private_counts) as private_table_rows,
  (select coalesce(sum(rows),0)=0 from private_counts) as private_tables_empty,
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c where c.relnamespace=to_regnamespace('business_auth') and c.relkind='r') as private_tables,
  (select count(*) from auth.sessions s join public.profiles p on p.id=s.user_id where p.account_type='business') as business_auth_sessions,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in('public','creator_finance','marketplace_ops','storage') and c.relkind='r'
     and not c.relrowsecurity and has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) as unfenced_authenticated_tables,
  (select count(*) from pg_class c cross join (values('anon'),('authenticated'),('service_role')) r(role)
   where c.relnamespace=to_regnamespace('business_auth') and c.relkind='r'
     and has_table_privilege(r.role,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as private_table_access,
  (select count(*) from pg_proc p cross join (values('anon'),('authenticated'),('service_role')) r(role)
   where p.pronamespace=to_regnamespace('business_auth') and has_function_privilege(r.role,p.oid,'EXECUTE')) as private_function_access,
  (select count(*) from (values('anon'),('authenticated'),('service_role')) r(role)
   where has_schema_privilege(r.role,'business_auth','USAGE')) as private_schema_access,
  to_regprocedure('business_auth.triniti_business_signin_check(text,text,text,text,text)') is null as target_function_absent,
  (select count(*) from supabase_migrations.schema_migrations where name like 'qa_business_auth_04_%') as stage4_journal_rows,
  (select coalesce(enforced and columns=array['proname','proargtypes','pronamespace'],false) from function_index) as function_uniqueness_enforced,
  (select to_jsonb(function_index) from function_index) as function_uniqueness,
  (select count(*) from other_client_activity) as other_active_or_open_client_transactions,
  (select coalesce(jsonb_agg(to_jsonb(a) order by pid),'[]'::jsonb) from other_client_activity a) as other_client_activity,
  (select count(*) from pg_prepared_xacts) as prepared_transactions
)
select to_jsonb(s)||jsonb_build_object(
 'stage4Installed',coalesce(executor='postgres' and read_only
  and fingerprint='2b059ccdb6cfcc12bf8fe45e502c166c'
  and marker='business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-4'
  and catalog_rows=100
  and private_tables=array['accounts','attempts','device_keys','events','grants','owner_seats','sessions']
  and private_tables_empty and business_auth_sessions=0 and unfenced_authenticated_tables=0
  and private_table_access=0 and private_function_access=0 and private_schema_access=0
  and not target_function_absent and stage4_journal_rows=1
  and (select count(*) from supabase_migrations.schema_migrations
       where name like 'qa_business_auth_04_%' and cardinality(statements)=1
        and octet_length(statements[1])=7894
        and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='ba49c5c8b8545952288ac1885bcf3421d4b42bb21c054d87391b891ed7edb749')=1
  and exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
       where p.oid=to_regprocedure('business_auth.triniti_business_signin_check(text,text,text,text,text)')
        and md5(p.prosrc)='a0f0447f063dab4696fb868abe556bff'
        and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text='{postgres=X/postgres}'
        and p.prosecdef and p.provolatile='v' and p.proconfig=array['search_path=""']
        and l.lanname='plpgsql' and p.prorettype='jsonb'::regtype
        and p.pronargs=5 and not p.proretset and not p.proisstrict)
  and not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace
       and p.proname in('business_session_allowed','business_auth_request_guard','triniti_business_signin_check','triniti_business_owner_access','triniti_business_finish_signin','triniti_business_cancel_signin'))
  and not exists(select 1 from pg_trigger where not tgisinternal and tgname like 'business_auth_%')
  and not exists(select 1 from pg_policy where polname='business_session_required')
  and not exists(select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) c
       where c like 'pgrst.db_pre_request=%' and c<>'pgrst.db_pre_request='),false),
 'quiescentForNextFreshPreflight',function_uniqueness_enforced
  and other_active_or_open_client_transactions=0 and prepared_transactions=0,
 'expectedStage4Fingerprint','2b059ccdb6cfcc12bf8fe45e502c166c',
 'expectedSourceSha256','ba49c5c8b8545952288ac1885bcf3421d4b42bb21c054d87391b891ed7edb749',
 'expectedBodyMd5','a0f0447f063dab4696fb868abe556bff',
 'candidateMigrationJournal',(select coalesce(jsonb_agg(jsonb_build_object(
   'version',version,'name',name,'statementCount',cardinality(statements),
   'queryBytes',octet_length(array_to_string(statements,E'\n')),
   'querySha256',encode(sha256(convert_to(array_to_string(statements,E'\n'),'UTF8')),'hex')) order by version),'[]'::jsonb)
   from supabase_migrations.schema_migrations where name like 'qa_business_auth_04_%'),
 'targetFunction',(select jsonb_build_object('signature',p.oid::regprocedure::text,
   'bodyMd5',md5(p.prosrc),'definitionMd5',md5(pg_get_functiondef(p.oid)),
   'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'securityDefiner',p.prosecdef,
   'configuration',p.proconfig,'language',l.lanname,'volatility',p.provolatile)
   from pg_proc p join pg_language l on l.oid=p.prolang
   where p.oid=to_regprocedure('business_auth.triniti_business_signin_check(text,text,text,text,text)')),
 'scope','Exact private stage-4 installation only. False at the known stage-3 baseline is expected. No Auth issuance, downstream deployment or provider acceptance is inferred.',
 'activityBoundary','Quiescence is reported separately from installed correctness and must be checked freshly before the next supported apply. No future-writer exclusion is claimed.'
) as postflight from state s;
rollback;
