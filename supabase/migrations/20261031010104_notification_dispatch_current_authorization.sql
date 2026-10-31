-- Record the initiating Auth session once, then recheck it and the exact
-- recipient eligibility before every external batch. Privileged/manual call
-- inserts retain their existing behavior but receive no push provenance.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
begin
 if current_user<>'postgres' then raise exception 'NOTIFICATION_POSTGRES_REQUIRED';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.claim_call_push_dispatch(uuid,uuid)')
  and md5(prosrc)='caab7b952d9dc7a744f18d9a041916e7' and proowner='postgres'::regrole
  and proacl::text='{postgres=X/postgres,service_role=X/postgres}') then raise exception 'CALL_DISPATCH_BASELINE_DRIFT';end if;
 if to_regclass('notification_delivery.call_origins') is not null
  or to_regprocedure('public.call_push_dispatch_allowed(uuid,uuid)') is not null then raise exception 'CALL_ORIGIN_CONTRACT_ALREADY_EXISTS';end if;
end $preflight$;
create table notification_delivery.call_origins(
 call_id uuid primary key references public.call_sessions(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 session_id uuid not null references auth.sessions(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp()
);
create index call_origins_user on notification_delivery.call_origins(user_id);
create index call_origins_session on notification_delivery.call_origins(session_id);
alter table notification_delivery.call_origins enable row level security;
revoke all on notification_delivery.call_origins from public,anon,authenticated,service_role;

create function notification_delivery.record_call_origin()
returns trigger language plpgsql security definer set search_path='' as $$
declare sid uuid;kind text;allowed boolean;
begin
 if auth.role() is distinct from 'authenticated' then return new;end if;
 sid:=media_delivery.require_session();
 if new.initiator_id is distinct from auth.uid() then raise exception 'CALL_INITIATOR_SESSION_REQUIRED' using errcode='42501';end if;
 select account_type into kind from public.profiles where id=new.initiator_id and deactivated_at is null for share;
 if not found then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501';end if;
 perform account_erasure.assert_writable(new.initiator_id);
 if to_regprocedure('public.business_session_allowed()') is not null then
  execute 'select public.business_session_allowed()' into allowed;
 elsif kind='business' then allowed:=false;else allowed:=true;end if;
 if not coalesce(allowed,false) then raise exception 'BUSINESS_SESSION_REQUIRED' using errcode='42501';end if;
 perform 1 from auth.sessions where id=sid and user_id=new.initiator_id for share;
 if not found then raise exception 'CALL_INITIATOR_SESSION_REQUIRED' using errcode='42501';end if;
 perform media_delivery.require_session();
 insert into notification_delivery.call_origins(call_id,user_id,session_id) values(new.id,new.initiator_id,sid);
 return new;
end $$;
revoke all on function notification_delivery.record_call_origin() from public,anon,authenticated,service_role;
create trigger aa_call_push_origin after insert on public.call_sessions for each row execute function notification_delivery.record_call_origin();

create function public.call_push_dispatch_allowed(p_call_id uuid,p_recipient uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare c public.call_sessions%rowtype;conversation public.conversations%rowtype;sid uuid;kind text;allowed boolean;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';end if;
 select * into c from public.call_sessions where id=p_call_id;
 if not found or p_recipient is null or p_recipient=c.initiator_id or c.status<>'ringing'
  or c.ended_at is not null or c.created_at is null or c.created_at>clock_timestamp()
  or c.expires_at is null or least(c.expires_at,c.created_at+interval '90 seconds')<=clock_timestamp() then return false;end if;
 select p.account_type into kind from public.profiles p join auth.users u on u.id=p.id
  where p.id=c.initiator_id and p.deactivated_at is null and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp());
 if not found then return false;end if;
 select origin.session_id into sid from notification_delivery.call_origins origin
 join auth.sessions s on s.id=origin.session_id and s.user_id=origin.user_id
 where origin.call_id=c.id and origin.user_id=c.initiator_id
  and (s.not_after is null or s.not_after>clock_timestamp());
 if not found then return false;end if;
 if to_regprocedure('business_auth.session_allowed(uuid,uuid)') is not null then
  execute 'select (not exists(select 1 from business_auth.accounts where business_id=$1) and $3<>''business'') or business_auth.session_allowed($1,$2)'
   into allowed using c.initiator_id,sid,kind;
 elsif kind='business' then allowed:=false;else allowed:=true;end if;
 if not coalesce(allowed,false) then return false;end if;
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
 return true;
end $$;

create or replace function public.claim_call_push_dispatch(p_call_id uuid,p_recipient uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare inserted uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';end if;
 perform 1 from public.call_sessions where id=p_call_id for share;
 if not public.call_push_dispatch_allowed(p_call_id,p_recipient) then return false;end if;
 insert into notification_delivery.call_push_dispatches(call_id,recipient_id)
 values(p_call_id,p_recipient) on conflict(call_id,recipient_id) do nothing returning call_id into inserted;
 return inserted is not null;
end $$;
revoke all on function public.call_push_dispatch_allowed(uuid,uuid),public.claim_call_push_dispatch(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.call_push_dispatch_allowed(uuid,uuid),public.claim_call_push_dispatch(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
