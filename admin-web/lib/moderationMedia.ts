import 'server-only';
import { requirePermission } from './adminAuth';
import { serviceClient } from './supabaseAdmin';
import { resolveMedia } from './media';
import { contentMediaLocation } from './publicMedia';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PRIVATE_CONTENT_BUCKETS = new Set(['post-media', 'story-media', 'media']);
const BINDING_PAGE_SIZE = 500;
const MAX_BINDINGS = 4000;

async function readBindings(svc: ReturnType<typeof serviceClient>, kind: 'post' | 'story', ids: string[]) {
  const rows: { entity_id: string; bucket_id: string; object_path: string }[] = [];
  // The API caps results at 1000 rows. Read smaller ordered pages, including a
  // final probe after a full limit, so an oversized result never looks complete.
  for (let offset = 0; offset <= MAX_BINDINGS; offset += BINDING_PAGE_SIZE) {
    const { data, error } = await svc.from('content_media_bindings')
      .select('entity_id, bucket_id, object_path').eq('entity_kind', kind).in('entity_id', ids)
      .order('entity_id', { ascending: true }).order('bucket_id', { ascending: true })
      .order('object_path', { ascending: true }).range(offset, offset + BINDING_PAGE_SIZE - 1);
    if (error) throw new Error('Content preview authorization could not be checked.');
    const page = data ?? [];
    if (rows.length + page.length > MAX_BINDINGS) {
      throw new Error('Content preview authorization exceeded its binding limit.');
    }
    rows.push(...page);
    if (page.length < BINDING_PAGE_SIZE) return rows;
  }
  throw new Error('Content preview authorization exceeded its binding limit.');
}

/** Moderator-only previews, restricted to existing content and its verified object bindings. */
export async function resolveModerationMedia(
  values: (string | null | undefined)[],
  kind: 'post' | 'story',
  entityIds: string[],
): Promise<Record<string, string>> {
  // Recheck the authenticated staff session here, independently of the calling page.
  await requirePermission('post_moderate');
  if (kind !== 'post' && kind !== 'story') throw new Error('Unsupported moderation media kind.');
  const ids = [...new Set(entityIds.filter(id => UUID.test(id)))].slice(0, 200);
  const raws = [...new Set(values.filter((v): v is string => typeof v === 'string' && !!v.trim()))].slice(0, 2000);
  if (!ids.length || !raws.length) return Object.create(null);
  const svc = serviceClient();
  const [map, existing, bindings] = await Promise.all([
    resolveMedia(raws),
    svc.from(kind === 'post' ? 'posts' : 'stories').select('id').in('id', ids),
    readBindings(svc, kind, ids),
  ]);
  if (existing.error) throw new Error('Content preview authorization could not be checked.');
  const live = new Set((existing.data ?? []).map(row => row.id));
  const allowed = new Set(bindings.filter(row => live.has(row.entity_id))
    .map(row => `${row.bucket_id}/${row.object_path}`));
  const groups = new Map<string, Map<string, string[]>>();
  for (const raw of raws) {
    const location = contentMediaLocation(raw, process.env.NEXT_PUBLIC_SUPABASE_URL || '');
    if (!location || !PRIVATE_CONTENT_BUCKETS.has(location.bucket) ||
        !allowed.has(`${location.bucket}/${location.path}`)) continue;
    let paths = groups.get(location.bucket);
    if (!paths) { paths = new Map(); groups.set(location.bucket, paths); }
    paths.set(location.path, [...(paths.get(location.path) ?? []), raw]);
  }
  // Three allowlisted buckets at most. Sign only paths bound to these post/story IDs.
  await Promise.all([...groups].map(async ([bucket, paths]) => {
    const { data, error } = await svc.storage.from(bucket).createSignedUrls([...paths.keys()], 600);
    if (error) return;
    for (const signed of data ?? []) {
      if (signed.error || !signed.path || !signed.signedUrl) continue;
      for (const raw of paths.get(signed.path) ?? []) map[raw] = signed.signedUrl;
    }
  }));
  return map;
}
