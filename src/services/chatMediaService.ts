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
type Client = typeof supabase;
let watchedClient: Client | undefined;
let unsubscribeAuth: (() => void) | undefined;
let cachedUserId: string | null = null;
let authVersion = 0;

function setCacheUser(userId: string | null, signedOut = false) {
  if (userId !== cachedUserId || signedOut) {
    cache.clear();
    cachedUserId = userId;
    authVersion += 1;
  }
}

function watchAuth(client: Client) {
  if (watchedClient === client) return;
  unsubscribeAuth?.();
  watchedClient = client;
  setCacheUser(null, true);
  // One synchronous listener for this shared client, including while no request
  // is running. Do not call Auth methods inside its callback (Auth holds a lock).
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    if (watchedClient === client) setCacheUser(session?.user?.id ?? null, event === 'SIGNED_OUT');
  });
  unsubscribeAuth = () => subscription.unsubscribe();
}

export function isChatMediaUrl(url?: string | null): boolean {
  return !!url && CHAT_URL.test(url);
}

export async function signChatMediaMap(pairs: Pair[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const media = pairs.filter((p) => p?.id && isChatMediaUrl(p.media_url));
  if (media.length === 0) return out;
  let isCurrent = () => true;
  try {
    watchAuth(supabase);
    const readingVersion = authVersion;
    // Session identity only scopes this local cache. The edge function still
    // validates the caller and authorizes every newly signed resource.
    const { data, error } = await supabase.auth.getSession();
    if (error) return {};
    const userId = data.session?.user?.id ?? null;
    if (watchedClient !== supabase || (authVersion !== readingVersion && cachedUserId !== userId)) return {};
    setCacheUser(userId);
    if (!userId) return {};
    const version = authVersion;
    isCurrent = () => watchedClient === supabase && authVersion === version && cachedUserId === userId;

    const need: { id: string; key: string }[] = [];
    const now = Date.now();
    for (const p of media) {
      const key = JSON.stringify([userId, p.id, p.media_url]);
      const hit = cache.get(key);
      if (hit && hit.exp > now) out[p.id] = hit.url;
      else need.push({ id: p.id, key });
    }
    for (let i = 0; i < need.length; i += 100) {
      const batch = need.slice(i, i + 100);
      if (!isCurrent()) return {};
      const { data, error } = await supabase.functions.invoke('chat-media-sign', { body: { messageIds: batch.map((p) => p.id) } });
      if (!isCurrent()) return {};
      if (error || !data?.urls) continue;
      for (const p of batch) {
        const url = data.urls[p.id];
        if (typeof url !== 'string' || !url) continue;
        cache.set(p.key, { url, exp: now + CACHE_MS });
        out[p.id] = url;
      }
    }
  } catch (e) {
    console.log('[chatMediaSign]', (e as any)?.message || e);
  }
  return isCurrent() ? out : {};
}

export async function signChatMedia<T extends Pair>(rows: T[]): Promise<T[]> {
  const signed = await signChatMediaMap(rows);
  if (Object.keys(signed).length === 0) return rows;
  return rows.map((r) => (signed[r.id] ? { ...r, media_url: signed[r.id] } : r));
}
