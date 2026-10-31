import 'server-only';
import { getAdmin, type Admin } from './adminAuth';
import { canAccessOperations } from './adminAssurance';
import { canPerform } from './permissions';
import { serviceClient } from './supabaseAdmin';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const BUCKETS = new Set(['post-media', 'story-media', 'media']);
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  'Surrogate-Control': 'no-store',
  'Vary': 'Cookie, Range',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};
type BoundObject = { object_id: string; object_version: string };

function unavailable(status: number, head: boolean): Response {
  return new Response(head ? null : JSON.stringify({ error: 'This media preview is unavailable. Refresh the review page.' }), {
    status, headers: { ...PRIVATE_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** A single, bounded HTTP byte range. Multipart and unsafe integer ranges fail closed. */
export function validMediaRange(range: string): boolean {
  const match = /^bytes=(\d{1,16})?-(\d{1,16})?$/.exec(range);
  if (!match || (!match[1] && !match[2])) return false;
  const start = match[1] ? Number(match[1]) : null;
  const end = match[2] ? Number(match[2]) : null;
  if (start !== null && (!Number.isSafeInteger(start) || start < 0)) return false;
  if (end !== null && (!Number.isSafeInteger(end) || end < 0)) return false;
  return start === null ? end! > 0 : end === null || end >= start;
}

function boundObject(value: unknown): BoundObject | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new Error('Invalid media authorization receipt');
  const object = value as Record<string, unknown>;
  if (typeof object.object_id !== 'string' || !UUID.test(object.object_id) ||
      typeof object.object_version !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(object.object_version)) {
    throw new Error('Invalid media authorization receipt');
  }
  return { object_id: object.object_id, object_version: object.object_version };
}

function displayMime(value: string | null, path: string): string | null {
  const mime = value?.split(';')[0].trim().toLowerCase() || '';
  if (/^(?:image\/(?:jpeg|png|webp|gif|avif|heic|heif|bmp|tiff)|video\/(?:mp4|quicktime|webm|ogg|x-m4v|mpeg|3gpp|3gpp2|x-msvideo|x-matroska))$/.test(mime)) return mime;
  // Some historical uploads have a generic MIME type. Only known media suffixes
  // can repair it; arbitrary HTML, SVG and documents are never served inline.
  if (mime !== 'application/octet-stream') return null;
  const suffix = path.split('.').at(-1)?.toLowerCase() || '';
  const types: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm' };
  return types[suffix] || null;
}

async function staffAllowed(admin: Admin | null): Promise<boolean> {
  return !!admin && canPerform(admin.role, 'post_moderate') && await canAccessOperations(admin);
}

/** Each image/video range request verifies a current staff session and the
 * exact, still-referenced Storage object. No bearer capability reaches the UI. */
export async function moderationMediaResponse(request: Request): Promise<Response> {
  const head = request.method === 'HEAD';
  if (!head && request.method !== 'GET') return unavailable(405, head);
  let upstream: Response | undefined;
  try {
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return unavailable(403, head);
    const admin = await getAdmin();
    if (!admin) return unavailable(401, head);
    if (!await staffAllowed(admin)) return unavailable(403, head);

    const url = new URL(request.url);
    const kind = url.searchParams.get('kind');
    const entityId = url.searchParams.get('id') || '';
    const bucket = url.searchParams.get('bucket') || '';
    const path = url.searchParams.get('path') || '';
    if ((kind !== 'post' && kind !== 'story') || !UUID.test(entityId) || !BUCKETS.has(bucket) ||
        !path || path.length > 1024 || /[%\\\x00-\x1f\x7f]/.test(path) ||
        path.split('/').some(part => !part || part === '.' || part === '..')) return unavailable(400, head);
    const range = request.headers.get('Range');
    if (range && !validMediaRange(range)) return unavailable(416, head);

    const configured = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (configured.protocol !== 'https:' || configured.username || configured.password || !serviceKey) return unavailable(503, head);
    const svc = serviceClient();
    const proof = async () => {
      const { data, error } = await svc.rpc('admin_bound_content_media_object', {
        p_kind: kind, p_entity_id: entityId, p_bucket: bucket, p_path: path, p_origin: configured.origin,
      });
      if (error) throw new Error('Media authorization unavailable');
      return boundObject(data);
    };
    const before = await proof();
    if (!before) return unavailable(404, head);

    const source = new URL(`/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, configured.origin);
    // This server-only nonce prevents a stale Storage CDN response from being
    // reused after a processor replaces an object at the same path.
    source.searchParams.set('cacheNonce', before.object_version + '-' + crypto.randomUUID());
    const controller = new AbortController();
    const headerDeadline = setTimeout(() => controller.abort(), 20_000);
    try {
      upstream = await fetch(source, {
        method: head ? 'HEAD' : 'GET', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([request.signal, controller.signal]),
        headers: { Authorization: 'Bearer ' + serviceKey, apikey: serviceKey, 'Cache-Control': 'no-store', ...(range ? { Range: range } : {}) },
      });
    } finally { clearTimeout(headerDeadline); }
    if (upstream.status !== 200 && upstream.status !== 206) {
      await upstream.body?.cancel();
      return unavailable(upstream.status === 416 ? 416 : upstream.status === 404 ? 404 : 503, head);
    }
    const after = await proof();
    const currentAdmin = await getAdmin();
    if (!after || after.object_id !== before.object_id || after.object_version !== before.object_version ||
        !currentAdmin || currentAdmin.id !== admin.id || currentAdmin.sessionId !== admin.sessionId || !await staffAllowed(currentAdmin)) {
      await upstream.body?.cancel();
      return unavailable(403, head);
    }
    const mime = displayMime(upstream.headers.get('Content-Type'), path);
    if (!mime) { await upstream.body?.cancel(); return unavailable(415, head); }
    const headers = new Headers({ ...PRIVATE_HEADERS, 'Content-Type': mime, 'Content-Disposition': 'inline' });
    for (const name of ['Content-Length', 'Content-Range', 'Accept-Ranges']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(head ? null : upstream.body, { status: upstream.status, headers });
  } catch {
    try { await upstream?.body?.cancel(); } catch { /* The upstream may already be cancelled. */ }
    return unavailable(503, head);
  }
}
