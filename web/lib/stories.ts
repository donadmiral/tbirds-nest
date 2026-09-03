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
  photoShape?: "square" | "rounded" | "circle";
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
  hashtag?: string;
  postId?: string;
  postAuthorName?: string;
  postText?: string;
  postAuthorAvatar?: string | null;
  postMediaUrl?: string | null;
  postMediaType?: string | null;
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
  // Creative engine extras, written by the phone composer and replayed here
  trimStart?: number;
  trimEnd?: number;
  filterAmt?: number;
  adjust?: { bri?: number; warm?: number; tint?: number; sat?: number; fade?: number; vig?: number } | null;
  mix?: { orig?: number; music?: number } | null;
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
  media_transform?: StoryMediaTransform | null;
  dual_front_url?: string | null;
  audio_url?: string | null;
  audio_title?: string | null;
  audio_source?: string | null;
  audio_duration_sec?: number | null;
  filter_id?: string | null;
};

// Same overlay definitions as the phone's StoryFilters.tsx - keep in sync.
export type StoryFilterFamily = "classic" | "modern" | "film";
export type StoryFilterDef = { id: string; label: string; family: StoryFilterFamily; layers: { color: string; opacity: number }[]; css?: string };
// One catalogue for web and phone. `layers` render identically on both as
// translucent colour planes. `css` is the extra grade web applies beneath,
// contrast, saturation and black-and-white, which the phone approximates
// with its layers alone. Ids are stored on stories.filter_id; never rename one.
export const STORY_FILTERS: StoryFilterDef[] = [
  { id: "warm", label: "Warm", family: "classic", layers: [{ color: "#FF9A3C", opacity: 0.14 }, { color: "#3B2000", opacity: 0.08 }], css: "saturate(1.05)" },
  { id: "golden", label: "Golden", family: "classic", layers: [{ color: "#FFC94D", opacity: 0.18 }], css: "contrast(1.04)" },
  { id: "cool", label: "Cool", family: "classic", layers: [{ color: "#3C7DFF", opacity: 0.12 }, { color: "#001A3B", opacity: 0.08 }], css: "saturate(0.95)" },
  { id: "rose", label: "Rose", family: "classic", layers: [{ color: "#FF5E8A", opacity: 0.12 }] },
  { id: "fade", label: "Fade", family: "modern", layers: [{ color: "#FFFFFF", opacity: 0.16 }, { color: "#000000", opacity: 0.05 }], css: "contrast(0.9) saturate(0.85)" },
  { id: "dusk", label: "Dusk", family: "classic", layers: [{ color: "#5B3B8F", opacity: 0.14 }, { color: "#000000", opacity: 0.10 }], css: "contrast(1.05)" },
  { id: "sepia", label: "Sepia", family: "classic", layers: [{ color: "#8A6A3B", opacity: 0.2 }, { color: "#2B1D07", opacity: 0.1 }] },
  { id: "mint", label: "Mint", family: "modern", layers: [{ color: "#3ECF8E", opacity: 0.1 }, { color: "#02291A", opacity: 0.07 }] },
  { id: "berry", label: "Berry", family: "modern", layers: [{ color: "#B33771", opacity: 0.13 }, { color: "#1B0210", opacity: 0.09 }] },
  { id: "noir", label: "Noir", family: "classic", layers: [{ color: "#000000", opacity: 0.22 }, { color: "#1C2B4A", opacity: 0.12 }] },
  { id: "fade_warm", label: "Fade warm", family: "modern", layers: [{ color: "#FFE0B8", opacity: 0.18 }, { color: "#000000", opacity: 0.04 }], css: "contrast(0.9) saturate(0.85)" },
  { id: "fade_cool", label: "Fade cool", family: "modern", layers: [{ color: "#C8DBFF", opacity: 0.18 }, { color: "#000000", opacity: 0.04 }], css: "contrast(0.9) saturate(0.85)" },
  { id: "simple", label: "Simple", family: "modern", layers: [{ color: "#FFFFFF", opacity: 0.06 }], css: "contrast(1.06) saturate(0.95)" },
  { id: "boost", label: "Boost", family: "modern", layers: [{ color: "#FFF3D6", opacity: 0.06 }], css: "contrast(1.18) saturate(1.28)" },
  { id: "boost_warm", label: "Boost warm", family: "modern", layers: [{ color: "#FFB86B", opacity: 0.12 }], css: "contrast(1.15) saturate(1.25)" },
  { id: "boost_cool", label: "Boost cool", family: "modern", layers: [{ color: "#7FA8FF", opacity: 0.12 }], css: "contrast(1.15) saturate(1.2)" },
  { id: "graphite", label: "Graphite", family: "modern", layers: [{ color: "#2A2E36", opacity: 0.22 }, { color: "#FFFFFF", opacity: 0.04 }], css: "grayscale(1) contrast(1.15)" },
  { id: "hyper", label: "Hyper", family: "modern", layers: [{ color: "#FF3D9A", opacity: 0.08 }, { color: "#2AF0FF", opacity: 0.06 }], css: "contrast(1.25) saturate(1.5)" },
  { id: "rosy", label: "Rosy", family: "modern", layers: [{ color: "#FF8FB3", opacity: 0.16 }], css: "saturate(1.1)" },
  { id: "emerald", label: "Emerald", family: "modern", layers: [{ color: "#1DB47A", opacity: 0.14 }, { color: "#003322", opacity: 0.06 }], css: "contrast(1.05)" },
  { id: "midnight", label: "Midnight", family: "modern", layers: [{ color: "#0B1E3D", opacity: 0.22 }, { color: "#000000", opacity: 0.14 }], css: "contrast(1.1) saturate(0.9)" },
  { id: "soft_light", label: "Soft light", family: "modern", layers: [{ color: "#FFFFFF", opacity: 0.12 }, { color: "#FFE9C9", opacity: 0.08 }], css: "contrast(0.95) brightness(1.05)" },
  { id: "clarendon", label: "Clarendon", family: "film", layers: [{ color: "#7FBFFF", opacity: 0.10 }], css: "contrast(1.2) saturate(1.35)" },
  { id: "gingham", label: "Gingham", family: "film", layers: [{ color: "#FFFFFF", opacity: 0.14 }, { color: "#E6E1D6", opacity: 0.08 }], css: "brightness(1.05) contrast(0.9)" },
  { id: "moon", label: "Moon", family: "film", layers: [{ color: "#DDE3EA", opacity: 0.10 }], css: "grayscale(1) brightness(1.1) contrast(1.1)" },
  { id: "lark", label: "Lark", family: "film", layers: [{ color: "#E8F4FF", opacity: 0.10 }], css: "brightness(1.08) saturate(1.1)" },
  { id: "reyes", label: "Reyes", family: "film", layers: [{ color: "#EFE3CF", opacity: 0.20 }, { color: "#000000", opacity: 0.03 }], css: "contrast(0.85) saturate(0.75) brightness(1.1)" },
  { id: "juno", label: "Juno", family: "film", layers: [{ color: "#FFD8B0", opacity: 0.10 }, { color: "#FF7A3C", opacity: 0.05 }], css: "contrast(1.15) saturate(1.3)" },
  { id: "slumber", label: "Slumber", family: "film", layers: [{ color: "#5D4A2A", opacity: 0.16 }, { color: "#000000", opacity: 0.06 }], css: "saturate(0.66) brightness(1.05)" },
  { id: "crema", label: "Crema", family: "film", layers: [{ color: "#F3E4CE", opacity: 0.16 }], css: "contrast(0.95) saturate(0.85)" },
  { id: "ludwig", label: "Ludwig", family: "film", layers: [{ color: "#FFF1DE", opacity: 0.08 }], css: "contrast(1.05) saturate(1.1) brightness(1.03)" },
  { id: "aden", label: "Aden", family: "film", layers: [{ color: "#FFB07A", opacity: 0.14 }, { color: "#66271E", opacity: 0.06 }], css: "contrast(0.9) saturate(0.85) brightness(1.15)" },
  { id: "perpetua", label: "Perpetua", family: "film", layers: [{ color: "#7FC4B3", opacity: 0.14 }, { color: "#0F3A2E", opacity: 0.06 }], css: "contrast(1.05)" },
  { id: "amaro", label: "Amaro", family: "film", layers: [{ color: "#FFFFFF", opacity: 0.10 }, { color: "#FFD9A8", opacity: 0.08 }], css: "contrast(0.9) brightness(1.1) saturate(1.5)" },
  { id: "mayfair", label: "Mayfair", family: "film", layers: [{ color: "#FFD0E8", opacity: 0.10 }, { color: "#000000", opacity: 0.06 }], css: "contrast(1.1) saturate(1.1)" },
  { id: "rise", label: "Rise", family: "film", layers: [{ color: "#FFE0B0", opacity: 0.16 }, { color: "#000000", opacity: 0.04 }], css: "brightness(1.05) saturate(0.9) contrast(0.95)" },
  { id: "hudson", label: "Hudson", family: "film", layers: [{ color: "#7AA6FF", opacity: 0.14 }, { color: "#002050", opacity: 0.06 }], css: "brightness(1.2) contrast(0.9) saturate(1.1)" },
  { id: "valencia", label: "Valencia", family: "film", layers: [{ color: "#FFD9A0", opacity: 0.14 }, { color: "#3A2A10", opacity: 0.04 }], css: "contrast(1.08) brightness(1.08) sepia(0.08)" },
  { id: "xpro", label: "X-Pro II", family: "film", layers: [{ color: "#FFC46B", opacity: 0.10 }, { color: "#000000", opacity: 0.16 }], css: "contrast(1.3) saturate(1.4) sepia(0.1)" },
  { id: "sierra", label: "Sierra", family: "film", layers: [{ color: "#F5E6C8", opacity: 0.16 }, { color: "#000000", opacity: 0.08 }], css: "contrast(0.85) saturate(0.85)" },
  { id: "willow", label: "Willow", family: "film", layers: [{ color: "#E9DFD0", opacity: 0.12 }], css: "grayscale(0.85) contrast(0.95) brightness(1.05)" },
  { id: "lofi", label: "Lo-Fi", family: "film", layers: [{ color: "#000000", opacity: 0.10 }], css: "contrast(1.4) saturate(1.3)" },
  { id: "inkwell", label: "Inkwell", family: "film", layers: [{ color: "#000000", opacity: 0.04 }], css: "grayscale(1) contrast(1.25) brightness(1.05)" },
  { id: "hefe", label: "Hefe", family: "film", layers: [{ color: "#FFC97A", opacity: 0.12 }, { color: "#000000", opacity: 0.12 }], css: "contrast(1.2) saturate(1.3)" },
  { id: "nashville", label: "Nashville", family: "film", layers: [{ color: "#FFD1B8", opacity: 0.18 }, { color: "#3C5A99", opacity: 0.10 }], css: "sepia(0.2) contrast(1.15) brightness(1.05)" },
];
export const STORY_FILTER_FAMILIES: { key: StoryFilterFamily; label: string }[] = [
  { key: "classic", label: "Classic" }, { key: "modern", label: "Modern" }, { key: "film", label: "Film" },
];
export function filterCss(filterId: string | null | undefined, intensity = 1): string | undefined {
  const f = filterId ? STORY_FILTERS.find((x) => x.id === filterId) : null;
  if (!f?.css) return undefined;
  if (intensity >= 1) return f.css;
  // Scale each function toward its neutral value by the intensity.
  return f.css.replace(/([a-z-]+)\(([\d.]+)\)/g, (_, fn, v) => {
    const n = parseFloat(v); const neutral = fn === "grayscale" || fn === "sepia" ? 0 : 1;
    return fn + "(" + (neutral + (n - neutral) * intensity).toFixed(3) + ")";
  });
}

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

export async function submitStickerResponse(storyId: string, stickerId: string, responseType: "question" | "slider" | "quiz", value: StickerResponseValue): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase.rpc("submit_sticker_response", {
    p_story_id: storyId,
    p_sticker_id: stickerId,
    p_response_type: responseType,
    p_text_value: value.text_value ?? null,
    p_number_value: value.number_value ?? null,
    p_option_id: value.option_id ?? null,
  });
  return !error;
}

export type StickerResponseRow = StickerResponseValue & { user_id?: string; created_at?: string };
export async function getStickerResponses(storyId: string, stickerId: string): Promise<StickerResponseRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_sticker_responses", { p_story_id: storyId, p_sticker_id: stickerId });
  if (error || !data) return [];
  return data as StickerResponseRow[];
}

export async function getMyStickerResponse(storyId: string, stickerId: string): Promise<StickerResponseValue | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_my_sticker_response", { p_story_id: storyId, p_sticker_id: stickerId });
  if (error || !data) return null;
  return data as StickerResponseValue;
}