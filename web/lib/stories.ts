// Mirrors src/services/storiesService.ts shapes and RPCs used by the viewer.
import { createClient } from "@/lib/supabase/client";
import { hydrateStoryMedia } from "@/lib/contentMedia";

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

export type StoryTextSticker = {
  id: string;
  text: string;
  style: string;
  color: string;
  nx: number;
  ny: number;
  scale: number;
  rotation: number;
  bgEnabled?: boolean;
  kind?: string;
  // Creative engine sticker kinds (gif, photo, time, date, weather, entity, drawing)
  gifUrl?: string;
  photoUri?: string | null;
  photoUrl?: string | null;
  photoShape?: "square" | "rounded" | "circle" | "cell";
  /** Layout-cell width and height, normalized to the story canvas. */
  photoFw?: number;
  photoFh?: number;
  infoStyle?: number;
  weatherTemp?: number;
  weatherCode?: number;
  entityType?: "profile" | "listing" | "job" | "article";
  entityId?: string;
  entityTitle?: string;
  entitySub?: string;
  entityImage?: string | null;
  strokes?: { tool: string; color: string; width: number; points: { x: number; y: number }[] }[];
  startSec?: number;
  endSec?: number;
  anim?: string;
  fontSizeOverride?: number;
  opacity?: number;
  textAlign?: "left" | "center" | "right";
  url?: string;
  locationName?: string;
  locationDisplayName?: string;
  mentionUserId?: string;
  mentionUsername?: string;
  mentions?: { id: string; username: string }[];
  hashtag?: string;
  pillVariant?: number;
  storyId?: string;
  storyThumbUrl?: string | null;
  storyMediaUrl?: string | null;
  storyUsername?: string | null;
  storyAuthorName?: string | null;
  storyAuthorAvatar?: string | null;
  postId?: string;
  postAuthorName?: string;
  postText?: string;
  postAuthorAvatar?: string | null;
  postMediaUrl?: string | null;
  postMediaType?: string | null;
  postMediaCount?: number;
  postMediaWidth?: number | null;
  postMediaHeight?: number | null;
  postMediaPlayback?: import('../../shared/postVoiceEffects').PostPlaybackRecipe | null;
  postUsername?: string | null;
  postVerified?: boolean;
  postVerifiedTier?: string | null;
  postAuthorId?: string;
  postArticleTitle?: string | null;
  postCreatedAt?: string | null;
  postLikes?: number;
  postComments?: number;
  postReposts?: number;
  questionPrompt?: string;
  sliderEmoji?: string;
  sliderLabel?: string;
  quizQuestion?: string;
  quizOptions?: { id: string; label: string; isCorrect: boolean }[];
  addYoursPrompt?: string;
  addYoursOriginStoryId?: string | null;
  addYoursOriginStickerId?: string | null;
  countdownTitle?: string;
  countdownTarget?: string | null;
};

export type StoryPollOption = { id: string; label: string; position: number; vote_count: number };
export type StoryPoll = {
  poll_id: string;
  story_id: string;
  question: string;
  nx: number;
  ny: number;
  scale: number;
  options: StoryPollOption[];
  my_vote: string | null;
  total_votes: number;
};

export type StoryMediaTransform = {
  scale: number;
  translateNX: number;
  translateNY: number;
  fit?: "cover" | "contain";
  audioStartSec?: number;
  audioSoundId?: string | null;
  // Creative engine extras, written by the phone composer and replayed here
  trimStart?: number;
  trimEnd?: number;
  filterAmt?: number;
  adjust?: { bri?: number; con?: number; warm?: number; tint?: number; sat?: number; fade?: number; vig?: number; hi?: number; sh?: number; grain?: number } | null;
  mix?: { orig?: number; music?: number } | null;
  speed?: number;
  bg?: { kind: "blur" | "color" | "gradient" | "none"; a?: string; b?: string } | null;
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
  text_background?: { colors?: string[] } | { kind?: string; color?: string } | string | null;
  stickers_json?: StoryTextSticker[] | null;
  allow_replies?: boolean;
  allow_reactions?: boolean;
  allow_sharing?: boolean;
  audience?: string | null;
  media_transform?: StoryMediaTransform | null;
  dual_front_url?: string | null;
  audio_url?: string | null;
  audio_sound_id?: string | null;
  audio_title?: string | null;
  audio_source?: string | null;
  audio_duration_sec?: number | null;
  filter_id?: string | null;
};

export { STORY_FILTERS, STORY_FILTER_FAMILIES, filterCss, type StoryFilterFamily, type StoryFilterDef } from "../../shared/storyFilterAppearance";

export async function getCatchupFeed(limit = 30, mode: string = "all"): Promise<CatchupUser[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_catchup_feed", { p_mode: mode, p_limit: limit });
  if (error) return [];
  return (data ?? []) as CatchupUser[];
}

export async function getUserStories(userId: string): Promise<StoryRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_user_stories", { p_user_id: userId });
  if (error) throw new Error("Stories could not be loaded. Please try again.");
  return hydrateStoryMedia((data ?? []) as StoryRow[], supabase);
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

export const REACTION_EMOJIS = ["\u2764\uFE0F", "\uD83D\uDD25", "\uD83D\uDE02", "\uD83D\uDE2E", "\uD83D\uDE22", "\uD83D\uDC4F"];

export async function toggleStoryReaction(storyId: string, emoji: string): Promise<{ reacted: boolean; emoji: string } | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("toggle_story_reaction", { p_story_id: storyId, p_emoji: emoji });
  if (error) return null;
  return data as { reacted: boolean; emoji: string };
}

export async function getMyStoryReactions(storyId: string): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_my_story_reactions", { p_story_id: storyId });
  if (error) return [];
  return (data ?? []) as string[];
}

export async function getStoryPoll(storyId: string): Promise<StoryPoll | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_story_poll", { p_story_id: storyId });
  if (error || !data) return null;
  return data as StoryPoll;
}

export async function voteStoryPoll(pollId: string, optionId: string): Promise<StoryPoll | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("vote_story_poll", { p_poll_id: pollId, p_option_id: optionId });
  if (error || !data) return null;
  return data as StoryPoll;
}

export type StickerResponseValue = { text_value?: string | null; number_value?: number | null; option_id?: string | null };

export async function submitStickerResponse(storyId: string, stickerId: string, responseType: "question" | "slider" | "quiz" | "countdown" | "addyours" | "notify", value: StickerResponseValue): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase.rpc("submit_sticker_response", {
    p_story_id: storyId,
    p_sticker_id: stickerId,
    p_response_type: responseType,
    p_text_value: value.text_value ?? null,
    p_number_value: value.number_value ?? null,
    p_option_id: value.option_id ?? null,
  });
  if (error) throw error;
  return true;
}

export type StickerResponseRow = StickerResponseValue & { user_id?: string; created_at?: string };
export async function getStickerResponses(storyId: string, stickerId: string): Promise<StickerResponseRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_sticker_responses", { p_story_id: storyId, p_sticker_id: stickerId });
  if (error) throw error;
  return (data ?? []) as StickerResponseRow[];
}

export async function getMyStickerResponse(storyId: string, stickerId: string): Promise<StickerResponseValue | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_my_sticker_response", { p_story_id: storyId, p_sticker_id: stickerId });
  if (error) throw error;
  return data as StickerResponseValue | null;
}
export type StickerSummary = { count: number; average: number | null; options: Record<string, number> };
export async function getStickerSummary(storyId: string, stickerId: string): Promise<StickerSummary> {
  const { data, error } = await createClient().rpc("get_story_sticker_summary", { p_story_id: storyId, p_sticker_id: stickerId });
  if (error) throw error;
  return data as StickerSummary;
}
