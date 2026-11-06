begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
-- Operator-driven, keyset-paged enrollment. Scan at most 100 Storage rows,
-- including unrelated rows, so an ineligible library cannot cause a full scan
-- in a single call. No cron, gate update, network access or worker is started.
create function public.backfill_media_renditions_v2(
  p_after_id uuid default null, p_limit integer default 100, p_dry_run boolean default true
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o record;
  scanned integer := 0;
  eligible integer := 0;
  admitted integer := 0;
  cursor_id uuid := p_after_id;
  enabled boolean;
  result jsonb;
begin
  perform media_processing.require_service();
  if p_limit is null or p_limit not between 1 and 100 or p_dry_run is null then
    raise exception 'Invalid bounded media backfill arguments';
  end if;
  select admission_enabled into enabled from media_renditions.settings where singleton;
  if not p_dry_run and not coalesce(enabled, false) then
    return jsonb_build_object('state', 'disabled', 'scanned', 0, 'eligible', 0,
      'admitted', 0, 'nextAfterId', p_after_id, 'hasMore', false);
  end if;
  for o in
    select id, version, bucket_id, name from storage.objects
    where (p_after_id is null or id > p_after_id) order by id limit p_limit
  loop
    scanned := scanned + 1;
    cursor_id := o.id;
    if o.bucket_id not in ('post-media', 'story-media') or o.name !~* '\.(mp4|mov|m4v)$'
       or exists(select 1 from media_renditions.jobs where source_id = o.id and source_version = o.version)
       or media_processing.source_snapshot(o.id, o.version) is null then
      continue;
    end if;
    eligible := eligible + 1;
    if not p_dry_run then
      result := media_renditions.enqueue(o.id, o.version);
      if result->>'state' in ('pending', 'blocked') then admitted := admitted + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('state', case when p_dry_run then 'preview' else 'complete' end,
    'scanned', scanned, 'eligible', eligible, 'admitted', admitted, 'nextAfterId', cursor_id,
    'hasMore', exists(select 1 from storage.objects where cursor_id is not null and id > cursor_id));
end $$;
revoke all on function public.backfill_media_renditions_v2(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.backfill_media_renditions_v2(uuid, integer, boolean) to service_role;
commit;
