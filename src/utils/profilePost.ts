import type { PostMedia } from '../components/MediaRenderer';

/** Shape only already-authorized rows. Never turn a video into an image fallback. */
export function normalizeProfilePost(row: any) {
  const attached = Array.isArray(row.post_media) ? row.post_media : [];
  const fallback = row.media_url || row.image_url;
  const candidates = attached.length ? attached : fallback ? [{
    id: `${row.id}:legacy`, url: fallback, sort_order: 0,
    media_type: row.media_type === 'video' || row.post_type === 'video' || /\.(?:mp4|mov|m4v|webm)(?:[?#]|$)/i.test(fallback) ? 'video' : 'image',
  }] : [];
  const media: PostMedia[] = candidates
    .filter((item: any) => typeof item.url === 'string' && item.url.length > 0)
    .map((item: any) => ({ ...item, media_type: item.media_type === 'video' ? 'video' : 'image' }))
    .sort((a: PostMedia, b: PostMedia) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return {
    ...row, id: row.id, content: row.content || row.body || '',
    likes_count: row.likes_count ?? 0, comments_count: row.comments_count ?? 0,
    reposts_count: row.reposts_count ?? 0, created_at: row.created_at,
    media_url: row.media_url || null, media, user_id: row.user_id,
    mediaUnavailable: candidates.length > media.length,
  };
}
