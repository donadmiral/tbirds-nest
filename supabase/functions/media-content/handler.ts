import { proofDiagnostics, type ProofBudget, type ProofStage } from './proofTransport.ts';
type Stage = ProofStage | 'storage_headers' | 'first_byte' | 'stream';
type Outcome = 'ready' | 'complete' | 'aborted' | 'timeout' | 'error';
export type MediaDeliveryDiagnostic = {
  outcome: Outcome; stage: Stage; elapsedMs: number; bytesRead: number;
  timings: Partial<Record<Stage, number>>; upstreamStatus?: number; resolver?: ReturnType<typeof proofDiagnostics>;
};
type Dependencies = {
  base: string; serviceKey: string;
  resolve(token: string, bucket: string, path: string, signal: AbortSignal, stage: 'authorization'|'revalidation', budget:ProofBudget): Promise<{ bucket: string; path: string; version: string; expiresAt: string } | null>;
  resolveVariant?(token: string, bucket: string, path: string, version: string, signal: AbortSignal, stage:'variant_selection'|'variant_revalidation', budget:ProofBudget): Promise<{
    bucket: string; path: string; version: string; etag: string; sourceVersion: string;
  } | { unavailable: true } | null>;
  readRepresentation?(token:string,bucket:string,path:string,version:string|null,kind:'poster'|'compatible',signal:AbortSignal): Promise<
    ({bytes:number;jpeg:string;hash:string} | {bucket:string;path:string;version:string;etag:string}) & {sourceVersion:string;sourcePath:string;sourceBucket:string;expiresAt:string} | null>;
  fetch: typeof fetch;
  randomId?(): string;
  diagnostic?(event: MediaDeliveryDiagnostic): void;
  startupTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
};
const headers = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'range, if-range',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Server-Timing',
  'Cache-Control': 'private, no-store, max-age=0', 'CDN-Cache-Control': 'no-store',
  'Vary': 'Range', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};
function validRange(range: string): boolean {
  if (range.length > 80) return false;
  const match = /^bytes=(?:(\d+)-(\d*)|-(\d+))$/.exec(range);
  if (!match) return false;
  return match[3] !== undefined ? BigInt(match[3]) > 0n
    : match[2] === '' || BigInt(match[2]) >= BigInt(match[1]);
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
  const rangedSize = end - start + 1n;
  if (size !== null && size !== rangedSize) throw new Error('Mismatched media length');
  return rangedSize;
}
export function createMediaContentHandler(deps: Dependencies) {
  const error = (status: number, extra: Record<string, string> = {}) => new Response(JSON.stringify({ error: 'This media is unavailable. Reload its post or conversation.' }), {
    status, headers: { ...headers, ...extra, 'Content-Type': 'application/json' },
  });
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!['GET', 'HEAD'].includes(request.method)) return error(405);
    const started = Date.now(), controller = new AbortController();
    const timings: Partial<Record<Stage, number>> = {};
    const proof:ProofBudget={until:started+(deps.startupTimeoutMs ?? 12000),retried:false,attempts:[]};
    let stage: Stage = 'authorization', stageStarted = started, bytesRead = 0;
    let activeUpstream: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let outputStream: ReadableStreamDefaultController<Uint8Array> | undefined;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const report = (outcome: Outcome) => {
      // No URL, token, path, identity, exception message or media bytes leave
      // this boundary. Timing fields can be correlated by the runtime's ID.
      try { deps.diagnostic?.({ outcome, stage, ...(proof.attempts.length ? {resolver:proofDiagnostics(proof)} : {}), elapsedMs: Date.now() - started, bytesRead, timings: { ...timings, [stage]: timings[stage] ?? Date.now() - stageStarted }, ...(activeUpstream ? { upstreamStatus: activeUpstream.status } : {}) }); } catch { /* Logging cannot interrupt delivery. */ }
    };
    const detach = () => {
      if (startupTimer) clearTimeout(startupTimer);
      if (idleTimer) clearTimeout(idleTimer);
      request.signal.removeEventListener('abort', clientAbort);
    };
    const cancelUpstream = () => {
      // Deno/network stream cancellation itself can remain pending. Initiate
      // it, but never make a refusal, client close or deadline wait for it.
      try {
        const pending = reader ? reader.cancel() : activeUpstream?.body?.cancel();
        void pending?.catch(() => {});
      } catch { /* Already closed or locked. */ }
    };
    const stop = (outcome: Exclude<Outcome, 'ready'>) => {
      if (finished) return;
      finished = true; detach();
      report(outcome);
      controller.abort(new Error('Media delivery stopped'));
      cancelUpstream();
      if (outcome !== 'complete') {
        try { outputStream?.error(new Error('Media download interrupted')); } catch { /* Already closed. */ }
      }
    };
    const clientAbort = () => stop('aborted');
    // Race every pre-response await with cancellation, including the two
    // authorization RPCs. The SDK also receives this same AbortSignal.
    const wait = <T,>(work: PromiseLike<T>): Promise<T> => {
      const pending = Promise.resolve(work);
      if (controller.signal.aborted) { void pending.catch(() => {}); return Promise.reject(new Error('Media delivery stopped')); }
      return new Promise<T>((resolve, reject) => {
        const abort = () => reject(new Error('Media delivery stopped'));
        controller.signal.addEventListener('abort', abort, { once: true });
        pending.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
      });
    };
    const measure = async <T,>(nextStage: Stage, work: () => PromiseLike<T>): Promise<T> => {
      if (controller.signal.aborted) throw new Error('Media delivery stopped');
      stage = nextStage;
      const before = Date.now();
      stageStarted = before;
      try { return await wait(work()); }
      finally { timings[nextStage] = Date.now() - before; }
    };
    const readNext = async () => {
      // Only time a read which is actually waiting on Storage. A paused or
      // prewarmed player may leave our queued chunk unread indefinitely.
      idleTimer = setTimeout(() => stop('timeout'), deps.streamIdleTimeoutMs ?? 15000);
      try { return await wait(reader!.read()); }
      finally { clearTimeout(idleTimer); idleTimer = undefined; }
    };
    try {
      const url = new URL(request.url);
      const match = url.pathname.match(/\/(?:functions\/v1\/)?media-content\/(post-media|story-media|media|chat-media|chat-files|music-audio|live-clips)\/(.+)$/);
      const token = url.searchParams.get('token') || '';
      if (!match || !/^[0-9a-f]{64}$/.test(token)) return error(403);
      const bucket = match[1], path = decodeURIComponent(match[2]);
      if (path.length > 1024 || /[%\\\u0000-\u001f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return error(403);
      const range = request.headers.get('Range');
      if (range && !validRange(range)) return error(416);
      request.signal.addEventListener('abort', clientAbort, { once: true });
      if (request.signal.aborted) { stop('aborted'); return error(499); }
      startupTimer = setTimeout(() => stop('timeout'), deps.startupTimeoutMs ?? 12000);
      const representation = url.searchParams.get('representation');
      if (representation !== null && (url.searchParams.getAll('representation').length !== 1 || !['poster','compatible'].includes(representation) || bucket!=='post-media')) {stop('complete');return error(400);}
      // One RPC couples the original ticket proof with the approved derivative.
      const scopedKind=representation==='poster'||representation==='compatible'?representation:null;
      const readScoped=(version:string|null)=>deps.readRepresentation?.(token,bucket,path,version,scopedKind!,controller.signal)??Promise.resolve(null);
      const scoped=scopedKind?await measure('authorization',()=>readScoped(null)):null;
      if(scopedKind && (!scoped||scoped.sourceBucket!==bucket||scoped.sourcePath!==path||!scoped.sourceVersion)){stop('complete');return error(403);}
      const grant=scoped?{bucket,path,version:scoped.sourceVersion,expiresAt:scoped.expiresAt}
        :await measure('authorization',()=>deps.resolve(token,bucket,path,controller.signal,'authorization',proof));
      if (!grant || grant.bucket !== bucket || grant.path !== path || typeof grant.version !== 'string' || !grant.version) { stop('complete'); return error(403); }
      // Selection uses the persisted ticket's creation time, never a TTL guess.
      // One playback URL therefore keeps its byte layout across Range requests.
      if(representation==='poster'){
        const result=scoped;
        if(!result){stop('complete');return error(410);}
        if(!('jpeg' in result)||!Number.isSafeInteger(result.bytes)||result.bytes<32||result.bytes>65536||result.jpeg.length>87384||!/^[a-f0-9]{64}$/.test(result.hash)){stop('error');return error(503);}
        const jpeg=Uint8Array.from(atob(result.jpeg),c=>c.charCodeAt(0));
        if(jpeg.length!==result.bytes||jpeg[0]!==255||jpeg[1]!==216||jpeg[2]!==255||jpeg.at(-2)!==255||jpeg.at(-1)!==217){stop('error');return error(503);}
        // The SQL read checked the current ticket, post context and exact object versions
        // atomically with returning these bytes. Never route an unknown poster to the original.
        stop('complete');return new Response(request.method==='HEAD'?null:jpeg,{status:200,headers:{...headers,'Content-Type':'image/jpeg','Content-Length':String(jpeg.length),'ETag':'"pc-poster-'+result.hash+'"'}});
      }
      const chooseVariant = async(phase:'variant_selection'|'variant_revalidation') => {
        if(representation==='compatible'){
          const asset=phase==='variant_selection'?scoped:await measure(phase,()=>readScoped(grant.version));
          if(asset && (asset.sourceVersion!==grant.version||asset.sourcePath!==path||asset.sourceBucket!==bucket))return {unavailable:true as const};
          return asset && 'path' in asset ? asset : {unavailable:true as const};
        }
        return deps.resolveVariant && ['post-media','story-media'].includes(bucket)
          ? measure(phase, () => deps.resolveVariant!(token, bucket, path, grant.version, controller.signal,phase,proof)) : null;
      };
      const variant=await chooseVariant('variant_selection');
      if (variant && 'unavailable' in variant) {stop('complete'); return error(410);}
      if (variant && (!variant.version||!variant.etag||variant.sourceVersion!==grant.version||variant.path.split('/')[0]!==path.split('/')[0]||
        (representation==='compatible'
          ? variant.bucket!=='adaptive-media'||!/^[0-9a-f-]{36}\/_renditions_v2\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/fallback\.mp4$/i.test(variant.path)
          : variant.bucket!=='derived-media'||!/^[0-9a-f-]{36}\/_derived_v1\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|mov)$/i.test(variant.path)))) {
        stop('complete');return error(503);
      }
      const selected = variant || grant;
      const representationTag = '"pc-' + encodeURIComponent(JSON.stringify([grant.version, selected.version])) + '"';
      // A stale or weak If-Range requests the complete selected representation.
      const upstreamRange = request.headers.has('If-Range') && request.headers.get('If-Range') !== representationTag ? null : range;
      const upstream = await measure('storage_headers', () => {
        const storageUrl = new URL(`${new URL(deps.base).origin}/storage/v1/object/authenticated/${selected.bucket}/${selected.path.split('/').map(encodeURIComponent).join('/')}`);
        // A fresh cache key prevents trusted processing replacements from serving
        // previously cached bytes while the database version is already newer.
        storageUrl.searchParams.set('cacheNonce', `${grant.version}${variant ? '-' + variant.version : ''}-${deps.randomId?.() ?? crypto.randomUUID()}`);
        return deps.fetch(storageUrl.href, {
          method: request.method, headers: { Authorization: `Bearer ${deps.serviceKey}`, apikey: deps.serviceKey,
            'Cache-Control': 'no-store', 'Accept-Encoding': 'identity', ...(upstreamRange ? { Range: upstreamRange } : {}) },
          cache: 'no-store', redirect: 'error', signal: controller.signal,
        }).then(response => {
          activeUpstream = response;
          if (controller.signal.aborted) { cancelUpstream(); throw new Error('Media delivery stopped'); }
          return response;
        });
      });
      if (upstream.redirected || !upstream.ok || ![200, 206].includes(upstream.status)) {
        stop('error');
        if (upstream.status === 416) {
          const size = upstream.headers.get('Content-Range');
          return error(416, size && /^bytes \*\/\d+$/.test(size) ? { 'Content-Range': size } : {});
        }
        return error(upstream.status === 404 ? 410 : 503);
      }
      const after = scopedKind?grant:await measure('revalidation', () => deps.resolve(token, bucket, path, controller.signal, 'revalidation', proof));
      if (!after || after.version !== grant.version || after.path !== path || after.bucket !== bucket) { stop('complete'); return error(403); }
      if (variant) {
        const current = await chooseVariant('variant_revalidation');
        if (!current || 'unavailable' in current || current.path !== variant.path || current.version !== variant.version
          || current.etag !== variant.etag || upstream.headers.get('ETag')?.trim().replace(/^"|"$/g, '') !== variant.etag) { stop('complete'); return error(410); }
      }
      const mime = upstream.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() || '';
      if(representation==='compatible' && mime!=='video/mp4'){stop('error');return error(415);}
      if (!(bucket === 'live-clips' && mime === 'text/vtt' && path.endsWith('/captions.vtt')) && !/^(?:image\/(?:jpeg|png|webp|gif|heic|heif|avif)|video\/(?:mp4|quicktime|webm)|audio\/[a-z0-9.+-]+|application\/(?:pdf|octet-stream))$/.test(mime)) { stop('complete'); return error(415); }
      // fetch may transparently decompress a response while retaining its
      // compressed Content-Length/Range. Those headers cannot describe the
      // decoded bytes; require identity for byte-accurate media/range delivery.
      const encoding = upstream.headers.get('Content-Encoding')?.trim().toLowerCase();
      if (encoding && encoding !== 'identity') throw new Error('Unexpected media encoding');
      const expectedBytes = responseSize(upstream);
      const output = new Headers({ ...headers, 'Content-Type': mime, 'ETag': representationTag, 'Content-Disposition': mime === 'application/octet-stream' ? 'attachment' : 'inline' });
      for (const name of ['Content-Length', 'Content-Range', 'Accept-Ranges']) {
        const value = upstream.headers.get(name); if (value) output.set(name, value);
      }
      const setTimings = () => output.set('Server-Timing', Object.entries(timings).map(([name, duration]) => `${name};dur=${duration}`).join(', '));
      if (request.method === 'HEAD' || !upstream.body || expectedBytes === 0n) {
        if (request.method !== 'HEAD' && expectedBytes !== null && expectedBytes > 0n) throw new Error('Missing media body');
        setTimings(); stop('complete');
        return new Response(null, { status: upstream.status, headers: output });
      }
      reader = upstream.body.getReader();
      const first = await measure('first_byte', () => reader!.read());
      if (first.done && expectedBytes !== null && expectedBytes > 0n) throw new Error('Truncated media body');
      if (!first.done && expectedBytes !== null && BigInt(first.value.byteLength) > expectedBytes) throw new Error('Excess media bytes');
      if (startupTimer) clearTimeout(startupTimer);
      stage = 'stream'; stageStarted = Date.now(); setTimings(); report('ready');
      let pendingFirst: ReadableStreamReadResult<Uint8Array> | null = first;
      const body = new ReadableStream<Uint8Array>({
        start(stream) { outputStream = stream; },
        async pull(stream) {
          if (finished) return;
          try {
            const next = pendingFirst ?? await readNext(); pendingFirst = null;
            if (finished) return;
            if (next.done) {
              if (expectedBytes !== null && BigInt(bytesRead) !== expectedBytes) throw new Error('Truncated media body');
              stream.close(); stop('complete'); return;
            }
            bytesRead += next.value.byteLength;
            if (expectedBytes !== null && BigInt(bytesRead) > expectedBytes) throw new Error('Excess media bytes');
            stream.enqueue(next.value);
            if (expectedBytes !== null && BigInt(bytesRead) === expectedBytes) {
              // The HTTP length is complete; do not retain a decoder/network
              // slot waiting for an extra EOF from a stalled upstream socket.
              stream.close(); stop('complete');
            }
          } catch { stop(request.signal.aborted ? 'aborted' : 'error'); }
        },
        cancel() { stop('aborted'); },
      });
      return new Response(body, { status: upstream.status, headers: output });
    } catch {
      stop(request.signal.aborted ? 'aborted' : 'error');
      return error(request.signal.aborted ? 499 : 503);
    }
  };
}
