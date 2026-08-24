// Mirrors src/services/storiesService.ts shapes and RPCs used by the viewer.
import { createClient } from "@/lib/supabase/client";

export type CatchupUser = {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  story_count: number;
  unseen_count: number;
  latest_story_at: string;
  latest_story_id: string;
  has_unseen: boolean;
};

export type StoryMediaTransform = {
  scale: number;
  translateNX: number;
  translateNY: number;
  fit?: "cover" | "contain";
};

export type StoryRow = {
  id: string;
  user_id: string;
  media_url: string | null;
  media_type: string;
  thumbnail_url: string | null;
  duration_sec: number | null;
  caption: string | null;
  views_count: number;
  expires_at: string;
  created_at: string;
  is_viewed?: boolean;
  text_background?: { colors?: string[] } | string | null;
  media_transform?: StoryMediaTransform | null;
  dual_front_url?: string | null;
  audio_url?: string | null;
  audio_title?: string | null;
  audio_source?: string | null;
  audio_duration_sec?: number | null;
  filter_id?: string | null;
};

// Same overlay definitions as the phone's StoryFilters.tsx - keep in sync.
export type StoryFilterDef = { id: string; label: string; layers: { color: string; opacity: number }[] };
export const STORY_FILTERS: StoryFilterDef[] = [
  { id: "warm", label: "Warm", layers: [{ color: "#FF9A3C", opacity: 0.14 }, { color: "#3B2000", opacity: 0.08 }] },
  { id: "golden", label: "Golden", layers: [{ color: "#FFC94D", opacity: 0.18 }] },
  { id: "cool", label: "Cool", layers: [{ color: "#3C7DFF", opacity: 0.12 }, { color: "#001A3B", opacity: 0.08 }] },
  { id: "rose", label: "Rose", layers: [{ color: "#FF5E8A", opacity: 0.12 }] },
  { id: "fade", label: "Fade", layers: [{ color: "#FFFFFF", opacity: 0.16 }, { color: "#000000", opacity: 0.05 }] },
  { id: "dusk", label: "Dusk", layers: [{ color: "#5B3B8F", opacity: 0.14 }, { color: "#000000", opacity: 0.1 }] },
];

export async function getCatchupFeed(limit = 30, mode: string = "all"): Promise<CatchupUser[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_catchup_feed", { p_mode: mode, p_limit: limit });
  if (error) return [];
  return (data ?? []) as CatchupUser[];
}

export async function getUserStories(userId: string): Promise<StoryRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_user_stories", { p_user_id: userId });
  if (error) return [];
  return (data ?? []) as StoryRow[];
}

export async function markStoryViewed(storyId: string): Promise<void> {
  const supabase = createClient();
  await supabase.rpc("mark_story_viewed", { p_story_id: storyId });
}

// Shared ring source: one cached catchup call powers every ringed avatar.
let ringCache: { users: CatchupUser[]; at: number } | null = null;

export async function getRingUsers(force = false): Promise<CatchupUser[]> {
  if (!force && ringCache && Date.now() - ringCache.at < 60000) return ringCache.users;
  const users = await getCatchupFeed(50);
  ringCache = { users, at: Date.now() };
  return users;
}

export function invalidateRings(): void {
  ringCache = null;
}