// Exchange authorized message IDs, never caller-supplied object paths, for
// short-lived private storage capabilities. This is access control, not E2EE.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL = 120;

function objectLocation(value: unknown, base: string): { bucket: string; path: string } | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.origin !== new URL(base).origin || url.username || url.password || (url.search && !/^\?t=\d+$/.test(url.search)) || url.hash) return null;
    const match = url.pathname.match(/^\/storage\/v1\/object\/public\/(chat-media|chat-files)\/([0-9a-f-]{36}\/[^?#]+)$/i);
    if (!match) return null;
    const path = decodeURIComponent(match[2]);
    if (!UUID.test(path.split('/')[0]) || path.includes('%') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) return null;
    return { bucket: match[1], path };
  } catch { return null; }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  try {
    const base = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!base || !anonKey || !serviceKey) return json(503, { error: 'media access unavailable' });
    const anon = createClient(base, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: auth, error: authError } = await anon.auth.getUser();
    if (authError || !auth?.user) return json(401, { error: 'unauthorized' });
    const body = await req.json().catch(() => null);
    if (!Array.isArray(body?.messageIds) || !body.messageIds.length || body.messageIds.length > 100
      || body.messageIds.some((id: unknown) => typeof id !== 'string' || !UUID.test(id))) return json(400, { error: 'valid messageIds required' });
    const ids = [...new Set(body.messageIds as string[])];
    const { data: manifest, error: manifestError } = await anon.rpc('chat_media_manifest', { p_message_ids: ids });
    if (manifestError) return json(503, { error: 'media access unavailable' });
    let remaining: number | undefined, expiresAt: string | undefined, mediaType: 'image' | 'video' | undefined;
    let ttl = TTL;
    const items: { id: string; url: string; thumbnail: boolean }[] = [];
    if (body.consume === true) {
      if (ids.length !== 1 || typeof body.requestId !== 'string' || !UUID.test(body.requestId)) return json(400, { error: 'A single attachment and requestId are required.' });
      const message = (manifest || []).find((row: any) => row.id === ids[0] && row.view_limit);
      const expected = message && objectLocation(message.media_url, base);
      if (!expected) return json(410, { error: 'This attachment is no longer available.' });
      // This explicit compatibility RPC exists only while the production app
      // uses the old view-count contract. It fails closed after session cutover.
      const { data: grant, error: grantError } = await anon.rpc('open_legacy_chat_media', { p_message_id: ids[0], p_request_id: body.requestId });
      if (grantError) return json(409, { error: 'This attachment needs the protected viewer.', code: 'PRIVATE_VIEW_UPDATE_REQUIRED' });
      if (!grant?.url) return json(410, { error: 'This attachment is no longer available.' });
      const granted = objectLocation(grant.url, base);
      const expires = Date.parse(grant.expiresAt);
      if (grant.requestId !== body.requestId || !granted || granted.bucket !== expected.bucket || granted.path !== expected.path
        || !['image', 'video'].includes(grant.mediaType) || !Number.isInteger(grant.remaining) || grant.remaining < 0 || grant.remaining > 1
        || !Number.isFinite(expires) || expires <= Date.now()) return json(410, { error: 'This viewing grant has ended.' });
      // Retrying a lost response never extends the original database grant.
      ttl = Math.min(TTL, Math.floor((expires - Date.now()) / 1000));
      if (ttl < 1) return json(410, { error: 'This viewing grant has ended.' });
      remaining = grant.remaining; expiresAt = new Date(Date.now() + ttl * 1000).toISOString(); mediaType = grant.mediaType;
      items.push({ id: ids[0], url: grant.url, thumbnail: false });
    } else {
      for (const message of manifest || []) {
        if (message.view_limit) continue;
        if (message.media_url) items.push({ id: message.id, url: message.media_url, thumbnail: false });
        if (message.thumbnail_url) items.push({ id: message.id, url: message.thumbnail_url, thumbnail: true });
      }
    }
    const svc = createClient(base, serviceKey);
    const urls: Record<string, string> = {}, thumbnails: Record<string, string> = {};
    for (const bucket of ['chat-media', 'chat-files']) {
      const batch = items.map(item => ({ ...item, location: objectLocation(item.url, base) })).filter(item => item.location?.bucket === bucket);
      if (!batch.length) continue;
      const { data: signed, error } = await svc.storage.from(bucket).createSignedUrls(batch.map(item => item.location!.path), ttl);
      if (error || !signed) return json(503, { error: 'media access unavailable' });
      signed.forEach((result: any, index: number) => {
        if (!result?.signedUrl || !batch[index]) return;
        const target = batch[index].thumbnail ? thumbnails : urls;
        target[batch[index].id] = result.signedUrl.startsWith('https://') ? result.signedUrl : `${base}/storage/v1${result.signedUrl}`;
      });
    }
    return json(200, { urls, thumbnails, expiresIn: ttl, ...(remaining !== undefined ? { remaining, expiresAt, mediaType, requestId: body.requestId } : {}) });
  } catch { return json(503, { error: 'media access unavailable' }); }
});
