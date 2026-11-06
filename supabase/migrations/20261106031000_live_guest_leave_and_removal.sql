-- Two foundations of a group live. A guest had no way to leave the stage:
-- "Leave studio" and "Leave camera" only left the room, so a departed guest kept
-- a place, a grant and an identity until the host found and removed them, and
-- acceptances failed with STAGE_FULL over empty seats. And removing or blocking a
-- guest who was still in the published layout let the minute sweep end the whole
-- broadcast, because the removed person looked like someone on air without authority.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare source text;anchor text;hits integer;
begin
 if current_user<>'postgres' then raise exception 'LIVE_GUEST_LEAVE_POSTGRES_REQUIRED';end if;
 perform pg_advisory_xact_lock(184516031,1);
 source:=pg_get_functiondef('live_streams.command(text,uuid,jsonb,uuid)'::regprocedure);

 anchor:=$a$ when 'cancel','accept_invite' then allowed:='{}';$a$;
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then raise exception 'LIVE_GUEST_LEAVE_ALLOWED_ANCHOR_DRIFT';end if;
 source:=replace(source,anchor,$r$ when 'cancel','accept_invite','leave_stage' then allowed:='{}';$r$);

 anchor:=$a$  when 'remove_member' then
   target:=(p_payload->>'user_id')::uuid;$a$;
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then raise exception 'LIVE_GUEST_LEAVE_BRANCH_ANCHOR_DRIFT';end if;
 source:=replace(source,anchor,$r$  when 'leave_stage' then
   -- A member other than the host gives up the place, the grant, the identity and
   -- the request, and may ask to join again later. The host ends the live instead.
   if uid=s.host_id then raise exception 'ACCESS_DENIED' using errcode='42501';end if;
   if not exists(select 1 from live_streams.members where session_id=sid and user_id=uid and status<>'removed') then raise exception 'STATE_CONFLICT';end if;
   update live_streams.stage_grants set revoked_at=now() where session_id=sid and user_id=uid and revoked_at is null;
   insert into live_streams.provider_outbox(session_id,action,provider_identity)
   select sid,'eject',m.provider_identity from live_streams.members m where m.session_id=sid and m.user_id=uid and m.status='accepted'
    and not exists(select 1 from live_streams.provider_outbox o where o.session_id=sid and o.action='eject' and o.provider_identity=m.provider_identity and o.state in ('pending','leased'));
   update live_streams.provider_sessions ps set published_participants=(select coalesce(jsonb_agg(p),'[]'::jsonb) from jsonb_array_elements(ps.published_participants) p where p->>'provider_identity' is distinct from m.provider_identity::text)
    from live_streams.members m where ps.session_id=sid and m.session_id=sid and m.user_id=uid and jsonb_typeof(ps.published_participants)='array';
   delete from live_streams.members where session_id=sid and user_id=uid;
   update live_streams.guest_requests set status='cancelled',updated_at=now() where session_id=sid and user_id=uid and status='accepted';
   perform live_streams.guest_notify(sid,uid);
   perform live_streams.broadcast(sid,'access_changed',jsonb_build_object('user_id',uid));
  when 'remove_member' then
   target:=(p_payload->>'user_id')::uuid;$r$);

 -- Removing or blocking someone who is on air: revoke their grant and forget them
 -- in the published layout at once. The sweep then sees nobody on air without
 -- authority and the broadcast goes on; the eject queued here removes them from the room.
 anchor:=$a$   insert into live_streams.provider_outbox(session_id,action,provider_identity) select sid,'eject',provider_identity from live_streams.members where session_id=sid and user_id=target and status='accepted';
   update live_streams.members set status='removed',provider_identity=gen_random_uuid() where session_id=sid and user_id=target;$a$;
 hits:=(length(source)-length(replace(source,anchor,'')))/length(anchor);
 if hits<>2 then raise exception 'LIVE_GUEST_REMOVAL_ANCHOR_DRIFT: %',hits;end if;
 source:=replace(source,anchor,$r$   insert into live_streams.provider_outbox(session_id,action,provider_identity) select sid,'eject',provider_identity from live_streams.members where session_id=sid and user_id=target and status='accepted';
   update live_streams.stage_grants set revoked_at=now() where session_id=sid and user_id=target and revoked_at is null;
   update live_streams.provider_sessions ps set published_participants=(select coalesce(jsonb_agg(p),'[]'::jsonb) from jsonb_array_elements(ps.published_participants) p where p->>'provider_identity' is distinct from m.provider_identity::text)
    from live_streams.members m where ps.session_id=sid and m.session_id=sid and m.user_id=target and jsonb_typeof(ps.published_participants)='array';
   update live_streams.members set status='removed',provider_identity=gen_random_uuid() where session_id=sid and user_id=target;$r$);
 execute source;
end $patch$;
notify pgrst,'reload schema';
commit;
