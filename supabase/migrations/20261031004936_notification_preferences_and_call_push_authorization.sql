-- Atomic owner preferences and current-session call authorization. This unit
-- changes no existing preference, sends no push and creates no provider job.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $preflight$
begin
 if current_user<>'postgres' then raise exception 'NOTIFICATION_POSTGRES_REQUIRED';end if;
 if to_regprocedure('media_delivery.require_session()') is null
  or to_regprocedure('account_erasure.assert_writable(uuid)') is null then
  raise exception 'NOTIFICATION_SESSION_PREREQUISITE_REQUIRED';end if;
 if to_regprocedure('public.set_notification_preference(text,boolean)') is not null
  or to_regprocedure('public.authorize_call_push(uuid)') is not null
  or to_regprocedure('public.get_notification_badge_count(uuid)') is not null then
  raise exception 'NOTIFICATION_CONTRACT_ALREADY_EXISTS';end if;
end $preflight$;

create function public.set_notification_preference(p_key text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;allowed boolean;p public.profiles%rowtype;saved jsonb;
begin
 sid:=media_delivery.require_session();
 if p_key is null or p_enabled is null or p_key<>all(array[
  'all','messages','message_reactions','calls','likes','comments','mentions',
  'followers','updates','jobs','payments','account']) then
  raise exception 'INVALID_NOTIFICATION_PREFERENCE' using errcode='22023';end if;
 select * into p from public.profiles where id=uid and deactivated_at is null for update;
 if not found then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501';end if;
 perform account_erasure.assert_writable(uid);
 if to_regprocedure('public.business_session_allowed()') is not null then
  execute 'select public.business_session_allowed()' into allowed;
 elsif p.account_type='business' then allowed:=false;else allowed:=true;end if;
 if not coalesce(allowed,false) then raise exception 'BUSINESS_SESSION_REQUIRED' using errcode='42501';end if;
 -- Recheck after the profile lock: another settings request must patch its own
 -- key onto the latest committed object, never replace a captured client copy.
 perform media_delivery.require_session();
 update public.profiles set notif_prefs=(case when jsonb_typeof(notif_prefs)='object'
  then notif_prefs else '{}'::jsonb end)||jsonb_build_object(p_key,p_enabled)
 where id=uid and deactivated_at is null returning notif_prefs into saved;
 if saved is null then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501';end if;
 return saved;
end $$;

create function public.authorize_call_push(p_call_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;allowed boolean;kind text;c public.call_sessions%rowtype;conversation public.conversations%rowtype;
begin
 sid:=media_delivery.require_session();
 select account_type into kind from public.profiles where id=uid and deactivated_at is null;
 if not found then return false;end if;
 perform account_erasure.assert_writable(uid);
 if to_regprocedure('public.business_session_allowed()') is not null then
  execute 'select public.business_session_allowed()' into allowed;
 elsif kind='business' then allowed:=false;else allowed:=true;end if;
 if not coalesce(allowed,false) then return false;end if;
 select * into c from public.call_sessions where id=p_call_id and initiator_id=uid;
 if not found or c.status<>'ringing' or c.ended_at is not null
  or c.created_at is null or c.created_at>clock_timestamp()
  or c.expires_at is null
  or least(c.expires_at,c.created_at+interval '90 seconds')<=clock_timestamp() then return false;end if;
 if c.conversation_id is not null then
  select * into conversation from public.conversations where id=c.conversation_id;
  if not found then return false;end if;
  if conversation.is_group then
   if not c.is_group_call or not exists(select 1 from public.conversation_members
    where conversation_id=c.conversation_id and user_id=uid) then return false;end if;
  elsif c.is_group_call or (uid=conversation.user_1 or uid=conversation.user_2) is not true
   or c.receiver_id is null or c.receiver_id=uid
   or c.receiver_id is distinct from (case when conversation.user_1=uid then conversation.user_2 else conversation.user_1 end)
   then return false;end if;
 elsif c.is_group_call or c.receiver_id is null or c.receiver_id=uid then return false;end if;
 if not c.is_group_call and (not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
   where p.id=c.receiver_id and p.deactivated_at is null and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=clock_timestamp()))
  or exists(select 1 from public.blocked_users where (blocker_id=uid and blocked_id=c.receiver_id)
   or (blocker_id=c.receiver_id and blocked_id=uid))) then return false;end if;
 return true;
end $$;

create function public.get_notification_badge_count(p_recipient uuid)
returns integer language plpgsql stable security definer set search_path='' as $$
declare result integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';end if;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=p_recipient and p.deactivated_at is null and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=now())) then return 0;end if;
 -- One aggregate replaces one request per group. Each message contributes at
 -- most once; removed group memberships cannot retain an unread badge.
 select least(count(*),2147483647)::integer into result
 from public.messages m left join public.conversations c on c.id=m.conversation_id
 left join public.conversation_members member on member.conversation_id=m.conversation_id and member.user_id=p_recipient
 where m.sender_id<>p_recipient and m.deleted_at is null and (
  (m.receiver_id=p_recipient and m.read_at is null and not coalesce(c.is_group,false))
  or (c.is_group and member.user_id is not null and m.created_at>member.last_read_at));
 return result;
end $$;

revoke all on function public.set_notification_preference(text,boolean),public.authorize_call_push(uuid),public.get_notification_badge_count(uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_notification_preference(text,boolean),public.authorize_call_push(uuid) to authenticated;
grant execute on function public.get_notification_badge_count(uuid) to service_role;
notify pgrst,'reload schema';
commit;
