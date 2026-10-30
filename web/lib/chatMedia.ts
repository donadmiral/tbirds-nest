// Private attachment grants are account-scoped and short-lived. Never fall back to a public locator.
import { createClient } from "@/lib/supabase/client";

import { mediaDeliveryUrl } from '../../shared/mediaDelivery';

const CHAT_URL = /\/storage\/v1\/object\/(?:public\/|sign\/)?(?:chat-media|chat-files)\//;
const CACHE_MS = 60 * 1000;

type Pair = { _private_media_url?: string | null; _private_thumbnail_url?: string | null; id: string; media_url?: string | null; thumbnail_url?: string | null; deleted_at?: string | null; view_limit?: number | null };
const cache = new Map<string, { url: string; exp: number }>();
type Client = ReturnType<typeof createClient>;
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
    if (watchedClient === client) setCacheUser(session?.user?.id ?? null, event === "SIGNED_OUT");
  });
  unsubscribeAuth = () => subscription.unsubscribe();
}

export function isChatMediaUrl(url?: string | null): boolean {
  return !!url && CHAT_URL.test(url);
}

export async function signChatMediaMap(pairs: Pair[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const media = pairs.map(row => ({ ...row, media_url: row._private_media_url || row.media_url, thumbnail_url: row._private_thumbnail_url || row.thumbnail_url })).filter((p) => p?.id && !p.deleted_at && !p.view_limit && (isChatMediaUrl(p.media_url) || isChatMediaUrl(p.thumbnail_url)));
  if (media.length === 0) return out;
  let isCurrent = () => true;
  try {
    const supabase = createClient();
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
      const key = JSON.stringify([userId, p.id, p.media_url, p.thumbnail_url]);
      const hit = cache.get(key);
      if (hit && hit.exp > now) { out[p.id] = hit.url; const thumb = cache.get(key + ':thumbnail'); if (thumb && thumb.exp > now) out[p.id + ':thumbnail'] = thumb.url; }
      else need.push({ id: p.id, key });
    }
    for (let i = 0; i < need.length; i += 100) {
      const batch = need.slice(i, i + 100);
      if (!isCurrent()) return {};
      const { data, error } = await supabase.functions.invoke("chat-media-sign", { body: { messageIds: batch.map((p) => p.id), delivery: 'no-store' } });
      if (!isCurrent()) return {};
      if (error || !data?.urls) continue;
      for (const p of batch) {
        const url = data.urls[p.id];
        if (typeof url !== "string" || !url) continue;
        if (cache.size >= 500) cache.delete(cache.keys().next().value!);
        cache.set(p.key, { url, exp: now + CACHE_MS });
        out[p.id] = url;
        const thumb = data.thumbnails?.[p.id];
        if (typeof thumb === 'string' && thumb) { cache.set(p.key + ':thumbnail', { url: thumb, exp: now + CACHE_MS }); out[p.id + ':thumbnail'] = thumb; }
      }
    }
  } catch { /* Missing grants remain inaccessible. */ }
  return isCurrent() ? out : {};
}

export async function signChatMedia<T extends Pair>(rows: T[]): Promise<T[]> {
  const privateRows = rows.map(row => ({ ...row,
    _private_media_url: row._private_media_url || (isChatMediaUrl(row.media_url) ? row.media_url : null),
    _private_thumbnail_url: row._private_thumbnail_url || (isChatMediaUrl(row.thumbnail_url) ? row.thumbnail_url : null),
  }));
  if (!privateRows.some(row => row._private_media_url || row._private_thumbnail_url)) return rows;
  const signed = await signChatMediaMap(privateRows);
  return privateRows.map(row => ({ ...row,
    ...(row._private_media_url ? { media_url: signed[row.id] || null } : {}),
    ...(row._private_thumbnail_url ? { thumbnail_url: signed[row.id + ':thumbnail'] || null } : {}),
  }));
}


/** Group photos use current membership proofs and noncached private delivery. */
export async function signGroupAvatars<T extends { group_avatar_url?: string | null }>(rows: T[]): Promise<T[]> {
  const result: T[] = rows.map(row => ({ ...row, ...(isChatMediaUrl(row.group_avatar_url) ? { group_avatar_url: null } : {}) }));
  const privateRows = rows.map((row, index) => ({ row, index })).filter(({ row }) => isChatMediaUrl(row.group_avatar_url));
  if (!privateRows.length) return rows;
  try {
    const supabase = createClient();
    watchAuth(supabase);
    const before = authVersion;
    const { data, error } = await supabase.auth.getSession();
    const userId = data.session?.user?.id ?? null;
    if (error || !userId || (authVersion !== before && cachedUserId !== userId)) return result;
    setCacheUser(userId);
    const version = authVersion;
    const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const paths = privateRows.flatMap(({ row, index }) => {
      try {
        const url = new URL(row.group_avatar_url!);
        const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/chat-media\/(.+)$/);
        if (url.origin !== base.origin || url.username || url.password || !match) return [];
        const path = decodeURIComponent(match[1]);
        if (path.length > 1024 || path.includes('%') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) return [];
        return [{ index, path }];
      } catch { return []; }
    });
    for (let i = 0; i < paths.length; i += 100) {
      if (authVersion !== version || cachedUserId !== userId) return rows.map(row => ({ ...row, ...(isChatMediaUrl(row.group_avatar_url) ? { group_avatar_url: null } : {}) }));
      const batch = paths.slice(i, i + 100);
      const signed = await supabase.rpc('issue_chat_object_delivery', { p_urls: batch.map(item => `${base.origin}/storage/v1/object/public/chat-media/${item.path}`) });
      if (authVersion !== version || cachedUserId !== userId) return rows.map(row => ({ ...row, ...(isChatMediaUrl(row.group_avatar_url) ? { group_avatar_url: null } : {}) }));
      if (signed.error) continue;
      for (const item of signed.data || []) {
        const reference = batch.find(value => value.path === item.object_path);
        if (reference && item.bucket_id === 'chat-media' && /^[0-9a-f]{64}$/.test(item.token) && Date.parse(item.expires_at) > Date.now()) {
          result[reference.index].group_avatar_url = mediaDeliveryUrl(base.origin, item.bucket_id, item.object_path, item.token);
        }
      }
    }
  } catch { /* The safe result hides ungranted photos. */ }
  return result;
}
