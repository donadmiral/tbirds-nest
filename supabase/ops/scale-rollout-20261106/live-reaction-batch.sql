-- Operator-only. Test identities or rooms roll back before the result is returned.
begin;
set local lock_timeout='2s'; set local statement_timeout='15s';
create temporary table reaction_acceptance(result jsonb) on commit drop;
do $test$
declare sid uuid:=gen_random_uuid(); epoch uuid:=gen_random_uuid(); fixture_topic text:='live:'||sid||':'||epoch; received jsonb; n integer; emitted integer;
begin
 begin
   update live_streams.settings set reaction_batch_viewers=1000 where singleton;
   insert into live_streams.sessions(id,host_id,title,topic,audience,state,viewer_count,chat_epoch)
     select sid,id,'Rollback-only batching probe','other','invite','live',100000,epoch from public.profiles limit 1;
   if not found then raise exception 'NO_FIXTURE_HOST'; end if;
   for n in 1..25 loop
    perform live_streams.broadcast(sid,'reaction',jsonb_build_object('id',gen_random_uuid(),'reaction',case when n<=15 then 'heart' when n<=22 then 'fire' else 'applause' end));
   end loop;
   if exists(select 1 from realtime.messages m where m.topic=fixture_topic and m.event='reaction' and m.inserted_at>now()-interval '1 minute') then raise exception 'IMMEDIATE_FANOUT'; end if;
   update live_streams.reaction_batches set window_at=window_at-interval '10 seconds' where session_id=sid;
   emitted:=live_streams.flush_reaction_batches();
   select m.payload into strict received from realtime.messages m where m.topic=fixture_topic and m.event='reaction' and m.private and m.inserted_at>now()-interval '1 minute';
   if received->'counts' is distinct from '{"heart":15,"fire":7,"applause":3}'::jsonb or received->>'reaction'<>'heart' then raise exception 'WRONG_SUMMARY';end if;
   perform live_streams.broadcast(sid,'reaction',jsonb_build_object('id',gen_random_uuid(),'reaction','fire'));
   update live_streams.sessions set chat_epoch=gen_random_uuid() where id=sid;
   update live_streams.reaction_batches set window_at=window_at-interval '10 seconds' where session_id=sid;
   perform live_streams.flush_reaction_batches();
   if (select count(*) from realtime.messages m where m.topic like 'live:'||sid||':%' and m.event='reaction' and m.inserted_at>now()-interval '1 minute')<>1 then raise exception 'EPOCH_LEAK';end if;
   raise sqlstate 'ZQ001' using message='rollback fixture';
 exception when sqlstate 'ZQ001' then null;
 end;
 if exists(select 1 from live_streams.sessions where id=sid) then raise exception 'FIXTURE_RETAINED';end if;
 insert into pg_temp.reaction_acceptance values (jsonb_build_object('accepted_fixture_taps',25,'private_messages',1,'counts',received->'counts','old_epoch_suppressed',true,'fixture_removed',true));
end $test$;
select result from pg_temp.reaction_acceptance;
commit;

