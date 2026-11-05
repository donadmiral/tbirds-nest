import { mediaDeliveryUrl } from '../../../shared/mediaDelivery.ts';
import type { ContentPlaybackGrant } from '../../../shared/contentMedia.ts';

type Ticket = { bucket_id: string; object_path: string; token: string; expires_at: string };
export type ContentDeliveryMetadata = { sourceVersion: string; playback?: Omit<ContentPlaybackGrant, 'source'> };
const liveClipPath = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/){4}(?:horizontal|vertical)\.mp4$/;
/** The signing response carries immutable source versions and already-ready HLS. */
export async function contentPlaybackReadiness(base: string, tickets: Ticket[], lookup: (items: Array<{ token: string; bucket: string; path: string }>) => Promise<unknown>): Promise<Map<string, ContentDeliveryMetadata>> {
  const allowed = new Map(tickets.filter(row => /^[0-9a-f]{64}$/.test(row.token))
    .slice(0, 128).map(row => [row.token, row]));
  const result = new Map<string, ContentDeliveryMetadata>();
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
      if (!row || typeof item.version !== 'string' || !item.version || item.version.length > 128) continue;
      const expiresAt = Date.parse(row.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 10000) continue;
      const metadata: ContentDeliveryMetadata = { sourceVersion: item.version };
      const adaptiveSource = ['post-media', 'story-media'].includes(row.bucket_id) && /\.(mp4|mov|m4v)$/i.test(row.object_path)
        || row.bucket_id === 'live-clips' && liveClipPath.test(row.object_path);
      if (item.hls === true && origin && adaptiveSource) {
        const url = new URL(`/playback/${encodeURIComponent(row.bucket_id)}/${row.object_path.split('/').map(encodeURIComponent).join('/')}/master.m3u8`, origin);
        url.searchParams.set('token', row.token);
        metadata.playback = { hlsUrl: url.href, sourceVersion: item.version, expiresAt };
      }
      result.set(mediaDeliveryUrl(base, row.bucket_id, row.object_path, row.token), metadata);
    }
  } catch { /* Discovery outages retain immediate original delivery. */ }
  return result;
}
