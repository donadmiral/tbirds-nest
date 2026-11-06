-- 'N watching' was measured only as the last step of the maintenance run. Any
-- earlier failure in that run, or a late run, left the count blank on every
-- surface after ninety seconds. Measure on a schedule of its own as well; the
-- measurement itself is bounded and skips sessions counted within twenty seconds.
do $$ begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
  perform cron.schedule('platinum-live-viewer-counts','* * * * *','select live_streams.refresh_viewer_counts(1000);');
 end if;
end $$;
