// Mirrors the get_feed RPC return table (migration 0095).
export type FeedRow = {
  post_id: string;
  author_id: string;
  content: string | null;
  body: string | null;
  media_url: string | null;
  media: {
    id: string;
    url: string;
    media_type: string | null;
    width: number | null;
    height: number | null;
    sort_order: number | null;
  }[];
  products: {
    id: string;
    title: string | null;
    subtitle: string | null;
    price: number | null;
    currency: string | null;
    image_url: string | null;
    listing_id: string | null;
    link_url: string | null;
    cta_label: string | null;
    sort_order: number | null;
  }[];
  link: {
    url: string;
    title: string | null;
    description: string | null;
    image_url: string | null;
    domain: string | null;
  } | null;
  channel: string | null;
  article_title: string | null;
  read_minutes: number | null;
  quoted_post_id: string | null;
  thread_parent_id: string | null;
  created_at: string;
  likes_count: number;
  comments_count: number;
  reposts_count: number;
  bookmarks_count: number;
  views_count: number;
  is_trending: boolean;
  author_name: string | null;
  author_username: string | null;
  author_avatar: string | null;
  author_verified: boolean;
  author_kind: string | null;
  author_verified_tier: string | null;
  viewer_liked: boolean;
  viewer_bookmarked: boolean;
  viewer_reposted: boolean;
  viewer_follows: boolean;
  sort_key: number;
  innovation_field: string | null;
  innovation_stage: string | null;
};

export function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}