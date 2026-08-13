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
  dual_front_url?: string | null;
};

export async function getCatchupFeed(limit = 30): Promise<CatchupUser[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_catchup_feed", { p_mode: "all", p_limit: limit });
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