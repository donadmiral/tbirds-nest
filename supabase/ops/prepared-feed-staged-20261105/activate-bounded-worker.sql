-- Operational rollout after source tests and authenticated rollback canaries.
-- One non-overlapping pg_cron job, one snapshot per pass, eight-second deadline.
-- Run as the database operator. No JWT or secret is stored in cron commands.
begin;
set local lock_timeout='3s';
set local statement_timeout='8s';
do $rollout$
declare worker_command constant text := 'set statement_timeout=''8s''; select public.drain_prepared_feed_v1(1);';
history_command constant text := 'set statement_timeout=''8s''; delete from cron.job_run_details where runid in (select runid from cron.job_run_details where jobid in(select jobid from cron.job where jobname in(''prepared-feed-refresh-v1'',''prepared-feed-history-v1'')) and end_time < now()-interval ''7 days'' order by runid limit 20000);';
begin
 if not exists(select 1 from pg_extension where extname='pg_cron')
  or position('score_at integer:=200' in (select prosrc from pg_proc where oid='feed_ranking.select_page(text,double precision,uuid,integer)'::regprocedure))=0
  or position('p.id = catalog.post_id' in (select pg_get_expr(polqual,polrelid) from pg_policy where polrelid='feed_ranking.catalog'::regclass and polname='feed_catalog_visible'))=0
  or position('platinum-cache/1' in (select prosrc from pg_proc where oid='public.get_feed(text,double precision,uuid,integer)'::regprocedure))=0 then
  raise exception 'PREPARED_FEED_ROLLOUT_BASELINE_REQUIRED';
 end if;
 if exists(select 1 from cron.job where jobname='prepared-feed-refresh-v1' and command<>worker_command)
  or exists(select 1 from cron.job where jobname='prepared-feed-history-v1' and command<>history_command) then
  raise exception 'PREPARED_FEED_CRON_REQUIRES_REVIEW';
 end if;
 perform public.configure_indexed_feed_v1(true);
 perform public.configure_prepared_feed_v1(true);
 perform cron.schedule('prepared-feed-refresh-v1','10 seconds',worker_command);
 perform cron.schedule('prepared-feed-history-v1','17 3 * * *',history_command);
end $rollout$;
select public.prepared_feed_status_v1() as prepared,public.feed_ranking_status_v1() as indexed;
commit;

-- Rollback: disable both feature settings and deactivate only these two jobs.
-- Existing originals and user data do not change.
