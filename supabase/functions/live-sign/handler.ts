type Config = { secret: string; signingKey: string; keyId: string; cdnOrigin: string };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store' } });
export async function signLivePath(path: string, expires: number, config: Config): Promise<string> {
  const parts = path.split('/');
  if (parts.length !== 4 || parts[0] !== 'live' || !uuid(parts[1]) || !uuid(parts[2]) || parts[3] !== 'master.m3u8'
    || !/^[a-z0-9_-]{1,16}$/.test(config.keyId) || config.signingKey.length < 32) throw Error('INVALID_SIGNING_INPUT');
  const prefix = `${config.keyId}.${expires}.${parts[1]}.${parts[2]}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`pc-live-v1.${prefix}`));
  const signature = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}.${signature}`;
}
async function same(left: string, right: string) {
  const hash = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const a = new Uint8Array(await hash(left)), b = new Uint8Array(await hash(right));
  let mismatch = 0; for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i]; return mismatch === 0;
}
export function createLiveSigner(config: Config, now: () => number = Date.now) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
    const bearer = request.headers.get('Authorization') || '';
    if (config.secret.length < 32 || bearer.length > 512 || !await same(bearer, `Bearer ${config.secret}`)) return json(401, { error: 'AUTH_REQUIRED' });
    try {
      if (Number(request.headers.get('content-length') || 0) > 4096) return json(413, { error: 'REQUEST_TOO_LARGE' });
      const reader = request.body?.getReader(); if (!reader) return json(400, { error: 'INVALID_REQUEST' });
      let size = 0; const chunks: Uint8Array[] = [];
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
        if (size > 4096) { await reader.cancel(); return json(413, { error: 'REQUEST_TOO_LARGE' }); } chunks.push(value); } }
      finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const body = JSON.parse(new TextDecoder().decode(bytes));
      const expires = Math.floor(Date.parse(body.expiresAt) / 1000), current = Math.floor(now() / 1000);
      if (!uuid(body.sessionId) || !uuid(body.userId) || typeof body.path !== 'string' || body.path.split('/')[1] !== body.sessionId
        || !Number.isSafeInteger(expires) || expires <= current || expires > current + 120) return json(400, { error: 'INVALID_REQUEST' });
      const origin = new URL(config.cdnOrigin);
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw Error('NOT_CONFIGURED');
      const token = await signLivePath(body.path, expires, config);
      return json(200, { url: `${origin.origin}/_live/${token}/${body.path}`, expiresAt: new Date(expires * 1000).toISOString() });
    } catch { return json(400, { error: 'INVALID_REQUEST' }); }
  };
}
