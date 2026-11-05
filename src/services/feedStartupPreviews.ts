import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { contentObject, isContentCapability } from '../../shared/contentMedia';
import { postAspectRatio } from '../../shared/postMediaEditing';
import { SUPABASE_URL } from './supabase';
import { createStartupSnapshot, startupSnapshots } from './startupSnapshots';

type Preview = {
  postId: string; mediaId: string; objectKey: string; kind: 'image' | 'video';
  width: number; height: number; aspectRatio: number; uri: string;
};
const LIMIT = 3, MAX_PREVIEW_LENGTH = 6800;
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const dimension = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 32768;
const restricted = (value: any) => !!(value?.view_once || value?.is_view_once || value?.view_limit || value?.is_ephemeral
  || value?.expires_at || value?.deleted_at || value?.is_deleted || value?.revoked_at || value?.is_restricted
  || value?.restricted || value?.is_sensitive || value?.edit?.sensitive || value?.is_paywalled);

export function sanitizeFeedPreviews(value: unknown): Preview[] | null {
  if (!Array.isArray(value)) return null;
  return value.slice(0, LIMIT).flatMap(row => {
    if (!row || !id(row.postId) || !id(row.mediaId) || !['image', 'video'].includes(row.kind)
      || typeof row.objectKey !== 'string' || row.objectKey.length > 1100 || !/^(post-media|media)\/[^?#\\]+$/.test(row.objectKey)
      || !dimension(row.width) || !dimension(row.height) || typeof row.aspectRatio !== 'number'
      || !Number.isFinite(row.aspectRatio) || row.aspectRatio < .25 || row.aspectRatio > 4
      || typeof row.uri !== 'string' || row.uri.length > MAX_PREVIEW_LENGTH
      || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(row.uri)) return [];
    return [{ postId: row.postId, mediaId: row.mediaId, objectKey: row.objectKey, kind: row.kind,
      width: row.width, height: row.height, aspectRatio: row.aspectRatio, uri: row.uri } as Preview];
  });
}

export const feedStartupPreviews = createStartupSnapshot<Preview[]>('feed-previews', {
  version: 1, ttlMs: 24 * 60 * 60_000, maxBytes: 24 * 1024, storage: 'secure', sanitize: sanitizeFeedPreviews,
});
let active: Promise<void> | null = null, revision = 0;
export function clearFeedStartupPreviews(account: string) {
  revision++;
  return feedStartupPreviews.clear(account);
}

/** Attach pixels only to the already validated public text snapshot. These
 * image rows are previews, including video covers, never playable video URLs. */
export function applyFeedStartupPreviews<T extends { post_id?: string; media?: any[] }>(account: string, rows: T[]): T[] {
  const previews = feedStartupPreviews.peek(account);
  if (!previews?.length) return rows;
  const byPost = new Map(previews.map(preview => [preview.postId, preview]));
  return rows.map(row => {
    const preview = byPost.get(row.post_id || '');
    if (!preview) return row;
    if (row.media?.length) {
      let changed = false;
      const media = row.media.map(item => {
        if (!item._startupPlaceholder || item.url || item.id !== preview.mediaId) return item;
        changed = true;
        return { ...item, url: preview.uri, _startupPreview: true };
      });
      return changed ? { ...row, media } : row;
    }
    return { ...row, media: [{ id: preview.mediaId, url: preview.uri, media_type: 'image',
      width: preview.width, height: preview.height, sort_order: 0, edit: { aspectRatio: preview.aspectRatio },
      _startupPreview: true, _startupMediaType: preview.kind }] };
  });
}

/** Off the visible path. Only a current visibility RPC can admit a public post.
 * Capability URLs are consumed transiently and never enter the disk snapshot. */
export function saveFeedStartupPreviews(account: string, rows: any[], eligible: Set<string>, isCurrent: () => boolean): Promise<void> {
  if (active) return active;
  const scope = startupSnapshots.revision(), token = revision;
  const current = () => token === revision && scope === startupSnapshots.revision() && isCurrent();
  const work = (async () => {
    const previews: Preview[] = [];
    for (const row of rows.slice(0, 8)) {
      if (!current() || previews.length >= LIMIT) break;
      if (!id(row?.post_id) || !eligible.has(row.post_id) || restricted(row)) continue;
      const item = Array.isArray(row.media) ? [...row.media].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))[0] : null;
      if (!id(item?.id) || restricted(item) || !['image', 'video'].includes(item?.media_type)) continue;
      const source = item.media_type === 'video' ? item.edit?.coverUrl || item.thumbnail_url : item.url;
      if (typeof source !== 'string' || !isContentCapability(source, SUPABASE_URL)) continue;
      const object = contentObject(source, SUPABASE_URL);
      if (!object || !['post-media', 'media'].includes(object.bucket)) continue;
      const cached = feedStartupPreviews.peek(account)?.find(preview => preview.mediaId === item.id && preview.objectKey === object.key);
      if (cached) {
        const width = dimension(item.width) ? item.width : cached.width;
        const height = dimension(item.height) ? item.height : cached.height;
        previews.push({ ...cached, width, height, aspectRatio: postAspectRatio(item.edit, width, height) });
        continue;
      }
      let preview: Preview | null = null;
      for (const width of [160, 96]) {
        if (!current()) break;
        let output: ImageManipulator.ImageResult | undefined;
        try {
          output = await ImageManipulator.manipulateAsync(source, [{ resize: { width } }], {
            format: ImageManipulator.SaveFormat.JPEG, compress: .35, base64: true,
          });
          if (!current()) break;
          const uri = output.base64 ? `data:image/jpeg;base64,${output.base64}` : '';
          if (uri.length > MAX_PREVIEW_LENGTH) continue;
          const mediaWidth = dimension(item.width) ? item.width : output.width;
          const mediaHeight = dimension(item.height) ? item.height : output.height;
          preview = sanitizeFeedPreviews([{ postId: row.post_id, mediaId: item.id, objectKey: object.key,
            kind: item.media_type, width: mediaWidth, height: mediaHeight,
            aspectRatio: postAspectRatio(item.edit, mediaWidth, mediaHeight), uri }])?.[0] ?? null;
          if (preview) break;
        } catch { break; }
        finally {
          // The manipulator creates a temporary JPEG. Never retain its
          // decrypted file alongside the encrypted launch snapshot.
          if (output?.uri?.startsWith('file:')) await FileSystem.deleteAsync(output.uri, { idempotent: true }).catch(() => {});
        }
      }
      if (preview) previews.push(preview);
    }
    if (current()) await feedStartupPreviews.write(account, previews);
  })();
  active = work.catch(() => {});
  void active.finally(() => { active = null; });
  return active;
}
