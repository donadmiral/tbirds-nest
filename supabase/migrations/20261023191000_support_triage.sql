begin;
set local lock_timeout='3s';
create table admin_ops.support_triage (
 ticket_id uuid primary key references public.support_tickets(id) on delete cascade,
 assigned_to uuid references public.admin_users(user_id),
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
 if p_assigned_to is not null and not exists(select 1 from public.admin_users where user_id=p_assigned_to and active and role in ('super_admin','platform_admin','trust_safety','support_agent')) then raise exception 'INVALID_ASSIGNEE';end if;
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
commit;
