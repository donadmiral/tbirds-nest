-- No exception is enabled by this migration. Provision the policy only in isolated QA.
-- Password sign-in, active native session, super-admin ownership and action roles remain required.
begin;
create table admin_ops.single_owner_qa_policy (
 singleton boolean primary key default true check(singleton),
 owner_id uuid not null references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 reason text not null check(length(btrim(reason)) between 1 and 500),
 updated_at timestamptz not null default now()
);
alter table admin_ops.single_owner_qa_policy enable row level security;
revoke all on admin_ops.single_owner_qa_policy from public,anon,authenticated,service_role;

create function admin_ops.single_owner_access(p_actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(exists(
  select 1 from admin_ops.single_owner_qa_policy p
  join public.admin_users a on a.user_id=p.owner_id
  where p.singleton and p.enabled and p.owner_id=p_actor
   and a.active and a.role='super_admin'
   and (select count(*) from public.admin_users where active)=1
 ),false);
$$;
revoke all on function admin_ops.single_owner_access(uuid) from public,anon,authenticated,service_role;

-- This read is only available to the verified staff server, never an end-user client.
create function public.triniti_admin_single_owner_access(p_actor_id uuid,p_session_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.triniti_admin_session_check(p_actor_id,p_session_id),false)
  and admin_ops.single_owner_access(p_actor_id)
  and exists(select 1 from auth.sessions where id=p_session_id and user_id=p_actor_id and aal::text in ('aal1','aal2'));
$$;
revoke all on function public.triniti_admin_single_owner_access(uuid,uuid) from public,anon,authenticated;
grant execute on function public.triniti_admin_single_owner_access(uuid,uuid) to service_role;

-- Retire the exception when a second active staff member joins, or ownership ceases.
-- Removing that second member later must not silently bring the exception back.
create function admin_ops.lock_staff_governance()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(77123,1);
 return null;
end $$;
create function admin_ops.retire_single_owner_access()
returns trigger language plpgsql security definer set search_path='' as $$
declare affected_owner uuid;
begin
 update admin_ops.single_owner_qa_policy p set enabled=false,updated_at=now()
 where p.enabled and not admin_ops.single_owner_access(p.owner_id)
 returning p.owner_id into affected_owner;
 if affected_owner is not null then
  insert into public.admin_audit_log(admin_id,action,target_kind,target_id,reason,after)
  values(affected_owner,'singleOwnerModeRetired','staff',affected_owner::text,
   'The active staff roster no longer has exactly the configured super administrator.',jsonb_build_object('enabled',false));
 end if;
 return null;
end $$;
revoke all on function admin_ops.lock_staff_governance(),admin_ops.retire_single_owner_access() from public,anon,authenticated,service_role;
create trigger lock_single_owner_governance before insert or update or delete on public.admin_users
 for each statement execute function admin_ops.lock_staff_governance();
create trigger retire_single_owner_governance after insert or update or delete on public.admin_users
 for each statement execute function admin_ops.retire_single_owner_access();

create or replace function admin_ops.require_session(p_actor_id uuid,p_session_id uuid,p_permission text)
returns text language plpgsql security definer set search_path = '' as $$
declare r text;
begin
 -- Serialize admission with every staff change. The lock is reentrant for staff commands.
 perform pg_advisory_xact_lock_shared(77123,1);
 -- The same native session used by the verified server token must still exist.
 if p_actor_id is null or p_session_id is null
    or not public.triniti_admin_session_check(p_actor_id,p_session_id)
    or not exists(select 1 from auth.sessions where id=p_session_id and user_id=p_actor_id and (aal::text='aal2' or (aal::text='aal1' and admin_ops.single_owner_access(p_actor_id))))
 then raise exception 'ACTIVE_ADMIN_SESSION_REQUIRED' using errcode='42501'; end if;
 perform 1 from auth.sessions s join auth.users u on u.id=s.user_id
 where s.id=p_session_id and s.user_id=p_actor_id and (s.aal::text='aal2' or (s.aal::text='aal1' and admin_ops.single_owner_access(p_actor_id)))
 and (s.not_after is null or s.not_after>now()) and u.deleted_at is null
 and (u.banned_until is null or u.banned_until<=now()) for share of s,u;
 if not found then raise exception 'ACTIVE_ADMIN_SESSION_REQUIRED' using errcode='42501'; end if;
 select role into r from public.admin_users where user_id=p_actor_id and active for share;
 if not coalesce(case p_permission
 when 'verification' then r=any(array['super_admin','platform_admin','verification_reviewer'])
 when 'user_moderate' then r=any(array['super_admin','platform_admin','trust_safety'])
 when 'post_moderate' then r=any(array['super_admin','platform_admin','trust_safety'])
 when 'market_moderate' then r=any(array['super_admin','platform_admin','market_reviewer'])
 when 'report_post' then r=any(array['super_admin','platform_admin','trust_safety'])
 when 'report_listing' then r=any(array['super_admin','platform_admin','trust_safety','market_reviewer'])
 when 'report_user' then r=any(array['super_admin','platform_admin','trust_safety'])
 when 'support' then r=any(array['super_admin','platform_admin','trust_safety','support_agent'])
 when 'ads' then r=any(array['super_admin','platform_admin','market_reviewer','finance_admin'])
 when 'system' then r=any(array['super_admin','platform_admin','ops_engineer'])
 when 'business_manage' then r='super_admin'
 when 'organization_manage' then r='super_admin'
 when 'staff_manage' then r='super_admin'
 when 'account_delete' then r='super_admin'
 when 'comment_delete' then r='super_admin'
 else false end,false) then raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501'; end if;
 return r;
end $$;
revoke all on function admin_ops.require_session(uuid,uuid,text) from public,anon,authenticated;
grant execute on function admin_ops.require_session(uuid,uuid,text) to service_role;


create or replace function creator_finance.require_staff(p_actor uuid,p_session uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock_shared(77123,1);
 if not coalesce(public.triniti_admin_session_check(p_actor,p_session),false) or not exists(
  select 1 from public.admin_users where user_id=p_actor and active and role in ('super_admin','platform_admin','finance_admin')
 ) then raise exception 'ACTIVE_FINANCE_SESSION_REQUIRED'; end if;
 if not exists(select 1 from auth.sessions where id=p_session and user_id=p_actor
   and (aal::text='aal2' or (aal::text='aal1' and admin_ops.single_owner_access(p_actor))))
 then raise exception 'MFA_REQUIRED'; end if;
end $$;
revoke all on function creator_finance.require_staff(uuid,uuid) from public,anon,authenticated,service_role;
commit;
