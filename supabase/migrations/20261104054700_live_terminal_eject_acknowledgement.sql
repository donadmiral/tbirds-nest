-- An exact provider no-current-call response can finish a terminal eject only
-- after every issued meeting token and bounded in-flight issuance has expired.
-- This records absence. It never claims that a participant was ejected.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $guard$
declare expected record;
begin
 if current_user<>'postgres' then raise exception 'LIVE_TERMINAL_EJECT_POSTGRES_REQUIRED';end if;
 perform pg_advisory_xact_lock(184516031,1);
 for expected in select * from(values
  ('live_streams.command(text,uuid,jsonb,uuid)','cf4ee3d32c0efa2a42a4401607ff4f2b','{postgres=X/postgres,authenticated=X/postgres}'),
  ('live_streams.service_context(uuid,uuid,uuid,text,uuid)','079ec807829174f8d0603150363be923','{postgres=X/postgres,service_role=X/postgres}'),
  ('live_streams.maintenance(integer)','61a97a004b1859e2b5cb3d986a649865','{postgres=X/postgres,service_role=X/postgres}')
 ) as definitions(signature,fingerprint,acl) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(expected.signature)
   and md5(pg_get_functiondef(p.oid))=expected.fingerprint and pg_get_userbyid(p.proowner)='postgres'
   and p.proacl::text=expected.acl and p.prosecdef and p.proconfig=array['search_path=""']::text[]) then
   raise exception 'LIVE_TERMINAL_EJECT_BASELINE_DRIFT: %',expected.signature;
  end if;
 end loop;
 if to_regprocedure('live_streams.finish_terminal_eject(uuid,uuid,uuid,uuid,text,uuid,timestamptz)') is not null
  or to_regprocedure('public.live_finish_terminal_eject(uuid,uuid,uuid,uuid,text,uuid,timestamptz)') is not null
  then raise exception 'LIVE_TERMINAL_EJECT_ALREADY_PRESENT';end if;
end $guard$;

create function live_streams.finish_terminal_eject(p_id uuid,p_lease uuid,p_session uuid,p_instance uuid,
 p_room text,p_identity uuid,p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ps live_streams.provider_sessions;s live_streams.sessions;o live_streams.provider_outbox;cutoff timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_REQUIRED' using errcode='42501';end if;
 if p_observed_at is null or p_observed_at<clock_timestamp()-interval '20 seconds'
  or p_observed_at>clock_timestamp()+interval '5 seconds' then raise exception 'INVALID_EJECT_EVIDENCE';end if;
 -- Match signed provider events. Session UPDATE conflicts with stage issuance's
 -- SHARE lock, so no grant can renew during the final authority checks.
 select * into ps from live_streams.provider_sessions where session_id=p_session for update;
 select * into s from live_streams.sessions where id=p_session for update;
 select * into o from live_streams.provider_outbox where id=p_id for update;
 -- A row-lock wait must not turn an old provider observation into fresh proof.
 if p_observed_at<clock_timestamp()-interval '20 seconds'
  or p_observed_at>clock_timestamp()+interval '5 seconds' then raise exception 'INVALID_EJECT_EVIDENCE';end if;
 if s.id is null or ps.session_id is null or o.id is null
  or o.session_id is distinct from p_session or o.provider_identity is distinct from p_identity
  or o.action<>'eject' or o.state<>'leased' or p_lease is null or o.lease_id is null or o.lease_id is distinct from p_lease
  or o.lease_until is null or o.lease_until<=clock_timestamp()
  or ps.instance_id is distinct from p_instance or ps.room_name is distinct from p_room
  or p_room is distinct from 'pc-live-'||replace(p_session::text,'-','')
  or s.state not in ('cancelled','ended') or s.ended_at is null
  or exists(select 1 from live_streams.controls c where c.session_id=p_session and c.status in ('queued','processing'))
  or not exists(select 1 from live_streams.stage_grants g where g.session_id=p_session and g.provider_identity=p_identity and g.revoked_at is not null)
  or exists(select 1 from live_streams.stage_grants g where g.session_id=p_session and g.revoked_at is null)
 then raise exception 'TERMINAL_EJECT_NOT_ELIGIBLE';end if;
 -- Current stage tokens expire 120 seconds after request start. Provider work
 -- has a 20-second request deadline. The remaining 40 seconds is a clock and
 -- settlement margin. Include every grant, including renewed auth sessions.
 select greatest(s.ended_at,max(g.revoked_at),max(g.expires_at-interval '6 hours'))+interval '3 minutes'
 into cutoff from live_streams.stage_grants g where g.session_id=p_session;
 if cutoff is null or clock_timestamp()<cutoff or p_observed_at<cutoff then raise exception 'TERMINAL_EJECT_TOKEN_WINDOW';end if;
 update live_streams.provider_outbox set state='done',lease_until=null,last_error=null where id=p_id;
 insert into live_streams.audit(session_id,actor_id,action,reason,payload)
 values(p_session,s.host_id,'terminal_stage_absence_confirmed','System maintenance: provider reported no current call after the stage token window.',
  jsonb_build_object('outbox_id',p_id,'instance_id',p_instance,'provider_identity',p_identity,
   'no_current_call',true,'token_cutoff_at',cutoff,'observed_at',p_observed_at,
   'actor_kind','system','performed_by','live-maintenance','owner_id',s.host_id));
 return jsonb_build_object('ok',true,'outcome','no_current_call_after_token_window','session_id',p_session,
  'instance_id',p_instance,'room_name',p_room,'provider_identity',p_identity,'state',s.state);
end $$;

create function public.live_finish_terminal_eject(p_id uuid,p_lease uuid,p_session uuid,p_instance uuid,
 p_room text,p_identity uuid,p_observed_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $$
 select live_streams.finish_terminal_eject(p_id,p_lease,p_session,p_instance,p_room,p_identity,p_observed_at);
$$;
revoke all on function live_streams.finish_terminal_eject(uuid,uuid,uuid,uuid,text,uuid,timestamptz),
 public.live_finish_terminal_eject(uuid,uuid,uuid,uuid,text,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function live_streams.finish_terminal_eject(uuid,uuid,uuid,uuid,text,uuid,timestamptz),
 public.live_finish_terminal_eject(uuid,uuid,uuid,uuid,text,uuid,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
