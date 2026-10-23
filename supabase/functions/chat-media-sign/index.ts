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
    let remaining: number | undefined;
    const items: { id: string; url: string; thumbnail: boolean }[] = [];
    if (body.consume === true) {
      if (ids.length !== 1 || typeof body.requestId !== 'string' || !UUID.test(body.requestId)) return json(400, { error: 'one message and a requestId are required' });
      const message = manifest?.find((row: any) => row.id === ids[0] && row.view_limit);
      if (!message || !objectLocation(message.media_url, base)) return json(403, { error: 'attachment unavailable' });
      const { data: granted, error: grantError } = await anon.rpc('claim_chat_media_view', { p_message_id: ids[0], p_request_id: body.requestId });
      if (grantError) return json(503, { error: 'media access unavailable' });
      const grant = Array.isArray(granted) ? granted[0] : granted;
      if (!grant?.url || grant.url !== message.media_url) return json(410, { error: 'attachment no longer available' });
      remaining = grant.remaining;
      items.push({ id: message.id, url: grant.url, thumbnail: false });
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
      const { data: signed, error } = await svc.storage.from(bucket).createSignedUrls(batch.map(item => item.location!.path), TTL);
      if (error || !signed) return json(503, { error: 'media access unavailable' });
      signed.forEach((result: any, index: number) => {
        if (!result?.signedUrl || !batch[index]) return;
        const target = batch[index].thumbnail ? thumbnails : urls;
        target[batch[index].id] = result.signedUrl.startsWith('https://') ? result.signedUrl : `${base}/storage/v1${result.signedUrl}`;
      });
    }
    return json(200, { urls, thumbnails, expiresIn: TTL, ...(remaining !== undefined ? { remaining } : {}) });
  } catch { return json(503, { error: 'media access unavailable' }); }
});
