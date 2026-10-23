/** Apple catalog references only. These values never grant soundtrack rights. */
export type AppleMusicTrack = {
  id: string;
  storefront: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string | null;
  url: string;
  explicit: boolean;
};

export function parseAppleMusicLink(value: string): { id: string; storefront: string; url: string } | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'music.apple.com' || url.port || url.username || url.password) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (!/^[a-z]{2}$/i.test(parts[0] || '') || !['song', 'album'].includes(parts[1])) return null;
    const id = parts[1] === 'album' ? url.searchParams.get('i') : parts.at(-1);
    if (!id || !/^\d{1,24}$/.test(id)) return null;
    const storefront = parts[0].toLowerCase();
    return { id, storefront, url: `https://music.apple.com/${storefront}/song/${id}` };
  } catch { return null; }
}

export function appleMusicShareText(track: AppleMusicTrack): string {
  return `${[track.title, track.artist].filter(Boolean).join(' · ')}\n${track.url}`;
}

/** Discard arbitrary URLs and every playback/download field from provider data. */
export function appleMusicTrackFromCatalog(value: unknown, storefront: string): AppleMusicTrack | null {
  if (!value || typeof value !== 'object' || !/^[a-z]{2}$/.test(storefront)) return null;
  const row = value as Record<string, unknown>;
  const attrs = row.attributes as Record<string, unknown> | undefined;
  const id = typeof row.id === 'string' ? row.id : '';
  if (row.type !== 'songs' || !/^\d{1,24}$/.test(id) || !attrs || typeof attrs.name !== 'string' || typeof attrs.artistName !== 'string') return null;
  let artworkUrl: string | null = null;
  const artwork = attrs.artwork as { url?: unknown } | undefined;
  if (typeof artwork?.url === 'string') {
    try {
      const url = new URL(artwork.url.replace('{w}', '300').replace('{h}', '300'));
      if (url.protocol === 'https:' && url.hostname.endsWith('.mzstatic.com') && !url.username && !url.password && !url.port) artworkUrl = url.toString();
    } catch { /* A track is usable without its artwork. */ }
  }
  return {
    id, storefront, title: attrs.name.slice(0, 300), artist: attrs.artistName.slice(0, 300),
    album: typeof attrs.albumName === 'string' ? attrs.albumName.slice(0, 300) : '',
    artworkUrl, url: `https://music.apple.com/${storefront}/song/${id}`,
    explicit: attrs.contentRating === 'explicit',
  };
}
