begin;
set local lock_timeout='3s';
set local statement_timeout='8s';
select public.configure_prepared_feed_v1(false);
select public.configure_indexed_feed_v1(false);
select cron.alter_job(jobid,active:=false) from cron.job
where jobname in('prepared-feed-refresh-v1','prepared-feed-history-v1');
commit;
