-- Reviewed business-auth staged installation 2; source SHA256 66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996.
-- No statement is hidden or encoded. Original destructive classifications are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
set local search_path=pg_catalog;

do $stage_guard$
declare stage_relation record;stage_rows bigint;
begin
 if current_user<>'postgres' then raise exception 'BUSINESS_AUTH_POSTGRES_REQUIRED';end if;
 if obj_description(to_regnamespace('business_auth'),'pg_namespace') is distinct from 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-1' then raise exception 'BUSINESS_AUTH_STAGE_ORDER';end if;
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
) inventory) is distinct from '19066ba1115e91e5c52b9ba6d0055641' then raise exception 'BUSINESS_AUTH_STAGED_CATALOG_DRIFT';end if;
 for stage_relation in select oid::regclass name from pg_class where relnamespace=to_regnamespace('business_auth') and relkind='r' loop
  execute format('select count(*) from %s',stage_relation.name) into stage_rows;
  if stage_rows<>0 then raise exception 'BUSINESS_AUTH_STAGED_DATA_REVIEW: %',stage_relation.name;end if;
 end loop;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','creator_finance','marketplace_ops','storage') and c.relkind='r' and not c.relrowsecurity and has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'BUSINESS_AUTH_UNFENCED_TABLE_REVIEW';end if;
 if exists(select 1 from auth.sessions s join public.profiles p on p.id=s.user_id where p.account_type='business') then raise exception 'BUSINESS_AUTH_EXISTING_SESSIONS_CUTOVER_REQUIRED';end if;
end $stage_guard$;


create function business_auth.owner_allowed(p_user uuid,p_session uuid,p_business uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  join public.profiles p on p.id=u.id join public.business_members m on m.member_id=p.id and m.business_id=p_business and m.role='owner'
  where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after>now())
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
   and p.deactivated_at is null and p.account_type<>'business'
   and not exists(select 1 from admin_ops.staff_social_shells where user_id=p_user)
   and not exists(select 1 from account_erasure.jobs where user_id=p_user and state<>'completed'));
$$;
create function business_auth.session_allowed(p_user uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from business_auth.sessions b
  join auth.sessions s on s.id=b.session_id and s.user_id=b.business_id
  join auth.users u on u.id=b.business_id
  join public.profiles p on p.id=b.business_id and p.account_type='business' and p.deactivated_at is null
  join public.business_access_members m on m.id=b.member_id and m.business_id=b.business_id and m.active
  join public.business_devices d on d.id=b.device_id and d.business_id=b.business_id and d.status='approved'
  join business_auth.device_keys k on k.device_id=d.id and k.revoked_at is null
  join public.studio_session_members sm on sm.session_id=s.id::text and sm.business_id=b.business_id and sm.member_id=m.id
  where b.session_id=p_session and b.business_id=p_user and b.expires_at>now()
   and (s.not_after is null or s.not_after>now()) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
   and (b.credential_hash is null or upper(b.credential_hash)=upper(m.code_hash))
   and (b.principal_user_id is null or business_auth.owner_allowed(b.principal_user_id,b.principal_session_id,b.business_id))
   and not exists(select 1 from account_erasure.jobs where user_id=b.business_id and state<>'completed'));
$$;
create function business_auth.business_session_allowed() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;
begin
 if uid is null then return true;end if;
 if not exists(select 1 from business_auth.accounts where business_id=uid)
  and not exists(select 1 from public.profiles where id=uid and account_type='business') then return true;end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when others then return false;end;
 return business_auth.session_allowed(uid,sid);
end $$;
create function business_auth.business_auth_request_guard() returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.business_session_allowed() then
  raise exception 'BUSINESS_SESSION_REQUIRED: Sign in again through business access.' using errcode='42501';end if;
end $$;

create function business_auth.register_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.account_type='business' then insert into business_auth.accounts(business_id) values(new.id) on conflict do nothing;end if;
 return new;
end $$;

create function business_auth.rate_limit(p_scope text,p_limit integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;h text:=encode(extensions.digest(p_scope,'sha256'),'hex');
begin
 insert into business_auth.attempts(scope_hash,window_at,attempts) values(h,clock_timestamp(),1)
 on conflict(scope_hash) do update set
  window_at=case when business_auth.attempts.window_at<clock_timestamp()-interval '10 minutes' then clock_timestamp() else business_auth.attempts.window_at end,
  attempts=case when business_auth.attempts.window_at<clock_timestamp()-interval '10 minutes' then 1 else least(business_auth.attempts.attempts+1,10000) end
 returning attempts into n;
 return n<=p_limit;
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
comment on schema business_auth is 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-2';
commit;
