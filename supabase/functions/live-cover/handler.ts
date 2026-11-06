type Result<T = unknown> = { data: T | null; error: { message?: string } | null };
type Rpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<Result> };
type Caller = Rpc & { auth: { getUser(): PromiseLike<{ data: { user: { id: string; is_anonymous?: boolean } | null }; error: unknown }> } };
type Storage = {
  createSignedUploadUrl(path: string, options: { upsert: boolean }): PromiseLike<Result<{ path: string; token: string; signedUrl: string }>>;
  createSignedUrls(paths: string[], ttl: number): PromiseLike<Result<Array<{ path: string | null; signedUrl: string | null; error: string | null }>>>;
  download(path: string): PromiseLike<Result<Blob>>;
};
export type LiveCoverDependencies = {
  caller(request: Request): Caller;
  service: Rpc;
  storage: Storage;
  storageOrigin: string;
  now?: () => number;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 2 * 1024 * 1024;
const TTL = 120;
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,apikey,x-client-info,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

function pathFor(value: unknown, sessionId: string, actorId?: string): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  return parts.length === 3 && uuid(parts[0]) && parts[1] === sessionId && (!actorId || parts[0] === actorId)
    && parts[2].endsWith('.jpg') && uuid(parts[2].slice(0, -4));
}
async function readBody(request: Request) {
  if (Number(request.headers.get('content-length')) > 8192) throw new Error('REQUEST_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INVALID_REQUEST');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) { await reader.cancel(); throw new Error('REQUEST_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!object(body)) throw new Error('INVALID_REQUEST');
  return body;
}
async function rpc<T>(client: Rpc, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(result.error.message || 'COVER_UNAVAILABLE');
  if (!object(result.data)) throw new Error('INVALID_SERVICE_RESPONSE');
  return result.data as T;
}

/** Inspect framing and dimensions without allocating a decoded image. */
export function inspectJpeg(bytes: Uint8Array) {
  if (bytes.length < 20 || bytes.length > MAX_BYTES || bytes[0] !== 255 || bytes[1] !== 216
    || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error('INVALID_JPEG');
  let position = 2;
  for (let count = 0; count < 512 && position + 4 <= bytes.length; count++) {
    if (bytes[position++] !== 255) throw new Error('INVALID_JPEG');
    while (bytes[position] === 255) position++;
    const marker = bytes[position++];
    if (marker === 218 || marker === 217 || marker === 0) break;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    const length = bytes[position] * 256 + bytes[position + 1];
    if (length < 2 || position + length > bytes.length) throw new Error('INVALID_JPEG');
    if ([192, 193, 194].includes(marker)) {
      if (length < 11 || bytes[position + 2] !== 8) throw new Error('INVALID_JPEG');
      const height = bytes[position + 3] * 256 + bytes[position + 4];
      const width = bytes[position + 5] * 256 + bytes[position + 6];
      const components = bytes[position + 7];
      if (length !== 8 + 3 * components || ![1, 3].includes(components) || width < 1 || height < 1
        || width > 4096 || height > 4096 || width * height > 12000000) throw new Error('INVALID_JPEG');
      return { width, height };
    }
    position += length;
  }
  throw new Error('INVALID_JPEG');
}

export function createLiveCoverHandler(deps: LiveCoverDependencies) {
  const storageOrigin = new URL(deps.storageOrigin).origin;
  function signedUrl(value: unknown, path: string, upload: boolean) {
    if (typeof value !== 'string') throw new Error('INVALID_SERVICE_RESPONSE');
    const parsed = new URL(value);
    const prefix = `/storage/v1/object/${upload ? 'upload/sign' : 'sign'}/live-covers/`;
    if (parsed.origin !== storageOrigin || parsed.username || parsed.password || parsed.hash
      || decodeURIComponent(parsed.pathname) !== prefix + path || !parsed.searchParams.get('token')) throw new Error('INVALID_SERVICE_RESPONSE');
    return parsed.toString();
  }
  async function readCovers(caller: Caller, ids: string[]) {
    const authorized = await rpc<{ items: Array<{ session_id: string; object_path: string }> }>(caller, 'live_cover_paths', { p_session_ids: ids });
    if (!Array.isArray(authorized.items) || authorized.items.length > ids.length) throw new Error('INVALID_SERVICE_RESPONSE');
    const paths = new Map<string, string>();
    for (const item of authorized.items) {
      if (!ids.includes(item.session_id) || !pathFor(item.object_path, item.session_id)) throw new Error('INVALID_SERVICE_RESPONSE');
      paths.set(item.object_path, item.session_id);
    }
    if (!paths.size) return { items: [] };
    const issuedAt = deps.now?.() ?? Date.now();
    const { data, error } = await deps.storage.createSignedUrls([...paths.keys()], TTL);
    if (error || !data || data.length > paths.size) throw new Error('COVER_UNAVAILABLE');
    // Recheck after storage signing. Removing an invitation while signing must
    // never return a freshly usable URL to that viewer.
    const fresh = await rpc<{ items: Array<{ session_id: string; object_path: string }> }>(caller, 'live_cover_paths', { p_session_ids: ids });
    if (!Array.isArray(fresh.items)) throw new Error('INVALID_SERVICE_RESPONSE');
    const allowed = new Set(fresh.items.map(item => `${item.session_id}/${item.object_path}`));
    const expires_at = new Date(issuedAt + TTL * 1000).toISOString();
    return { items: data.flatMap(item => {
      const session_id = item.path && paths.get(item.path);
      if (item.error || !session_id || !item.path || !allowed.has(`${session_id}/${item.path}`)) return [];
      return [{ session_id, thumbnail_url: signedUrl(item.signedUrl, item.path, false), expires_at }];
    }) };
  }
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
    try {
      const body = await readBody(request);
      if (!['authorize', 'finalize', 'read'].includes(String(body.action))) return json(400, { error: 'INVALID_REQUEST' });
      const caller = deps.caller(request);
      const { data, error } = await caller.auth.getUser();
      if (error || !data.user || data.user.is_anonymous || !uuid(data.user.id)) return json(401, { error: 'AUTH_REQUIRED' });
      if (body.action === 'read') {
        if (!Array.isArray(body.sessionIds) || body.sessionIds.length < 1 || body.sessionIds.length > 24 || !body.sessionIds.every(uuid)) return json(400, { error: 'INVALID_REQUEST' });
        return json(200, await readCovers(caller, [...new Set(body.sessionIds.map(id => id.toLowerCase()))]));
      }
      if (!uuid(body.sessionId)) return json(400, { error: 'INVALID_REQUEST' });
      const sessionId = body.sessionId.toLowerCase();
      if (body.action === 'authorize') {
        if (body.requestId !== undefined && !uuid(body.requestId)) return json(400, { error: 'INVALID_REQUEST' });
        const grant = await rpc<{ bucket: string; object_path: string; session_id: string }>(caller, 'live_cover_upload', {
          p_session_id: sessionId, p_action: 'authorize', p_object_path: null, p_request_id: body.requestId ?? crypto.randomUUID(),
        });
        if (grant.bucket !== 'live-covers' || grant.session_id !== sessionId || !pathFor(grant.object_path, sessionId, data.user.id)) throw new Error('INVALID_SERVICE_RESPONSE');
        const signed = await deps.storage.createSignedUploadUrl(grant.object_path, { upsert: false });
        if (signed.error || !signed.data || signed.data.path !== grant.object_path || !signed.data.token) throw new Error('COVER_UNAVAILABLE');
        await rpc(caller, 'live_cover_upload', { p_session_id: sessionId, p_action: 'inspect', p_object_path: grant.object_path });
        return json(200, { ...grant, token: signed.data.token, signed_url: signedUrl(signed.data.signedUrl, grant.object_path, true) });
      }
      if (!pathFor(body.objectPath, sessionId, data.user.id)) return json(400, { error: 'INVALID_REQUEST' });
      // The caller cannot invoke finalization directly. The service RPC is
      // reachable only after the current owner and pending upload are checked.
      await rpc(caller, 'live_cover_upload', { p_session_id: sessionId, p_action: 'inspect', p_object_path: body.objectPath });
      const download = await deps.storage.download(body.objectPath);
      if (download.error || !download.data) throw new Error('COVER_UNAVAILABLE');
      if (download.data.type.split(';')[0].toLowerCase() !== 'image/jpeg' || download.data.size > MAX_BYTES) throw new Error('INVALID_JPEG');
      const dimensions = inspectJpeg(new Uint8Array(await download.data.arrayBuffer()));
      await rpc(caller, 'live_cover_upload', { p_session_id: sessionId, p_action: 'inspect', p_object_path: body.objectPath });
      // getUser above verified the exact bearer token before its session claim
      // is used. The service RPC checks auth.sessions and publishing rights again.
      const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      let claims: unknown;
      try { claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { throw new Error('AUTH_REQUIRED'); }
      if (!object(claims) || claims.sub !== data.user.id || !uuid(claims.session_id)) throw new Error('AUTH_REQUIRED');
      await rpc(deps.service, 'live_cover_finalize', {
        p_actor_id: data.user.id, p_auth_session_id: claims.session_id, p_session_id: sessionId,
        p_object_path: body.objectPath, p_width: dimensions.width, p_height: dimensions.height,
      });
      const visible = await readCovers(caller, [sessionId]);
      const cover = visible.items.find(item => item.session_id === sessionId);
      if (!cover) throw new Error('COVER_UNAVAILABLE');
      return json(200, { ...cover, object_path: body.objectPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/AUTH_REQUIRED|ACTIVE_SESSION|JWT/.test(message)) return json(401, { error: 'AUTH_REQUIRED' });
      if (/ACCESS_DENIED|ADMIN_ACCESS|LIVE_NOT_AVAILABLE|UPLOAD_NOT_FOUND/.test(message)) return json(403, { error: 'COVER_NOT_AVAILABLE' });
      if (/TOO_LARGE/.test(message)) return json(413, { error: 'REQUEST_TOO_LARGE' });
      if (/RATE_LIMIT/.test(message)) return json(429, { error: 'RATE_LIMIT' });
      if (/INVALID_|COVER_SIZE/.test(message) || error instanceof SyntaxError) return json(400, { error: 'INVALID_COVER' });
      return json(503, { error: 'COVER_UNAVAILABLE' });
    }
  };
}
