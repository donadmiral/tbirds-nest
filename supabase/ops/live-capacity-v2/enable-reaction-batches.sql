-- Run only after the installed migration and a rollback-safe room test pass.
-- The threshold applies to accepted reactions and does not change room admission.
begin;
set local lock_timeout='2s';
do $enable$
declare cmd constant text := 'select live_streams.flush_reaction_batches();';
begin
 if not exists(select from pg_extension where extname='pg_cron' and split_part(extversion,'.',1)::int=1 and split_part(extversion,'.',2)::int>=5)
 then raise exception 'LIVE_REACTION_CRON_UNAVAILABLE'; end if;
 if exists(select from cron.job where jobname='platinum-live-reactions'
           and (username<>current_user or command<>cmd or schedule<>'5 seconds' or not active))
 then raise exception 'LIVE_REACTION_CRON_CONFLICT'; end if;
 if not exists(select from cron.job where jobname='platinum-live-reactions') then
  perform cron.schedule('platinum-live-reactions','5 seconds',cmd);
 end if;
 update live_streams.settings set reaction_batch_viewers=1000 where singleton;
end $enable$;
commit;
