import { readBoundedJson } from '../live-clip-worker/body.ts';
type Rpc = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
type Dependencies = { service: Rpc; secret: string };
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' };
async function authorized(supplied: string, expected: string) {
  if (expected.length < 32 || expected.length > 256 || supplied.length < 32 || supplied.length > 256) return false;
  const hash = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a, b] = await Promise.all([hash(supplied), hash(expected)]);
  const left = new Uint8Array(a), right = new Uint8Array(b); let different = 0;
  for (let i = 0; i < left.length; i++) different |= left[i] ^ right[i];
  return different === 0;
}
export function createClipQueueHandler(deps: Dependencies) {
  return async (request: Request) => {
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers });
    if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
    try {
      const bearer = /^Bearer ([A-Za-z0-9_+=./-]{32,256})$/.exec(request.headers.get('Authorization') || '');
      if (!bearer || !await authorized(bearer[1], deps.secret)) return json(401, { error: 'AUTH_REQUIRED' });
      let body: unknown;
      try { body = await readBoundedJson(request, 128, request.signal); }
      catch { return json(400, { error: 'INVALID_REQUEST' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).length !== 1 || (body as Record<string, unknown>).action !== 'peek') {
        return json(400, { error: 'INVALID_REQUEST' });
      }
      const result = await deps.service.rpc('live_clip_queue_peek');
      const data = result.data as { enabled?: unknown; due?: unknown; active?: unknown } | null;
      if (result.error || !data || typeof data.enabled !== 'boolean' || typeof data.due !== 'boolean'
          || !Number.isInteger(data.active) || Number(data.active) < 0 || Number(data.active) > 2) throw Error('UNAVAILABLE');
      return json(200, { enabled: data.enabled, due: data.due, active: data.active });
    } catch { return json(503, { error: 'QUEUE_UNAVAILABLE' }); }
  };
}
