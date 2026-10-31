-- Restore the existing staff support-triage and seller-review workflows.
-- This candidate is intentionally additive to the current production baseline.
-- A pre-existing admin namespace requires a separate definition/ACL review.
begin;
set local lock_timeout='3s';
create schema admin_ops;
revoke all on schema admin_ops from public,anon,authenticated;
grant usage on schema admin_ops to service_role;

create table admin_ops.commands (
 command_key uuid primary key, actor_id uuid not null, operation text not null,
 payload jsonb not null, result jsonb, created_at timestamptz not null default now()
);
alter table admin_ops.commands enable row level security;
revoke all on admin_ops.commands from public,anon,authenticated,service_role;

-- Match the existing password-session policy and grant only the two permissions
-- required by the restored functions. Credentials and staff roles are unchanged.
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
 when 'support' then r=any(array['super_admin','platform_admin','trust_safety','support_agent'])
 when 'report_listing' then r=any(array['super_admin','platform_admin','trust_safety','market_reviewer'])
 else false end,false) then raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501'; end if;
 return r;
end $$;
revoke all on function admin_ops.require_session(uuid,uuid,text) from public,anon,authenticated;
grant execute on function admin_ops.require_session(uuid,uuid,text) to service_role;

create table admin_ops.support_triage (
 ticket_id uuid primary key references public.support_tickets(id) on delete cascade,
 assigned_to uuid references public.admin_users(user_id) on delete set null,
 priority text not null default 'normal' check(priority in ('urgent','high','normal','low')),
 queue text not null default 'general' check(queue in ('general','account','payments','safety','marketplace')),
 escalated boolean not null default false,
 version integer not null default 1,
 updated_at timestamptz not null default now()
);
alter table admin_ops.support_triage enable row level security;
revoke all on admin_ops.support_triage from public,anon,authenticated,service_role;
create index if not exists support_messages_latest_idx on public.support_messages(ticket_id,created_at desc,id desc);

create or replace function public.admin_support_triage_read(p_ids uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'ticket_id',t.id,'assigned_to',s.assigned_to,'assigned_name',p.full_name,
  'priority',coalesce(s.priority,'normal'),'queue',coalesce(s.queue,'general'),
  'escalated',coalesce(s.escalated,false),'version',coalesce(s.version,0),
  'support_commands_available',coalesce(has_function_privilege('service_role',to_regprocedure('public.triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)'),'EXECUTE'),false),
  'response_due_at',case when t.status='open' and coalesce(m.sender,'user')<>'ops' then
   coalesce(m.created_at,t.created_at)+case coalesce(s.priority,'normal') when 'urgent' then interval '15 minutes' when 'high' then interval '1 hour' when 'low' then interval '72 hours' else interval '24 hours' end end
 )),'[]') from public.support_tickets t
 left join admin_ops.support_triage s on s.ticket_id=t.id
 left join public.profiles p on p.id=s.assigned_to
 left join lateral(select sender,created_at from public.support_messages where ticket_id=t.id order by created_at desc,id desc limit 1) m on true
 where t.id=any(p_ids) and cardinality(p_ids)<=100;
$$;

create or replace function public.admin_support_triage_update(
 p_actor_id uuid,p_session_id uuid,p_key uuid,p_ticket_id uuid,p_version integer,
 p_assigned_to uuid,p_priority text,p_queue text,p_escalated boolean,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; saved admin_ops.commands%rowtype; previous jsonb; result_value jsonb; current_version integer;
begin
 perform admin_ops.require_session(p_actor_id,p_session_id,'support');
 if p_key is null or p_ticket_id is null or p_version is null or p_version<0
   or p_priority is null or p_priority not in ('urgent','high','normal','low')
   or p_queue is null or p_queue not in ('general','account','payments','safety','marketplace')
   or p_escalated is null or coalesce(length(trim(p_reason)),0) not between 3 and 2000
 then raise exception 'INVALID_TRIAGE';end if;
 payload:=jsonb_build_object('ticket_id',p_ticket_id,'version',p_version,'assigned_to',p_assigned_to,'priority',p_priority,'queue',p_queue,'escalated',p_escalated,'reason',trim(p_reason));
 insert into admin_ops.commands(command_key,actor_id,operation,payload) values(p_key,p_actor_id,'supportTriage',payload) on conflict do nothing;
 select * into saved from admin_ops.commands where command_key=p_key for update;
 if saved.actor_id<>p_actor_id or saved.operation<>'supportTriage' or saved.payload<>payload then raise exception 'COMMAND_CONFLICT';end if;
 if saved.result is not null then return saved.result;end if;
 perform 1 from public.support_tickets where id=p_ticket_id for update;
 if not found then raise exception 'TARGET_NOT_FOUND';end if;
 if p_assigned_to is not null then
  perform 1 from public.admin_users where user_id=p_assigned_to and active and role in ('super_admin','platform_admin','trust_safety','support_agent') for share;
  if not found then raise exception 'INVALID_ASSIGNEE';end if;
 end if;
 select to_jsonb(s),s.version into previous,current_version from admin_ops.support_triage s where ticket_id=p_ticket_id;
 if coalesce(current_version,0)<>p_version then raise exception 'TRIAGE_CHANGED';end if;
 insert into admin_ops.support_triage(ticket_id,assigned_to,priority,queue,escalated)
 values(p_ticket_id,p_assigned_to,p_priority,p_queue,p_escalated)
 on conflict(ticket_id) do update set assigned_to=excluded.assigned_to,priority=excluded.priority,queue=excluded.queue,escalated=excluded.escalated,version=admin_ops.support_triage.version+1,updated_at=now();
 select to_jsonb(s) into result_value from admin_ops.support_triage s where ticket_id=p_ticket_id;
 insert into public.admin_audit_log(admin_id,action,target_kind,target_id,reason,before,after)
 values(p_actor_id,'supportTriage','support_ticket',p_ticket_id::text,trim(p_reason),previous,result_value);
 result_value:=jsonb_build_object('success',true,'command_key',p_key,'version',(result_value->>'version')::integer);
 update admin_ops.commands set result=result_value where command_key=p_key;
 return result_value;
end;$$;
revoke all on function public.admin_support_triage_read(uuid[]),public.admin_support_triage_update(uuid,uuid,uuid,uuid,integer,uuid,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.admin_support_triage_read(uuid[]),public.admin_support_triage_update(uuid,uuid,uuid,uuid,integer,uuid,text,text,boolean,text) to service_role;

create function public.admin_seller_review_reports(p_actor_id uuid,p_session_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_status text default 'open')
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform admin_ops.require_session(p_actor_id,p_session_id,'report_listing');
 if p_status is null or p_status not in ('open','all') then raise exception 'INVALID_STATUS'; end if;
 if (p_before_at is null)<>(p_before_id is null) then raise exception 'INVALID_CURSOR'; end if;
 with page as(
 select t.*,r.seller_id,r.reviewer_id,r.rating,r.comment,r.moderation_status,r.order_id,r.content_version as current_version
 from public.seller_review_reports t left join public.seller_reviews r on r.id=t.review_id
 where (p_status='all' or t.status='open') and (p_before_at is null or (t.created_at,t.id)<(p_before_at,p_before_id)) order by t.created_at desc,t.id desc limit 51
 ), shown as(select * from page order by created_at desc,id desc limit 50)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(s) order by created_at desc,id desc) from shown s),'[]'::jsonb),
 'has_more',(select count(*)>50 from page),'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id) from shown order by created_at,id limit 1)) into result;
 return result;
end $$;

create function public.moderate_seller_review(p_actor_id uuid,p_session_id uuid,p_key uuid,p_report_id uuid,p_action text,p_reason text,p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.seller_review_reports; new_report public.seller_review_reports; old_review public.seller_reviews; new_review public.seller_reviews; c admin_ops.commands; payload jsonb; result jsonb;
begin
 perform admin_ops.require_session(p_actor_id,p_session_id,'report_listing');
 if p_key is null or p_action is null or p_action not in ('hide','dismiss','restore') or p_reason is null or length(btrim(p_reason))<3 or length(p_reason)>1000 then raise exception 'INVALID_MODERATION'; end if;
 payload:=jsonb_build_object('report_id',p_report_id,'action',p_action,'reason',btrim(p_reason),'version',p_expected_version);
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 select * into c from admin_ops.commands where command_key=p_key;
 if found then
  if c.actor_id<>p_actor_id or c.operation<>'moderate_seller_review' or c.payload<>payload then raise exception 'COMMAND_KEY_REUSED'; end if;
  return c.result;
 end if;
 select * into t from public.seller_review_reports where id=p_report_id for update;
 if not found then raise exception 'REPORT_NOT_FOUND'; end if;
 select * into old_review from public.seller_reviews where id=t.review_id for update;
 if not found and p_action<>'dismiss' then raise exception 'REVIEW_UNAVAILABLE'; end if;
 if p_action<>'dismiss' and p_expected_version is distinct from old_review.content_version then raise exception 'REVIEW_CHANGED_REFRESH'; end if;
 if p_action in ('hide','dismiss') and t.status<>'open' then raise exception 'REPORT_ALREADY_RESOLVED'; end if;
 if p_action='restore' and old_review.moderation_status<>'hidden' then raise exception 'REVIEW_NOT_HIDDEN'; end if;
 if p_action<>'dismiss' then update public.seller_reviews set moderation_status=case when p_action='hide' then 'hidden' else 'visible' end,updated_at=now() where id=t.review_id; end if;
 select * into new_review from public.seller_reviews where id=t.review_id;
 update public.seller_review_reports set status=case p_action when 'hide' then 'hidden' when 'restore' then 'restored' else 'dismissed' end,resolved_by=p_actor_id,resolved_at=now() where id=t.id returning * into new_report;
 insert into public.admin_audit_log(admin_id,action,target_kind,target_id,reason,before,after)
 values(p_actor_id,'seller_review_'||p_action,'seller_review_report',t.id::text,btrim(p_reason),jsonb_build_object('report',to_jsonb(t),'review',to_jsonb(old_review)),jsonb_build_object('report',to_jsonb(new_report),'review',to_jsonb(new_review)));
 result:=jsonb_build_object('success',true,'command_key',p_key);
 insert into admin_ops.commands(command_key,actor_id,operation,payload,result) values(p_key,p_actor_id,'moderate_seller_review',payload,result);
 return result;
end $$;
revoke all on function public.admin_seller_review_reports(uuid,uuid,timestamptz,uuid,text),public.moderate_seller_review(uuid,uuid,uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.admin_seller_review_reports(uuid,uuid,timestamptz,uuid,text),public.moderate_seller_review(uuid,uuid,uuid,uuid,text,text,integer) to service_role;

notify pgrst, 'reload schema';
commit;
