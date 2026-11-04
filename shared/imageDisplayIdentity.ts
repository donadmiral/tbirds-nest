import { isContentCapability } from './contentMedia';

/** Keep an already displayed image through renewal of the same media grant.
 * This is a view identity only, never a cache key or a replacement request URL.
 */
export function imageDisplayIdentity(uri: string, base: string): string {
  if (!isContentCapability(uri, base)) return uri;
  const url = new URL(uri);
  url.searchParams.delete('token');
  url.searchParams.sort();
  return url.toString();
}
