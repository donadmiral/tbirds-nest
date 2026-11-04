-- Measured viewer leases. Clients submit their playback activity, never a count.
-- Each browser/player instance has its own lease so closing a tab does not
-- remove another tab. Aggregation deduplicates authenticated members.
create table live_streams.viewer_presence (
 session_id uuid not null references live_streams.sessions(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 auth_session_id uuid not null references auth.sessions(id) on delete cascade,
 playback_id uuid not null,
 last_seen_at timestamptz not null,
 expires_at timestamptz not null,
 primary key(session_id,user_id,auth_session_id,playback_id)
);
alter table live_streams.viewer_presence enable row level security;
revoke all on live_streams.viewer_presence from public,anon,authenticated,service_role;
create index live_viewer_presence_stream_expiry on live_streams.viewer_presence(session_id,expires_at,user_id);
create index live_viewer_presence_expiry on live_streams.viewer_presence(expires_at);
create index live_viewer_presence_user_expiry on live_streams.viewer_presence(user_id,expires_at);
create index live_viewer_presence_auth_session on live_streams.viewer_presence(auth_session_id);
create index live_sessions_viewer_refresh on live_streams.sessions(viewer_count_at,id)
 where state in ('live','reconnecting') or viewer_count>0;

create function live_streams.viewer_heartbeat(p_session_id uuid,p_playback_id uuid,p_active boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=live_streams.require_user();sid uuid:=(auth.jwt()->>'session_id')::uuid;
 observed timestamptz:=clock_timestamp();stream_host uuid;stream_state text;lease_until timestamptz;
begin
 if p_session_id is null or p_playback_id is null or p_active is null then raise exception 'INVALID_REQUEST';end if;
 if not p_active then
  delete from live_streams.viewer_presence where session_id=p_session_id and user_id=uid and auth_session_id=sid and playback_id=p_playback_id;
  return jsonb_build_object('ok',true);
 end if;
 select host_id,state into stream_host,stream_state from live_streams.sessions where id=p_session_id;
 if not found or not live_streams.can_view(p_session_id,uid) then raise exception 'LIVE_NOT_AVAILABLE' using errcode='42501';end if;
 -- The host is excluded even when watching their own delivery.
 if stream_host=uid or stream_state not in ('live','reconnecting') then
  delete from live_streams.viewer_presence where session_id=p_session_id and user_id=uid and auth_session_id=sid and playback_id=p_playback_id;
  return jsonb_build_object('ok',true);
 end if;
 select least(observed+interval '90 seconds',coalesce(not_after,observed+interval '90 seconds')) into lease_until
  from auth.sessions where id=sid and user_id=uid;
 if lease_until is null or lease_until<=observed then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 if not exists(select 1 from live_streams.viewer_presence where session_id=p_session_id and user_id=uid and auth_session_id=sid and playback_id=p_playback_id and expires_at>observed) then
  -- Only new playback instances take a per-member lock. Normal heartbeats never
  -- contend on a broadcast counter or an aggregate row.
  perform pg_advisory_xact_lock(184516030,hashtext(uid::text));
  if not exists(select 1 from live_streams.viewer_presence where session_id=p_session_id and user_id=uid and auth_session_id=sid and playback_id=p_playback_id and expires_at>observed)
   and (select count(*) from live_streams.viewer_presence where user_id=uid and expires_at>observed)>=8 then
   raise exception 'VIEWER_INSTANCE_LIMIT';
  end if;
 end if;
 insert into live_streams.viewer_presence(session_id,user_id,auth_session_id,playback_id,last_seen_at,expires_at)
 values(p_session_id,uid,sid,p_playback_id,observed,lease_until)
 on conflict(session_id,user_id,auth_session_id,playback_id) do update
 set last_seen_at=excluded.last_seen_at,expires_at=excluded.expires_at
 where live_streams.viewer_presence.last_seen_at<observed-interval '20 seconds'
  or live_streams.viewer_presence.expires_at>excluded.expires_at;
 return jsonb_build_object('ok',true);
end $$;

create function public.live_viewer_heartbeat(p_session_id uuid,p_playback_id uuid,p_active boolean default true)
returns jsonb language sql security invoker set search_path='' as $$
 select live_streams.viewer_heartbeat(p_session_id,p_playback_id,p_active);
$$;
revoke all on function live_streams.viewer_heartbeat(uuid,uuid,boolean),public.live_viewer_heartbeat(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function live_streams.viewer_heartbeat(uuid,uuid,boolean),public.live_viewer_heartbeat(uuid,uuid,boolean) to authenticated;

create function live_streams.refresh_viewer_counts(p_limit integer default 1000)
returns jsonb language plpgsql security definer set search_path='' as $$
declare lim integer:=greatest(1,least(coalesce(p_limit,1000),5000));observed timestamptz:=clock_timestamp();
 target record;total bigint;measured integer:=0;changed integer:=0;pruned integer:=0;
begin
 with stale as(
  select session_id,user_id,auth_session_id,playback_id from live_streams.viewer_presence
  where expires_at<=observed order by expires_at for update skip locked limit lim
 )
 delete from live_streams.viewer_presence p using stale
 where (p.session_id,p.user_id,p.auth_session_id,p.playback_id)=(stale.session_id,stale.user_id,stale.auth_session_id,stale.playback_id);
 get diagnostics pruned=row_count;
 for target in
  select s.id,s.host_id,s.state,s.viewer_count from live_streams.sessions s
  where (s.state in ('live','reconnecting') or s.viewer_count>0)
   and (s.viewer_count_at is null or s.viewer_count_at<observed-interval '20 seconds')
  order by s.viewer_count_at nulls first,s.id for no key update of s skip locked limit lim
 loop
  if target.state in ('live','reconnecting') then
   select count(distinct p.user_id) into total from live_streams.viewer_presence p
    where p.session_id=target.id and p.expires_at>observed and p.user_id<>target.host_id;
  else total:=0;
  end if;
  update live_streams.sessions set viewer_count=total,viewer_count_at=observed where id=target.id;
  -- Do not touch updated_at. Provider stop/recovery uses that timestamp.
  measured:=measured+1;
  if target.viewer_count is distinct from total then
   changed:=changed+1;
   perform live_streams.broadcast(target.id,'session',jsonb_build_object('session',live_streams.session_json(target.id)));
  end if;
 end loop;
 return jsonb_build_object('measured',measured,'changed',changed,'expired_pruned',pruned);
end $$;
revoke all on function live_streams.refresh_viewer_counts(integer) from public,anon,authenticated,service_role;

-- Keep every existing session field and ACL. An old measurement is unknown.
create or replace function live_streams.session_json(p_session uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select (to_jsonb(s)-'pinned_message_id'-'chat_epoch'-'cover_object_path')||jsonb_build_object(
  'host',live_streams.profile_json(s.host_id),'has_cover',s.cover_object_path is not null,
  'viewer_count',case when s.viewer_count_at>now()-interval '90 seconds' then s.viewer_count else null end)
 from live_streams.sessions s where s.id=p_session;
$$;

-- Preserve the deployed maintenance implementation and add one bounded count
-- pass to its existing schedule. No per-viewer cron jobs or counter increments.
CREATE OR REPLACE FUNCTION live_streams.maintenance(p_limit integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare lim integer:=greatest(1,least(coalesce(p_limit,1000),5000));messages integer;commands integer;rates integer;events integer;notifications integer;
 controls integer;outbox integer;grants integer;stopped integer:=0;revoked integer:=0;authority_row record;grant_row live_streams.stage_grants;
begin
 notifications:=live_streams.notification_batch(200);
 -- Auth revocation is checked against bound sessions, devices and current team
 -- roles. No audience member writes to these authority or provider rows.
 for grant_row in select * from live_streams.stage_grants where revoked_at is null and (checked_at is null or checked_at<now()-interval '45 seconds')
  order by checked_at nulls first,id for update skip locked limit lim loop
  update live_streams.stage_grants set checked_at=now() where id=grant_row.id;
  if grant_row.expires_at<=now() or not live_streams.publisher_allowed(grant_row.user_id,grant_row.auth_session_id)
   or not live_streams.can_view(grant_row.session_id,grant_row.user_id) or live_streams.role_for(grant_row.session_id,grant_row.user_id) not in ('host','producer','camera','guest') then
   update live_streams.stage_grants set revoked_at=now() where id=grant_row.id;
   insert into live_streams.provider_outbox(session_id,action,provider_identity) values(grant_row.session_id,'eject',grant_row.provider_identity);
   revoked:=revoked+1;
   if exists(select 1 from live_streams.provider_sessions ps where ps.session_id=grant_row.session_id
    and ps.published_participants @> jsonb_build_array(jsonb_build_object('provider_identity',grant_row.provider_identity::text))) then
    update live_streams.sessions set state='ending',updated_at=now() where id=grant_row.session_id and state in ('starting','live','reconnecting');
    insert into live_streams.provider_outbox(session_id,action) select grant_row.session_id,'stop'
     where not exists(select 1 from live_streams.provider_outbox where session_id=grant_row.session_id and action='stop' and state in ('pending','leased'));
    perform live_streams.broadcast(grant_row.session_id,'access_changed',jsonb_build_object('session_id',grant_row.session_id));
   end if;
  end if;
 end loop;
 for authority_row in select ps.session_id,ps.authority_actor_id,ps.authority_session_id,s.state,s.updated_at from live_streams.provider_sessions ps
  join live_streams.sessions s on s.id=ps.session_id where s.state in ('starting','live','reconnecting','ending')
  and (ps.authority_checked_at is null or ps.authority_checked_at<now()-interval '45 seconds')
  order by ps.authority_checked_at nulls first,ps.session_id for update of ps skip locked limit lim loop
  update live_streams.provider_sessions set authority_checked_at=now() where session_id=authority_row.session_id;
  if not coalesce(live_streams.publisher_allowed(authority_row.authority_actor_id,authority_row.authority_session_id),false)
   or not live_streams.can_view(authority_row.session_id,authority_row.authority_actor_id) or live_streams.role_for(authority_row.session_id,authority_row.authority_actor_id) not in ('host','producer')
   or authority_row.state='ending' and authority_row.updated_at<now()-interval '2 minutes'
   or authority_row.state='starting' and authority_row.updated_at<now()-interval '2 minutes' then
   update live_streams.sessions set state='ending',updated_at=case when state='ending' then updated_at else now() end where id=authority_row.session_id;
   insert into live_streams.provider_outbox(session_id,action) select authority_row.session_id,'stop'
    where not exists(select 1 from live_streams.provider_outbox where session_id=authority_row.session_id and action='stop'
     and (state in ('pending','leased') or created_at>now()-interval '2 minutes'));
   stopped:=stopped+1;
   perform live_streams.broadcast(authority_row.session_id,'session',jsonb_build_object('session',jsonb_build_object('id',authority_row.session_id,'state','ending','updated_at',now())));
  end if;
 end loop;
 with stale as(select id from live_streams.messages m where created_at<now()-interval '14 days'
  and not exists(select 1 from live_streams.sessions s where s.pinned_message_id=m.id)
  and not exists(select 1 from live_streams.reports r where r.message_id=m.id and r.state='open')
  order by created_at,id for update skip locked limit lim) delete from live_streams.messages m using stale where m.id=stale.id;get diagnostics messages=row_count;
 with stale as(select actor_id,request_id from live_streams.commands where created_at<now()-interval '7 days' order by created_at for update skip locked limit lim)
 delete from live_streams.commands c using stale where (c.actor_id,c.request_id)=(stale.actor_id,stale.request_id);get diagnostics commands=row_count;
 with stale as(select scope,key,window_start from live_streams.rate_limits where window_start<now()-interval '2 days' order by window_start for update skip locked limit lim)
 delete from live_streams.rate_limits r using stale where (r.scope,r.key,r.window_start)=(stale.scope,stale.key,stale.window_start);get diagnostics rates=row_count;
 with stale as(select event_id from live_streams.provider_events where created_at<now()-interval '30 days' order by created_at for update skip locked limit lim)
 delete from live_streams.provider_events e using stale where e.event_id=stale.event_id;get diagnostics events=row_count;
 with stale as(select c.id from live_streams.controls c join live_streams.sessions s on s.id=c.session_id where c.created_at<now()-interval '7 days'
  and s.state in ('ended','cancelled') order by c.created_at for update of c skip locked limit lim)
 delete from live_streams.controls c using stale where c.id=stale.id;get diagnostics controls=row_count;
 with stale as(select id from live_streams.provider_outbox where state='done' and created_at<now()-interval '7 days' order by created_at for update skip locked limit lim)
 delete from live_streams.provider_outbox o using stale where o.id=stale.id;get diagnostics outbox=row_count;
 with stale as(select id from live_streams.stage_grants where revoked_at is not null and created_at<now()-interval '7 days' order by created_at for update skip locked limit lim)
 delete from live_streams.stage_grants g using stale where g.id=stale.id;get diagnostics grants=row_count;
 -- Run after provider-session locks. Provider events lock provider then session.
 perform live_streams.refresh_viewer_counts(lim);
 return jsonb_build_object('messages_pruned',messages,'commands_pruned',commands,'rates_pruned',rates,'events_pruned',events,'notifications_created',notifications,
  'controls_pruned',controls,'outbox_pruned',outbox,'grants_pruned',grants,'stage_grants_revoked',revoked,'orphan_stops_queued',stopped);
end $function$
