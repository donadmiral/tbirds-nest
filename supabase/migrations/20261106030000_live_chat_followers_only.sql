-- A viewer who is not following the host of a followers-only chat was told the
-- chat is closed, on every platform. It is open; they need to follow. Raise a
-- code that says so, so the apps can show the real reason. A closed chat still
-- raises CHAT_CLOSED, and hosts, producers and moderators keep writing in both.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare source text;anchor text;
begin
 if current_user<>'postgres' then raise exception 'LIVE_CHAT_FOLLOWERS_ONLY_POSTGRES_REQUIRED';end if;
 perform pg_advisory_xact_lock(184516031,1);
 source:=pg_get_functiondef('live_streams.command(text,uuid,jsonb,uuid)'::regprocedure);
 anchor:=$anchor$   if (s.chat_mode='closed' or (s.chat_mode='followers' and not exists(select 1 from public.follows where follower_id=uid and following_id=s.host_id))) and role not in ('host','producer','moderator') then raise exception 'CHAT_CLOSED';end if;$anchor$;
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then raise exception 'LIVE_CHAT_FOLLOWERS_ONLY_ANCHOR_DRIFT';end if;
 execute replace(source,anchor,$replacement$   if s.chat_mode='closed' and role not in ('host','producer','moderator') then raise exception 'CHAT_CLOSED';end if;
   if s.chat_mode='followers' and role not in ('host','producer','moderator') and not exists(select 1 from public.follows where follower_id=uid and following_id=s.host_id) then raise exception 'FOLLOWERS_ONLY';end if;$replacement$);
end $patch$;
commit;
