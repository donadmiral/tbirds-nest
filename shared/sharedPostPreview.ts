/** A preview is selected only from the source post's already-authorized row. */
export type SharedPostMedia = {
  url: string;
  media_type: 'image' | 'video' | 'audio' | 'file';
  thumbnail_url: string | null;
};

type MediaRow = {
  url?: unknown;
  media_type?: unknown;
  sort_order?: unknown;
  thumbnail_url?: unknown;
  edit?: unknown;
};
type SourceRow = { post_media?: unknown; media_url?: unknown; media_type?: unknown; image_url?: unknown };

const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const extension = (value: unknown) => string(value).split(/[?#]/, 1)[0].toLowerCase();
const VIDEO = /\.(?:mp4|m4v|mov|webm|mkv|avi|3gp|hevc|m3u8)$/i;
const AUDIO = /\.(?:mp3|m4a|aac|wav|ogg|flac)$/i;

export function sharedPostMediaKind(type: unknown, url?: unknown): SharedPostMedia['media_type'] {
  const kind = string(type).toLowerCase();
  if (kind === 'video' || kind.startsWith('video/') || VIDEO.test(extension(url))) return 'video';
  if (kind === 'audio' || kind.startsWith('audio/') || AUDIO.test(extension(url))) return 'audio';
  if (kind === 'file' || kind.startsWith('application/')) return 'file';
  return 'image';
}

/** Never pass a movie URL to an image decoder, even for legacy mistyped rows. */
export function sharedPostImageUri(media: { url?: unknown; media_type?: unknown; thumbnail_url?: unknown } | null | undefined): string | null {
  if (!media) return null;
  const kind = sharedPostMediaKind(media.media_type, media.url);
  const poster = string(media.thumbnail_url);
  if (poster && sharedPostMediaKind('', poster) === 'image') return poster;
  return kind === 'image' ? string(media.url) || null : null;
}

/**
 * Call after hydratePostMedia (or after stripping unavailable private URLs).
 * Keep the first ordered item even if access to its pixels is unavailable:
 * borrowing a later item's poster would misrepresent the source.
 */
export function sharedPostPreview(row: SourceRow | null | undefined): { media: SharedPostMedia | null; mediaCount: number } {
  const media = Array.isArray(row?.post_media)
    ? row.post_media.filter((item): item is MediaRow => !!item && typeof item === 'object')
      .slice().sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
    : [];
  const first = media[0];
  if (first) {
    const edit = first.edit && typeof first.edit === 'object' ? first.edit as Record<string, unknown> : null;
    const url = string(first.url);
    return {
      media: {
        url,
        media_type: sharedPostMediaKind(first.media_type, url),
        thumbnail_url: string(edit?.coverUrl) || string(first.thumbnail_url) || null,
      },
      mediaCount: media.length,
    };
  }
  const url = string(row?.media_url) || string(row?.image_url);
  return {
    media: url ? { url, media_type: sharedPostMediaKind(row?.media_type, url), thumbnail_url: null } : null,
    mediaCount: url ? 1 : 0,
  };
}

export function sharedPostMediaLabel(media: { media_type?: unknown; url?: unknown } | null | undefined, mediaCount = 0): string {
  if (mediaCount > 1) return `${mediaCount} items`;
  if (!media) return 'Post';
  const kind = sharedPostMediaKind(media.media_type, media.url);
  return kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : kind === 'file' ? 'Attachment' : 'Photo';
}
