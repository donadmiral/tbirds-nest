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
  const { data, error } = await supabase.rpc("get_active_promos", { p_limit: limit });
  if (error) return [];
  return ((data ?? []) as (PromoRow & { author_id: string })[]).map((r) => ({
    ...r,
    viewer_liked: false, viewer_reposted: false, viewer_bookmarked: false,
    sort_key: 0,
  })) as PromoRow[];
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