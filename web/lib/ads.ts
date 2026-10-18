// The simple ads tier on the existing 0041 rails: promoted_posts,
// ad_events via record_ad_event (deduped per user and kind), get_active_promos.
import { createClient } from "@/lib/supabase/client";
import type { FeedRow } from "@/lib/feed";

export type Promo = {
  id: string;
  post_id: string;
  advertiser_id: string;
  label: string;
  status: "active" | "paused" | "ended";
  starts_at: string;
  ends_at: string | null;
  total_cap: number | null;
  impressions_count: number;
  clicks_count: number;
  created_at: string;
};

export type PromoRow = FeedRow & { promo_id: string; promo_label: string };

export function promoDeliveryStatus(promo: Promo, at: number): string {
  if (promo.status === "ended") return "Ended";
  if (promo.ends_at && new Date(promo.ends_at).getTime() < at) return "Expired";
  if (promo.total_cap !== null && promo.impressions_count >= promo.total_cap) return "Limit reached";
  if (promo.status === "paused") return "Paused";
  if (new Date(promo.starts_at).getTime() > at) return "Scheduled";
  return "Active";
}

export async function getActivePromos(limit = 3): Promise<PromoRow[]> {
  const supabase = createClient();
  try {
    const [{ data, error }, { data: session, error: sessionError }] = await Promise.all([
      supabase.rpc("get_active_promos", { p_limit: limit }),
      supabase.auth.getSession(),
    ]);
    if (error || sessionError) return [];
    const rows = (data ?? []) as PromoRow[];
    if (!rows.length) return [];
    const viewer = session.session?.user.id;
    const ids = [...new Set(rows.map((r) => r.post_id))];
    const authors = [...new Set(rows.map((r) => r.author_id))];
    const [likes, reposts, bookmarks, follows] = viewer ? await Promise.all([
      supabase.from("post_likes").select("post_id").eq("user_id", viewer).in("post_id", ids),
      supabase.from("post_reposts").select("post_id").eq("user_id", viewer).in("post_id", ids),
      supabase.from("post_bookmarks").select("post_id").eq("user_id", viewer).in("post_id", ids),
      supabase.from("follows").select("following_id").eq("follower_id", viewer).in("following_id", authors),
    ]) : [];
    // Don't render invented viewer state when a relationship read failed.
    if ([likes, reposts, bookmarks, follows].some((result) => result?.error)) return [];
    const { data: current, error: currentError } = await supabase.auth.getSession();
    if (currentError || current.session?.user.id !== viewer) return [];
    const liked = new Set((likes?.data ?? []).map((r) => r.post_id));
    const reposted = new Set((reposts?.data ?? []).map((r) => r.post_id));
    const saved = new Set((bookmarks?.data ?? []).map((r) => r.post_id));
    const followed = new Set((follows?.data ?? []).map((r) => r.following_id));
    return rows.map((r) => ({
      ...r,
      viewer_liked: liked.has(r.post_id),
      viewer_reposted: reposted.has(r.post_id),
      viewer_bookmarked: saved.has(r.post_id),
      viewer_follows: followed.has(r.author_id),
      sort_key: 0,
    }));
  } catch {
    return [];
  }
}

// Bound this per-account cache. A failed attempt must remain retryable, and a
// second signed-in account must not inherit the first account's deduplication.
const seen = new Set<string>();
const pending = new Set<string>();
export function recordAdEvent(promoId: string, kind: "impression" | "click"): void {
  const supabase = createClient();
  void (async () => {
    let key: string | null = null;
    let ownsPending = false;
    try {
      const { data, error } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (error || !uid) return;
      key = uid + ":" + promoId + ":" + kind;
      if (seen.has(key) || pending.has(key)) return;
      pending.add(key);
      ownsPending = true;
      const { error: writeError } = await supabase.rpc("record_ad_event", { p_promo_id: promoId, p_kind: kind });
      if (!writeError) {
        seen.add(key);
        if (seen.size > 2048) seen.delete(seen.values().next().value!);
      }
    } catch { /* Analytics must never interrupt the post interaction. */ }
    finally { if (key && ownsPending) pending.delete(key); }
  })();
}

async function requireAdvertiser(supabase: ReturnType<typeof createClient>, expected?: string): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (error || !uid || (expected && uid !== expected)) throw new Error("Your account changed. Refresh Ads to continue.");
  return uid;
}

export async function myPromos(expectedAdvertiser?: string): Promise<Promo[]> {
  const supabase = createClient();
  const uid = await requireAdvertiser(supabase, expectedAdvertiser);
  const { data, count, error } = await supabase
    .from("promoted_posts")
    .select("*", { count: "exact" })
    .eq("advertiser_id", uid)
    .order("created_at", { ascending: false })
    .order("id");
  if (error) throw error;
  if (count === null || count !== (data ?? []).length) throw new Error("The full promotions list could not be loaded.");
  await requireAdvertiser(supabase, uid);
  return (data ?? []) as Promo[];
}

export type PromoDay = { day: string; impressions: number; clicks: number };

export async function myPromoPerformance(expectedAdvertiser: string): Promise<PromoDay[]> {
  const supabase = createClient();
  const uid = await requireAdvertiser(supabase, expectedAdvertiser);
  const until = new Date();
  const since = new Date(until);
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 29);
  const byDay = new Map<string, PromoDay>();
  for (let i = 0; i < 30; i++) {
    const date = new Date(since.getTime() + i * 86400000);
    const day = date.toISOString().slice(0, 10);
    byDay.set(day, { day, impressions: 0, clicks: 0 });
  }
  // Do not silently graph the Data API's first page as the whole month. The
  // bounded fallback is for existing deployments; high volume needs a rollup.
  const pageSize = 500;
  const maxEvents = 10000;
  const ids = new Set<string>();
  let total: number | null = null;
  for (let offset = 0; offset < maxEvents; offset += pageSize) {
    const { data, error, count } = await supabase.from("ad_events")
      .select("id, kind, created_at, promoted_posts!inner(advertiser_id)", { count: "exact" })
      .eq("promoted_posts.advertiser_id", uid)
      .gte("created_at", since.toISOString()).lte("created_at", until.toISOString())
      .order("created_at").order("id").range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (count === null || count > maxEvents) throw new Error("The detailed chart is unavailable for this volume. Lifetime totals are still shown.");
    if (total !== null && total !== count) throw new Error("Performance changed while loading. Refresh the chart.");
    total = count;
    for (const event of data ?? []) {
      if (ids.has(event.id)) continue;
      ids.add(event.id);
      const row = byDay.get(event.created_at.slice(0, 10));
      if (!row) continue;
      if (event.kind === "click") row.clicks++;
      else if (event.kind === "impression") row.impressions++;
    }
    if (ids.size === total) {
      await requireAdvertiser(supabase, uid);
      return Array.from(byDay.values());
    }
    if (!data?.length || data.length < pageSize) break;
  }
  throw new Error("The full performance chart could not be loaded. Refresh the chart.");
}

export async function createPromo(postId: string, opts: { label?: string; endsAt?: string | null; totalCap?: number | null }): Promise<string | null> {
  const supabase = createClient();
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) return null;
  const { data, error } = await supabase.from("promoted_posts").insert({
    post_id: postId,
    advertiser_id: uid,
    label: opts.label?.trim() || "Sponsored",
    ends_at: opts.endsAt ?? null,
    total_cap: opts.totalCap ?? null,
  }).select("id").single();
  if (error) return null;
  return data?.id ?? null;
}

export async function setPromoStatus(id: string, status: Promo["status"], advertiser: string, previous: Promo["status"]): Promise<boolean> {
  const supabase = createClient();
  const uid = await requireAdvertiser(supabase, advertiser);
  const { data, error } = await supabase.from("promoted_posts").update({ status })
    .eq("id", id).eq("advertiser_id", uid).eq("status", previous)
    .select("id, advertiser_id, status").maybeSingle();
  if (error) throw error;
  await requireAdvertiser(supabase, uid);
  return data?.id === id && data?.advertiser_id === uid && data?.status === status;
}
