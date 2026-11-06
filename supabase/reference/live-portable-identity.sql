-- Live-owned compatibility boundary. Existing account/security systems are
-- consulted when installed; this never creates substitutes for those systems.
create or replace function live_streams.account_available(p_user uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare permitted boolean;
begin
 select exists(select 1 from auth.users u join public.profiles p on p.id=u.id
  where u.id=p_user and u.deleted_at is null and not coalesce(u.is_anonymous,false)
  and (u.banned_until is null or u.banned_until<=now()) and p.deactivated_at is null
  and (p.restricted_until is null or p.restricted_until<=now())) into permitted;
 if not permitted then return false;end if;
 if to_regclass('admin_ops.staff_social_shells') is not null then
  execute 'select not exists(select 1 from admin_ops.staff_social_shells where user_id=$1)' into permitted using p_user;
  if not permitted then return false;end if;
 end if;
 if to_regclass('account_erasure.jobs') is not null then
  execute 'select not exists(select 1 from account_erasure.jobs where user_id=$1 and state<>''completed'')' into permitted using p_user;
  if not permitted then return false;end if;
 end if;
 return true;
end $$;
create or replace function live_streams.business_actor(p_user uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare business boolean;
begin
 select exists(select 1 from public.profiles where id=p_user and account_type='business') into business;
 if not business and to_regclass('business_auth.accounts') is not null then
  execute 'select exists(select 1 from business_auth.accounts where business_id=$1)' into business using p_user;
 end if;
 return business;
end $$;
create or replace function live_streams.business_session_valid(p_user uuid,p_session uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare permitted boolean;
begin
 if not live_streams.business_actor(p_user) then return true;end if;
 if to_regnamespace('business_auth') is not null then
  -- An installed but incomplete stronger guard is an error, never a fallback.
  execute 'select business_auth.session_allowed($1,$2)' into permitted using p_user,p_session;
  return coalesce(permitted,false);
 end if;
 -- The deployed production Studio binds access members to Auth sessions.
 -- Live requires that binding even when the legacy Studio has an owner default.
 return exists(select 1 from public.studio_session_members sm
  join public.business_access_members m on m.id=sm.member_id and m.business_id=sm.business_id
  where sm.session_id=p_session::text and sm.business_id=p_user and m.active);
end $$;
create or replace function live_streams.active_user(p_user uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select live_streams.account_available(p_user) and live_streams.business_session_valid(p_user,p_session)
  and exists(select 1 from auth.sessions where id=p_session and user_id=p_user
    and (not_after is null or not_after>now()));
$$;
create or replace function live_streams.publisher_allowed(p_user uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select live_streams.active_user(p_user,p_session) and (not live_streams.business_actor(p_user)
  or exists(select 1 from public.studio_session_members sm
   join public.business_access_members m on m.id=sm.member_id and m.business_id=sm.business_id
   where sm.session_id=p_session::text and sm.business_id=p_user and m.active and m.role in ('owner','admin','editor')));
$$;
create or replace function live_streams.require_user() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;permitted boolean;
begin
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when others then raise exception 'AUTH_REQUIRED' using errcode='42501';end;
 if uid is null or sid is null or not live_streams.active_user(uid,sid) then
  raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 if to_regprocedure('public.business_session_allowed()') is not null then
  execute 'select public.business_session_allowed()' into permitted;
  if not coalesce(permitted,false) then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 end if;
 return uid;
end $$;
revoke all on function live_streams.account_available(uuid),live_streams.business_actor(uuid),
 live_streams.business_session_valid(uuid,uuid),live_streams.active_user(uuid,uuid),
 live_streams.publisher_allowed(uuid,uuid),live_streams.require_user()
 from public,anon,authenticated,service_role;
