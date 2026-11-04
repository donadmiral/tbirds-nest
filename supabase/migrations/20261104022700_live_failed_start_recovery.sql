-- Reconcile only failed starts whose authorized stop has become stale.
-- The worker must first observe Daily's exact no-current-call response, delete
-- the session's unique room, and verify its absence. Never invent a webhook.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function live_streams.failed_start_recovery_context(p_id uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx record;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_REQUIRED' using errcode='42501';end if;
 select s.id,ps.room_name,ps.instance_id into ctx
 from live_streams.provider_outbox o
 join live_streams.sessions s on s.id=o.session_id
 join live_streams.provider_sessions ps on ps.session_id=s.id
 where o.id=p_id and o.lease_id=p_lease and o.state='leased' and o.action='stop'
  and o.lease_until>clock_timestamp() and s.state='ending' and s.updated_at<clock_timestamp()-interval '2 minutes'
  and s.started_at is null and ps.playback_path is null
  and ps.room_name='pc-live-'||replace(s.id::text,'-','')
  and not exists(select 1 from live_streams.provider_events e where e.session_id=s.id and e.event_type='streaming.started')
  and not exists(select 1 from live_streams.controls c where c.session_id=s.id and c.status='processing' and c.lease_until>clock_timestamp());
 if not found then return jsonb_build_object('eligible',false);end if;
 return jsonb_build_object('eligible',true,'session_id',ctx.id,'room_name',ctx.room_name,'instance_id',ctx.instance_id,
  'recovery_started',exists(select 1 from live_streams.audit a where a.session_id=ctx.id and a.action='provider_failed_start_recovery_started'
   and a.payload->>'instance_id'=ctx.instance_id::text and a.payload->>'room_name'=ctx.room_name
   and a.payload->>'no_current_call'='true'));
end $$;

create or replace function live_streams.begin_failed_start_recovery(p_id uuid,p_lease uuid,p_instance uuid,p_room text,p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid;ctx jsonb;host uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_REQUIRED' using errcode='42501';end if;
 if p_observed_at is null or p_observed_at<clock_timestamp()-interval '20 seconds' or p_observed_at>clock_timestamp()+interval '5 seconds'
  then raise exception 'INVALID_RECOVERY_EVIDENCE';end if;
 select session_id into target from live_streams.provider_outbox where id=p_id;
 if not found then raise exception 'RECOVERY_NOT_AVAILABLE';end if;
 perform 1 from live_streams.provider_sessions where session_id=target for update;
 select host_id into host from live_streams.sessions where id=target for update;
 perform 1 from live_streams.provider_outbox where id=p_id for update;
 ctx:=live_streams.failed_start_recovery_context(p_id,p_lease);
 if ctx->>'eligible' is distinct from 'true' or ctx->>'instance_id' is distinct from p_instance::text
  or ctx->>'room_name' is distinct from p_room then raise exception 'RECOVERY_NOT_AVAILABLE';end if;
 if ctx->>'recovery_started' is distinct from 'true' then
  -- Persist provider absence before deleting anything. A later leased attempt
  -- can then finish a successful DELETE whose completion response was lost.
  insert into live_streams.audit(session_id,actor_id,action,reason,payload)
  values(target,host,'provider_failed_start_recovery_started','Provider confirmed no current call before room retirement.',
   jsonb_build_object('instance_id',p_instance,'room_name',p_room,'no_current_call',true,'observed_at',p_observed_at));
 end if;
 return ctx||jsonb_build_object('ok',true,'recovery_started',true);
end $$;

create or replace function live_streams.finish_failed_start_recovery(p_id uuid,p_lease uuid,p_instance uuid,p_room text,p_confirmed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid;ctx jsonb;host uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_REQUIRED' using errcode='42501';end if;
 if p_confirmed_at is null or p_confirmed_at<clock_timestamp()-interval '20 seconds' or p_confirmed_at>clock_timestamp()+interval '5 seconds'
  then raise exception 'INVALID_RECOVERY_EVIDENCE';end if;
 select session_id into target from live_streams.provider_outbox where id=p_id;
 if not found then raise exception 'RECOVERY_NOT_AVAILABLE';end if;
 -- Match the signed-event lock order before rechecking the leased operation.
 perform 1 from live_streams.provider_sessions where session_id=target for update;
 select host_id into host from live_streams.sessions where id=target for update;
 perform 1 from live_streams.provider_outbox where id=p_id for update;
 ctx:=live_streams.failed_start_recovery_context(p_id,p_lease);
 if ctx->>'eligible' is distinct from 'true' or ctx->>'recovery_started' is distinct from 'true' or ctx->>'instance_id' is distinct from p_instance::text
  or ctx->>'room_name' is distinct from p_room then raise exception 'RECOVERY_NOT_AVAILABLE';end if;
 update live_streams.sessions set state='cancelled',ended_at=p_confirmed_at,updated_at=now(),replay_available=false where id=target;
 update live_streams.provider_sessions set published_participants='[]'::jsonb,error=null where session_id=target;
 update live_streams.stage_grants set revoked_at=coalesce(revoked_at,now()) where session_id=target;
 update live_streams.controls set status='failed',lease_until=null,updated_at=now(),
  result=jsonb_build_object('ok',false,'session_id',target,'state','cancelled','error','FAILED_START_CANCELLED')
 where session_id=target and status in ('queued','processing');
 update live_streams.provider_outbox set state='done',lease_until=null,last_error=null
 where session_id=target and action='stop' and state in ('pending','leased','dead');
 insert into live_streams.audit(session_id,actor_id,action,reason,payload)
 values(target,host,'provider_failed_start_recovered','Provider confirmed no current call and an absent room after retirement.',
  jsonb_build_object('instance_id',p_instance,'stop_response','no_current_call','room_retired',true,'room_absence_confirmed',true,'confirmed_at',p_confirmed_at));
 perform live_streams.broadcast(target,'session',jsonb_build_object('session',live_streams.session_json(target)));
 return jsonb_build_object('ok',true,'session_id',target,'state','cancelled');
end $$;

create or replace function public.live_failed_start_recovery_context(p_id uuid,p_lease uuid)
returns jsonb language sql security invoker set search_path='' as $$select live_streams.failed_start_recovery_context(p_id,p_lease);$$;
create or replace function public.live_begin_failed_start_recovery(p_id uuid,p_lease uuid,p_instance uuid,p_room text,p_observed_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $$select live_streams.begin_failed_start_recovery(p_id,p_lease,p_instance,p_room,p_observed_at);$$;
create or replace function public.live_finish_failed_start_recovery(p_id uuid,p_lease uuid,p_instance uuid,p_room text,p_confirmed_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $$select live_streams.finish_failed_start_recovery(p_id,p_lease,p_instance,p_room,p_confirmed_at);$$;
revoke all on function live_streams.failed_start_recovery_context(uuid,uuid),
 live_streams.begin_failed_start_recovery(uuid,uuid,uuid,text,timestamptz),public.live_begin_failed_start_recovery(uuid,uuid,uuid,text,timestamptz),
 live_streams.finish_failed_start_recovery(uuid,uuid,uuid,text,timestamptz),
 public.live_failed_start_recovery_context(uuid,uuid),public.live_finish_failed_start_recovery(uuid,uuid,uuid,text,timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function live_streams.failed_start_recovery_context(uuid,uuid),
 live_streams.begin_failed_start_recovery(uuid,uuid,uuid,text,timestamptz),public.live_begin_failed_start_recovery(uuid,uuid,uuid,text,timestamptz),
 live_streams.finish_failed_start_recovery(uuid,uuid,uuid,text,timestamptz),
 public.live_failed_start_recovery_context(uuid,uuid),public.live_finish_failed_start_recovery(uuid,uuid,uuid,text,timestamptz)
 to service_role;
