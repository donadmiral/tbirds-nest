-- Generated from policy.json by build.cjs. Deployment remains opt-in.
-- Require the exact isolated gates, then a bounded QA canary, before production.
-- Four non-overlapping lanes, one snapshot per lane per second, eight-second
-- server deadlines. No feature flag, provider quota, or paid resource changes.
-- Hourly bounded history cleanup retains v2 detail for one hour and preserves
-- the previous seven-day retention for v1. Raw acceptance receipts live in git.
begin;
set local lock_timeout='3s';
set local statement_timeout='8s';
do $rollout$
declare old_job bigint;history_job bigint;lane_name text;client_count integer;
begin
 if not exists(select 1 from pg_extension where extname='pg_cron')
  or (select md5(prosrc) from pg_proc where oid='prepared_feed.select_page(text,double precision,uuid,integer)'::regprocedure)<>'cc7c382e422fe66d229c93991f7849c4'
  or (select md5(prosrc) from pg_proc where oid='public.drain_prepared_feed_v1(integer)'::regprocedure)<>'abcfe583c6a6a23a47f69be8a508ee74'
  or not(select relrowsecurity from pg_class where oid='feed_ranking.catalog'::regclass)
  or (select rolcanlogin or rolbypassrls from pg_roles where rolname='prepared_feed_reader')
  or has_function_privilege('authenticated','public.drain_prepared_feed_v1(integer)','execute')
  or has_function_privilege('anon','public.drain_prepared_feed_v1(integer)','execute')
  or not prepared_feed.enabled() or not feed_ranking.enabled() then
  raise exception 'PREPARED_FEED_V2_BASELINE_REQUIRED';
 end if;
 if exists(select 1 from cron.job where jobname in('prepared-feed-refresh-v1','prepared-feed-history-v1','prepared-feed-refresh-v2-1','prepared-feed-refresh-v2-2','prepared-feed-refresh-v2-3','prepared-feed-refresh-v2-4')
  and (database<>current_database() or username<>current_user)) then
  raise exception 'PREPARED_FEED_V2_JOB_AUTHORITY_REQUIRES_REVIEW';
 end if;
 if exists(select 1 from cron.job where jobname='prepared-feed-refresh-v1' and (command<>'set statement_timeout=''8s''; select public.drain_prepared_feed_v1(1);' or schedule<>'10 seconds'))
  or exists(select 1 from cron.job where jobname in('prepared-feed-refresh-v2-1','prepared-feed-refresh-v2-2','prepared-feed-refresh-v2-3','prepared-feed-refresh-v2-4') and (command<>'set statement_timeout=''8s''; select public.drain_prepared_feed_v1(1);' or schedule<>'1 second'))
  or exists(select 1 from cron.job where jobname='prepared-feed-history-v1' and command not in('set statement_timeout=''8s''; delete from cron.job_run_details where runid in (select runid from cron.job_run_details where jobid in(select jobid from cron.job where jobname in(''prepared-feed-refresh-v1'',''prepared-feed-history-v1'')) and end_time < now()-interval ''7 days'' order by runid limit 20000);','set statement_timeout=''8s''; delete from cron.job_run_details where runid in (select r.runid from cron.job_run_details r join cron.job j using(jobid) where j.jobname in(''prepared-feed-refresh-v1'',''prepared-feed-history-v1'',''prepared-feed-refresh-v2-1'',''prepared-feed-refresh-v2-2'',''prepared-feed-refresh-v2-3'',''prepared-feed-refresh-v2-4'') and r.end_time < now()-case when j.jobname in(''prepared-feed-refresh-v2-1'',''prepared-feed-refresh-v2-2'',''prepared-feed-refresh-v2-3'',''prepared-feed-refresh-v2-4'') then interval ''1 hour'' else interval ''7 days'' end order by r.runid limit 20000);')) then
  raise exception 'PREPARED_FEED_V2_JOB_COMMAND_REQUIRES_REVIEW';
 end if;
 select jobid into old_job from cron.job where jobname='prepared-feed-refresh-v1';
 select jobid into history_job from cron.job where jobname='prepared-feed-history-v1';
 if old_job is null or history_job is null then raise exception 'PREPARED_FEED_V1_ROLLBACK_REQUIRED';end if;
 select count(*) into client_count from pg_stat_activity where backend_type='client backend';
 if client_count+4>least(42,floor(current_setting('max_connections')::integer*0.7)) then
  raise exception 'PREPARED_FEED_V2_CONNECTION_RESERVE_REQUIRED';
 end if;
 perform cron.alter_job(old_job,active:=false);
 foreach lane_name in array array['prepared-feed-refresh-v2-1','prepared-feed-refresh-v2-2','prepared-feed-refresh-v2-3','prepared-feed-refresh-v2-4'] loop
  perform cron.schedule(lane_name,'1 second','set statement_timeout=''8s''; select public.drain_prepared_feed_v1(1);');
 end loop;
 perform cron.alter_job(history_job,schedule:='17 * * * *',command:='set statement_timeout=''8s''; delete from cron.job_run_details where runid in (select r.runid from cron.job_run_details r join cron.job j using(jobid) where j.jobname in(''prepared-feed-refresh-v1'',''prepared-feed-history-v1'',''prepared-feed-refresh-v2-1'',''prepared-feed-refresh-v2-2'',''prepared-feed-refresh-v2-3'',''prepared-feed-refresh-v2-4'') and r.end_time < now()-case when j.jobname in(''prepared-feed-refresh-v2-1'',''prepared-feed-refresh-v2-2'',''prepared-feed-refresh-v2-3'',''prepared-feed-refresh-v2-4'') then interval ''1 hour'' else interval ''7 days'' end order by r.runid limit 20000);',active:=true);
end $rollout$;
select jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active,'command_md5',md5(command))order by jobname)
from cron.job where jobname in('prepared-feed-refresh-v1','prepared-feed-history-v1','prepared-feed-refresh-v2-1','prepared-feed-refresh-v2-2','prepared-feed-refresh-v2-3','prepared-feed-refresh-v2-4');
commit;
