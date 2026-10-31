-- Reviewed business-auth staged installation 7; source SHA256 66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996.
-- No statement is hidden or encoded. Original destructive classifications are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
set local search_path=pg_catalog;

do $stage_guard$
declare stage_relation record;stage_rows bigint;
begin
 if current_user<>'postgres' then raise exception 'BUSINESS_AUTH_POSTGRES_REQUIRED';end if;
 if obj_description(to_regnamespace('business_auth'),'pg_namespace') is distinct from 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-6' then raise exception 'BUSINESS_AUTH_STAGE_ORDER';end if;
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
) inventory) is distinct from '1eb5ad671173842667ced9e052f232bd' then raise exception 'BUSINESS_AUTH_STAGED_CATALOG_DRIFT';end if;
 for stage_relation in select oid::regclass name from pg_class where relnamespace=to_regnamespace('business_auth') and relkind='r' loop
  execute format('select count(*) from %s',stage_relation.name) into stage_rows;
  if stage_rows<>0 then raise exception 'BUSINESS_AUTH_STAGED_DATA_REVIEW: %',stage_relation.name;end if;
 end loop;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','creator_finance','marketplace_ops','storage') and c.relkind='r' and not c.relrowsecurity and has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'BUSINESS_AUTH_UNFENCED_TABLE_REVIEW';end if;
 if exists(select 1 from auth.sessions s join public.profiles p on p.id=s.user_id where p.account_type='business') then raise exception 'BUSINESS_AUTH_EXISTING_SESSIONS_CUTOVER_REQUIRED';end if;
end $stage_guard$;


create function business_auth.triniti_business_cancel_signin(p_grant_id uuid,p_business_id uuid,p_session_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare g business_auth.grants%rowtype;
begin
 select * into g from business_auth.grants where id=p_grant_id and business_id=p_business_id for update;
 if not found then return false;end if;
 if exists(select 1 from auth.sessions where id=p_session_id and user_id=g.business_id and created_at>=g.created_at-interval '2 seconds')
  and not exists(select 1 from business_auth.sessions where session_id=p_session_id and (member_id<>g.member_id or device_id<>g.device_id)) then
  delete from auth.sessions where id=p_session_id and user_id=g.business_id;
  insert into business_auth.events(business_id,member_id,device_id,action) values(g.business_id,g.member_id,g.device_id,'failed_signin_revoked');
 end if;
 update business_auth.grants set expires_at=least(expires_at,clock_timestamp()) where id=g.id;
 return true;
end $$;

create function business_auth.revoke_member_sessions() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' or not new.active or new.code_hash is distinct from old.code_hash then
  delete from auth.sessions where id in(select session_id from business_auth.sessions where member_id=old.id);
  update business_auth.grants set expires_at=least(expires_at,clock_timestamp()) where member_id=old.id;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create function business_auth.revoke_device_sessions() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' or new.status<>'approved' then
  delete from auth.sessions where id in(select session_id from business_auth.sessions where device_id=old.id);
  update business_auth.grants set expires_at=least(expires_at,clock_timestamp()) where device_id=old.id;
  update business_auth.device_keys set revoked_at=coalesce(revoked_at,clock_timestamp()) where device_id=old.id;
 else update business_auth.device_keys set revoked_at=null where device_id=old.id;end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create function business_auth.revoke_owner_sessions() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.role='owner' and (tg_op='DELETE' or new.role<>'owner' or new.business_id<>old.business_id or new.member_id<>old.member_id) then
  delete from auth.sessions where id in(select session_id from business_auth.sessions where business_id=old.business_id and principal_user_id=old.member_id);
  update public.business_access_members set active=false where id in(select member_id from business_auth.owner_seats where business_id=old.business_id and user_id=old.member_id);
  update business_auth.grants set expires_at=least(expires_at,clock_timestamp()) where business_id=old.business_id and principal_user_id=old.member_id;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create function business_auth.cleanup_session() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 delete from auth.sessions where id in(select session_id from business_auth.sessions where principal_session_id=old.id and session_id<>old.id);
 delete from public.studio_session_members where session_id=old.id::text;
 return old;
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
comment on schema business_auth is 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-7';
commit;
