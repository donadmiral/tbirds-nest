-- Owner-requested policy: allow staff password sessions without mandatory authenticator enrollment.
-- Native session validity, active staff roles, per-operation permissions and audit remain enforced.
-- No user credentials or MFA factors are changed.
begin;
create or replace function admin_ops.require_session(p_actor_id uuid,p_session_id uuid,p_permission text)
returns text language plpgsql security definer set search_path = '' as $$
declare r text;
begin
 -- The same native session used by the verified server token must still exist.
 if p_actor_id is null or p_session_id is null
    or not public.triniti_admin_session_check(p_actor_id,p_session_id)
    or not exists(select 1 from auth.sessions where id=p_session_id and user_id=p_actor_id and aal::text in ('aal1','aal2'))
 then raise exception 'ACTIVE_ADMIN_SESSION_REQUIRED' using errcode='42501'; end if;
 perform 1 from auth.sessions s join auth.users u on u.id=s.user_id
 where s.id=p_session_id and s.user_id=p_actor_id and s.aal::text in ('aal1','aal2')
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


commit;
