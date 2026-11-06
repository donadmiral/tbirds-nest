-- Complete canonical admission without enabling processing or paid compute.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Upload completion can follow content binding creation. Both orders must
-- converge on the same immutable (source ID, version, profile) queue key.
create function media_renditions.source_added() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.bucket_id in ('post-media', 'story-media')
     and new.name ~* '\.(mp4|mov|m4v)$'
     and exists(select 1 from media_renditions.settings where singleton and admission_enabled) then
    perform media_renditions.enqueue(new.id, new.version);
  end if;
  return new;
end $$;
revoke all on function media_renditions.source_added() from public, anon, authenticated, service_role;
create trigger enqueue_adaptive_uploaded_source after insert on storage.objects
for each row execute function media_renditions.source_added();

drop trigger enqueue_adaptive_media on public.content_media_bindings;
create trigger enqueue_adaptive_media
after insert or update of entity_kind, entity_id, bucket_id, object_path, uploader_id
on public.content_media_bindings for each row execute function media_renditions.binding_added();

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
