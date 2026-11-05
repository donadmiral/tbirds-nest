-- Source versions and prepared HLS travel with the authorized signing response.
-- This never grants media access or changes admission/delivery gates.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
create function public.media_playback_readiness_v2(p_items jsonb) returns jsonb
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
    if origin is not null and checked < 32 and item->>'bucket' in ('post-media', 'story-media')
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
revoke all on function public.media_playback_readiness_v2(jsonb) from public, anon, authenticated;
grant execute on function public.media_playback_readiness_v2(jsonb) to service_role;
commit;
