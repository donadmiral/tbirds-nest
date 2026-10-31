-- Reviewed business-auth staged installation 5; source SHA256 66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996.
-- No statement is hidden or encoded. Original destructive classifications are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
set local search_path=pg_catalog;

do $stage_guard$
declare stage_relation record;stage_rows bigint;
begin
 if current_user<>'postgres' then raise exception 'BUSINESS_AUTH_POSTGRES_REQUIRED';end if;
 if obj_description(to_regnamespace('business_auth'),'pg_namespace') is distinct from 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-4' then raise exception 'BUSINESS_AUTH_STAGE_ORDER';end if;
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
) inventory) is distinct from '3718506a7cf16a513514502dbf370f89' then raise exception 'BUSINESS_AUTH_STAGED_CATALOG_DRIFT';end if;
 for stage_relation in select oid::regclass name from pg_class where relnamespace=to_regnamespace('business_auth') and relkind='r' loop
  execute format('select count(*) from %s',stage_relation.name) into stage_rows;
  if stage_rows<>0 then raise exception 'BUSINESS_AUTH_STAGED_DATA_REVIEW: %',stage_relation.name;end if;
 end loop;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','creator_finance','marketplace_ops','storage') and c.relkind='r' and not c.relrowsecurity and has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'BUSINESS_AUTH_UNFENCED_TABLE_REVIEW';end if;
 if exists(select 1 from auth.sessions s join public.profiles p on p.id=s.user_id where p.account_type='business') then raise exception 'BUSINESS_AUTH_EXISTING_SESSIONS_CUTOVER_REQUIRED';end if;
end $stage_guard$;


create function business_auth.triniti_business_finish_signin(p_grant_id uuid,p_business_id uuid,p_session_id uuid,p_proof_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g business_auth.grants%rowtype;m public.business_access_members%rowtype;expires timestamptz;created timestamptz;
begin
 select * into g from business_auth.grants where id=p_grant_id;
 if not found or g.business_id<>p_business_id or g.proof_hash is distinct from p_proof_hash then raise exception 'BUSINESS_GRANT_REJECTED' using errcode='42501';end if;
 perform account_erasure.assert_writable(g.business_id);
 perform pg_advisory_xact_lock(hashtextextended('studio-access:'||g.business_id::text,0));
 select * into g from business_auth.grants where id=p_grant_id for update;
 if g.expires_at<=clock_timestamp() or (g.consumed_session_id is not null and g.consumed_session_id<>p_session_id) then raise exception 'BUSINESS_GRANT_EXPIRED' using errcode='42501';end if;
 if not exists(select 1 from auth.users u join public.profiles p on p.id=u.id where u.id=g.business_id and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=clock_timestamp()) and p.account_type='business' and p.deactivated_at is null) then raise exception 'BUSINESS_ACCOUNT_UNAVAILABLE' using errcode='42501';end if;
 select * into m from public.business_access_members where id=g.member_id and business_id=g.business_id and active for update;
 if not found or (g.credential_hash is not null and upper(g.credential_hash)<>upper(m.code_hash)) then raise exception 'BUSINESS_MEMBER_REVOKED' using errcode='42501';end if;
 if not exists(select 1 from public.business_devices d join business_auth.device_keys k on k.device_id=d.id where d.id=g.device_id
  and d.business_id=g.business_id and d.status='approved' and k.revoked_at is null and k.proof_hash=g.proof_hash for share of d,k) then raise exception 'BUSINESS_DEVICE_REVOKED' using errcode='42501';end if;
 if g.principal_user_id is not null then
  perform 1 from auth.sessions where id=g.principal_session_id and user_id=g.principal_user_id for share;
  perform 1 from public.business_members where business_id=g.business_id and member_id=g.principal_user_id and role='owner' for share;
  if not business_auth.owner_allowed(g.principal_user_id,g.principal_session_id,g.business_id) then raise exception 'BUSINESS_OWNER_REVOKED' using errcode='42501';end if;
 end if;
 select created_at,least(coalesce(not_after,'infinity'::timestamptz),clock_timestamp()+interval '24 hours') into created,expires
  from auth.sessions where id=p_session_id and user_id=g.business_id for update;
 if not found or created is null or created<g.created_at-interval '2 seconds' or expires<=clock_timestamp() then raise exception 'BUSINESS_SESSION_MISMATCH' using errcode='42501';end if;
 if g.principal_user_id is not null then select least(expires,coalesce(not_after,'infinity'::timestamptz)) into expires from auth.sessions where id=g.principal_session_id;end if;
 if exists(select 1 from business_auth.sessions where session_id=p_session_id and (business_id<>g.business_id or member_id<>g.member_id or device_id<>g.device_id)) then raise exception 'BUSINESS_SESSION_MISMATCH' using errcode='42501';end if;
 insert into business_auth.sessions(session_id,business_id,member_id,device_id,credential_hash,principal_user_id,principal_session_id,expires_at)
  values(p_session_id,g.business_id,g.member_id,g.device_id,g.credential_hash,g.principal_user_id,g.principal_session_id,expires)
  on conflict(session_id) do nothing;
 insert into public.studio_session_members(session_id,business_id,member_id) values(p_session_id::text,g.business_id,g.member_id)
  on conflict(session_id) do update set business_id=excluded.business_id,member_id=excluded.member_id,bound_at=clock_timestamp();
 update auth.sessions set not_after=least(coalesce(not_after,'infinity'::timestamptz),expires) where id=p_session_id;
 if g.consumed_at is null then
  update public.business_access_members set last_sign_in_at=clock_timestamp() where id=m.id;
  insert into public.business_signin_log(business_id,member_id,member_name,device_id)
   select g.business_id,m.id,m.display_name,device_id from public.business_devices where id=g.device_id;
  insert into business_auth.events(business_id,member_id,device_id,principal_user_id,action) values(g.business_id,m.id,g.device_id,g.principal_user_id,'session_bound');
  update business_auth.grants set consumed_session_id=p_session_id,consumed_at=clock_timestamp() where id=g.id;
 end if;
 if not business_auth.session_allowed(g.business_id,p_session_id) then raise exception 'BUSINESS_BINDING_REJECTED' using errcode='42501';end if;
 return jsonb_build_object('success',true,'business_id',g.business_id,'member_id',m.id,'role',m.role,'session_id',p_session_id);
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
comment on schema business_auth is 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-5';
commit;
