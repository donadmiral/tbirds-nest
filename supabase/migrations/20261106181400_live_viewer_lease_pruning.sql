-- A disconnected large room can leave more expired leases than the counter's
-- 1,000-row maintenance allowance. Reclaim independently in short transactions.
set local lock_timeout='250ms';
set local statement_timeout='5s';
do $guard$
begin
 if md5(pg_get_functiondef('live_streams.refresh_viewer_counts(integer)'::regprocedure)) <> 'af68ca99a573274396aece79df60d5b4'
  or md5(pg_get_functiondef('live_streams.prepare_control(uuid,text,uuid,jsonb,text)'::regprocedure)) <> '13bf8e8ef41c65059ce209398a61b61e'
  or not exists(select from pg_index where indexrelid='live_streams.live_viewer_presence_expiry'::regclass and indisvalid and indisready
    and pg_get_indexdef(indexrelid)='CREATE INDEX live_viewer_presence_expiry ON live_streams.viewer_presence USING btree (expires_at)')
  or to_regprocedure('live_streams.prune_expired_viewer_leases(integer)') is not null
 then raise exception 'LIVE_LEASE_PRUNE_BASELINE_CHANGED';end if;
end $guard$;

create function live_streams.prune_expired_viewer_leases(p_limit integer default 5000)
returns integer language plpgsql security invoker set search_path='' set lock_timeout='250ms' as $prune$
declare affected integer; cutoff timestamptz:=statement_timestamp();
begin
 if p_limit is null or p_limit not between 1 and 5000 then
  raise exception 'INVALID_PRUNE_LIMIT' using errcode='22023';
 end if;
 -- Row-lock the oldest eligible versions first. Holding this tuple lock
 -- prevents renewal from winning between selection and deletion; when a
 -- heartbeat already holds it, skip and let the next tick reconsider.
 with claimed as materialized (
  select v.ctid as tid from live_streams.viewer_presence v where v.expires_at<=cutoff
  order by v.expires_at limit p_limit for update of v skip locked
 )
 delete from live_streams.viewer_presence v where v.ctid=any(array(select tid from claimed)) and v.expires_at<=cutoff;
 get diagnostics affected=row_count;
 return affected;
end $prune$;
revoke all on function live_streams.prune_expired_viewer_leases(integer) from public,anon,authenticated,service_role;
comment on function live_streams.prune_expired_viewer_leases(integer) is 'Private scheduler-only cleanup. Protected counts are measured by their existing independent job.';

do $schedule$
declare cmd constant text:='set local lock_timeout=''250ms''; set local statement_timeout=''2s''; select live_streams.prune_expired_viewer_leases(5000);';
begin
 -- The isolated SQL fixture has no scheduler. On hosted environments validate
 -- the scheduler version, role and existing minute job before adding this job.
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
  if not exists(select from pg_extension where extname='pg_cron' and split_part(extversion,'.',1)::integer=1 and split_part(extversion,'.',2)::integer>=5)
   or not exists(select from cron.job where jobname='platinum-live-viewer-counts' and active and username=current_user and schedule='* * * * *'
      and command='select live_streams.refresh_viewer_counts(1000);')
   or exists(select from cron.job where jobname='platinum-live-viewer-lease-prune')
  then raise exception 'LIVE_LEASE_PRUNE_CRON_BASELINE_CHANGED';end if;
  perform cron.schedule('platinum-live-viewer-lease-prune','10 seconds',cmd);
 end if;
end $schedule$;
