-- A canonical decision produces exactly one activity row in the same transaction.
-- The existing durable command receipt returns before this branch on replay.
-- No historical fanout, provider call, admission change or user-row modification at install.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
do $install$
declare before_meta jsonb; def text; anchor text := ' perform live_streams.guest_notify(p_session,target);';
begin
 perform pg_advisory_xact_lock(184516031,1);
 select to_jsonb(p)-'prosrc', pg_get_functiondef(p.oid) into strict before_meta,def
 from pg_proc p where p.oid='live_streams.guest_command(text,uuid,jsonb,uuid)'::regprocedure and md5(p.prosrc)='9f50a1d53dfee260bcd155e10f8701c7';
 if (length(def)-length(replace(def,anchor,'')))<>length(anchor) then raise exception 'GUEST_DECISION_SOURCE_DRIFT';end if;
 execute replace(def,anchor,$body$
 if p_action in ('accept_join_request','decline_join_request') and cfg.reminders_enabled
 and target<>uid and live_streams.account_available(target) and live_streams.can_view(p_session,target)
 and not exists(select 1 from public.blocked_users b where (b.blocker_id=uid and b.blocked_id=target) or (b.blocker_id=target and b.blocked_id=uid))
 and not exists(select 1 from public.user_restrictions r where r.restrictor_id=target and r.restricted_id in (uid,s.host_id))
 and exists(select 1 from public.profiles p where p.id=target and p.notif_prefs->'all' is distinct from 'false'::jsonb
   and p.notif_prefs->'updates' is distinct from 'false'::jsonb and p.notif_prefs->'live_stream' is distinct from 'false'::jsonb) then
  insert into public.notifications(recipient_id,actor_id,type,message,data)
  values(target,null,'live_stream',case p_action when 'accept_join_request' then 'Your request to join the live stage was accepted.' else 'Your request to join the live stage was declined.' end,
    jsonb_build_object('live_session_id',p_session,'recipient_id',target,'kind',case p_action when 'accept_join_request' then 'guest_accepted' else 'guest_declined' end));
 end if;
$body$||anchor);
 if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid='live_streams.guest_command(text,uuid,jsonb,uuid)'::regprocedure) is distinct from before_meta
 then raise exception 'GUEST_DECISION_FUNCTION_METADATA_CHANGED';end if;
end $install$;
commit;
