import { channelMediaObject } from '../../shared/channelMedia';
import { contentObject, hydrateContentMedia, isMediaDeliveryCapability } from '../../shared/contentMedia';
import type { createClient } from './supabase/client';
import { withTimeout } from './withTimeout';
import { acceptAdaptiveMedia } from '../../shared/adaptiveMedia';

const receivePlayback: typeof acceptAdaptiveMedia = grants => { if (typeof window !== 'undefined') acceptAdaptiveMedia(grants); };

/** Live clips use the destination's content grant; ordinary channel media keeps its storage grant. */
export async function channelAttachmentUrls(client: ReturnType<typeof createClient>, base: string, rows: { id: string; media_url: string | null }[]): Promise<Record<string, string>> {
  const attached = rows.filter(row => !!row.media_url);
  const clips = attached.filter(row => contentObject(row.media_url!, base)?.bucket === 'live-clips');
  const clipIds = new Set(clips.map(row => row.id));
  const [authorizedClips, ordinary] = await Promise.all([
    clips.length ? hydrateContentMedia(client, base, clips, 'channel_message', undefined, receivePlayback) : Promise.resolve([]),
    Promise.all(attached.filter(row => !clipIds.has(row.id)).map(async row => {
      const object = channelMediaObject(row.media_url!, base);
      if (!object) return [row.id, ''] as const;
      const result = await withTimeout(client.storage.from(object.bucket).createSignedUrl(object.path, 300));
      return [row.id, result.error ? '' : result.data?.signedUrl || ''] as const;
    })),
  ]);
  return Object.fromEntries([...ordinary, ...authorizedClips.map(row => [row.id, row.media_url && isMediaDeliveryCapability(row.media_url, base) ? row.media_url : ''])]);
}
