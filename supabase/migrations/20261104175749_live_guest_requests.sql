-- Viewer consent, host approval and a bounded, private guest-request inbox.
set local lock_timeout='3s';
set local statement_timeout='60s';

create table live_streams.guest_requests (
 session_id uuid not null references live_streams.sessions(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 status text not null check(status in ('pending','accepted','declined','cancelled')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(session_id,user_id)
);
create index live_guest_requests_pending on live_streams.guest_requests(session_id,created_at,user_id) where status='pending';
alter table live_streams.guest_requests enable row level security;
revoke all on live_streams.guest_requests from public,anon,authenticated,service_role;

create function live_streams.guest_can_receive(p_topic text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare uid uuid;sid uuid;recipient uuid;
begin
 if p_topic !~ '^live-guests:[0-9a-f-]{36}:[0-9a-f-]{36}$' then return false;end if;
 begin uid:=live_streams.require_user();sid:=split_part(p_topic,':',2)::uuid;recipient:=split_part(p_topic,':',3)::uuid;
 exception when others then return false;end;
 return recipient=uid and live_streams.can_view(sid,uid);
end $$;
revoke all on function live_streams.guest_can_receive(text) from public,anon,service_role;
grant execute on function live_streams.guest_can_receive(text) to authenticated;
do $$begin
 if to_regclass('realtime.messages') is not null then
  execute $p$create policy live_guest_read on realtime.messages for select to authenticated using(extension='broadcast' and live_streams.guest_can_receive((select realtime.topic())))$p$;
  execute $p$create policy live_guest_read_guard on realtime.messages as restrictive for select to authenticated using((select realtime.topic()) not like 'live-guests:%' or (extension='broadcast' and live_streams.guest_can_receive((select realtime.topic()))))$p$;
  execute $p$create policy live_guest_server_only on realtime.messages as restrictive for insert to authenticated with check((select realtime.topic()) not like 'live-guests:%')$p$;
 end if;
end $$;

create function live_streams.guest_notify(p_session uuid,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
 if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return;end if;
 for recipient in
  select host_id from live_streams.sessions where id=p_session
  union select user_id from live_streams.members where session_id=p_session and status='accepted' and role='producer'
  union select p_user
 loop
  if recipient is not null and live_streams.can_view(p_session,recipient) then
   perform realtime.send(jsonb_build_object('session_id',p_session),'guest_requests_changed','live-guests:'||p_session::text||':'||recipient::text,true);
  end if;
 end loop;
end $$;

create function live_streams.guest_snapshot(p_session uuid,p_admin boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();actor_role text;s live_streams.sessions;cfg live_streams.settings;pending jsonb:='[]';own_request jsonb;occupied integer;
begin
 if p_admin then perform live_streams.require_admin(false);else uid:=live_streams.require_user();end if;
 if not p_admin and not live_streams.can_view(p_session,uid) then raise exception 'LIVE_NOT_AVAILABLE' using errcode='42501';end if;
 select * into s from live_streams.sessions where id=p_session;
 select * into cfg from live_streams.settings where singleton;
 actor_role:=live_streams.role_for(p_session,uid);
 select 1+count(*) into occupied from live_streams.members where session_id=p_session and status<>'removed' and role in ('producer','camera','guest');
 select jsonb_build_object('status',r.status,'created_at',r.created_at,'updated_at',r.updated_at) into own_request
 from live_streams.guest_requests r where r.session_id=p_session and r.user_id=uid;
 if (p_admin or actor_role in ('host','producer')) and s.state in ('live','reconnecting') then
  select coalesce(jsonb_agg(jsonb_build_object('user_id',r.user_id,'status',r.status,'created_at',r.created_at,'profile',live_streams.profile_json(r.user_id)) order by r.created_at,r.user_id),'[]') into pending
  from (select * from live_streams.guest_requests where session_id=p_session and status='pending' and live_streams.can_view(p_session,user_id) order by created_at,user_id limit 100) r;
 end if;
 return jsonb_build_object('join_requests',pending,'own_join_request',own_request,
  'stage',jsonb_build_object('limit',cfg.max_stage_members,'occupied',occupied,'available',greatest(0,cfg.max_stage_members-occupied)),
  'guest_topic',case when p_admin then null else 'live-guests:'||p_session::text||':'||uid::text end,
  'can_request_join',not p_admin and cfg.stage_enabled and s.state in ('live','reconnecting') and actor_role='viewer'
    and coalesce(own_request->>'status','') not in ('pending','accepted','declined')
    and not exists(select 1 from live_streams.members where session_id=p_session and user_id=uid));
end $$;

create function live_streams.guest_command(p_action text,p_session uuid,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=live_streams.require_user();s live_streams.sessions;cfg live_streams.settings;c live_streams.commands;
 target uuid;actor_role text;request_status text;occupied integer;v_result jsonb;
begin
 if p_action not in ('request_join','cancel_join_request','accept_join_request','decline_join_request') or p_request is null
  or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>1024 then raise exception 'INVALID_COMMAND';end if;
 if p_action in ('request_join','cancel_join_request') then
  if p_payload<>'{}'::jsonb then raise exception 'INVALID_COMMAND_FIELD';end if;target:=uid;
  if p_action='request_join' then perform live_streams.require_publisher();end if;
 else
  if (select array_agg(k order by k) from jsonb_object_keys(p_payload) k) is distinct from array['user_id']::text[] then raise exception 'INVALID_COMMAND_FIELD';end if;
  target:=(p_payload->>'user_id')::uuid;if target is null then raise exception 'INVALID_MEMBER';end if;
  perform live_streams.require_publisher();
 end if;
 if not live_streams.can_view(p_session,uid) then raise exception 'LIVE_NOT_AVAILABLE' using errcode='42501';end if;
 insert into live_streams.commands(actor_id,request_id,session_id,action,payload) values(uid,p_request,p_session,p_action,p_payload) on conflict do nothing;
 select * into c from live_streams.commands where actor_id=uid and request_id=p_request for update;
 if c.action<>p_action or c.session_id is distinct from p_session or c.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 if c.result is not null then return c.result||jsonb_build_object('duplicate',true);end if;
 -- Same lock as invites, removals and provider state changes. No approval can overfill the stage.
 select * into s from live_streams.sessions where id=p_session for update;
 if not found or s.state not in ('live','reconnecting') then raise exception 'STATE_CONFLICT';end if;
 if not live_streams.can_view(p_session,uid) then raise exception 'LIVE_NOT_AVAILABLE' using errcode='42501';end if;
 select * into cfg from live_streams.settings where singleton;
 if not cfg.stage_enabled then raise exception 'PROVIDER_NOT_READY';end if;
 actor_role:=live_streams.role_for(p_session,uid);
 if p_action in ('accept_join_request','decline_join_request') and actor_role not in ('host','producer') then raise exception 'ACCESS_DENIED' using errcode='42501';end if;
 select status into request_status from live_streams.guest_requests where session_id=p_session and user_id=target for update;
 if p_action='request_join' then
  if actor_role<>'viewer' or exists(select 1 from live_streams.members where session_id=p_session and user_id=uid) then raise exception 'JOIN_REQUEST_NOT_AVAILABLE';end if;
  if request_status in ('accepted','declined') then raise exception 'JOIN_REQUEST_NOT_AVAILABLE';end if;
  perform live_streams.take_rate('guest_request',uid::text,3,60);
  if request_status is distinct from 'pending' then
   if (select count(*) from live_streams.guest_requests where session_id=p_session and status='pending')>=100 then raise exception 'JOIN_REQUEST_QUEUE_FULL';end if;
   insert into live_streams.guest_requests(session_id,user_id,status) values(p_session,uid,'pending')
   on conflict(session_id,user_id) do update set status='pending',created_at=now(),updated_at=now();
  end if;
 elsif p_action='cancel_join_request' then
  if request_status is distinct from 'pending' then raise exception 'JOIN_REQUEST_NOT_AVAILABLE';end if;
  update live_streams.guest_requests set status='cancelled',updated_at=now() where session_id=p_session and user_id=uid;
 elsif p_action='decline_join_request' then
  if request_status is distinct from 'pending' then raise exception 'JOIN_REQUEST_NOT_AVAILABLE';end if;
  update live_streams.guest_requests set status='declined',updated_at=now() where session_id=p_session and user_id=target;
 else
  if request_status is distinct from 'pending' or target=s.host_id or not live_streams.can_view(p_session,target)
   or exists(select 1 from public.blocked_users where (blocker_id=uid and blocked_id=target) or (blocker_id=target and blocked_id=uid))
   or exists(select 1 from live_streams.members where session_id=p_session and user_id=target)
   then raise exception 'JOIN_REQUEST_NOT_AVAILABLE';end if;
  select count(*) into occupied from live_streams.members where session_id=p_session and status<>'removed' and role in ('producer','camera','guest');
  if occupied>=cfg.max_stage_members-1 then raise exception 'STAGE_FULL';end if;
  if (select count(*) from live_streams.members where session_id=p_session and status<>'removed')>=49 then raise exception 'MEMBER_LIMIT';end if;
  insert into live_streams.members(session_id,user_id,role,status) values(p_session,target,'guest','accepted');
  update live_streams.guest_requests set status='accepted',updated_at=now() where session_id=p_session and user_id=target;
 end if;
 v_result:=jsonb_build_object('ok',true,'session_id',p_session,'status',(select status from live_streams.guest_requests where session_id=p_session and user_id=target));
 update live_streams.commands set result=v_result where actor_id=uid and request_id=p_request;
 insert into live_streams.audit(session_id,actor_id,action,payload) values(p_session,uid,p_action,p_payload);
 perform live_streams.guest_notify(p_session,target);
 return v_result;
end $$;
revoke all on function live_streams.guest_notify(uuid,uuid),live_streams.guest_snapshot(uuid,boolean),live_streams.guest_command(text,uuid,jsonb,uuid) from public,anon,authenticated,service_role;

-- Extend the existing authenticated entry points without changing their grants, owners or cancellation safeguards.
do $install$
declare original text;changed text;
begin
 original:=pg_get_functiondef('live_streams.command(text,uuid,jsonb,uuid)'::regprocedure);
 if md5(original)<>'cf4ee3d32c0efa2a42a4401607ff4f2b' then raise exception 'LIVE_COMMAND_DEFINITION_CHANGED';end if;
 changed:=replace(original,E'begin\n if p_request is null',E'begin\n if p_action in (''request_join'',''cancel_join_request'',''accept_join_request'',''decline_join_request'') then return live_streams.guest_command(p_action,p_session,p_payload,p_request);end if;\n if p_request is null');
 if changed=original then raise exception 'LIVE_COMMAND_ANCHOR_MISSING';end if;execute changed;
 original:=pg_get_functiondef('live_streams.detail(uuid,boolean)'::regprocedure);
 if md5(original)<>'16096ef45694a14b5511f49621b539a1' then raise exception 'LIVE_DETAIL_DEFINITION_CHANGED';end if;
 changed:=replace(original,'return jsonb_build_object(''session'',','return live_streams.guest_snapshot(p_session,p_admin)||jsonb_build_object(''session'',');
 if changed=original then raise exception 'LIVE_DETAIL_ANCHOR_MISSING';end if;execute changed;
end $install$;
