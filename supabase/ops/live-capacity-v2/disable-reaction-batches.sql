begin;
set local lock_timeout='2s';
update live_streams.settings set reaction_batch_viewers=null where singleton;
-- Retire the scheduled sender and discard only unsent, ephemeral reaction counts.
do $disable$ begin
 if exists(select from cron.job where jobname='platinum-live-reactions' and username=current_user
           and command='select live_streams.flush_reaction_batches();') then
  perform cron.unschedule('platinum-live-reactions');
 end if;
end $disable$;
delete from live_streams.reaction_batches;
commit;
