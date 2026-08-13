// Mirrors src/services/marketService.ts shapes and ops.
import { createClient } from "@/lib/supabase/client";

export type Listing = {
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  price: number;
  currency: string;
  category: string;
  condition: string | null;
  location_city: string | null;
  images: string[];
  status: string;
  delivery_available?: boolean;
  delivery_fee?: number | null;
  delivery_note?: string | null;
  created_at: string;
  seller?: {
    id: string;
    full_name: string;
    username: string | null;
    avatar_url: string | null;
    is_verified: boolean;
  } | null;
};

export const MARKET_CATEGORIES = [
  "Electronics", "Vehicles", "Property", "Fashion", "Home",
  "Agriculture", "Services", "Jobs Gear", "Beauty", "Other",
] as const;

const SELLER_SELECT = "seller:profiles!marketplace_listings_seller_id_fkey(id, full_name, username, avatar_url, is_verified)";

export async function getMarketFeed(opts: { search?: string | null; category?: string | null; limit?: number }): Promise<Listing[]> {
  const supabase = createClient();
  const { data: ranked, error } = await supabase.rpc("get_market_feed", {
    p_category: opts.category || null,
    p_search: opts.search?.trim() || null,
    p_city: null,
    p_limit: opts.limit ?? 30,
    p_offset: 0,
  });
  if (error || !ranked?.length) return [];
  const ids = (ranked as { id: string }[]).map((r) => r.id);
  const { data: rows } = await supabase
    .from("marketplace_listings")
    .select("*, " + SELLER_SELECT)
    .in("id", ids);
  const map = new Map(((rows ?? []) as Listing[]).map((l) => [l.id, l]));
  return ids.map((id) => map.get(id)).filter(Boolean) as Listing[];
}

export async function getListing(id: string): Promise<Listing | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("marketplace_listings")
    .select("*, " + SELLER_SELECT)
    .eq("id", id)
    .maybeSingle();
  return (data as Listing) ?? null;
}

export async function getSavedListingIds(): Promise<Set<string>> {
  const supabase = createClient();
  const { data: me } = await supabase.auth.getUser();
  if (!me?.user) return new Set();
  const { data } = await supabase.from("saved_listings").select("listing_id").eq("user_id", me.user.id);
  return new Set(((data ?? []) as { listing_id: string }[]).map((r) => r.listing_id));
}

export async function toggleSaved(listingId: string, on: boolean): Promise<void> {
  const supabase = createClient();
  const { data: me } = await supabase.auth.getUser();
  if (!me?.user) return;
  if (on) await supabase.from("saved_listings").upsert({ user_id: me.user.id, listing_id: listingId });
  else await supabase.from("saved_listings").delete().eq("user_id", me.user.id).eq("listing_id", listingId);
}

export function priceLabel(l: Listing): string {
  return (l.currency === "USD" ? "$" : l.currency + " ") + Number(l.price).toLocaleString();
}
export const MARKET_CONDITIONS = ["New", "Like New", "Good", "Fair"] as const;

export type MarketFilters = {
  minPrice?: number | null;
  maxPrice?: number | null;
  condition?: string | null;
  city?: string | null;
  sort?: "recent" | "price_low" | "price_high";
};

export async function getListings(opts: MarketFilters & { search?: string | null; category?: string | null; limit?: number }): Promise<Listing[]> {
  const supabase = createClient();
  let q = supabase
    .from("marketplace_listings")
    .select("*, " + SELLER_SELECT)
    .eq("status", "available")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 30);
  if (opts.category) q = q.eq("category", opts.category);
  if (opts.search && opts.search.trim().length > 0) q = q.ilike("title", "%" + opts.search.trim() + "%");
  if (opts.minPrice != null) q = q.gte("price", opts.minPrice);
  if (opts.maxPrice != null) q = q.lte("price", opts.maxPrice);
  if (opts.condition) q = q.eq("condition", opts.condition);
  if (opts.city && opts.city.trim().length > 0) q = q.ilike("location_city", "%" + opts.city.trim() + "%");
  if (opts.sort === "price_low") q = q.order("price", { ascending: true });
  else if (opts.sort === "price_high") q = q.order("price", { ascending: false });
  const { data } = await q;
  return (data ?? []) as Listing[];
}

export async function myListings(userId: string): Promise<Listing[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("marketplace_listings")
    .select("*, " + SELLER_SELECT)
    .eq("seller_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Listing[];
}