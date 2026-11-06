/** A live playback grant is a CDN capability in the path: /_live/<token>/<session>/.../master.m3u8.
 * A renewed grant for the same stream differs only by that token, so a running player can
 * keep its buffers and swap the token into each request instead of starting over. */
export function livePlaybackToken(url: string): string | null {
  try { const match = new URL(url).pathname.match(/^\/_live\/([^/]+)\//); return match ? match[1] : null; } catch { return null; }
}
/** The same URL carrying a newer token. A URL without a capability passes through unchanged. */
export function renewLivePlaybackUrl(url: string, token: string | null): string {
  if (!token) return url;
  try {
    const parsed = new URL(url), path = parsed.pathname;
    if (!path.startsWith('/_live/')) return url;
    const rest = path.slice('/_live/'.length), slash = rest.indexOf('/');
    if (slash < 0) return url;
    return parsed.origin + '/_live/' + token + rest.slice(slash) + parsed.search + parsed.hash;
  } catch { return url; }
}
/** True when a renewed grant plays the same stream through the same delivery path. */
export function sameLiveStream(previous: string, next: string): boolean {
  if (previous === next) return true;
  const token = livePlaybackToken(next);
  return !!token && !!livePlaybackToken(previous) && renewLivePlaybackUrl(previous, token) === next;
}
