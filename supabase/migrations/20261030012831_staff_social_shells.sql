-- Isolate only future staff reservations. Existing staff, personal accounts,
-- business identities and completed reservations are not backfilled. An older
-- unfinished staff setup must be reviewed before the cutover can proceed.
begin;
set local lock_timeout='3s';

do $preflight$
declare f record; policies_md5 text;
begin
 perform pg_advisory_xact_lock(77123,1);
 if to_regclass('admin_ops.staff_social_shells') is not null
  or to_regprocedure('admin_ops.enforce_staff_social_shell()') is not null
  or exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass and tgname='enforce_staff_social_shell') then
  raise exception 'STAFF_SHELL_TARGET_ALREADY_EXISTS';
 end if;
 for f in select * from (values
  ('public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)','06bc23c46b912a538427a6e0d49d01b1','{postgres=X/postgres,service_role=X/postgres}'),
  ('account_erasure.assert_writable(uuid)','4cb940a9d477eb574a8208d048de9cc0','{postgres=X/postgres}'),
  ('account_erasure.guard_actor_write()','046547d7e04b40a1a9f8a1aca382066d','{postgres=X/postgres}'),
  ('account_erasure.guard_storage_write()','38698dbd1ea2f85095fb2a17bdf56eb7','{postgres=X/postgres}'),
  ('public.triniti_admin_session_check(uuid,uuid)','ba2e1c694288129ee94d8b6d06746eef','{postgres=X/postgres,service_role=X/postgres}'),
  ('admin_ops.require_session(uuid,uuid,text)','2a59dac44760254e1f2e730c6154d9a9','{postgres=X/postgres,service_role=X/postgres}')
 ) expected(signature,definition_md5,acl)
 loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(f.signature)
   and md5(pg_get_functiondef(p.oid))=f.definition_md5 and p.proacl::text=f.acl
   and pg_get_userbyid(p.proowner)='postgres') then
   raise exception 'STAFF_SHELL_BASELINE_DRIFT: %',f.signature;
  end if;
 end loop;
 if exists(select 1 from admin_ops.provisions where kind='staff' and completed_at is null) then
  raise exception 'STAFF_SHELL_PENDING_STAFF_REVIEW_REQUIRED';
 end if;
 select md5(jsonb_agg(jsonb_build_object('name',policyname,'cmd',cmd,'permissive',permissive,
  'roles',roles,'qual',qual,'check',with_check) order by policyname)::text) into policies_md5
 from pg_policies where schemaname='public' and tablename='profiles';
 if policies_md5 is distinct from 'a048f406fa129d4e7e08c71dc1c0f44a'
  or not (select relrowsecurity from pg_class where oid='public.profiles'::regclass) then
  raise exception 'STAFF_SHELL_PROFILE_VISIBILITY_DRIFT';
 end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in('public','creator_finance','marketplace_ops') and c.relkind='r'
  and not exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='account_erasure_actor_write'
   and t.tgenabled='O' and t.tgfoid='account_erasure.guard_actor_write()'::regprocedure))
  or not exists(select 1 from pg_trigger where tgrelid='storage.objects'::regclass and tgname='account_erasure_storage_write'
   and tgenabled='O' and tgfoid='account_erasure.guard_storage_write()'::regprocedure) then
  raise exception 'STAFF_SHELL_WRITE_GUARD_COVERAGE_DRIFT';
 end if;
end $preflight$;

-- This marker precedes Auth creation, so a provider-created but unfinished
-- identity never acquires an active social profile. No account is created here.
create table admin_ops.staff_social_shells (
 user_id uuid primary key,
 command_key uuid not null unique references admin_ops.provisions(command_key) on delete cascade,
 provision_id uuid not null unique,
 reserved_at timestamptz not null default clock_timestamp()
);
alter table admin_ops.staff_social_shells enable row level security;
revoke all on admin_ops.staff_social_shells from public,anon,authenticated,service_role;

create function admin_ops.enforce_staff_social_shell() returns trigger
language plpgsql security definer set search_path='' as $$
declare shell admin_ops.staff_social_shells%rowtype;
begin
 if tg_op='UPDATE' and new.id is distinct from old.id
  and exists(select 1 from admin_ops.staff_social_shells where user_id=old.id) then
  raise exception 'STAFF_SOCIAL_IDENTITY_IMMUTABLE' using errcode='42501';
 end if;
 select * into shell from admin_ops.staff_social_shells where user_id=new.id;
 if not found then return new; end if;
 if not exists(select 1 from auth.users u join admin_ops.provisions j on j.command_key=shell.command_key
  where u.id=new.id and j.kind='staff' and j.auth_user_id=u.id and j.provision_id=shell.provision_id
   and u.raw_app_meta_data->>'triniti_provision_id'=shell.provision_id::text
   and lower(u.email)=j.email and u.deleted_at is null) then
  raise exception 'STAFF_SHELL_IDENTITY_MISMATCH' using errcode='42501';
 end if;
 if tg_op='UPDATE' and new.deactivated_at is null then
  raise exception 'STAFF_SOCIAL_PROFILE_REQUIRED' using errcode='42501';
 end if;
 new.deactivated_at:=coalesce(new.deactivated_at,clock_timestamp());
 new.profile_visibility:='private';
 new.push_token:=null;
 return new;
end $$;
revoke all on function admin_ops.enforce_staff_social_shell() from public,anon,authenticated,service_role;
create trigger enforce_staff_social_shell before insert or update on public.profiles
 for each row execute function admin_ops.enforce_staff_social_shell();

do $patch$
declare source text; reservation_anchor text; finish_anchor text;
begin
 source:=pg_get_functiondef('public.triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)'::regprocedure);
 reservation_anchor:=E'  values(p_key,p_actor_id,p_kind,p_payload,new_id,email_value,case when p_kind=\'business\' then application.id else null end,snapshot_value) returning * into j;';
 if position(reservation_anchor in source)=0 then raise exception 'STAFF_SHELL_RESERVATION_ANCHOR_MISSING'; end if;
 source:=replace(source,reservation_anchor,reservation_anchor||$guard$
  if p_kind='staff' then
   -- The server generated this fresh UUID; never convert an existing identity.
   if exists(select 1 from auth.users where id=j.auth_user_id)
    or exists(select 1 from public.profiles where id=j.auth_user_id) then
    raise exception 'STAFF_SHELL_IDENTITY_EXISTS';
   end if;
   insert into admin_ops.staff_social_shells(user_id,command_key,provision_id)
   values(j.auth_user_id,j.command_key,j.provision_id);
  end if;$guard$);
 finish_anchor:='  insert into public.profiles(id,email,full_name,account_type) values(j.auth_user_id,j.email,'''',''personal'') on conflict(id) do nothing;';
 if position(finish_anchor in source)=0 then raise exception 'STAFF_SHELL_FINISH_ANCHOR_MISSING'; end if;
 source:=replace(source,finish_anchor,finish_anchor||$guard$
  if exists(select 1 from admin_ops.staff_social_shells where user_id=j.auth_user_id and provision_id=j.provision_id) then
   update public.profiles set deactivated_at=coalesce(deactivated_at,clock_timestamp()),
    profile_visibility='private',push_token=null where id=j.auth_user_id;
  end if;$guard$);
 execute source;

 source:=pg_get_functiondef('account_erasure.assert_writable(uuid)'::regprocedure);
 if position(' if exists(select 1 from account_erasure.jobs where user_id=p_user' in source)=0 then
  raise exception 'STAFF_SHELL_WRITE_ANCHOR_MISSING';
 end if;
 source:=replace(source,' if exists(select 1 from account_erasure.jobs where user_id=p_user',$guard$ -- Staff sign-ins remain valid for server-authorized operations, while every
 -- user-authored social write and owner-bound Storage upload stays disabled.
 if exists(select 1 from admin_ops.staff_social_shells where user_id=p_user) then
  raise exception 'STAFF_SOCIAL_WRITES_DISABLED' using errcode='42501';
 end if;
 if exists(select 1 from account_erasure.jobs where user_id=p_user$guard$);
 execute source;
end $patch$;

-- CREATE OR REPLACE retains the reviewed function owners and execution ACLs.
-- Auth session, optional MFA and existing staff-governance policies are untouched.
notify pgrst,'reload schema';
commit;
