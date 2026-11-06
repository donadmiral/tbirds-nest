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
type Receipt = BoundObject & { lease?:string; bytes?:number; hash?:string; jpeg?:string; path?:string; etag?:string; version?:string };

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

function responseSize(response: Response): bigint | null {
  const length = response.headers.get('Content-Length');
  if (length !== null && !/^\d{1,20}$/.test(length)) throw new Error('Invalid media length');
  const size = length === null ? null : BigInt(length);
  if (response.status !== 206) return size;
  const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers.get('Content-Range') || '');
  if (!range) throw new Error('Invalid media range');
  const start = BigInt(range[1]), end = BigInt(range[2]);
  if (end < start || (range[3] !== '*' && BigInt(range[3]) <= end)) throw new Error('Invalid media range');
  const rangedSize = end - start + BigInt(1);
  if (size !== null && size !== rangedSize) throw new Error('Mismatched media length');
  return rangedSize;
}

type DeliveryOptions = { startupTimeoutMs?: number; streamIdleTimeoutMs?: number };

/** Each image/video range request verifies a current staff session and the
 * exact, still-referenced Storage object. No bearer capability reaches the UI. */
export async function moderationMediaResponse(request: Request, options: DeliveryOptions = {}): Promise<Response> {
  const head = request.method === 'HEAD';
  if (!head && request.method !== 'GET') return unavailable(405, head);
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return unavailable(403, head);
  const controller = new AbortController();
  let upstream: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let output: ReadableStreamDefaultController<Uint8Array> | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  const cancelUpstream = () => {
    // Cancellation may itself remain pending. Refusals and client aborts must
    // never wait for an unresponsive Storage connection to acknowledge it.
    try { void (reader ? reader.cancel() : upstream?.body?.cancel())?.catch(() => {}); } catch { /* Already closed. */ }
  };
  const stop = (failed = false) => {
    if (finished) return;
    finished = true;
    clearTimeout(startupTimer); clearTimeout(idleTimer);
    request.signal.removeEventListener('abort', clientAbort);
    controller.abort(new Error('Media preview stopped'));
    cancelUpstream();
    if (failed) { try { output?.error(new Error('Media preview interrupted')); } catch { /* Already closed. */ } }
  };
  const clientAbort = () => stop(true);
  const wait = <T,>(work: PromiseLike<T>): Promise<T> => {
    const pending = Promise.resolve(work);
    if (controller.signal.aborted) { void pending.catch(() => {}); return Promise.reject(new Error('Media preview stopped')); }
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new Error('Media preview stopped'));
      controller.signal.addEventListener('abort', abort, { once: true });
      pending.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
    });
  };
  const reject = (status: number) => { stop(); return unavailable(status, head); };
  const readNext = async () => {
    // Bound only an outstanding read, never time spent waiting for a paused
    // browser to consume a queued chunk. Healthy long videos have no time cap.
    idleTimer = setTimeout(() => stop(true), options.streamIdleTimeoutMs ?? 15_000);
    try { return await wait(reader!.read()); }
    finally { clearTimeout(idleTimer); idleTimer = undefined; }
  };
  request.signal.addEventListener('abort', clientAbort, { once: true });
  if (request.signal.aborted) { stop(true); return unavailable(499, head); }
  startupTimer = setTimeout(() => stop(true), options.startupTimeoutMs ?? 12_000);
  try {
    const admin = await wait(getAdmin());
    if (!admin) return reject(401);
    if (!await wait(staffAllowed(admin))) return reject(403);

    const url = new URL(request.url);
    const kind = url.searchParams.get('kind');
    const entityId = url.searchParams.get('id') || '';
    const bucket = url.searchParams.get('bucket') || '';
    const path = url.searchParams.get('path') || '';
    if ((kind !== 'post' && kind !== 'story') || !UUID.test(entityId) || !BUCKETS.has(bucket) ||
        !path || path.length > 1024 || /[%\\\x00-\x1f\x7f]/.test(path) ||
        path.split('/').some(part => !part || part === '.' || part === '..')) return reject(400);
    const representation=url.searchParams.get('representation');
    if(representation!==null&&(url.searchParams.getAll('representation').length!==1||kind!=='post'||bucket!=='post-media'||!['poster','compatible'].includes(representation)))return reject(400);
    const range = request.headers.get('Range');
    if (range && !validMediaRange(range)) return reject(416);

    const configured = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (configured.protocol !== 'https:' || configured.username || configured.password || !serviceKey) return reject(503);
    const svc = serviceClient();
    const proof = async (payload=false):Promise<Receipt|null> => {
      const ordinary={p_kind:kind,p_entity_id:entityId,p_bucket:bucket,p_path:path,p_origin:configured.origin};
      const {data,error}=await wait((representation
        ?svc.rpc('admin_bound_post_representation_v1',{...ordinary,p_kind:representation,p_payload:payload})
        :svc.rpc('admin_bound_content_media_object',ordinary)).abortSignal(controller.signal));
      if(error)throw new Error('Media authorization unavailable');
      const original=boundObject(data);if(!original||!representation)return original;
      if(!data||!UUID.test(data.lease)||!Number.isSafeInteger(data.bytes)||data.bytes<1)throw Error('Invalid derived receipt');
      if(representation==='poster'){
        if(data.bytes>65536||typeof data.hash!=='string'||!/^[a-f0-9]{64}$/.test(data.hash)||
          (payload&&(typeof data.jpeg!=='string'||data.jpeg.length>87384)))throw Error('Invalid image proof');
        return {...original,lease:data.lease,bytes:data.bytes,hash:data.hash,...(payload?{jpeg:data.jpeg}:{})};
      }
      const parts=typeof data.path==='string'?data.path.split('/'):[];
      if(data.bytes>33554432||parts.length!==5||parts[0]!==path.split('/')[0]||!UUID.test(parts[0])||parts[1]!=='_renditions_v2'||
        !UUID.test(parts[2])||parts[3]!==data.lease||parts[4]!=='fallback.mp4'||typeof data.version!=='string'||
        !/^[a-zA-Z0-9_-]{1,200}$/.test(data.version)||typeof data.etag!=='string'||!/^[\x21\x23-\x7e]{1,200}$/.test(data.etag))throw Error('Invalid video proof');
      return {...original,lease:data.lease,bytes:data.bytes,path:data.path,etag:data.etag,version:data.version};
    };
    const before=await proof(representation==='poster'&&!head);
    if(!before)return reject(404);
    const revalidate=async()=>{
      const [after,currentAdmin]=await Promise.all([proof(),wait(getAdmin())]);
      return !!after && after.object_id===before.object_id && after.object_version===before.object_version &&
        after.lease===before.lease && after.bytes===before.bytes && after.hash===before.hash && after.path===before.path &&
        after.etag===before.etag && after.version===before.version &&
        !!currentAdmin && currentAdmin.id===admin.id && currentAdmin.sessionId===admin.sessionId && await wait(staffAllowed(currentAdmin));
    };
    if(representation==='poster'){
      const jpeg=head?null:Uint8Array.from(atob(before.jpeg!),c=>c.charCodeAt(0));
      if(jpeg&&(jpeg.length!==before.bytes||jpeg[0]!==255||jpeg[1]!==216||jpeg[2]!==255||jpeg.at(-2)!==255||jpeg.at(-1)!==217))return reject(503);
      if(!await revalidate())return reject(403);
      stop();return new Response(jpeg,{status:200,headers:{...PRIVATE_HEADERS,'Content-Type':'image/jpeg','Content-Disposition':'inline','Content-Length':String(before.bytes),'ETag':'"'+before.hash+'"'}});
    }
    const deliveredPath=before.path||path;
    const source = new URL(`/storage/v1/object/authenticated/${representation==='compatible'?'adaptive-media':bucket}/${deliveredPath.split('/').map(encodeURIComponent).join('/')}`, configured.origin);
    const representationTag=representation==='compatible'?'"pc-admin-'+before.lease+'-'+before.version+'"':null;
    const forwardedRange=representationTag&&request.headers.has('If-Range')&&request.headers.get('If-Range')!==representationTag?null:range;
    // This server-only nonce prevents a stale Storage CDN response from being
    // reused after a processor replaces an object at the same path.
    source.searchParams.set('cacheNonce', before.object_version + '-' + crypto.randomUUID());
    await wait(fetch(source, {
      method: head ? 'HEAD' : 'GET', cache: 'no-store', redirect: 'error', signal: controller.signal,
      headers: { Authorization: 'Bearer ' + serviceKey, apikey: serviceKey, 'Cache-Control': 'no-store', 'Accept-Encoding': 'identity', ...(forwardedRange ? { Range: forwardedRange } : {}) },
    }).then(response => {
      upstream = response;
      if (controller.signal.aborted) { cancelUpstream(); throw new Error('Media preview stopped'); }
    }));
    if (!upstream) throw new Error('Media preview unavailable');
    if (upstream.redirected || (upstream.status !== 200 && upstream.status !== 206)) {
      return reject(upstream.status === 416 ? 416 : upstream.status === 404 ? 404 : 503);
    }
    if(!await revalidate())return reject(403);
    if(representation==='compatible'&&(upstream.headers.get('ETag')?.trim().replace(/^"|"$/g,'')!==before.etag||
      (upstream.status===206?!upstream.headers.get('Content-Range')?.endsWith('/'+before.bytes):upstream.headers.get('Content-Length')!==String(before.bytes))))return reject(410);
    const mime = displayMime(upstream.headers.get('Content-Type'), deliveredPath);
    if(representation==='compatible'&&mime!=='video/mp4')return reject(415);
    if (!mime) return reject(415);
    // fetch can decode compressed bytes while retaining their original length.
    // Those headers cannot safely describe the delivered range.
    const encoding = upstream.headers.get('Content-Encoding')?.trim().toLowerCase();
    if (encoding && encoding !== 'identity') throw new Error('Unexpected media encoding');
    const expectedBytes = responseSize(upstream);
    const headers = new Headers({ ...PRIVATE_HEADERS, 'Content-Type': mime, 'Content-Disposition': 'inline' });
    if(representationTag)headers.set('ETag',representationTag);
    for (const name of ['Content-Length', 'Content-Range', 'Accept-Ranges']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (head || !upstream.body || expectedBytes === BigInt(0)) {
      if (!head && expectedBytes !== null && expectedBytes > BigInt(0)) throw new Error('Missing media body');
      stop(); return new Response(null, { status: upstream.status, headers });
    }
    reader = upstream.body.getReader();
    const first = await wait(reader.read());
    if (first.done && expectedBytes !== null && expectedBytes > BigInt(0)) throw new Error('Truncated media body');
    if (!first.done && expectedBytes !== null && BigInt(first.value.byteLength) > expectedBytes) throw new Error('Excess media bytes');
    clearTimeout(startupTimer);
    let pendingFirst: ReadableStreamReadResult<Uint8Array> | null = first, bytesRead = BigInt(0);
    const body = new ReadableStream<Uint8Array>({
      start(stream) { output = stream; },
      async pull(stream) {
        if (finished) return;
        try {
          const next = pendingFirst ?? await readNext(); pendingFirst = null;
          if (finished) return;
          if (next.done) {
            if (expectedBytes !== null && bytesRead !== expectedBytes) throw new Error('Truncated media body');
            stream.close(); stop(); return;
          }
          bytesRead += BigInt(next.value.byteLength);
          if (expectedBytes !== null && bytesRead > expectedBytes) throw new Error('Excess media bytes');
          stream.enqueue(next.value);
          if (expectedBytes !== null && bytesRead === expectedBytes) { stream.close(); stop(); }
        } catch { stop(true); }
      },
      cancel() { stop(true); },
    });
    return new Response(body, { status: upstream.status, headers });
  } catch {
    stop(true);
    return unavailable(request.signal.aborted ? 499 : 503, head);
  }
}
