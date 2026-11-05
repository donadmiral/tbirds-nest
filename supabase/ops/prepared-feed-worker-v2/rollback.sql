-- Generated from policy.json by build.cjs.
-- Restore only the reviewed single v1 job and its original history policy.
-- Keep feature flags, ranking functions, originals, and user data unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='8s';
do $rollback$
declare old_job bigint;history_job bigint;lane record;
begin
 select jobid into old_job from cron.job where jobname='prepared-feed-refresh-v1' and command='set statement_timeout=''8s''; select public.drain_prepared_feed_v1(1);' and schedule='10 seconds';
 select jobid into history_job from cron.job where jobname='prepared-feed-history-v1' and command in('set statement_timeout=''8s''; delete from cron.job_run_details where runid in (select runid from cron.job_run_details where jobid in(select jobid from cron.job where jobname in(''prepared-feed-refresh-v1'',''prepared-feed-history-v1'')) and end_time < now()-interval ''7 days'' order by runid limit 20000);','set statement_timeout=''8s''; delete from cron.job_run_details where runid in (select r.runid from cron.job_run_details r join cron.job j using(jobid) where j.jobname in(''prepared-feed-refresh-v1'',''prepared-feed-history-v1'',''prepared-feed-refresh-v2-1'',''prepared-feed-refresh-v2-2'',''prepared-feed-refresh-v2-3'',''prepared-feed-refresh-v2-4'') and r.end_time < now()-case when j.jobname in(''prepared-feed-refresh-v2-1'',''prepared-feed-refresh-v2-2'',''prepared-feed-refresh-v2-3'',''prepared-feed-refresh-v2-4'') then interval ''1 hour'' else interval ''7 days'' end order by r.runid limit 20000);');
 if old_job is null or history_job is null then raise exception 'PREPARED_FEED_V1_ROLLBACK_REQUIRES_REVIEW';end if;
 if exists(select 1 from cron.job where jobname in('prepared-feed-refresh-v2-1','prepared-feed-refresh-v2-2','prepared-feed-refresh-v2-3','prepared-feed-refresh-v2-4') and command<>'set statement_timeout=''8s''; select public.drain_prepared_feed_v1(1);') then
  raise exception 'PREPARED_FEED_V2_ROLLBACK_REQUIRES_REVIEW';
 end if;
 for lane in select jobid from cron.job where jobname in('prepared-feed-refresh-v2-1','prepared-feed-refresh-v2-2','prepared-feed-refresh-v2-3','prepared-feed-refresh-v2-4') loop
  perform cron.alter_job(lane.jobid,active:=false);
 end loop;
 perform cron.alter_job(old_job,active:=true);
 perform cron.alter_job(history_job,schedule:='17 3 * * *',command:='set statement_timeout=''8s''; delete from cron.job_run_details where runid in (select runid from cron.job_run_details where jobid in(select jobid from cron.job where jobname in(''prepared-feed-refresh-v1'',''prepared-feed-history-v1'')) and end_time < now()-interval ''7 days'' order by runid limit 20000);',active:=true);
end $rollback$;
select jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active,'command_md5',md5(command))order by jobname)
from cron.job where jobname in('prepared-feed-refresh-v1','prepared-feed-history-v1','prepared-feed-refresh-v2-1','prepared-feed-refresh-v2-2','prepared-feed-refresh-v2-3','prepared-feed-refresh-v2-4');
commit;
