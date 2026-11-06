-- Published live clips reuse the existing bounded HLS encoder and ticket ACL.
-- No renderer change, original replacement, private export or gate activation.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Keep v1's admission contract unchanged. Only the HLS pipeline gains this
-- source type, after verifying its completed render and current publication.
create function media_renditions.source_snapshot(p_id uuid, p_version text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  result := media_processing.source_snapshot(p_id, p_version);
  if result is not null then return result; end if;
  select jsonb_build_object('id', o.id, 'version', o.version, 'bucket', o.bucket_id, 'path', o.name,
    'owner', c.creator_id, 'bytes', (o.metadata->>'size')::bigint,
    'etag', trim(both '"' from coalesce(o.metadata->>'eTag', o.metadata->>'etag')), 'mime', 'video/mp4')
  into result
  from storage.objects o
  join live_streams.clips c on c.id::text = o.user_metadata->>'live_clip_id'
  join live_streams.sessions s on s.id = c.session_id and s.host_id = c.owner_id and s.audience = 'public'
  join live_streams.clip_jobs j on j.id::text = o.user_metadata->>'live_clip_job_id'
    and j.clip_id = c.id and j.lease_id = c.current_lease and j.revision = c.render_revision and j.state = 'done'
  join auth.users creator on creator.id = c.creator_id and creator.deleted_at is null
  cross join lateral jsonb_array_elements(case when jsonb_typeof(c.manifest->'assets') = 'array' then c.manifest->'assets' else '[]'::jsonb end) asset
  where o.id = p_id and o.version = p_version and length(o.version) between 1 and 128
    and o.bucket_id = 'live-clips' and c.state = 'ready' and c.moderation_state = 'approved' and c.copyright_state = 'cleared'
    and live_streams.clip_can_create(c.session_id, c.creator_id)
    and coalesce(nullif(o.owner_id, ''), o.owner::text) = c.creator_id::text
    and c.output_prefix = c.owner_id::text || '/' || c.session_id::text || '/' || c.id::text || '/' || c.current_lease::text || '/'
    and o.user_metadata->>'live_clip_lease_id' = c.current_lease::text
    and asset->>'name' in ('horizontal.mp4', 'vertical.mp4') and c.formats ? replace(asset->>'name', '.mp4', '')
    and o.name = c.output_prefix || (asset->>'name')
    and o.user_metadata->>'sha256' ~ '^[a-f0-9]{64}$' and o.user_metadata->>'sha256' = asset->>'sha256'
    and asset->>'content_type' = 'video/mp4' and split_part(o.metadata->>'mimetype', ';', 1) = 'video/mp4'
    and case when o.metadata->>'size' ~ '^[0-9]{1,12}$' and asset->>'bytes' ~ '^[0-9]{1,12}$'
      then (o.metadata->>'size')::bigint between 1 and 536870912 and (o.metadata->>'size')::bigint = (asset->>'bytes')::bigint else false end
    and length(trim(both '"' from coalesce(o.metadata->>'eTag', o.metadata->>'etag'))) between 1 and 256
    and coalesce(o.metadata->>'eTag', o.metadata->>'etag') not like 'W/%'
    and exists (
      select 1 from live_streams.clip_publications pub
      cross join lateral (select coalesce((select project_origin from live_streams.clip_runtime where singleton),
        (select project_origin from live_streams.worker_settings where singleton)) || '/storage/v1/object/public/live-clips/' || o.name as url) expected
      where pub.clip_id = c.id and pub.state = 'published' and pub.format || '.mp4' = asset->>'name'
        and exists(select 1 from auth.users publisher where publisher.id = pub.actor_id and publisher.deleted_at is null)
        and (
          (pub.destination in ('feed', 'community') and exists(select 1 from public.posts p where p.id = pub.published_id and p.user_id = pub.actor_id
            and (p.media_url = expected.url or exists(select 1 from public.post_media pm where pm.post_id = p.id and pm.url = expected.url))))
          or (pub.destination = 'story' and exists(select 1 from public.stories st where st.id = pub.published_id and st.user_id = pub.actor_id and st.media_url = expected.url))
          or (pub.destination = 'channel' and exists(select 1 from public.channel_messages m where m.id = pub.published_id and m.channel_id = pub.target_id
            and m.sender_id = pub.actor_id and m.media_url = expected.url))
        )
    )
  limit 1;
  return result;
end $$;
revoke all on function media_renditions.source_snapshot(uuid, text) from public, anon, authenticated, service_role;

create or replace function media_renditions.source_matches(j media_renditions.jobs) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(media_renditions.source_snapshot(j.source_id, j.source_version) @> jsonb_build_object(
    'bucket', j.source_bucket, 'path', j.source_path, 'owner', j.source_owner, 'bytes', j.source_bytes, 'etag', j.source_etag), false)
$$;

-- Exactly two current immutable render files are considered. The source
-- snapshot, not a caller-supplied prefix, decides whether either may enter HLS.
create function media_renditions.refresh_clip(p_clip uuid, p_prefix text) returns void
language plpgsql security definer set search_path = '' as $$
declare o record; job record;
begin
  if p_prefix is null then return; end if;
  for o in select id, version from storage.objects where bucket_id = 'live-clips'
    and name in (p_prefix || 'horizontal.mp4', p_prefix || 'vertical.mp4')
    and user_metadata->>'live_clip_id' = p_clip::text
  loop
    if media_renditions.source_snapshot(o.id, o.version) is not null then
      perform media_renditions.enqueue(o.id, o.version);
      -- A restored publication uses a fresh output lease. Never revive old
      -- output URLs or refill its bounded retry budget after repeated toggles.
      for job in select id from media_renditions.jobs where source_id = o.id and source_version = o.version
        and state = 'cancelled' and retry_budget > 0 and attempts < 100
        and exists(select 1 from media_renditions.settings where singleton and admission_enabled)
        for update
      loop
        delete from media_renditions.publications where job_id = job.id and not active;
        update media_renditions.jobs set state = 'pending', lease_id = null, lease_until = null,
          available_at = clock_timestamp(), updated_at = clock_timestamp(), error_code = null where id = job.id;
      end loop;
    else
      for job in select id from media_renditions.jobs where source_id = o.id and state in ('pending', 'processing', 'retry', 'ready') loop
        perform media_renditions.cancel(job.id, 'clip_revoked');
      end loop;
    end if;
  end loop;
end $$;
revoke all on function media_renditions.refresh_clip(uuid, text) from public, anon, authenticated, service_role;

create function media_renditions.clip_publication_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare clip_id uuid; prefix text;
begin
  clip_id := case when tg_op = 'DELETE' then old.clip_id else new.clip_id end;
  select output_prefix into prefix from live_streams.clips where id = clip_id;
  perform media_renditions.refresh_clip(clip_id, prefix);
  if tg_op = 'UPDATE' and old.clip_id is distinct from new.clip_id then
    select output_prefix into prefix from live_streams.clips where id = old.clip_id;
    perform media_renditions.refresh_clip(old.clip_id, prefix);
  end if;
  return null;
end $$;
revoke all on function media_renditions.clip_publication_changed() from public, anon, authenticated, service_role;
-- clip_publish_one marks the publication before inserting its destination.
-- Deferral observes the completed transaction and never admits a dangling row.
create constraint trigger adaptive_clip_publication_changed after insert or update or delete on live_streams.clip_publications
deferrable initially deferred for each row execute function media_renditions.clip_publication_changed();

create function media_renditions.clip_revision_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform media_renditions.refresh_clip(old.id, old.output_prefix);
  if tg_op = 'UPDATE' and old.output_prefix is distinct from new.output_prefix then
    perform media_renditions.refresh_clip(new.id, new.output_prefix);
  end if;
  return null;
end $$;
revoke all on function media_renditions.clip_revision_changed() from public, anon, authenticated, service_role;
create constraint trigger adaptive_clip_revision_changed after update or delete on live_streams.clips
deferrable initially deferred for each row execute function media_renditions.clip_revision_changed();


create or replace function media_renditions.enqueue(p_id uuid,p_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c media_renditions.settings;s jsonb;j media_renditions.jobs;
begin
 select * into c from media_renditions.settings where singleton;
 if not c.admission_enabled then return jsonb_build_object('state','disabled');end if;
 s:=media_renditions.source_snapshot(p_id,p_version);
 if s is null then return jsonb_build_object('state','ineligible');end if;
 insert into media_renditions.jobs(source_id,source_version,source_bucket,source_path,source_owner,source_bytes,source_etag,source_mime,state,error_code)
 values(p_id,p_version,s->>'bucket',s->>'path',(s->>'owner')::uuid,(s->>'bytes')::bigint,s->>'etag',s->>'mime',
 case when (s->>'bytes')::bigint>c.input_max_bytes then 'blocked' else 'pending' end,
 case when (s->>'bytes')::bigint>c.input_max_bytes then 'input_budget' else null end)
 on conflict(profile,source_id,source_version) do nothing;
 select * into j from media_renditions.jobs where source_id=p_id and source_version=p_version;
 return jsonb_build_object('job_id',j.id,'state',j.state);
end $$;

create or replace function media_renditions.source_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare j media_renditions.jobs;
begin
 if old.bucket_id not in ('post-media','story-media','live-clips') then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='UPDATE' and old.id=new.id and old.version is not distinct from new.version and old.name=new.name and old.bucket_id=new.bucket_id
  and old.metadata is not distinct from new.metadata and old.user_metadata is not distinct from new.user_metadata
  and old.owner_id is not distinct from new.owner_id and old.owner is not distinct from new.owner then return new;end if;
 for j in select * from media_renditions.jobs where source_id=old.id and state in ('pending','processing','retry','ready') loop perform media_renditions.cancel(j.id,'source_changed');end loop;
 if tg_op='UPDATE' and new.bucket_id in ('post-media','story-media','live-clips') then perform media_renditions.enqueue(new.id,new.version);end if;
 return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function public.backfill_media_renditions_v2(
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
    if o.bucket_id not in ('post-media', 'story-media', 'live-clips') or o.name !~* '\.(mp4|mov|m4v)$'
       or exists(select 1 from media_renditions.jobs where source_id = o.id and source_version = o.version)
       or media_renditions.source_snapshot(o.id, o.version) is null then
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

create or replace function public.media_playback_readiness_v2(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  ticket record;
  access_grant jsonb;
  rendition jsonb;
  origin text;
  ready boolean;
  checked integer := 0;
  items jsonb := '[]'::jsonb;
begin
  perform media_processing.require_service();
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 128
     or octet_length(p_items::text) > 160000 then
    raise exception 'Invalid bounded playback request' using errcode = '22023';
  end if;
  origin := public.media_adaptive_gateway_origin_v2();
  for item in select distinct value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) is distinct from 'object' or item->>'token' is null
       or item->>'token' !~ '^[0-9a-f]{64}$' or item->>'bucket' is null
       or item->>'path' is null or length(item->>'path') not between 1 and 1024
       or item->>'path' ~ '(%|\\|(^|/)\.\.?(/|$)|//|^/|/$|[[:cntrl:]])' then
      continue;
    end if;
    -- Metadata is only returned for the exact existing capability and immutable
    -- source it already names. This adds no new URL or authorization for images.
    select t.object_version into ticket from media_delivery.tickets t
    join storage.objects o on o.id = t.object_id and o.version = t.object_version
      and o.bucket_id = t.bucket_id and o.name = t.object_path
    where t.token_digest = extensions.digest(item->>'token', 'sha256')
      and t.bucket_id = item->>'bucket' and t.object_path = item->>'path'
      and t.expires_at > clock_timestamp();
    if not found then continue; end if;
    ready := false;
    -- Skip unfinished/unrelated objects before doing the full audience lookup.
    if origin is not null and checked < 32 and item->>'bucket' in ('post-media', 'story-media', 'live-clips')
       and item->>'path' ~* '\.(mp4|mov|m4v)$' and exists (
      select 1 from media_delivery.tickets t
      join media_renditions.jobs j on j.source_id = t.object_id and j.source_version = t.object_version and j.state = 'ready'
      join media_renditions.publications p on p.job_id = j.id and p.active and p.created_at <= t.created_at
      where t.token_digest = extensions.digest(item->>'token', 'sha256')
    ) then
      checked := checked + 1;
      -- Full live session/audience/deletion checks precede HLS readiness. The
      -- rendition resolver additionally validates source, lease and all assets.
      access_grant := public.resolve_media_delivery(item->>'token', item->>'bucket', item->>'path');
      if access_grant is not null and access_grant->>'version' = ticket.object_version then
        rendition := public.resolve_media_rendition_v2(item->>'token', item->>'bucket', item->>'path', ticket.object_version);
        ready := rendition is not null and rendition->>'sourceVersion' = ticket.object_version;
      end if;
    end if;
    items := items || jsonb_build_array(jsonb_build_object('token', item->>'token', 'version', ticket.object_version, 'hls', ready));
  end loop;
  return jsonb_build_object('origin', origin, 'items', items);
end $$;

notify pgrst, 'reload schema';
commit;
