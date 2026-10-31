-- Reviewed business-auth staged installation 1; source SHA256 66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996.
-- No statement is hidden or encoded. Original destructive classifications are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
set local search_path=pg_catalog;


do $preflight$
declare f record;
begin
 if current_user<>'postgres' then raise exception 'BUSINESS_AUTH_POSTGRES_REQUIRED';end if;
 if to_regnamespace('business_auth') is not null then raise exception 'BUSINESS_AUTH_TARGET_EXISTS';end if;
 if exists(select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) c
  where c like 'pgrst.db_pre_request=%' and c<>'pgrst.db_pre_request=') then
  raise exception 'BUSINESS_AUTH_EXISTING_REQUEST_HOOK_REVIEW';end if;
 for f in select * from (values
  ('studio_workflow.context(uuid)','88f2b41f172b80b323ad1b20fdf983db','{postgres=X/postgres}'),
  ('public.studio_role()','955f1c432cc78baa8af374a1b7764c1b','{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.studio_bind_member(text)','725e31f7b81626e606a75618c87c969b','{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.studio_set_device(uuid,text)','47239a4b49b3408379d3314fda0a089a','{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.resolve_media_delivery(text,text,text)','c0f3550b138e1e1476a345f7094fbed7','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)','69d07d257bb8a9c59ae27d7a4e8e79cd','{postgres=X/postgres,service_role=X/postgres}')
 ) expected(signature,hash,acl)
 loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(f.signature)
   and md5(pg_get_functiondef(p.oid))=f.hash and p.proacl::text=f.acl and pg_get_userbyid(p.proowner)='postgres') then
   raise exception 'BUSINESS_AUTH_BASELINE_DRIFT: %',f.signature;end if;
 end loop;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in('public','creator_finance','marketplace_ops','storage') and c.relkind='r'
   and not c.relrowsecurity and has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) then
  raise exception 'BUSINESS_AUTH_UNFENCED_TABLE_REVIEW';end if;
 -- Old issued sessions need an intentional client cutover; never silently
 -- invalidate an installed business client as a side effect of installation.
 if exists(select 1 from auth.sessions s join public.profiles p on p.id=s.user_id where p.account_type='business') then
  raise exception 'BUSINESS_AUTH_EXISTING_SESSIONS_CUTOVER_REQUIRED';end if;
end $preflight$;

create schema business_auth;
revoke all on schema business_auth from public,anon,authenticated,service_role;
create table business_auth.accounts (
 business_id uuid primary key,
 created_at timestamptz not null default clock_timestamp(),
 bootstrapped_at timestamptz
);
create table business_auth.owner_seats (
 business_id uuid not null references business_auth.accounts(business_id),
 user_id uuid not null references public.profiles(id) on delete cascade,
 member_id uuid not null unique references public.business_access_members(id) on delete cascade,
 primary key(business_id,user_id)
);
create table business_auth.device_keys (
 device_id uuid primary key references public.business_devices(id) on delete cascade,
 proof_hash text not null check(proof_hash ~ '^[0-9a-f]{64}$'),
 revoked_at timestamptz,
 created_at timestamptz not null default clock_timestamp()
);
create table business_auth.grants (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references business_auth.accounts(business_id),
 member_id uuid not null references public.business_access_members(id) on delete cascade,
 device_id uuid not null references public.business_devices(id) on delete cascade,
 proof_hash text not null,
 credential_hash text,
 principal_user_id uuid,
 principal_session_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '2 minutes',
 consumed_session_id uuid,
 consumed_at timestamptz,
 check((principal_user_id is null)=(principal_session_id is null))
);
create index business_grants_expiry on business_auth.grants(expires_at);
create table business_auth.sessions (
 session_id uuid primary key references auth.sessions(id) on delete cascade,
 business_id uuid not null references business_auth.accounts(business_id),
 member_id uuid not null references public.business_access_members(id) on delete cascade,
 device_id uuid not null references public.business_devices(id) on delete cascade,
 credential_hash text,
 principal_user_id uuid,
 principal_session_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 check((principal_user_id is null)=(principal_session_id is null))
);
create index business_sessions_member on business_auth.sessions(member_id);
create index business_sessions_device on business_auth.sessions(device_id);
create index business_sessions_principal on business_auth.sessions(principal_session_id);
create index business_sessions_business on business_auth.sessions(business_id);
create table business_auth.attempts (
 scope_hash text primary key,
 window_at timestamptz not null,
 attempts integer not null check(attempts>0)
);
create table business_auth.events (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 member_id uuid,
 device_id uuid,
 principal_user_id uuid,
 action text not null,
 created_at timestamptz not null default clock_timestamp()
);
create index business_auth_events_business on business_auth.events(business_id,created_at desc,id);
do $private$
declare t record;
begin
 for t in select oid::regclass name from pg_class where relnamespace='business_auth'::regnamespace and relkind='r'
 loop
  execute format('alter table %s enable row level security',t.name);
  execute format('revoke all on %s from public,anon,authenticated,service_role',t.name);
 end loop;
end $private$;
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
comment on schema business_auth is 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-1';
commit;

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
) inventory) is distinct from '2f92a9d038364736fa2413bb6d05a160' then raise exception 'BUSINESS_AUTH_STAGED_CATALOG_DRIFT';end if;
 for stage_relation in select oid::regclass name from pg_class where relnamespace=to_regnamespace('business_auth') and relkind='r' loop
  execute format('select count(*) from %s',stage_relation.name) into stage_rows;
  if stage_rows<>0 then raise exception 'BUSINESS_AUTH_STAGED_DATA_REVIEW: %',stage_relation.name;end if;
 end loop;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','creator_finance','marketplace_ops','storage') and c.relkind='r' and not c.relrowsecurity and has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'BUSINESS_AUTH_UNFENCED_TABLE_REVIEW';end if;
 if exists(select 1 from auth.sessions s join public.profiles p on p.id=s.user_id where p.account_type='business') then raise exception 'BUSINESS_AUTH_EXISTING_SESSIONS_CUTOVER_REQUIRED';end if;
end $stage_guard$;


create function business_auth.triniti_business_signin_check(p_handle text,p_code_hash text,p_device text,p_proof_hash text,p_label text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare biz uuid;m public.business_access_members%rowtype;d jsonb;g uuid;h text:=lower(btrim(p_handle));
begin
 if h is null or h !~ '^[a-z0-9_]{3,32}$' or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$'
  or length(coalesce(p_device,''))>100 then return jsonb_build_object('allowed',false,'error','ACCESS_REJECTED');end if;
 delete from business_auth.attempts where window_at<clock_timestamp()-interval '1 day';
 delete from business_auth.grants where expires_at<clock_timestamp()-interval '1 day';
 if not business_auth.rate_limit('business:'||h,100) or not business_auth.rate_limit('device:'||h||':'||coalesce(p_device,''),12) then
  return jsonb_build_object('allowed',false,'error','TRY_LATER');end if;
 select p.id into biz from public.profiles p join auth.users u on u.id=p.id
  where lower(p.username)=h and p.account_type='business' and p.deactivated_at is null and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp());
 if biz is null then return jsonb_build_object('allowed',false,'error','ACCESS_REJECTED');end if;
 perform account_erasure.assert_writable(biz);
 perform pg_advisory_xact_lock(hashtextextended('studio-access:'||biz::text,0));
 select * into m from public.business_access_members where business_id=biz and active and upper(code_hash)=upper(p_code_hash) for update;
 if not found then return jsonb_build_object('allowed',false,'error','ACCESS_REJECTED');end if;
 -- Personal-owner seats only open through that owner's verified personal Auth
 -- session. Their internal random code is never a second reusable credential.
 if exists(select 1 from business_auth.owner_seats where member_id=m.id) then return jsonb_build_object('allowed',false,'error','OWNER_SIGNIN_REQUIRED');end if;
 d:=business_auth.device(biz,p_device,p_proof_hash,p_label,false);
 if not (d->>'allowed')::boolean then return d;end if;
 insert into business_auth.grants(business_id,member_id,device_id,proof_hash,credential_hash)
  values(biz,m.id,(d->>'device_id')::uuid,p_proof_hash,m.code_hash) returning id into g;
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
comment on schema business_auth is 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-5';
commit;

-- Reviewed business-auth staged installation 6; source SHA256 66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996.
-- No statement is hidden or encoded. Original destructive classifications are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
set local search_path=pg_catalog;

do $stage_guard$
declare stage_relation record;stage_rows bigint;
begin
 if current_user<>'postgres' then raise exception 'BUSINESS_AUTH_POSTGRES_REQUIRED';end if;
 if obj_description(to_regnamespace('business_auth'),'pg_namespace') is distinct from 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-5' then raise exception 'BUSINESS_AUTH_STAGE_ORDER';end if;
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
comment on schema business_auth is 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-6';
commit;

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

-- Reviewed business-auth staged installation 8; source SHA256 66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996.
-- No statement is hidden or encoded. Original destructive classifications are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
set local search_path=pg_catalog;
lock table public.profiles,auth.sessions in share row exclusive mode;

do $stage_guard$
declare stage_relation record;stage_rows bigint;
begin
 if current_user<>'postgres' then raise exception 'BUSINESS_AUTH_POSTGRES_REQUIRED';end if;
 if obj_description(to_regnamespace('business_auth'),'pg_namespace') is distinct from 'business-auth:66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996:stage-7' then raise exception 'BUSINESS_AUTH_STAGE_ORDER';end if;
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
) inventory) is distinct from '070a20dc374c50741b19573e21822048' then raise exception 'BUSINESS_AUTH_STAGED_CATALOG_DRIFT';end if;
 for stage_relation in select oid::regclass name from pg_class where relnamespace=to_regnamespace('business_auth') and relkind='r' loop
  execute format('select count(*) from %s',stage_relation.name) into stage_rows;
  if stage_rows<>0 then raise exception 'BUSINESS_AUTH_STAGED_DATA_REVIEW: %',stage_relation.name;end if;
 end loop;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','creator_finance','marketplace_ops','storage') and c.relkind='r' and not c.relrowsecurity and has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'BUSINESS_AUTH_UNFENCED_TABLE_REVIEW';end if;
 if exists(select 1 from auth.sessions s join public.profiles p on p.id=s.user_id where p.account_type='business') then raise exception 'BUSINESS_AUTH_EXISTING_SESSIONS_CUTOVER_REQUIRED';end if;
end $stage_guard$;
alter function business_auth.business_session_allowed() set schema public;
alter function business_auth.business_auth_request_guard() set schema public;
alter function business_auth.triniti_business_signin_check(text,text,text,text,text) set schema public;
alter function business_auth.triniti_business_owner_access(uuid,uuid,uuid,text,text,text,boolean,uuid) set schema public;
alter function business_auth.triniti_business_finish_signin(uuid,uuid,uuid,text) set schema public;
alter function business_auth.triniti_business_cancel_signin(uuid,uuid,uuid) set schema public;
create trigger business_auth_register_account after insert or update of account_type on public.profiles
 for each row execute function business_auth.register_account();
create trigger business_auth_revoke_member before delete or update of active,code_hash on public.business_access_members
 for each row execute function business_auth.revoke_member_sessions();
create trigger business_auth_revoke_device before delete or update of status on public.business_devices
 for each row execute function business_auth.revoke_device_sessions();
create trigger business_auth_revoke_owner before delete or update on public.business_members
 for each row execute function business_auth.revoke_owner_sessions();
create trigger business_auth_cleanup_session before delete on auth.sessions for each row execute function business_auth.cleanup_session();
-- Retain an internal UUID marker if a profile is later removed or reclassified:
-- a previously issued business JWT must not become an ordinary personal JWT.
insert into business_auth.accounts(business_id) select id from public.profiles where account_type='business';

-- Every request and non-Data-API RLS read must check the same authoritative
-- binding. Personal/anonymous/staff behavior returns true unchanged.
revoke all on function public.business_session_allowed(),public.business_auth_request_guard() from public,anon,authenticated,service_role;
grant execute on function public.business_session_allowed(),public.business_auth_request_guard() to anon,authenticated,service_role;
do $rls$
declare t record;
begin
 for t in select c.oid::regclass name from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and c.relrowsecurity and (n.nspname in('public','creator_finance','marketplace_ops','storage') or (n.nspname='realtime' and c.relname='messages'))
 loop
  execute format('create policy business_session_required on %s as restrictive for all to authenticated using ((select public.business_session_allowed())) with check ((select public.business_session_allowed()))',t.name);
 end loop;
end $rls$;
alter role authenticator set pgrst.db_pre_request='public.business_auth_request_guard';

do $existing_functions$
declare source text;anchor text;
begin
 source:=pg_get_functiondef('studio_workflow.context(uuid)'::regprocedure);
 anchor:=' perform account_erasure.assert_writable(a.user_id);';
 if position(anchor in source)=0 then raise exception 'BUSINESS_AUTH_CONTEXT_ANCHOR';end if;
 source:=replace(source,anchor,E' if not public.business_session_allowed() then raise exception \'WORKFLOW_ACTIVE_SESSION_REQUIRED\' using errcode=\'42501\';end if;\n'||anchor);
 execute source;
 source:=pg_get_functiondef('public.studio_role()'::regprocedure);
 anchor:=' if uid is null or coalesce(auth.jwt()->>''is_anonymous'',''false'')<>''false'' then return null;end if;';
 if position(anchor in source)=0 then raise exception 'BUSINESS_AUTH_ROLE_ANCHOR';end if;
 source:=replace(source,anchor,anchor||E'\n if not public.business_session_allowed() then return null;end if;');execute source;
 source:=pg_get_functiondef('public.studio_set_device(uuid,text)'::regprocedure);
 anchor:='declare a studio_workflow.actor:=studio_workflow.context();d public.business_devices%rowtype;';
 if position(anchor in source)=0 then raise exception 'BUSINESS_AUTH_DEVICE_LOCK_ANCHOR';end if;
 source:=replace(source,anchor,'declare a studio_workflow.actor;d public.business_devices%rowtype;');
 source:=replace(source,E'begin\n perform studio_workflow.require_roles',E'begin\n if auth.uid() is null then raise exception \'WORKFLOW_ACTIVE_SESSION_REQUIRED\' using errcode=\'42501\';end if;\n perform account_erasure.assert_writable(auth.uid());\n perform pg_advisory_xact_lock(hashtextextended(\'studio-access:\'||auth.uid()::text,0));\n a:=studio_workflow.context();\n perform studio_workflow.require_roles');
 execute source;
 source:=pg_get_functiondef('public.resolve_media_delivery(text,text,text)'::regprocedure);
 anchor:=' if not coalesce(allowed,false) then return null;end if;';
 if position(anchor in source)=0 then raise exception 'BUSINESS_AUTH_MEDIA_RESOLVER_ANCHOR';end if;
 source:=replace(source,anchor,' if not coalesce(allowed,false) or (exists(select 1 from business_auth.accounts where business_id=g.user_id) and not business_auth.session_allowed(g.user_id,g.session_id)) then return null;end if;');
 execute source;
 source:=pg_get_functiondef('public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)'::regprocedure);
 anchor:='  update auth.users set banned_until=''infinity'',updated_at=now() where id=j.auth_user_id;';
 if position(anchor in source)=0 then raise exception 'BUSINESS_AUTH_PROVISION_ANCHOR';end if;
 source:=replace(source,anchor,'  -- The random-password, non-deliverable business identity opens only through a bound member/device session. Existing banned identities are never enabled here.');
 execute source;
end $existing_functions$;

create or replace function public.studio_bind_member(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a studio_workflow.actor:=studio_workflow.context();m public.business_access_members%rowtype;
begin
 if not a.is_business or a.member_id is null or length(coalesce(p_code,'')) not between 4 and 200 then
  raise exception 'BUSINESS_SIGNIN_REQUIRED' using errcode='42501';end if;
 select * into m from public.business_access_members where id=a.member_id and business_id=a.user_id and active
  and upper(code_hash)=upper(encode(extensions.digest(upper(btrim(p_code)),'sha256'),'hex'));
 if not found then raise exception 'BUSINESS_SEAT_SWITCH_REQUIRES_SIGNIN' using errcode='42501';end if;
 return jsonb_build_object('member_id',m.id,'role',m.role,'display_name',m.display_name);
end $$;
revoke all on all functions in schema business_auth from public,anon,authenticated,service_role;
do $service_grants$
declare f record;
begin
 for f in select p.oid::regprocedure name from pg_proc p where p.pronamespace='public'::regnamespace
  and p.proname in('triniti_business_signin_check','triniti_business_owner_access','triniti_business_finish_signin','triniti_business_cancel_signin')
 loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.name);
  execute format('grant execute on function %s to service_role',f.name);
 end loop;
end $service_grants$;
notify pgrst,'reload schema';
notify pgrst,'reload config';
comment on schema business_auth is null;

commit;
