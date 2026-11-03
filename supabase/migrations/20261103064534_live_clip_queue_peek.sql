-- Queue metadata only: the on-demand launcher never receives a clip, grant or worker credential.
begin;
create index if not exists live_clip_cleanup_leased
 on live_streams.clip_cleanup(lease_until,id) where state='leased';

create function live_streams.clip_queue_peek() returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare cfg live_streams.clip_runtime;active_count integer;maintenance_due boolean;render_due boolean;
begin
 select * into cfg from live_streams.clip_runtime where singleton;
 -- This is a saturated count for one initial launcher, not a queue-size scan.
 select count(*) into active_count from (
  select 1 from live_streams.clip_jobs where state='leased' and lease_until>statement_timestamp() limit 2
 ) q;
 maintenance_due :=
  exists(select 1 from live_streams.clip_publications where state in ('pending','scheduled') and next_attempt_at<=statement_timestamp())
  or exists(select 1 from live_streams.clip_cleanup where state='pending' and available_at<=statement_timestamp())
  or exists(select 1 from live_streams.clip_cleanup where state='leased' and lease_until<statement_timestamp());
 render_due := coalesce(cfg.enabled,false) and active_count<least(coalesce(cfg.max_active,1),2) and (
  exists(select 1 from live_streams.clip_jobs where state='pending' and available_at<=statement_timestamp())
  or exists(select 1 from live_streams.clip_jobs where state='leased' and lease_until<statement_timestamp())
 );
 return jsonb_build_object('enabled',coalesce(cfg.enabled,false) or maintenance_due,
  'due',render_due or maintenance_due,'active',active_count);
end $$;
revoke all on function live_streams.clip_queue_peek() from public,anon,authenticated,service_role;

create function public.live_clip_queue_peek() returns jsonb
 language sql stable security definer set search_path='' as $$ select live_streams.clip_queue_peek() $$;
revoke all on function public.live_clip_queue_peek() from public,anon,authenticated,service_role;
grant execute on function public.live_clip_queue_peek() to service_role;
comment on function public.live_clip_queue_peek() is 'Service-only bounded queue signal. No claim, identifiers, media or credentials. Cleanup remains eligible while encoding is disabled.';
commit;
