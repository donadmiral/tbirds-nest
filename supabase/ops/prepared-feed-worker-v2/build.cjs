'use strict';
const fs = require('node:fs');
const path = require('node:path');
const policy = require('./policy.json');
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
if (policy.version !== 2 || policy.lanes !== 4 || policy.jobsPerTick !== 1 || policy.intervalMs !== 1000
  || policy.hostedStatementTimeoutMs !== 8000 || policy.isolatedStatementTimeoutMs !== 30000) {
  throw Error('Review the bounded worker policy before changing its operating limits');
}
const previous = fs.readFileSync(path.join(__dirname, '../prepared-feed-staged-20261105/activate-bounded-worker.sql'), 'utf8');
const captured = name => {
  const value = previous.match(new RegExp(name + " constant text := '((?:''|[^'])*)';"));
  if (!value) throw Error('Missing reviewed prior scheduler command');
  return value[1].replaceAll("''", "'");
};
const workerCommand = captured('worker_command');
const oldHistory = captured('history_command');
const newNames = Array.from({ length: policy.lanes }, (_, index) => policy.jobNamePrefix + (index + 1));
const allNames = ['prepared-feed-refresh-v1', 'prepared-feed-history-v1', ...newNames];
const names = list => list.map(quote).join(',');
const historyCommand = `set statement_timeout='8s'; delete from cron.job_run_details where runid in (select r.runid from cron.job_run_details r join cron.job j using(jobid) where j.jobname in(${names(allNames)}) and r.end_time < now()-case when j.jobname in(${names(newNames)}) then interval '1 hour' else interval '7 days' end order by r.runid limit 20000);`;
const common = `begin;
set local lock_timeout='3s';
set local statement_timeout='8s';
`;
const readback = `select jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active,'command_md5',md5(command))order by jobname)
from cron.job where jobname in(${names(allNames)});
commit;
`;
const activate = `-- Generated from policy.json by build.cjs. Deployment remains opt-in.
-- Require the exact isolated gates, then a bounded QA canary, before production.
-- Four non-overlapping lanes, one snapshot per lane per second, eight-second
-- server deadlines. No feature flag, provider quota, or paid resource changes.
-- Hourly bounded history cleanup retains v2 detail for one hour and preserves
-- the previous seven-day retention for v1. Raw acceptance receipts live in git.
${common}do $rollout$
declare old_job bigint;history_job bigint;lane_name text;client_count integer;
begin
 if not exists(select 1 from pg_extension where extname='pg_cron')
  or (select md5(prosrc) from pg_proc where oid='prepared_feed.select_page(text,double precision,uuid,integer)'::regprocedure)<>${quote(policy.selectorSourceMd5)}
  or (select md5(prosrc) from pg_proc where oid='public.drain_prepared_feed_v1(integer)'::regprocedure)<>${quote(policy.workerSourceMd5)}
  or not(select relrowsecurity from pg_class where oid='feed_ranking.catalog'::regclass)
  or (select rolcanlogin or rolbypassrls from pg_roles where rolname='prepared_feed_reader')
  or has_function_privilege('authenticated','public.drain_prepared_feed_v1(integer)','execute')
  or has_function_privilege('anon','public.drain_prepared_feed_v1(integer)','execute')
  or not prepared_feed.enabled() or not feed_ranking.enabled() then
  raise exception 'PREPARED_FEED_V2_BASELINE_REQUIRED';
 end if;
 if exists(select 1 from cron.job where jobname in(${names(allNames)})
  and (database<>current_database() or username<>current_user)) then
  raise exception 'PREPARED_FEED_V2_JOB_AUTHORITY_REQUIRES_REVIEW';
 end if;
 if exists(select 1 from cron.job where jobname='prepared-feed-refresh-v1' and (command<>${quote(workerCommand)} or schedule<>'10 seconds'))
  or exists(select 1 from cron.job where jobname in(${names(newNames)}) and (command<>${quote(workerCommand)} or schedule<>'1 second'))
  or exists(select 1 from cron.job where jobname='prepared-feed-history-v1' and command not in(${quote(oldHistory)},${quote(historyCommand)})) then
  raise exception 'PREPARED_FEED_V2_JOB_COMMAND_REQUIRES_REVIEW';
 end if;
 select jobid into old_job from cron.job where jobname='prepared-feed-refresh-v1';
 select jobid into history_job from cron.job where jobname='prepared-feed-history-v1';
 if old_job is null or history_job is null then raise exception 'PREPARED_FEED_V1_ROLLBACK_REQUIRED';end if;
 select count(*) into client_count from pg_stat_activity where backend_type='client backend';
 if client_count+${policy.lanes}>least(42,floor(current_setting('max_connections')::integer*0.7)) then
  raise exception 'PREPARED_FEED_V2_CONNECTION_RESERVE_REQUIRED';
 end if;
 perform cron.alter_job(old_job,active:=false);
 foreach lane_name in array array[${names(newNames)}] loop
  perform cron.schedule(lane_name,'1 second',${quote(workerCommand)});
 end loop;
 perform cron.alter_job(history_job,schedule:='17 * * * *',command:=${quote(historyCommand)},active:=true);
end $rollout$;
${readback}`;
const rollback = `-- Generated from policy.json by build.cjs.
-- Restore only the reviewed single v1 job and its original history policy.
-- Keep feature flags, ranking functions, originals, and user data unchanged.
${common}do $rollback$
declare old_job bigint;history_job bigint;lane record;
begin
 select jobid into old_job from cron.job where jobname='prepared-feed-refresh-v1' and command=${quote(workerCommand)} and schedule='10 seconds';
 select jobid into history_job from cron.job where jobname='prepared-feed-history-v1' and command in(${quote(oldHistory)},${quote(historyCommand)});
 if old_job is null or history_job is null then raise exception 'PREPARED_FEED_V1_ROLLBACK_REQUIRES_REVIEW';end if;
 if exists(select 1 from cron.job where jobname in(${names(newNames)}) and command<>${quote(workerCommand)}) then
  raise exception 'PREPARED_FEED_V2_ROLLBACK_REQUIRES_REVIEW';
 end if;
 for lane in select jobid from cron.job where jobname in(${names(newNames)}) loop
  perform cron.alter_job(lane.jobid,active:=false);
 end loop;
 perform cron.alter_job(old_job,active:=true);
 perform cron.alter_job(history_job,schedule:='17 3 * * *',command:=${quote(oldHistory)},active:=true);
end $rollback$;
${readback}`;
for (const [file, text] of [['activate.sql', activate], ['rollback.sql', rollback]]) {
  const output = path.join(__dirname, file);
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(output, 'utf8') !== text) throw Error('Generated scheduler differs from policy: ' + file);
  } else fs.writeFileSync(output, text);
}
