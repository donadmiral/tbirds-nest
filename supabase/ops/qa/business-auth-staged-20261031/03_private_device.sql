-- Reviewed business-auth staged installation 3; source SHA256 66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996.
-- No statement is hidden or encoded. Original destructive classifications are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
set local search_path=pg_catalog;

do $stage_guard$
declare stage_relation record;stage_rows bigint;
begin
 if current_user<>'postgres' then raise exception 'BUSINESS_AUTH_POSTGRES_REQUIRED';end if;
 if obj_description(to_regnamespace('business_auth'),'pg_namespace') is distinct from 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-2' then raise exception 'BUSINESS_AUTH_STAGE_ORDER';end if;
 if (select md5(coalesce(jsonb_agg(jsonb_build_array(k,n,v) order by k,n)::text,'[]')) from (
select 'schema' k,nspname::text n,jsonb_build_array(pg_get_userbyid(nspowner),nspacl::text) v from pg_namespace where nspname='business_auth'
union all select 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',jsonb_build_array(pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),p.proacl::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='business_auth' or (n.nspname,p.proname) in (('studio_workflow','context'),('public','studio_role'),('public','studio_bind_member'),('public','studio_set_device'),('public','resolve_media_delivery'),('public','triniti_admin_provision'),('public','business_session_allowed'),('public','business_auth_request_guard'),('public','triniti_business_signin_check'),('public','triniti_business_owner_access'),('public','triniti_business_finish_signin'),('public','triniti_business_cancel_signin'))
union all select 'relation',c.relname,jsonb_build_array(c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner),c.relacl::text) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='business_auth' and c.relkind in('r','p','v','m','f','S')
union all select 'column',c.relname||'.'||a.attnum::text,jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname='business_auth' and c.relkind in('r','p') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.relname||'.'||t.conname,to_jsonb(pg_get_constraintdef(t.oid)) from pg_constraint t join pg_class c on c.oid=t.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='business_auth' and t.contype<>'n'
union all select 'index',c.relname,to_jsonb(pg_get_indexdef(c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='business_auth' and c.relkind in('i','I')
union all select 'trigger',t.tgrelid::regclass::text||'.'||t.tgname,jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled) from pg_trigger t where not t.tgisinternal and t.tgname like 'business_auth_%'
union all select 'policy',p.polrelid::regclass::text||'.'||p.polname,jsonb_build_array(p.polpermissive,p.polcmd,(select jsonb_agg(r.rolname order by r.rolname) from pg_roles r where r.oid=any(p.polroles)),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) from pg_policy p where p.polname='business_session_required' or p.polrelid in(select oid from pg_class where relnamespace=to_regnamespace('business_auth'))
union all select 'hook',coalesce(r.rolname,'ALL')||':'||coalesce(d.datname,'ALL'),to_jsonb(c) from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole left join pg_database d on d.oid=s.setdatabase cross join lateral unnest(s.setconfig) c where c like 'pgrst.db_pre_request=%' and c<>'pgrst.db_pre_request='
) inventory) is distinct from '756c75d5c5ce2659a65ee4632d4edab4' then raise exception 'BUSINESS_AUTH_STAGED_CATALOG_DRIFT';end if;
 for stage_relation in select oid::regclass name from pg_class where relnamespace=to_regnamespace('business_auth') and relkind='r' loop
  execute format('select count(*) from %s',stage_relation.name) into stage_rows;
  if stage_rows<>0 then raise exception 'BUSINESS_AUTH_STAGED_DATA_REVIEW: %',stage_relation.name;end if;
 end loop;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','creator_finance','marketplace_ops','storage') and c.relkind='r' and not c.relrowsecurity and has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'BUSINESS_AUTH_UNFENCED_TABLE_REVIEW';end if;
 if exists(select 1 from auth.sessions s join public.profiles p on p.id=s.user_id where p.account_type='business') then raise exception 'BUSINESS_AUTH_EXISTING_SESSIONS_CUTOVER_REQUIRED';end if;
end $stage_guard$;


create function business_auth.device(p_business uuid,p_device text,p_proof text,p_label text,p_bootstrap boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.business_devices%rowtype;k business_auth.device_keys%rowtype;
begin
 if p_device is null or p_device !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or p_proof is null or p_proof !~ '^[0-9a-f]{64}$' or length(coalesce(p_label,''))>100 then
  return jsonb_build_object('allowed',false,'error','ACCESS_REJECTED');end if;
 select * into d from public.business_devices where business_id=p_business and device_id=p_device for update;
 if found then
  select * into k from business_auth.device_keys where device_id=d.id;
  -- A legacy registration or changed browser secret requires explicit review;
  -- knowledge of a device ID is never enough to take over that registration.
  if k.device_id is null or k.proof_hash<>p_proof then return jsonb_build_object('allowed',false,'error','ACCESS_REJECTED');end if;
  if k.revoked_at is not null then return jsonb_build_object('allowed',false,'error','DEVICE_BLOCKED');end if;
  if d.status<>'approved' then return jsonb_build_object('allowed',false,'error','DEVICE_APPROVAL_REQUIRED');end if;
 else
  if (select count(*) from public.business_devices where business_id=p_business)>=200 then return jsonb_build_object('allowed',false,'error','DEVICE_LIMIT');end if;
  insert into public.business_devices(business_id,device_id,label,status,approved_at)
   values(p_business,p_device,nullif(btrim(p_label),''),case when p_bootstrap then 'approved' else 'pending' end,case when p_bootstrap then clock_timestamp() end)
   returning * into d;
  insert into business_auth.device_keys(device_id,proof_hash) values(d.id,p_proof);
  insert into business_auth.events(business_id,device_id,action) values(p_business,d.id,case when p_bootstrap then 'owner_device_bootstrapped' else 'device_approval_requested' end);
  if not p_bootstrap then return jsonb_build_object('allowed',false,'error','DEVICE_APPROVAL_REQUIRED');end if;
 end if;
 return jsonb_build_object('allowed',true,'device_id',d.id);
end $$;
do $private_stage$
declare t record;
begin
 for t in select oid::regclass name from pg_class where relnamespace='business_auth'::regnamespace and relkind='r' loop
  execute format('alter table %s enable row level security',t.name);
  execute format('revoke all on %s from public,anon,authenticated,service_role',t.name);
 end loop;
end $private_stage$;
revoke all on schema business_auth from public,anon,authenticated,service_role;
revoke all on all functions in schema business_auth from public,anon,authenticated,service_role;
comment on schema business_auth is 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-3';
commit;
