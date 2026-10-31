type Client = {
  auth: {
    getUser(): PromiseLike<{
      data: {
        user: unknown;
      };
      error: unknown;
    }>;
  };
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: any;
    error: unknown;
  }>;
};
type Dependencies = {
  protocol?: 'private' | 'legacy';
  env(name: string): string | undefined;
  client(url: string, key: string, authorization?: string): Client;
  fetch: typeof fetch;
  randomId?(): string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,range",
  "Access-Control-Allow-Methods": "POST,GET,HEAD,OPTIONS",
  "Access-Control-Expose-Headers": "Content-Length,Content-Range,Accept-Ranges",
};
const headers = {
  ...cors,
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vary": "Authorization, Range",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
function location(value: unknown, base: string) {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    if (
      u.origin !== new URL(base).origin ||
      u.username ||
      u.password ||
      u.hash ||
      (u.search && !/^\?t=\d+$/.test(u.search))
    )
      return null;
    const m = u.pathname.match(
      /^\/storage\/v1\/object\/public\/(chat-media|chat-files)\/(.+)$/,
    );
    if (!m) return null;
    const p = decodeURIComponent(m[2]);
    if (
      !UUID.test(p.split("/")[0]) ||
      p.includes("%") ||
      p.includes("\\") ||
      p.split("/").some((x) => !x || x === "." || x === "..")
    )
      return null;
    return { bucket: m[1], path: p };
  } catch {
    return null;
  }
}
function validRange(range: string): boolean {
  if (range.length > 80) return false;
  const match = /^bytes=(?:(\d+)-(\d*)|-(\d+))$/.exec(range);
  if (!match) return false;
  return match[3] !== undefined ? BigInt(match[3]) > 0n
    : match[2] === '' || BigInt(match[2]) >= BigInt(match[1]);
}
export function createPrivateMediaSession(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (!["GET", "HEAD", "POST"].includes(req.method))
      return json(405, { error: "Method not allowed" });
    let cleanup: (() => void) | undefined;
    let activeUpstream: Response | undefined;
    try {
      const base = deps.env("SUPABASE_URL"),
        anon = deps.env("SUPABASE_ANON_KEY"),
        service = deps.env("SUPABASE_SERVICE_ROLE_KEY");
      if (!base || !anon || !service)
        return json(503, { error: "Private viewing unavailable" });
      const authorization = req.headers.get("Authorization") || "";
      if (!authorization.startsWith("Bearer "))
        return json(401, { error: "Sign in required" });
      const client = deps.client(base, anon, authorization);
      const auth = await client.auth.getUser();
      if (auth.error || !auth.data?.user)
        return json(401, { error: "Sign in required" });
      const input =
        req.method === "POST"
          ? await req.json().catch(() => null)
          : Object.fromEntries(new URL(req.url).searchParams);
      if (
        !input ||
        typeof input.messageId !== "string" ||
        typeof input.requestId !== "string" ||
        !UUID.test(input.messageId) ||
        !UUID.test(input.requestId)
      )
        return json(400, { error: "Invalid viewing request" });
      const args = {
        p_message_id: input.messageId,
        p_request_id: input.requestId,
      };
      if (req.method === "POST") {
        if (input.action === "close") {
          const r = await client.rpc(deps.protocol === 'legacy' ? 'close_legacy_chat_media' : "close_private_media", {
            ...args,
            ...(deps.protocol === 'legacy' ? {} : { p_reason:
              typeof input.reason === "string" ? input.reason : "closed",
            }),
          });
          return r.error
            ? json(503, { error: "Could not close viewing session" })
            : json(200, { closed: r.data === true });
        }
        if (input.action !== "open")
          return json(400, { error: "Invalid action" });
        const r = await client.rpc(deps.protocol === 'legacy' ? 'open_legacy_chat_media' : "open_private_media", args);
        if (r.error)
          return json(503, { error: "Could not open viewing session" });
        return r.data
          ? json(200, {
            requestId: r.data.requestId, expiresAt: r.data.expiresAt,
            remaining: r.data.remaining, mediaType: r.data.mediaType,
            watermark: r.data.watermark || 'Limited view',
          })
          : json(410, { error: "This attachment is no longer available" });
      }
      const r = await client.rpc(deps.protocol === 'legacy' ? 'read_legacy_chat_media' : "read_private_media", args);
      if (r.error) return json(503, { error: "Private viewing unavailable" });
      if (!r.data) return json(410, { error: "Viewing session has ended" });
      const object = location(r.data.url, base);
      if (!object) return json(403, { error: "Attachment unavailable" });
      const range = req.headers.get("Range");
      if (range && !validRange(range))
        return json(416, { error: "Invalid range" });
      if (deps.protocol === 'legacy' && (typeof r.data.objectVersion !== 'string' || !r.data.objectVersion))
        return json(410, { error: "Viewing session has ended" });
      if (req.signal.aborted) return json(499, { error: "Viewing cancelled" });
      const controller = new AbortController();
      const abort = () => controller.abort(req.signal.reason);
      req.signal.addEventListener('abort', abort, { once: true });
      cleanup = () => req.signal.removeEventListener('abort', abort);
      const timeout = setTimeout(() => controller.abort(), 30000);
      let upstream: Response;
      try {
        const storageUrl = new URL(`${new URL(base).origin}/storage/v1/object/authenticated/${object.bucket}/${object.path.split("/").map(encodeURIComponent).join("/")}`);
        storageUrl.searchParams.set('cacheNonce', `${r.data.objectVersion || 'session'}-${deps.randomId?.() ?? crypto.randomUUID()}`);
        upstream = await deps.fetch(storageUrl.href, {
          method: req.method,
          headers: { Authorization: `Bearer ${service}`, apikey: service,
            'Cache-Control': 'no-store', ...(range ? { Range: range } : {}) },
          cache: 'no-store', redirect: 'error', signal: controller.signal,
        });
        activeUpstream = upstream;
      } finally { clearTimeout(timeout); }
      if (!upstream.ok || ![200, 206].includes(upstream.status)) {
        await upstream.body?.cancel(); cleanup();
        if (upstream.status === 416) return json(416, { error: "Requested range is unavailable" });
        return json(upstream.status === 404 ? 410 : 503, {
          error: "Attachment unavailable",
        });
      }
      // A close or account revocation may land while Storage is preparing the response.
      const stillAllowed = await client.rpc(deps.protocol === 'legacy' ? 'read_legacy_chat_media' : "read_private_media", args);
      if (
        stillAllowed.error ||
        !stillAllowed.data ||
        stillAllowed.data.url !== r.data.url ||
        stillAllowed.data.objectVersion !== r.data.objectVersion || req.signal.aborted
      ) {
        await upstream.body?.cancel(); cleanup();
        return json(410, { error: "Viewing session has ended" });
      }
      const mime = upstream.headers.get("Content-Type")?.split(";")[0] || "";
      if (
        !(
          r.data.mediaType === "image"
            ? /^image\/(jpeg|png|webp|gif|heic|heif|avif)$/
            : /^video\/(mp4|quicktime|webm)$/
        ).test(mime)
      ) {
        await upstream.body?.cancel(); cleanup();
        return json(415, { error: "Unsupported attachment" });
      }
      const responseHeaders = new Headers({
        ...headers,
        "Content-Type": mime,
        "Content-Disposition": "inline",
      });
      for (const h of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
        const v = upstream.headers.get(h);
        if (v) responseHeaders.set(h, v);
      }
      if (req.method === 'HEAD' || !upstream.body) {
        await upstream.body?.cancel(); cleanup();
        return new Response(null, { status: upstream.status, headers: responseHeaders });
      }
      const reader = upstream.body.getReader(), release = cleanup;
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
      return new Response(body, { status: upstream.status, headers: responseHeaders });
    } catch {
      cleanup?.();
      try { await activeUpstream?.body?.cancel(); } catch { /* Already closed/locked. */ }
      return json(req.signal.aborted ? 499 : 503, { error: "Private viewing unavailable" });
    }
  };
}
