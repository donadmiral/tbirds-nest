type Dependencies = {
  base: string; serviceKey: string;
  resolve(token: string, bucket: string, path: string): Promise<{ bucket: string; path: string; version: string; expiresAt: string } | null>;
  fetch: typeof fetch;
  randomId?(): string;
};
const headers = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'range',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
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
export function createMediaContentHandler(deps: Dependencies) {
  const error = (status: number, extra: Record<string, string> = {}) => new Response(JSON.stringify({ error: 'This media is unavailable. Reload its post or conversation.' }), {
    status, headers: { ...headers, ...extra, 'Content-Type': 'application/json' },
  });
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!['GET', 'HEAD'].includes(request.method)) return error(405);
    let cleanup: (() => void) | undefined;
    let activeUpstream: Response | undefined;
    try {
      const url = new URL(request.url);
      const match = url.pathname.match(/\/(?:functions\/v1\/)?media-content\/(post-media|story-media|media|chat-media|chat-files|music-audio)\/(.+)$/);
      const token = url.searchParams.get('token') || '';
      if (!match || !/^[0-9a-f]{64}$/.test(token)) return error(403);
      const bucket = match[1], path = decodeURIComponent(match[2]);
      if (path.length > 1024 || /[%\\\u0000-\u001f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return error(403);
      const range = request.headers.get('Range');
      if (range && !validRange(range)) return error(416);
      const grant = await deps.resolve(token, bucket, path);
      if (!grant || grant.bucket !== bucket || grant.path !== path || typeof grant.version !== 'string' || !grant.version) return error(403);
      if (request.signal.aborted) return error(499);
      const controller = new AbortController();
      const abort = () => controller.abort(request.signal.reason);
      request.signal.addEventListener('abort', abort, { once: true });
      cleanup = () => request.signal.removeEventListener('abort', abort);
      const timeout = setTimeout(() => controller.abort(), 20000);
      let upstream: Response;
      try {
        const storageUrl = new URL(`${new URL(deps.base).origin}/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`);
        // A fresh cache key prevents trusted processing replacements from serving
        // previously cached bytes while the database version is already newer.
        storageUrl.searchParams.set('cacheNonce', `${grant.version}-${deps.randomId?.() ?? crypto.randomUUID()}`);
        upstream = await deps.fetch(storageUrl.href, {
          method: request.method, headers: { Authorization: `Bearer ${deps.serviceKey}`, apikey: deps.serviceKey,
            'Cache-Control': 'no-store', ...(range ? { Range: range } : {}) },
          cache: 'no-store', redirect: 'error', signal: controller.signal,
        });
        activeUpstream = upstream;
      } finally { clearTimeout(timeout); }
      if (!upstream.ok || ![200, 206].includes(upstream.status)) {
        await upstream.body?.cancel(); cleanup();
        if (upstream.status === 416) {
          const size = upstream.headers.get('Content-Range');
          return error(416, size && /^bytes \*\/\d+$/.test(size) ? { 'Content-Range': size } : {});
        }
        return error(upstream.status === 404 ? 410 : 503);
      }
      const after = await deps.resolve(token, bucket, path);
      if (request.signal.aborted || !after || after.version !== grant.version || after.path !== path || after.bucket !== bucket) {
        await upstream.body?.cancel(); cleanup(); return error(403);
      }
      const mime = upstream.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() || '';
      if (!/^(?:image\/(?:jpeg|png|webp|gif|heic|heif|avif)|video\/(?:mp4|quicktime|webm)|audio\/[a-z0-9.+-]+|application\/(?:pdf|octet-stream))$/.test(mime)) {
        await upstream.body?.cancel(); cleanup(); return error(415);
      }
      const output = new Headers({ ...headers, 'Content-Type': mime, 'Content-Disposition': mime === 'application/octet-stream' ? 'attachment' : 'inline' });
      for (const name of ['Content-Length', 'Content-Range', 'Accept-Ranges']) {
        const value = upstream.headers.get(name); if (value) output.set(name, value);
      }
      if (request.method === 'HEAD' || !upstream.body) {
        await upstream.body?.cancel(); cleanup();
        return new Response(null, { status: upstream.status, headers: output });
      }
      const reader = upstream.body.getReader();
      const release = cleanup;
      const body = new ReadableStream<Uint8Array>({
        async pull(stream) {
          try {
            const next = await reader.read();
            if (next.done) { release(); stream.close(); }
            else stream.enqueue(next.value);
          } catch (cause) { release(); stream.error(cause); }
        },
        async cancel(reason) { controller.abort(reason); release(); await reader.cancel(reason); },
      });
      return new Response(body, { status: upstream.status, headers: output });
    } catch {
      cleanup?.();
      try { await activeUpstream?.body?.cancel(); } catch { /* Already closed/locked. */ }
      return error(request.signal.aborted ? 499 : 503);
    }
  };
}
