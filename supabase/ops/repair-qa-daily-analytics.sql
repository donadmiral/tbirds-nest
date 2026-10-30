-- QA operations repair for uaulhuelcfkjwojtymmw, 30 October 2026.
-- Recompute aggregate rows from existing records. No source records, user
-- permissions, schema definitions, or publication/payment schedules change.
-- The inspected production job already works and does not need this repair.
begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
do $repair$
declare day_offset integer;
begin
  if current_setting('TimeZone') <> 'UTC' then
    raise exception 'Expected UTC daily reporting timezone';
  end if;
  if md5(pg_get_functiondef('public.rebuild_daily_stats(date)'::regprocedure))
     <> 'a6644cc5186d7ea4ea48d230cf2c5889' then
    raise exception 'Daily analytics implementation changed. Review before repair.';
  end if;
  if exists(select 1 from cron.job where jobname = 'daily-stats') then
    raise exception 'Daily analytics schedule already exists. Review its current state.';
  end if;
  for day_offset in 0..29 loop
    perform public.rebuild_daily_stats((now() at time zone 'UTC')::date - day_offset);
  end loop;
  perform cron.schedule(
    'daily-stats', '10 0 * * *',
    'select public.rebuild_daily_stats(current_date - 1); select public.rebuild_daily_stats(current_date);'
  );
end
$repair$;
commit;

select jsonb_build_object(
  'dailyRows', (select count(*) from public.daily_stats),
  'latestDay', (select max(day) from public.daily_stats),
  'recordedPosts', (select coalesce(sum(posts),0) from public.daily_stats),
  'sourcePosts', (select count(*) from public.posts where created_at >= ((now() at time zone 'UTC')::date - 29)),
  'schedule', (select jsonb_build_object('name',jobname,'schedule',schedule,'active',active) from cron.job where jobname='daily-stats')
) as analytics_postflight;
