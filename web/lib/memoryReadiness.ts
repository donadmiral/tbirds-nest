import { canonicalContentMedia, contentMediaUrls, contentObject, isMediaDeliveryCapability, replaceContentMedia } from '../../shared/contentMedia';
import type { MemoryAlbum, MemoryPage } from './memoryAlbum';

export const memoryPageMediaKey = (page: MemoryPage, attempt = 0) => JSON.stringify([
  page.id, page.media_type, page.media_url, page.thumbnail_url, page.media_transform, page.filter_id, attempt,
]);

/** Fresh RLS metadata may retain the displayed exact capabilities in this session. */
export function retainMemoryBookMedia(previous: MemoryAlbum | null | undefined, incoming: MemoryAlbum,
  base: string, previousScope: string | null | undefined, scope: string | null | undefined, now = Date.now()): MemoryAlbum {
  if (!previousScope || previousScope !== scope || !previous || previous.id !== incoming.id
    || previous.user_id !== incoming.user_id || (!incoming.is_owner && !incoming.can_view)) return incoming;
  const expiry = previous._mediaExpiresAt;
  if (typeof expiry !== 'number' || !Number.isFinite(expiry) || expiry <= now + 60_000 || expiry > now + 300_000) return incoming;
  const recipe = (album: MemoryAlbum) => JSON.stringify(canonicalContentMedia({ pages: album.pages,
    cover_page: album.cover_page, cover_pages: album.cover_pages, soundtrack: album.soundtrack }, base));
  if (recipe(previous) !== recipe(incoming)) return incoming;
  const grants = new Map<string, string>();
  for (const url of contentMediaUrls(previous, base)) {
    if (!isMediaDeliveryCapability(url, base)) continue;
    const object = contentObject(url, base);
    if (object) grants.set(object.key, url);
  }
  const requested = contentMediaUrls(incoming, base);
  if (!requested.length || requested.some(url => !grants.has(contentObject(url, base)!.key))) return incoming;
  return { ...replaceContentMedia(incoming, base, grants), _mediaExpiresAt: expiry };
}
