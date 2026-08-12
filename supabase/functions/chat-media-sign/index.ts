// chat-media-sign: exchange message ids for short-lived signed URLs to
// chat-media / chat-files objects. Caller must belong to each message's
// conversation (conversation_members row, or user_1/user_2 for DMs).
// The buckets go private; this function is the only read door.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const CHAT_URL = /\/storage\/v1\/object\/(?:public\/|sign\/)?(chat-media|chat-files)\/([^?]+)/;
const TTL = 86400;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: authErr } = await anon.auth.getUser();
    if (authErr || !userData?.user) return json(401, { error: 'unauthorized' });
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.messageIds)
      ? body.messageIds.filter((x: unknown) => typeof x === 'string').slice(0, 100)
      : [];
    if (ids.length === 0) return json(400, { error: 'no messageIds' });

    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: msgs, error: msgErr } = await svc.from('messages')
      .select('id, conversation_id, media_url').in('id', ids);
    if (msgErr) return json(500, { error: msgErr.message });

    const convIds = Array.from(new Set((msgs ?? []).map((m) => m.conversation_id).filter(Boolean)));
    if (convIds.length === 0) return json(200, { urls: {} });

    const allowed = new Set<string>();
    const { data: memberRows } = await svc.from('conversation_members')
      .select('conversation_id').eq('user_id', uid).in('conversation_id', convIds);
    (memberRows ?? []).forEach((r) => allowed.add(r.conversation_id));
    const pending = convIds.filter((c) => !allowed.has(c));
    if (pending.length > 0) {
      const { data: convRows } = await svc.from('conversations')
        .select('id, user_1, user_2').in('id', pending);
      (convRows ?? []).forEach((c) => { if (c.user_1 === uid || c.user_2 === uid) allowed.add(c.id); });
    }

    const perBucket: Record<string, { path: string; msgId: string }[]> = {};
    for (const m of msgs ?? []) {
      if (!allowed.has(m.conversation_id)) continue;
      const match = typeof m.media_url === 'string' ? m.media_url.match(CHAT_URL) : null;
      if (!match) continue;
      (perBucket[match[1]] ??= []).push({ path: match[2], msgId: m.id });
    }

    const base = Deno.env.get('SUPABASE_URL')!;
    const urls: Record<string, string> = {};
    for (const [bucket, items] of Object.entries(perBucket)) {
      const { data: signed, error: signErr } = await svc.storage.from(bucket)
        .createSignedUrls(items.map((i) => i.path), TTL);
      if (signErr || !signed) continue;
      signed.forEach((s, i) => {
        if (!s?.signedUrl) return;
        const abs = s.signedUrl.startsWith('http') ? s.signedUrl : `${base}/storage/v1${s.signedUrl}`;
        urls[items[i].msgId] = abs;
      });
    }
    return json(200, { urls });
  } catch (e) {
    return json(500, { error: String((e as any)?.message || e) });
  }
});