import 'server-only';
import { requirePermission } from './adminAuth';
import { serviceClient } from './supabaseAdmin';
import { resolveMedia } from './media';
import { contentMediaLocation } from './publicMedia';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PRIVATE_CONTENT_BUCKETS = new Set(['post-media', 'story-media', 'media']);
const MAX_BINDINGS = 4000;

/** Staff-only previews. Private media never falls back to its historical public
 * URL or a signed CDN URL; the same-origin route rechecks access for every read. */
export async function resolveModerationMedia(
  values: (string | null | undefined)[],
  kind: 'post' | 'story',
  entityIds: string[],
): Promise<Record<string, string>> {
  await requirePermission('post_moderate');
  if (kind !== 'post' && kind !== 'story') throw new Error('Unsupported moderation media kind.');
  const ids = [...new Set(entityIds.filter(id => UUID.test(id)))];
  const raws = [...new Set(values.filter((v): v is string => typeof v === 'string' && !!v.trim()))];
  if (ids.length > 200 || raws.length > MAX_BINDINGS) throw new Error('Content preview authorization exceeded its binding limit.');
  if (!ids.length || !raws.length) return Object.create(null);
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const origin = new URL(base).origin;
  const publicSources = raws.filter(raw => {
    const location = contentMediaLocation(raw, base);
    return location && !PRIVATE_CONTENT_BUCKETS.has(location.bucket);
  });
  const [map, result] = await Promise.all([
    resolveMedia(publicSources),
    serviceClient().rpc('admin_bound_content_media_manifest', { p_kind: kind, p_entity_ids: ids, p_origin: origin }),
  ]);
  if (result.error) throw new Error('Content preview authorization could not be checked.');
  if (!Array.isArray(result.data)) throw new Error('Content preview authorization returned an invalid manifest.');
  if (result.data.length > MAX_BINDINGS) throw new Error('Content preview authorization exceeded its binding limit.');
  const allowed = new Map<string, string>();
  const requested = new Set(ids);
  for (const row of result.data) {
    if (!row || typeof row !== 'object' || typeof row.entity_id !== 'string' || !requested.has(row.entity_id) ||
        typeof row.bucket_id !== 'string' || !PRIVATE_CONTENT_BUCKETS.has(row.bucket_id) || typeof row.object_path !== 'string') {
      throw new Error('Content preview authorization returned an invalid manifest.');
    }
    const location = contentMediaLocation(row.bucket_id + '/' + row.object_path, base);
    if (!location || location.path !== row.object_path || location.path.length > 1024 || location.path.includes('%')) {
      throw new Error('Content preview authorization returned an invalid manifest.');
    }
    allowed.set(row.bucket_id + '/' + row.object_path, row.entity_id);
  }
  for (const raw of raws) {
    const location = contentMediaLocation(raw, base);
    if (!location || !PRIVATE_CONTENT_BUCKETS.has(location.bucket)) continue;
    const id = allowed.get(location.bucket + '/' + location.path);
    if (!id) continue;
    const query = new URLSearchParams({ kind, id, bucket: location.bucket, path: location.path });
    map[raw] = '/api/moderation-media?' + query.toString();
  }
  return map;
}
