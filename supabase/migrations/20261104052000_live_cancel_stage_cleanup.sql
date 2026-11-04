-- Cancelling an unused Live session revokes its issued stage grants and sends
-- the existing provider ban/eject operation. No provider event is fabricated.
-- The meeting token admits a join for two minutes. Its six-hour database grant
-- also governs an already joined participant, so cancellation must revoke it.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare expected record;source text;anchor text;grant_start integer;authority_start integer;cleanup_start integer;
 authority_block text;grant_block text;
begin
 if current_user<>'postgres' then raise exception 'LIVE_CANCEL_CLEANUP_POSTGRES_REQUIRED';end if;
 perform pg_advisory_xact_lock(184516031,1);
 -- Inspected QA and production definitions are identical. Preserve their owner,
 -- search path and private execution grants through CREATE OR REPLACE.
 for expected in select * from(values
  ('live_streams.command(text,uuid,jsonb,uuid)','d544b435226623ee29cb47c6717f040d','{postgres=X/postgres,authenticated=X/postgres}'),
  ('live_streams.service_context(uuid,uuid,uuid,text,uuid)','b8e88130f9706a3cfe8356de3e65ac9e','{postgres=X/postgres,service_role=X/postgres}'),
  ('live_streams.maintenance(integer)','7681b26d56db36c1a16af7a8b35fdaaf','{postgres=X/postgres,service_role=X/postgres}')
 ) as definitions(signature,fingerprint,acl) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(expected.signature)
   and md5(pg_get_functiondef(p.oid))=expected.fingerprint and pg_get_userbyid(p.proowner)='postgres'
   and p.proacl::text=expected.acl and p.prosecdef and p.proconfig=array['search_path=""']::text[]) then
   raise exception 'LIVE_CANCEL_CLEANUP_BASELINE_DRIFT: %',expected.signature;
  end if;
 end loop;

 source:=pg_get_functiondef('live_streams.command(text,uuid,jsonb,uuid)'::regprocedure);
 anchor:=$anchor$   update live_streams.sessions set state='cancelled',ended_at=now(),updated_at=now() where id=sid;
  when 'chat' then$anchor$;
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then raise exception 'LIVE_CANCEL_CLEANUP_COMMAND_ANCHOR_DRIFT';end if;
 execute replace(source,anchor,$replacement$   update live_streams.sessions set state='cancelled',ended_at=now(),updated_at=now() where id=sid;
   -- The command already holds this session row. Stage issuance takes a shared
   -- row lock before recording its grant, so either ordering observes cancel.
   with revoked as(
    update live_streams.stage_grants set revoked_at=now()
    where session_id=sid and revoked_at is null returning provider_identity
   )
   insert into live_streams.provider_outbox(session_id,action,provider_identity)
   select distinct sid,'eject',g.provider_identity from revoked g
   where not exists(select 1 from live_streams.provider_outbox o where o.session_id=sid
    and o.action='eject' and o.provider_identity=g.provider_identity and o.state in ('pending','leased'));
  when 'chat' then$replacement$);

 source:=pg_get_functiondef('live_streams.service_context(uuid,uuid,uuid,text,uuid)'::regprocedure);
 anchor:=' select * into s from live_streams.sessions where id=p_session;';
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then raise exception 'LIVE_CANCEL_CLEANUP_STAGE_ANCHOR_DRIFT';end if;
 execute replace(source,anchor,$replacement$ -- Stage grant issuance must serialize with cancellation before its state
 -- check and grant insert. Other provider operations keep their existing locks.
 if p_purpose='stage' then
  select * into s from live_streams.sessions where id=p_session for share;
 else
  select * into s from live_streams.sessions where id=p_session;
 end if;$replacement$);

 source:=pg_get_functiondef('live_streams.maintenance(integer)'::regprocedure);
 anchor:='authority_row record;grant_row live_streams.stage_grants;';
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then raise exception 'LIVE_CANCEL_CLEANUP_MAINTENANCE_DECLARATION_DRIFT';end if;
 source:=replace(source,anchor,'authority_row record;grant_candidate record;grant_state text;grant_row live_streams.stage_grants;');
 grant_start:=position(' for grant_row in select * from live_streams.stage_grants' in source);
 authority_start:=position(' for authority_row in select ps.session_id' in source);
 cleanup_start:=position(' with stale as(select id from live_streams.messages m' in source);
 if grant_start=0 or authority_start<=grant_start or cleanup_start<=authority_start then
  raise exception 'LIVE_CANCEL_CLEANUP_MAINTENANCE_ANCHOR_DRIFT';end if;
 authority_block:=substring(source from authority_start for cleanup_start-authority_start);
 grant_block:=$grants$ -- Provider authority runs first, retaining provider-session -> session lock
 -- order used by signed provider events. Grant processing then locks session
 -- before grant, matching cancellation and stage issuance. Busy rows are skipped.
 for grant_candidate in select id,session_id from live_streams.stage_grants
  where revoked_at is null and (checked_at is null or checked_at<now()-interval '45 seconds')
  order by checked_at nulls first,id limit lim loop
  select state into grant_state from live_streams.sessions where id=grant_candidate.session_id
   for no key update skip locked;
  if not found then continue;end if;
  select * into grant_row from live_streams.stage_grants where id=grant_candidate.id
   and session_id=grant_candidate.session_id and revoked_at is null
   and (checked_at is null or checked_at<now()-interval '45 seconds') for update skip locked;
  if not found then continue;end if;
  update live_streams.stage_grants set checked_at=now() where id=grant_row.id;
  if grant_state in ('ended','cancelled') or grant_row.expires_at<=now()
   or not live_streams.publisher_allowed(grant_row.user_id,grant_row.auth_session_id)
   or not live_streams.can_view(grant_row.session_id,grant_row.user_id)
   or live_streams.role_for(grant_row.session_id,grant_row.user_id) not in ('host','producer','camera','guest') then
   update live_streams.stage_grants set revoked_at=now() where id=grant_row.id;
   insert into live_streams.provider_outbox(session_id,action,provider_identity)
   select grant_row.session_id,'eject',grant_row.provider_identity
    where not exists(select 1 from live_streams.provider_outbox o where o.session_id=grant_row.session_id
     and o.action='eject' and o.provider_identity=grant_row.provider_identity and o.state in ('pending','leased'));
   revoked:=revoked+1;
   -- Terminal cleanup only ejects. Never turn a cancelled/ended session into a
   -- fresh stop operation because its previous scene still lists participants.
   if grant_state in ('starting','live','reconnecting','ending')
    and exists(select 1 from live_streams.provider_sessions ps where ps.session_id=grant_row.session_id
     and ps.published_participants @> jsonb_build_array(jsonb_build_object('provider_identity',grant_row.provider_identity::text))) then
    update live_streams.sessions set state='ending',updated_at=now() where id=grant_row.session_id and state in ('starting','live','reconnecting');
    insert into live_streams.provider_outbox(session_id,action) select grant_row.session_id,'stop'
     where not exists(select 1 from live_streams.provider_outbox where session_id=grant_row.session_id and action='stop' and state in ('pending','leased'));
    perform live_streams.broadcast(grant_row.session_id,'access_changed',jsonb_build_object('session_id',grant_row.session_id));
   end if;
  end if;
 end loop;
$grants$;
 execute substring(source from 1 for grant_start-1)||authority_block||grant_block||substring(source from cleanup_start);
end $patch$;
notify pgrst,'reload schema';
commit;
