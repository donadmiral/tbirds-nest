-- Read the persisted canvas after start without overriding a host's pre-start selection.
set local lock_timeout='3s';
set local statement_timeout='60s';
do $install$
declare original text;changed text;
begin
 original:=pg_get_functiondef('live_streams.guest_snapshot(uuid,boolean)'::regprocedure);
 if md5(original)<>'aa7d58330a7942a15cf6614ec134d716' then raise exception 'LIVE_GUEST_SNAPSHOT_DEFINITION_CHANGED';end if;
 changed:=replace(original,$anchor$'join_requests',pending,$anchor$,$patch$'join_requests',pending,
  'output_orientation',case when s.state in ('starting','live','reconnecting','ending','ended') then
   (select ps.output_orientation from live_streams.provider_sessions ps where ps.session_id=p_session) else null end,$patch$);
 if changed=original then raise exception 'LIVE_DETAIL_ORIENTATION_ANCHOR_MISSING';end if;execute changed;
end $install$;
