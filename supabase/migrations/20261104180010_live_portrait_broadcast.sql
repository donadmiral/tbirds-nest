-- Fix output orientation at broadcast start. Camera scene changes cannot resize a live encoder.
-- Daily HLS and start output dimensions verified 2026-11-04:
-- https://docs.daily.co/docs/guides/features/live-streaming/hls
-- https://docs.daily.co/reference/rest-api/rooms/live-streaming/start
set local lock_timeout='3s';
set local statement_timeout='60s';
alter table live_streams.provider_sessions add column output_orientation text not null default 'landscape'
 check(output_orientation in ('landscape','portrait'));
do $install$
declare original text;changed text;
begin
 original:=pg_get_functiondef('live_streams.prepare_control(uuid,text,uuid,jsonb,text)'::regprocedure);
 if md5(original)<>'8c2b3be0f9a11d2bfae656c2ce8b85ae' then raise exception 'LIVE_PREPARE_CONTROL_DEFINITION_CHANGED';end if;
 changed:=replace(original,
  ' if p_action=''scene'' and (jsonb_typeof(p_scene)',
  ' if p_scene ? ''orientation'' and (jsonb_typeof(p_scene->''orientation'') is distinct from ''string'' or p_scene->>''orientation'' not in (''portrait'',''landscape'')) then raise exception ''INVALID_SCENE'';end if;
 if p_action=''scene'' and (jsonb_typeof(p_scene)');
 if changed=original then raise exception 'LIVE_ORIENTATION_VALIDATION_ANCHOR_MISSING';end if;
 original:=changed;
 changed:=replace(original,
  'update live_streams.provider_sessions set authority_actor_id=uid,authority_session_id=sid where session_id=p_session;',
  'update live_streams.provider_sessions set authority_actor_id=uid,authority_session_id=sid,output_orientation=coalesce(p_scene->>''orientation'',''landscape'') where session_id=p_session;');
 if changed=original then raise exception 'LIVE_ORIENTATION_START_ANCHOR_MISSING';end if;execute changed;
 original:=pg_get_functiondef('live_streams.service_context(uuid,uuid,uuid,text,uuid)'::regprocedure);
 if md5(original)<>'079ec807829174f8d0603150363be923' then raise exception 'LIVE_SERVICE_CONTEXT_DEFINITION_CHANGED';end if;
 changed:=replace(original,'''active_scene'',ps.active_scene)', '''active_scene'',ps.active_scene,''output_orientation'',ps.output_orientation)');
 if changed=original then raise exception 'LIVE_ORIENTATION_CONTEXT_ANCHOR_MISSING';end if;execute changed;
end $install$;
