-- A provider send with an uncertain result must not ring the same recipient
-- again. Claims are private, transactionally unique, and erased with the call
-- or recipient. This unit sends nothing and grants no direct table access.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
begin
 if current_user<>'postgres' then raise exception 'NOTIFICATION_POSTGRES_REQUIRED';end if;
 if to_regprocedure('public.authorize_call_push(uuid)') is null then raise exception 'CALL_AUTHORIZATION_REQUIRED';end if;
 if to_regnamespace('notification_delivery') is not null
  or to_regprocedure('public.claim_call_push_dispatch(uuid,uuid)') is not null then
  raise exception 'CALL_DISPATCH_CONTRACT_ALREADY_EXISTS';end if;
end $preflight$;
create schema notification_delivery;
revoke all on schema notification_delivery from public,anon,authenticated,service_role;
create table notification_delivery.call_push_dispatches(
 call_id uuid not null references public.call_sessions(id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 claimed_at timestamptz not null default clock_timestamp(),
 primary key(call_id,recipient_id)
);
create index call_push_dispatches_recipient on notification_delivery.call_push_dispatches(recipient_id);
alter table notification_delivery.call_push_dispatches enable row level security;
revoke all on notification_delivery.call_push_dispatches from public,anon,authenticated,service_role;

create function public.claim_call_push_dispatch(p_call_id uuid,p_recipient uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.call_sessions%rowtype;conversation public.conversations%rowtype;inserted uuid;kind text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';end if;
 select * into c from public.call_sessions where id=p_call_id for share;
 if not found or p_recipient is null or p_recipient=c.initiator_id or c.status<>'ringing'
  or c.ended_at is not null or c.created_at is null or c.created_at>clock_timestamp()
  or c.expires_at is null or least(c.expires_at,c.created_at+interval '90 seconds')<=clock_timestamp() then return false;end if;
 select p.account_type into kind from public.profiles p join auth.users u on u.id=p.id
  where p.id=c.initiator_id and p.deactivated_at is null and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp());
 if not found or (kind='business' and to_regprocedure('public.business_session_allowed()') is null) then return false;end if;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=p_recipient and p.deactivated_at is null and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp())) then return false;end if;
 if exists(select 1 from public.blocked_users where (blocker_id=c.initiator_id and blocked_id=p_recipient)
  or (blocker_id=p_recipient and blocked_id=c.initiator_id)) then return false;end if;
 if c.conversation_id is not null then
  select * into conversation from public.conversations where id=c.conversation_id;
  if not found then return false;end if;
  if conversation.is_group then
   if not c.is_group_call or not exists(select 1 from public.conversation_members where conversation_id=c.conversation_id and user_id=c.initiator_id)
    or not exists(select 1 from public.conversation_members where conversation_id=c.conversation_id and user_id=p_recipient)
    or not exists(select 1 from public.call_participants where call_session_id=c.id and user_id=p_recipient and status='invited' and left_at is null)
    then return false;end if;
  elsif c.is_group_call or (c.initiator_id=conversation.user_1 or c.initiator_id=conversation.user_2) is not true
   or p_recipient is distinct from (case when conversation.user_1=c.initiator_id then conversation.user_2 else conversation.user_1 end)
   or c.receiver_id is distinct from p_recipient then return false;end if;
 elsif c.is_group_call or c.receiver_id is distinct from p_recipient then return false;end if;
 insert into notification_delivery.call_push_dispatches(call_id,recipient_id)
 values(c.id,p_recipient) on conflict(call_id,recipient_id) do nothing returning call_id into inserted;
 return inserted is not null;
end $$;
revoke all on function public.claim_call_push_dispatch(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_call_push_dispatch(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
