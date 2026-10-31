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
