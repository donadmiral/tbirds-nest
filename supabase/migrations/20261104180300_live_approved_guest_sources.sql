-- Trusted on-air guest identities are visible only to the host and accepted producers.
set local lock_timeout='3s';
set local statement_timeout='60s';
-- Bound profile deletion's foreign-key cascade to this user's request rows.
create index live_guest_requests_user on live_streams.guest_requests(user_id,session_id);
do $install$
declare original text;changed text;
begin
 original:=pg_get_functiondef('live_streams.guest_snapshot(uuid,boolean)'::regprocedure);
 if md5(original)<>'47ac6a9697df2f55d7266c86eab4c47d' then raise exception 'LIVE_GUEST_SNAPSHOT_DEFINITION_CHANGED';end if;
 changed:=replace(original,$anchor$'join_requests',pending,$anchor$,$patch$'join_requests',pending,
  'stage_guest_identities',case when not p_admin and actor_role in ('host','producer') and s.state in ('starting','live','reconnecting') then (
   select coalesce(jsonb_agg(g.provider_identity order by g.created_at,g.user_id),'[]') from (
    select m.provider_identity,m.created_at,m.user_id from live_streams.members m
    where m.session_id=p_session and m.status='accepted' and m.role='guest'
     and live_streams.can_view(p_session,m.user_id)
     and exists(select 1 from live_streams.stage_grants sg where sg.session_id=p_session and sg.user_id=m.user_id and sg.provider_identity=m.provider_identity
       and sg.revoked_at is null and sg.expires_at>now() and live_streams.publisher_allowed(sg.user_id,sg.auth_session_id))
    order by m.created_at,m.user_id limit 11
   ) g
  ) else '[]'::jsonb end,$patch$);
 if changed=original then raise exception 'LIVE_GUEST_SOURCES_ANCHOR_MISSING';end if;execute changed;
end $install$;
