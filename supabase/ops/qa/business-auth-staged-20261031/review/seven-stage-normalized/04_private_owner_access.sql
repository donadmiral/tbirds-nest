-- Reviewed business-auth staged installation 4; source SHA256 66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996.
-- No statement is hidden or encoded. Original destructive classifications are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
set local search_path=pg_catalog;

do $stage_guard$
declare stage_relation record;stage_rows bigint;
begin
 if current_user<>'postgres' then raise exception 'BUSINESS_AUTH_POSTGRES_REQUIRED';end if;
 if obj_description(to_regnamespace('business_auth'),'pg_namespace') is distinct from 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-3' then raise exception 'BUSINESS_AUTH_STAGE_ORDER';end if;
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
) inventory) is distinct from '2b059ccdb6cfcc12bf8fe45e502c166c' then raise exception 'BUSINESS_AUTH_STAGED_CATALOG_DRIFT';end if;
 for stage_relation in select oid::regclass name from pg_class where relnamespace=to_regnamespace('business_auth') and relkind='r' loop
  execute format('select count(*) from %s',stage_relation.name) into stage_rows;
  if stage_rows<>0 then raise exception 'BUSINESS_AUTH_STAGED_DATA_REVIEW: %',stage_relation.name;end if;
 end loop;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','creator_finance','marketplace_ops','storage') and c.relkind='r' and not c.relrowsecurity and has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'BUSINESS_AUTH_UNFENCED_TABLE_REVIEW';end if;
 if exists(select 1 from auth.sessions s join public.profiles p on p.id=s.user_id where p.account_type='business') then raise exception 'BUSINESS_AUTH_EXISTING_SESSIONS_CUTOVER_REQUIRED';end if;
end $stage_guard$;


create function business_auth.triniti_business_owner_access(p_user_id uuid,p_session_id uuid,p_application_id uuid,p_device text,p_proof_hash text,p_label text,p_bootstrap_owner boolean default false,p_business_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare biz uuid;m public.business_access_members%rowtype;d jsonb;g uuid;bootstrap_device boolean;name_value text;
begin
 if (p_application_id is null)=(p_business_id is null) then return jsonb_build_object('allowed',false,'error','ACCESS_REJECTED');end if;
 if p_application_id is not null then
  select j.auth_user_id into biz from admin_ops.provisions j join public.business_applications a on a.id=j.application_id
   where j.application_id=p_application_id and j.kind='business' and j.completed_at is not null and a.status='approved';
 else biz:=p_business_id;end if;
 if biz is null or not business_auth.owner_allowed(p_user_id,p_session_id,biz) then
  return jsonb_build_object('allowed',false,'error','ACTIVE_OWNER_SESSION_REQUIRED');end if;
 perform account_erasure.assert_writable(p_user_id);perform account_erasure.assert_writable(biz);
 perform pg_advisory_xact_lock(hashtextextended('studio-access:'||biz::text,0));
 perform 1 from auth.sessions where id=p_session_id and user_id=p_user_id for share;
 perform 1 from public.business_members where business_id=biz and member_id=p_user_id and role='owner' for share;
 if not business_auth.owner_allowed(p_user_id,p_session_id,biz) then return jsonb_build_object('allowed',false,'error','ACTIVE_OWNER_SESSION_REQUIRED');end if;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=biz and p.account_type='business' and p.deactivated_at is null
  and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())) then
  return jsonb_build_object('allowed',false,'error','BUSINESS_ACCOUNT_UNAVAILABLE');end if;
 if not business_auth.rate_limit('owner:'||p_user_id::text||':'||biz::text,30) then return jsonb_build_object('allowed',false,'error','TRY_LATER');end if;
 select b.* into m from business_auth.owner_seats o join public.business_access_members b on b.id=o.member_id and b.business_id=o.business_id
  where o.business_id=biz and o.user_id=p_user_id for update of b;
 if not found then
  if not coalesce(p_bootstrap_owner,false) then return jsonb_build_object('allowed',false,'error','OWNER_BOOTSTRAP_REQUIRED','requires_owner_bootstrap',true);end if;
  if (select count(*) from public.business_access_members where business_id=biz)>=500 then return jsonb_build_object('allowed',false,'error','MEMBER_LIMIT');end if;
  select left(coalesce(nullif(btrim(full_name),''),'Business owner'),100) into name_value from public.profiles where id=p_user_id;
  insert into public.business_access_members(business_id,display_name,role,code_hash)
   values(biz,name_value,'owner',encode(extensions.digest(extensions.gen_random_bytes(32),'sha256'),'hex')) returning * into m;
  insert into business_auth.owner_seats(business_id,user_id,member_id) values(biz,p_user_id,m.id);
  insert into business_auth.events(business_id,member_id,principal_user_id,action) values(biz,m.id,p_user_id,'owner_seat_created');
 elsif not m.active then return jsonb_build_object('allowed',false,'error','ACCESS_REJECTED');end if;
 select coalesce(p_bootstrap_owner,false) and bootstrapped_at is null into bootstrap_device from business_auth.accounts where business_id=biz for update;
 d:=business_auth.device(biz,p_device,p_proof_hash,p_label,bootstrap_device);
 if not (d->>'allowed')::boolean then return d;end if;
 update business_auth.accounts set bootstrapped_at=coalesce(bootstrapped_at,clock_timestamp()) where business_id=biz;
 insert into business_auth.grants(business_id,member_id,device_id,proof_hash,principal_user_id,principal_session_id)
  values(biz,m.id,(d->>'device_id')::uuid,p_proof_hash,p_user_id,p_session_id) returning id into g;
 return jsonb_build_object('allowed',true,'grant_id',g,'business_id',biz,'member_id',m.id);
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
comment on schema business_auth is 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-4';
commit;
