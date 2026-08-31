import { createClient } from "@/lib/supabase/client";
import { checkUploadable } from "@/lib/media";

export type StudioRole = "owner" | "admin" | "editor" | "recruiter" | "support";
export type StudioMe = {
  is_business: boolean; bound: boolean; needs_code: boolean;
  member_id: string | null; role: StudioRole | null; display_name: string | null;
  business_name: string | null; username: string | null; avatar_url: string | null;
};
export type StudioHome = {
  todos: { unanswered: number; offers: number; applicants: number; ads_ending: number; reviews: number; scheduled_today: number; failed_posts: number };
  now: Metrics; prev: Metrics;
  payments: { currency: string; total: number; count: number }[];
  recent: { post_id: string; content: string | null; body: string | null; created_at: string; likes_count: number; comments_count: number; reposts_count: number; views_count: number }[];
  best_hours: { hour: number; score: number }[];
};
export type Metrics = { posts: number; likes: number; comments: number; reposts: number; views: number; followers: number; messages: number; ad_impressions: number; ad_clicks: number };
export type ScheduledPost = {
  id: string; status: "draft" | "scheduled" | "publishing" | "published" | "failed" | "cancelled";
  publish_at: string | null; content: string | null; body: string | null; category: string | null; community_id: string | null;
  media: { url: string; media_type: string; width?: number; height?: number }[];
  products: { title: string; subtitle?: string | null; price?: number | null; currency?: string; image_url?: string | null; listing_id?: string | null; link_url?: string | null; cta_label?: string }[];
  published_post_id: string | null; error: string | null; created_at: string; updated_at: string;
};
export type SavedReply = { id: string; shortcut: string; title: string; body: string };
export type AutoReplies = { welcome_enabled: boolean; welcome_text: string | null; away_enabled: boolean; away_text: string | null; faq: { q: string; a: string }[] };

// Desk order follows the design: the daily surfaces first, the deeper tools
// after, settings last. Every href here is a route that exists; nothing is
// listed that would land on a blank page.
export const ROOMS = [
  { key: "home", href: "/studio", label: "Overview", ready: true },
  { key: "content", href: "/studio/content", label: "Content", ready: true },
  { key: "insights", href: "/studio/insights", label: "Insights", ready: true },
  { key: "planner", href: "/studio/planner", label: "Planner", ready: true },
  { key: "inbox", href: "/studio/inbox", label: "Inbox", ready: true },
  { key: "recruiter", href: "/studio/recruiter", label: "Recruiter", ready: true },
  { key: "commerce", href: "/studio/commerce", label: "Commerce", ready: true },
  { key: "audience", href: "/studio/audience", label: "Audience", ready: true },
  { key: "ads", href: "/studio/ads", label: "Ads", ready: true },
  { key: "reviews", href: "/studio/reviews", label: "Reviews", ready: true },
  { key: "settings", href: "/studio/settings", label: "Settings", ready: true },
] as const;

export const ROLE_CAN: Record<string, StudioRole[]> = {
  publish: ["owner", "admin", "editor"],
  spend: ["owner", "admin"],
  team: ["owner"],
  recruit: ["owner", "admin", "recruiter"],
  inbox: ["owner", "admin", "editor", "support"],
};
export function can(role: StudioRole | null, action: keyof typeof ROLE_CAN) {
  return !!role && ROLE_CAN[action].includes(role);
}

const sb = () => createClient();

export async function studioMe(): Promise<StudioMe | null> {
  const { data, error } = await sb().rpc("studio_me");
  if (error) return null;
  return data as StudioMe;
}
export async function bindMember(code: string) {
  const { data, error } = await sb().rpc("studio_bind_member", { p_code: code });
  if (error) throw error;
  return data as { member_id: string; role: StudioRole; display_name: string };
}
export async function studioHome(): Promise<StudioHome | null> {
  const { data, error } = await sb().rpc("studio_home");
  if (error) return null;
  return data as StudioHome;
}
export async function listScheduled(status?: string) {
  const { data, error } = await sb().rpc("studio_list_posts", { p_status: status ?? null, p_limit: 100 });
  if (error) throw error;
  return (data as ScheduledPost[]) ?? [];
}
export async function savePost(input: { id?: string | null; content?: string | null; body?: string | null; category?: string | null; community?: string | null; media?: ScheduledPost["media"]; products?: ScheduledPost["products"]; publishAt?: string | null }) {
  const { data, error } = await sb().rpc("studio_save_post", {
    p_id: input.id ?? null, p_content: input.content ?? null, p_body: input.body ?? null, p_category: input.category ?? null,
    p_community: input.community ?? null, p_media: input.media ?? [], p_products: input.products ?? [], p_publish_at: input.publishAt ?? null,
  });
  if (error) throw error;
  return data as string;
}
export async function publishNow(id: string) {
  const { data, error } = await sb().rpc("studio_publish_now", { p_id: id });
  if (error) throw error;
  return data as string | null;
}
export async function cancelScheduled(id: string) {
  const { error } = await sb().rpc("studio_cancel_post", { p_id: id });
  if (error) throw error;
}
export async function deleteScheduled(id: string) {
  const { error } = await sb().rpc("studio_delete_post", { p_id: id });
  if (error) throw error;
}
export async function uploadStudioMedia(file: File): Promise<{ url: string; media_type: string }> {
  const s = sb();
  const { data } = await s.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error("Not signed in");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace("jpeg", "jpg");
  const path = uid + "/studio_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
  const bad = checkUploadable(file);
  if (bad) throw new Error(bad);
  const up = await s.storage.from("post-media").upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (up.error) throw up.error;
  return { url: s.storage.from("post-media").getPublicUrl(path).data.publicUrl, media_type: file.type.startsWith("video") ? "video" : "image" };
}
export async function myListings() {
  const s = sb();
  const { data } = await s.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return [];
  const r = await s.rpc("get_seller_listings", { p_seller_id: uid, p_cursor: null, p_limit: 50, p_include_sold: false });
  return (r.data as { id: string; title: string; price: number; currency: string; images: string[] }[]) ?? [];
}
export async function listReplies() {
  const { data, error } = await sb().rpc("studio_list_replies");
  if (error) throw error;
  return (data as SavedReply[]) ?? [];
}
export async function upsertReply(r: { id?: string | null; shortcut: string; title: string; body: string }) {
  const { error } = await sb().rpc("studio_upsert_reply", { p_id: r.id ?? null, p_shortcut: r.shortcut, p_title: r.title, p_body: r.body });
  if (error) throw error;
}
export async function deleteReply(id: string) {
  const { error } = await sb().rpc("studio_delete_reply", { p_id: id });
  if (error) throw error;
}
export async function getAutoReplies(): Promise<AutoReplies> {
  const { data } = await sb().rpc("studio_get_auto_replies");
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { welcome_enabled: !!row.welcome_enabled, welcome_text: row.welcome_text, away_enabled: !!row.away_enabled, away_text: row.away_text, faq: Array.isArray(row.faq) ? row.faq : [] }
    : { welcome_enabled: false, welcome_text: "", away_enabled: false, away_text: "", faq: [] };
}
export async function setAutoReplies(a: AutoReplies) {
  const { error } = await sb().rpc("studio_set_auto_replies", { p_welcome_enabled: a.welcome_enabled, p_welcome_text: a.welcome_text, p_away_enabled: a.away_enabled, p_away_text: a.away_text, p_faq: a.faq });
  if (error) throw error;
}
export function pct(now: number, prev: number) {
  if (prev === 0) return now === 0 ? 0 : 100;
  return Math.round(((now - prev) / prev) * 100);
}
