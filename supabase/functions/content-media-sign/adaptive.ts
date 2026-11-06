import { mediaDeliveryUrl } from '../../../shared/mediaDelivery.ts';
import type { ContentPlaybackGrant } from '../../../shared/contentMedia.ts';

type Ticket = { bucket_id: string; object_path: string; token: string; expires_at: string; object_version: string };
export type ContentDeliveryMetadata = { sourceVersion: string; playback?: Omit<ContentPlaybackGrant, 'source'> };
const liveClipPath = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/){4}(?:horizontal|vertical)\.mp4$/;
/** Issuance pins original versions. Optional discovery adds only matching HLS. */
export async function contentPlaybackReadiness(base: string, tickets: Ticket[], lookup: (items: Array<{ token: string; bucket: string; path: string }>) => Promise<unknown>): Promise<Map<string, ContentDeliveryMetadata>> {
  const result = new Map<string, ContentDeliveryMetadata>();
  const valid = tickets.filter(row => /^[0-9a-f]{64}$/.test(row.token)
    && typeof row.object_version === 'string' && row.object_version.length > 0 && row.object_version.length <= 128
    && Number.isFinite(Date.parse(row.expires_at)) && Date.parse(row.expires_at) > Date.now());
  // Original version metadata is complete even when optional discovery is
  // unavailable, cancelled or limited to a smaller batch than this issuance.
  for (const row of valid) result.set(mediaDeliveryUrl(base, row.bucket_id, row.object_path, row.token), { sourceVersion: row.object_version });
  const allowed = new Map(valid.slice(0, 128).map(row => [row.token, row]));
  if (!allowed.size) return result;
  try {
    const payload = await lookup([...allowed.values()].map(row => ({ token: row.token, bucket: row.bucket_id, path: row.object_path }))) as { origin?: string; items?: Array<{ token: string; version: string; hls?: boolean }> } | null;
    if (!Array.isArray(payload?.items)) return result;
    let origin: URL | null = null;
    try {
      const candidate = new URL(payload!.origin!);
      if (candidate.protocol === 'https:' && !candidate.username && !candidate.password && candidate.pathname === '/' && !candidate.search && !candidate.hash) origin = candidate;
    } catch { /* Immutable versions remain useful without an adaptive origin. */ }
    for (const item of payload.items.slice(0, 128)) {
      const row = allowed.get(item.token);
      if (!row || item.version !== row.object_version) continue;
      const expiresAt = Date.parse(row.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 10000) continue;
      const metadata: ContentDeliveryMetadata = { sourceVersion: row.object_version };
      const adaptiveSource = ['post-media', 'story-media'].includes(row.bucket_id) && /\.(mp4|mov|m4v)$/i.test(row.object_path)
        || row.bucket_id === 'live-clips' && liveClipPath.test(row.object_path);
      if (item.hls === true && origin && adaptiveSource) {
        const url = new URL(`/playback/${encodeURIComponent(row.bucket_id)}/${row.object_path.split('/').map(encodeURIComponent).join('/')}/master.m3u8`, origin);
        url.searchParams.set('token', row.token);
        metadata.playback = { hlsUrl: url.href, sourceVersion: row.object_version, expiresAt };
      }
      result.set(mediaDeliveryUrl(base, row.bucket_id, row.object_path, row.token), metadata);
    }
  } catch { /* Discovery outages retain immediate original delivery. */ }
  return result;
}
