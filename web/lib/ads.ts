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

const seen = new Set<string>();
export function recordAdEvent(promoId: string, kind: "impression" | "click"): void {
  const key = promoId + ":" + kind;
  if (seen.has(key)) return;
  seen.add(key);
  const supabase = createClient();
  supabase.rpc("record_ad_event", { p_promo_id: promoId, p_kind: kind }).then(() => {}, () => {});
}

export async function myPromos(): Promise<Promo[]> {
  const supabase = createClient();
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) return [];
  const { data } = await supabase
    .from("promoted_posts")
    .select("*")
    .eq("advertiser_id", uid)
    .order("created_at", { ascending: false });
  return (data ?? []) as Promo[];
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

export async function setPromoStatus(id: string, status: "active" | "paused" | "ended"): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase.from("promoted_posts").update({ status }).eq("id", id);
  return !error;
}
