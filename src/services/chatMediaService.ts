// chatMediaService: swap stored chat-media / chat-files URLs for short-lived
// signed URLs via the chat-media-sign edge function. messages.media_url keeps
// the public-form URL as a canonical locator; the buckets themselves go
// private. Fails open: on any error the original URL is returned, so nothing
// breaks while the buckets are still public.
import { supabase } from './supabase';

const CHAT_URL = /\/storage\/v1\/object\/(?:public\/|sign\/)?(?:chat-media|chat-files)\//;
const CACHE_MS = 20 * 60 * 60 * 1000; // resign well inside the 24h server TTL

type Pair = { id: string; media_url?: string | null };
const cache = new Map<string, { url: string; exp: number }>();

export function isChatMediaUrl(url?: string | null): boolean {
  return !!url && CHAT_URL.test(url);
}

export async function signChatMediaMap(pairs: Pair[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const need: string[] = [];
  const now = Date.now();
  for (const p of pairs) {
    if (!p?.id || !isChatMediaUrl(p.media_url)) continue;
    const hit = cache.get(p.id);
    if (hit && hit.exp > now) out[p.id] = hit.url;
    else need.push(p.id);
  }
  if (need.length === 0) return out;
  try {
    for (let i = 0; i < need.length; i += 100) {
      const batch = need.slice(i, i + 100);
      const { data, error } = await supabase.functions.invoke('chat-media-sign', { body: { messageIds: batch } });
      if (error || !data?.urls) continue;
      for (const [id, url] of Object.entries(data.urls as Record<string, string>)) {
        cache.set(id, { url, exp: now + CACHE_MS });
        out[id] = url;
      }
    }
  } catch (e) {
    console.log('[chatMediaSign]', (e as any)?.message || e);
  }
  return out;
}

export async function signChatMedia<T extends Pair>(rows: T[]): Promise<T[]> {
  const signed = await signChatMediaMap(rows);
  if (Object.keys(signed).length === 0) return rows;
  return rows.map((r) => (signed[r.id] ? { ...r, media_url: signed[r.id] } : r));
}