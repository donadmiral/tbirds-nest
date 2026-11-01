import { canonicalContentMedia, contentMediaUrls, contentObject, isMediaDeliveryCapability, replaceContentMedia } from './contentMedia';

type FeedMediaRow = {
  id: string; user_id?: string; media?: unknown; media_url?: unknown;
  content?: unknown; body?: unknown; _mediaExpiresAt?: number;
};

/** Retain a displayed source's identity during an authorized metadata refresh. */
export function reuseFeedMediaGrants<T extends FeedMediaRow>(
  current: T[], incoming: T[], base: string,
  previousScope: string | null, nextScope: string | null, now = Date.now(),
): T[] {
  if (!previousScope || previousScope !== nextScope) return incoming;
  const prior = new Map(current.map(row => [row.id, row]));
  const recipe = (row: FeedMediaRow) => JSON.stringify(canonicalContentMedia({
    media: row.media, media_url: row.media_url, content: row.content, body: row.body,
  }, base));
  return incoming.map(row => {
    const old = prior.get(row.id), expiry = old?._mediaExpiresAt;
    if (!old || old.user_id !== row.user_id || typeof expiry !== 'number'
      || !Number.isFinite(expiry) || expiry <= now + 60_000 || expiry > now + 300_000
      || recipe(old) !== recipe(row)) return row;
    const grants = new Map<string, string>();
    for (const url of contentMediaUrls(old, base)) {
      // These delivery capabilities recheck access on each byte request.
      // Legacy signed-storage URLs do not share that revocation guarantee.
      if (!isMediaDeliveryCapability(url, base)) continue;
      const object = contentObject(url, base);
      if (object) grants.set(object.key, url);
    }
    const requested = contentMediaUrls(row, base);
    if (!requested.length || requested.some(url => !grants.has(contentObject(url, base)!.key))) return row;
    return { ...replaceContentMedia(row, base, grants), _mediaExpiresAt: expiry };
  });
}
