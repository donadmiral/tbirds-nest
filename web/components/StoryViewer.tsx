"use client";

import { MUSIC_CATALOG_ENABLED } from '../../shared/musicAvailability';
import { useCallback, useEffect, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import { X, ChevronLeft, ChevronRight, Volume2, VolumeX, Eye, Trash2, Music, Heart, Smile, Send, BadgeCheck, AtSign, MessageCircle, Repeat2, Bookmark, Play, Pause, MoreHorizontal, Settings2, Globe2 } from "lucide-react";
import { getUserStories, markStoryViewed, toggleStoryReaction, getMyStoryReactions, getStoryPoll, STORY_FILTERS, filterCss, REACTION_EMOJIS, type CatchupUser, type StoryRow, type StoryMediaTransform, type StoryTextSticker, type StoryPoll } from "@/lib/stories";
import { StoryPollCard } from "@/components/StoryPollCard";
import { hydrateStoryMedia } from "@/lib/contentMedia";
import { QuestionCard, QuizCard, SliderCard, CountdownCard, AddYoursCard, SupportCard, ResultsCard } from "@/components/StoryEngageCards";
import { RelativeTime } from "@/components/RelativeTime";
import { SaveToMemory } from "@/components/SaveToMemory";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { AdjustOverlay, BgLayer, DrawSvg, EngineSticker, animStyle, extraFontCss, STICKER_ANIM_CSS } from "@/components/StoryEngine";

import { SharedPostStory } from "./SharedPostStory";
import { stickerCss } from "./storyTextAppearance";

import { currentTextMentions } from "../../shared/storyMentions";

const callActive = () => typeof document !== "undefined" && document.documentElement?.dataset?.platinumCallActive === "true";

function SharedStoryVideo({ src, paused }: { src: string; paused: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { const video = ref.current; if (!video) return; if (paused || callActive() || document.hidden) video.pause(); else void video.play().catch(() => {}); }, [src, paused]);
  return <video ref={ref} src={src} muted loop playsInline preload="metadata" className="h-full w-full object-contain" />;
}

const IMAGE_DURATION_MS = 5000;
const MAX_AUDIO_MS = 30000;


const TIER_COLORS: Record<string, string> = { public_figure: "#22C55E", business: "#8E8E93", official: "#C9BFB0" };
const tierCache = new Map<string, string | null>();
function MentionTag({ userId, username, pos, pillStyle, pillCls, tint }: { userId?: string; username: string; pos: React.CSSProperties; pillStyle: React.CSSProperties; pillCls: string; tint: boolean }) {
  const [tier, setTier] = useState<string | null>(userId ? (tierCache.get(userId) ?? null) : null);
  useEffect(() => {
    if (!userId || tierCache.has(userId)) return;
    let dead = false;
    createClient().from("profiles").select("is_verified, verified_tier").eq("id", userId).maybeSingle().then(({ data }) => {
      const t = data?.is_verified ? ((data.verified_tier as string) || "business") : null;
      tierCache.set(userId, t);
      if (!dead) setTier(t);
    });
    return () => { dead = true; };
  }, [userId]);
  const color = tier ? (TIER_COLORS[tier] || TIER_COLORS.business) : null;
  return (
    <a href={"/" + username} style={{ ...pos, ...pillStyle, ...(tint && color ? { color } : null) }} className={pillCls}>
      @{username}
      {color ? <BadgeCheck size={13} style={{ color, flexShrink: 0 }} /> : null}
    </a>
  );
}

function StickerLayer({ stickers, clock, storyId, isOwn, paused }: { stickers: StoryTextSticker[]; clock?: number | null; storyId: string; isOwn: boolean; paused: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[4]">
      {stickers.map((st) => {
        const pos: React.CSSProperties = { position: "absolute", left: (st.nx * 100) + "%", top: (st.ny * 100) + "%", transform: "translate(-50%, -50%) rotate(" + (st.rotation || 0) + "rad) scale(" + (st.scale || 1) + ")", opacity: st.opacity ?? 1, maxWidth: "82%" };
        const kind = st.kind || "text";
        if (kind === "drawing") return null;
        if (typeof clock === "number" && (st.startSec != null || st.endSec != null)) {
          const t0 = typeof st.startSec === "number" ? st.startSec : 0;
          const t1 = typeof st.endSec === "number" ? st.endSec : Number.MAX_SAFE_INTEGER;
          if (clock < t0 - 0.05 || clock > t1 + 0.05) return null;
        }
        if (kind === "text" || kind === "emoji") {
          // Typed @handles that resolved to people open the profile.
          const ms = currentTextMentions(st);
          const body = ms.length ? String(st.text).split(/(@[A-Za-z0-9_.]{2,30})/g).map((part, i) => {
            const m = part.startsWith("@") ? ms.find((x) => x.username.toLowerCase() === part.slice(1).toLowerCase()) : null;
            return m ? <a key={i} href={"/" + m.username} onClick={(e) => e.stopPropagation()} className="pointer-events-auto font-extrabold underline">{part}</a> : <span key={i}>{part}</span>;
          }) : st.text;
          return <div key={st.id} style={pos}><div style={{ ...stickerCss(st), ...extraFontCss(st.style), ...animStyle(st.anim) }}>{body}</div></div>;
        }
        if (kind === "gif" || kind === "photo" || kind === "time" || kind === "date" || kind === "weather" || kind === "entity") {
          const cell = kind === "photo" && (st as any).photoShape === "cell" && typeof (st as any).photoFw === "number" ? { width: ((st as any).photoFw * 100) + "%", height: ((st as any).photoFh * 100) + "%" } : null;
          return <div key={st.id} style={{ ...pos, ...(cell || {}) }}><div style={{ ...animStyle(st.anim), ...(cell ? { width: "100%", height: "100%" } : {}) }}><EngineSticker st={st} /></div></div>;
        }
        // Pill looks mirror the phone StickerPill: 0 white, 1 ink, 2 gradient, 3 glass.
        const pv = (((st as any).pillVariant || 0) % 4 + 4) % 4;
        const pillBase = "pointer-events-auto inline-flex max-w-full items-center gap-1.5 truncate rounded-[18px] border border-black/5 px-4 py-2.5 text-[15px] font-extrabold tracking-[-0.3px] shadow-lg";
        const pillGrad: Record<string, string> = { link: "linear-gradient(135deg,#3C7DFF,#00C2FF)", location: "linear-gradient(135deg,#FF6B4A,#FFB03A)", mention: "linear-gradient(135deg,#7C5CFF,#B96BFF)", hashtag: "linear-gradient(135deg,#0EA5E9,#22D3EE)" };
        const pillStyle: React.CSSProperties = pv === 0 ? { background: "#FFFFFF", color: "#0A0A0A" }
          : pv === 1 ? { background: "#0B1E3D", color: "#FFFFFF" }
          : pv === 2 ? { background: pillGrad[kind] || pillGrad.link, color: "#FFFFFF" }
          : { background: "rgba(10,12,18,0.42)", color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.5)", boxShadow: "none" };
        const pillCls = pillBase;
        if (kind === "link" && st.url) {
          return <a key={st.id} href={st.url} target="_blank" rel="noopener noreferrer" style={{ ...pos, ...pillStyle }} className={pillCls}>{"\uD83D\uDD17 "}{st.text || st.url}</a>;
        }
        if (kind === "mention" && st.mentionUsername) {
          return <MentionTag key={st.id} userId={st.mentionUserId} username={st.mentionUsername} pos={pos} pillStyle={pillStyle} pillCls={pillCls} tint={pv === 0 || pv === 3} />;
        }
        if (kind === "hashtag" && st.hashtag) {
          return <a key={st.id} href={"/topic/" + encodeURIComponent(st.hashtag)} style={{ ...pos, ...pillStyle }} className={pillCls}>#{st.hashtag}</a>;
        }
        if (kind === "location") {
          return <a key={st.id} href={"https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(st.locationDisplayName || st.locationName || st.text)} target="_blank" rel="noopener noreferrer" style={{ ...pos, ...pillStyle }} className={pillCls}>{"\uD83D\uDCCD "}{st.locationDisplayName || st.locationName || st.text}</a>;
        }
        if (kind === "story" && (st as any).storyId) {
          const rs: any = st;
          const thumb = rs.storyThumbUrl || rs.storyMediaUrl;
          const href = "/story/" + encodeURIComponent(rs.storyId);
          return (
            <a key={st.id} href={href} style={{ ...pos, width: 200, height: 356 }} className="pointer-events-auto block overflow-hidden rounded-[18px] border-2 border-white bg-black">
              {thumb ? <img src={thumb} alt="" className="h-full w-full object-contain" /> : null}
              <span className="absolute left-2.5 top-2.5 flex items-center gap-2 text-[12px] font-extrabold text-white drop-shadow">{rs.storyAuthorAvatar ? <img src={rs.storyAuthorAvatar} alt="" className="h-6 w-6 rounded-full border border-white object-cover" /> : null}{rs.storyAuthorName || "Story"}</span>
              <span className="absolute bottom-2.5 left-2.5 rounded-full bg-black/45 px-2 py-1 text-[11px] font-bold text-white">@ Mentioned you</span>
            </a>
          );
        }
        if (kind === "post" && st.postId) return <SharedPostStory key={st.id} sticker={st} paused={paused} />;
        if (kind === "question") return <div key={st.id} style={{ ...pos, maxWidth: "none" }}><QuestionCard st={st} storyId={storyId} isOwn={isOwn} /></div>;
        if (kind === "quiz") return <div key={st.id} style={{ ...pos, maxWidth: "none" }}><QuizCard st={st} storyId={storyId} isOwn={isOwn} /></div>;
        if (kind === "slider") return <div key={st.id} style={{ ...pos, maxWidth: "none" }}><SliderCard st={st} storyId={storyId} isOwn={isOwn} /></div>;
        if (kind === "countdown") return <div key={st.id} style={{ ...pos, maxWidth: "none" }}><CountdownCard st={st} /></div>;
        if (kind === "addyours") return <div key={st.id} style={{ ...pos, maxWidth: "none" }}><AddYoursCard st={st} storyId={storyId} isOwn={isOwn} /></div>;
        if (kind === "support") return <div key={st.id} style={{ ...pos, maxWidth: "none" }}><SupportCard st={st} /></div>;
        if (kind === "results") return <div key={st.id} style={{ ...pos, maxWidth: "none" }}><ResultsCard st={st} /></div>;
        return null;
      })}
    </div>
  );
}

function mediaStyle(mt: StoryMediaTransform | null | undefined): React.CSSProperties {
  if (!mt || typeof mt !== "object") return { objectFit: "contain" };
  const hasMove = (mt.scale && mt.scale !== 1) || mt.translateNX !== 0 || mt.translateNY !== 0;
  const style: React.CSSProperties = { objectFit: mt.fit === "contain" ? "contain" : "cover" };
  if (hasMove) {
    style.transform = "translate(" + ((mt.translateNX || 0) * 100) + "%, " + ((mt.translateNY || 0) * 100) + "%) scale(" + (mt.scale || 1) + ")";
  }
  return style;
}

function FilterOverlay({ filterId, amt }: { filterId: string | null | undefined; amt?: number | null }) {
  if (!filterId) return null;
  const f = STORY_FILTERS.find((x) => x.id === filterId);
  if (!f) return null;
  // filterAmt (0-100) scales the look exactly as the phone FilterLayer does; the CSS grade scales toward neutral.
  const k = Math.max(0, Math.min(1, (typeof amt === "number" ? amt : 100) / 100));
  return (
    <div className="pointer-events-none absolute inset-0 z-[1]" style={{ backdropFilter: filterCss(filterId, k), WebkitBackdropFilter: filterCss(filterId, k) }}>
      {f.layers.map((l, i) => (
        <div key={i} className="pointer-events-none absolute inset-0" style={{ backgroundColor: l.color, opacity: l.opacity * k }} />
      ))}
    </div>
  );
}

export function StoryViewer({ users, startIndex, initialStoryId, onClose }: {
  users: CatchupUser[];
  startIndex: number;
  initialStoryId?: string;
  onClose: () => void;
}) {
  const [userIdx, setUserIdx] = useState(startIndex);
  const [stories, setStories] = useState<StoryRow[]>([]);
  const [storyLoadFinished, setStoryLoadFinished] = useState(false);
  const [storyLoadError, setStoryLoadError] = useState(false);
  const [storyLoadAttempt, setStoryLoadAttempt] = useState(0);
  const [itemIdx, setItemIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const durRef = useRef(IMAGE_DURATION_MS);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const viewerRef = useRef<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [clock, setClock] = useState<number | null>(null);
  const [poll, setPoll] = useState<StoryPoll | null>(null);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const settingsBusyRef = useRef(false);
  const [storyMentions, setStoryMentions] = useState<{ id: string; mentioned_user_id: string; visible: boolean; username?: string | null }[]>([]);
  const holdOrigin = useRef<{ x: number; y: number } | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackPausedRef = useRef(false);
  const manualPauseRef = useRef(false);
  const holdPausedRef = useRef(false);
  const holdConsumedClickRef = useRef(false);
  const [playbackPaused, setPlaybackPaused] = useState(false);
  const pausedAtRef = useRef(0);
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set());
  const reactionRequests = useRef(new Set<string>());
  const reactionVersion = useRef(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [heartBurst, setHeartBurst] = useState(0);
  const [loadedStoryId, setLoadedStoryId] = useState<string | null>(null);
  const readyStoryRef = useRef<string | null>(null);
  const [failedStoryId, setFailedStoryId] = useState<string | null>(null);
  const [mediaRetry, setMediaRetry] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const sendingReplyRef = useRef(false);
  const [replyToast, setReplyToast] = useState(false);
  const user = users[userIdx];
  const story = stories[itemIdx];
  const currentStoryRef = useRef(story?.id);
  currentStoryRef.current = story?.id;
  const inputFocusedRef = useRef(false);
  const overlayPausedRef = useRef(false);
  overlayPausedRef.current = viewersOpen || moreOpen || memoryOpen || emojiOpen || !!replyText.trim();
  const mediaReady = !story?.media_url || loadedStoryId === story.id;

  // Reset on every advance, otherwise the previous story's ready flag hides the
  // shimmer for the next one and it flashes black again.
  useEffect(() => {
    readyStoryRef.current = null;
    setLoadedStoryId(null);
    setFailedStoryId(null);
    setActionError(null);
    setReplyText("");
    setReplyToast(false);
    setViewersOpen(false);
    setMoreOpen(false); setMemoryOpen(false);
    setHeartBurst(0);
    playbackPausedRef.current = false;
    manualPauseRef.current = false;
    holdPausedRef.current = false;
    holdConsumedClickRef.current = false;
    setPlaybackPaused(false);
    if (holdRef.current) clearTimeout(holdRef.current);
    return () => {
      if (holdRef.current) clearTimeout(holdRef.current);
    };
  }, [story?.id]);
  const onMediaReady = () => {
    if (currentStoryRef.current !== story?.id) return;
    readyStoryRef.current = story?.id ?? null;
    setLoadedStoryId(story?.id ?? null);
    setFailedStoryId(null);
    startedAt.current = Date.now();
  };

  // Preload the next frame while this one is on screen. A story lasts several
  // seconds; using that time is the difference between instant and a stall at
  // every tap.
  useEffect(() => {
    const videos: HTMLVideoElement[] = [];
    [stories[itemIdx + 1], stories[itemIdx + 2]].forEach((next, i) => {
      if (!next?.media_url) return;
      const poster = (next as { thumbnail_url?: string | null }).thumbnail_url;
      if (poster) { const pi = new Image(); pi.src = poster; }
      if (next.media_type === "video") { if (i === 0) { const v = document.createElement("video"); v.preload = "metadata"; v.src = next.media_url; videos.push(v); } }
      else { const img = new Image(); img.src = next.media_url; }
    });
    return () => { videos.forEach(video => { video.removeAttribute("src"); video.load(); }); };
  }, [stories, itemIdx]);
  const storyAudioUrl = MUSIC_CATALOG_ENABLED ? story?.audio_url ?? null : null;
  const isOwn = !!(uid && story && uid === story.user_id);
  useEffect(() => { setPoll(null); if (!story) return; let dead = false; getStoryPoll(story.id).then((p) => { if (!dead) setPoll(p); }).catch(() => {}); return () => { dead = true; }; }, [story?.id]);
  // Only the author and mentioned people get rows back (RLS), so a normal
  // viewer sees no chip and pays one cheap empty query.
  useEffect(() => {
    setStoryMentions([]);
    if (!story) return;
    let dead = false;
    const sb = createClient();
    sb.from("story_mentions").select("id, mentioned_user_id, visible").eq("story_id", story.id).then(async ({ data }) => {
      const rows = (data ?? []) as { id: string; mentioned_user_id: string; visible: boolean }[];
      if (rows.length === 0) return;
      const { data: profs } = await sb.from("profiles").select("id, username").in("id", rows.map((r) => r.mentioned_user_id));
      const names = new Map(((profs ?? []) as { id: string; username: string | null }[]).map((p) => [p.id, p.username]));
      if (!dead) setStoryMentions(rows.map((r) => ({ ...r, username: names.get(r.mentioned_user_id) ?? null })));
    });
    return () => { dead = true; };
  }, [story?.id]);
  const canReact = !!(story && !isOwn && story.allow_reactions !== false);
  const canReply = !!(story && !isOwn && story.allow_replies !== false);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const nextUser = useCallback(() => {
    if (userIdx + 1 < users.length) { setUserIdx(userIdx + 1); setItemIdx(0); }
    else onClose();
  }, [userIdx, users.length, onClose]);

  const advance = useCallback(() => {
    stopTimer();
    if (itemIdx + 1 < stories.length) setItemIdx(itemIdx + 1);
    else nextUser();
  }, [itemIdx, stories.length, nextUser, stopTimer]);

  const back = useCallback(() => {
    if (itemIdx === 0 && userIdx === 0) return;
    stopTimer();
    if (itemIdx > 0) setItemIdx(itemIdx - 1);
    else if (userIdx > 0) { setUserIdx(userIdx - 1); setItemIdx(0); }
  }, [itemIdx, userIdx, stopTimer]);

  const pauseNow = useCallback(() => {
    if (playbackPausedRef.current) return;
    playbackPausedRef.current = true;
    setPlaybackPaused(true);
    pausedAtRef.current = (Date.now() - startedAt.current) / durRef.current;
    stopTimer();
    videoRef.current?.pause();
    audioRef.current?.pause();
  }, [stopTimer]);

  const resumeNow = useCallback(() => {
    if (!playbackPausedRef.current || manualPauseRef.current || overlayPausedRef.current || inputFocusedRef.current || document.hidden || callActive()) return;
    playbackPausedRef.current = false;
    setPlaybackPaused(false);
    stopTimer();
    startedAt.current = Date.now() - pausedAtRef.current * durRef.current;
    timerRef.current = setInterval(() => {
      if (story?.media_url && readyStoryRef.current !== story.id) { startedAt.current = Date.now(); return; }
      const el = videoRef.current;
      if (story?.media_type === "video" && el) {
        const t0 = Number((story?.media_transform as StoryMediaTransform | undefined)?.trimStart) || 0; const win = durRef.current / 1000;
        const p = Math.max(0, Math.min(1, (el.currentTime - t0) / win));
        if (el.ended || (el.currentTime - t0) >= win - 0.06) advance(); else setProgress(p);
        return;
      }
      const p = (Date.now() - startedAt.current) / durRef.current;
      if (p >= 1) advance();
      else setProgress(p);
    }, 50);
    videoRef.current?.play().catch(() => {});
    if (readyStoryRef.current === story?.id || !story?.media_url) audioRef.current?.play().catch(() => {});
  }, [advance, story, stopTimer]);

  const togglePlayback = useCallback(() => {
    if (playbackPausedRef.current) {
      manualPauseRef.current = false;
      resumeNow();
    } else {
      manualPauseRef.current = true;
      pauseNow();
    }
  }, [pauseNow, resumeNow]);

  const holdStart = useCallback(() => {
    if (holdRef.current) clearTimeout(holdRef.current);
    holdPausedRef.current = false;
    holdConsumedClickRef.current = false;
    holdRef.current = setTimeout(() => {
      holdConsumedClickRef.current = true;
      if (!playbackPausedRef.current) { holdPausedRef.current = true; pauseNow(); }
    }, 200);
  }, [pauseNow]);

  const holdEnd = useCallback(() => {
    if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; }
    if (!holdPausedRef.current) return;
    holdPausedRef.current = false;
    resumeNow();
  }, [resumeNow]);

  const react = useCallback(async (emoji: string) => {
    if (!story || !canReact || !uid) return;
    const storyId = story.id;
    const requestKey = storyId + ":" + emoji;
    if (reactionRequests.current.has(requestKey)) return;
    reactionRequests.current.add(requestKey);
    reactionVersion.current += 1;
    const had = myReactions.has(emoji);
    const applyReaction = (reacted: boolean) => setMyReactions(current => {
      const next = new Set(current);
      if (reacted) next.add(emoji); else next.delete(emoji);
      return next;
    });
    applyReaction(!had);
    if (!had && emoji === REACTION_EMOJIS[0]) { setHeartBurst(Date.now()); setTimeout(() => { if (currentStoryRef.current === storyId) setHeartBurst(0); }, 900); }
    try {
      const { data, error } = await createClient().auth.getSession();
      if (error || data.session?.user.id !== uid) throw new Error("Account changed");
      const res = await toggleStoryReaction(storyId, emoji);
      if (currentStoryRef.current !== storyId) return;
      applyReaction(res ? res.reacted : had);
      if (!res) setActionError("Your reaction could not be confirmed. Try again.");
    } catch {
      if (currentStoryRef.current === storyId) {
        applyReaction(had);
        setActionError("Your reaction could not be confirmed. Try again.");
      }
    } finally { reactionRequests.current.delete(requestKey); }
  }, [story, canReact, uid, myReactions]);

  const sendReply = useCallback(async () => {
    if (!story || !uid || !canReply) return;
    const trimmed = replyText.trim();
    if (!trimmed || sendingReplyRef.current) return;
    sendingReplyRef.current = true;
    setSendingReply(true);
    setActionError(null);
    try {
      const supabase = createClient();
      const checkSession = async () => { const { data, error } = await supabase.auth.getSession(); if (error || data.session?.user.id !== uid) throw new Error("Sign in again to send this reply."); };
      await checkSession();
      const ownerId = story.user_id;
      const sorted = [uid, ownerId].sort();
      const messageText = "Replied to your story:\n" + trimmed;
      const { data: existing, error: lookupError } = await supabase.from("conversations").select("id")
        .or("and(user_1.eq." + uid + ",user_2.eq." + ownerId + "),and(user_1.eq." + ownerId + ",user_2.eq." + uid + ")")
        .eq("type", "direct").eq("is_group", false).maybeSingle();
      if (lookupError) throw lookupError;
      let convId = existing?.id as string | undefined;
      if (!convId) {
        const { data: created, error: createError } = await supabase.from("conversations")
          .insert({ user_1: sorted[0], user_2: sorted[1], last_message: "", last_message_time: new Date().toISOString() })
          .select("id").single();
        if (createError) throw createError;
        convId = created?.id;
      }
      if (!convId) throw new Error("The conversation could not be opened.");
      await checkSession();
      const { error: msgErr } = await supabase.from("messages")
        .insert({ conversation_id: convId, sender_id: uid, receiver_id: ownerId, text: messageText });
      if (msgErr) throw msgErr;
      // The message is committed. A preview refresh must not invite resending it.
      void Promise.resolve(supabase.from("conversations").update({ last_message: messageText, last_message_time: new Date().toISOString() }).eq("id", convId)).catch(() => {});
      if (currentStoryRef.current === story.id) {
        setReplyText("");
        overlayPausedRef.current = false;
        setReplyToast(true);
        setTimeout(() => setReplyToast(false), 2000);
        resumeNow();
      }
    } catch {
      if (currentStoryRef.current === story.id) setActionError("Your reply could not be confirmed. It is kept here. Check Messages before sending again.");
    } finally {
      sendingReplyRef.current = false;
      setSendingReply(false);
    }
  }, [story, uid, canReply, replyText, sendingReply, resumeNow]);

  useEffect(() => {
    const client = createClient();
    let alive = true, version = 0;
    const accept = (next: string | null) => {
      if (!alive) return;
      if (viewerRef.current !== next) {
        viewerRef.current = next;
        setStories([]); setReplyText(""); setPoll(null); setMyReactions(new Set()); setViewersOpen(false);
      }
      setUid(next);
    };
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      version++; accept(session?.user.id ?? null);
    });
    const initial = version;
    void client.auth.getSession().then(({ data, error }) => {
      if (alive && version === initial) accept(error ? null : data.session?.user.id ?? null);
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  const refreshCurrentMedia = async () => {
    if (!story || !uid) return;
    const id = story.id, viewer = uid;
    setFailedStoryId(null); setLoadedStoryId(null); readyStoryRef.current = null;
    try {
      const [current] = await hydrateStoryMedia([story]);
      if (viewerRef.current !== viewer || currentStoryRef.current !== id) return;
      setStories(rows => rows.map(row => row.id === id ? current : row));
      setMediaRetry(value => value + 1);
    } catch { if (viewerRef.current === viewer && currentStoryRef.current === id) setFailedStoryId(id); }
  };

  useEffect(() => {
    if (!user || !uid) return;
    let off = false;
    setStories([]);
    setStoryLoadFinished(false);
    setStoryLoadError(false);
    getUserStories(user.user_id).then((rows) => {
      if (off) return;
      const target = userIdx === startIndex && initialStoryId ? rows.findIndex((row) => row.id === initialStoryId) : 0;
      // An expired notification must not open an unrelated story instead.
      setStories(target < 0 ? [] : rows);
      setItemIdx(Math.max(0, target));
      setStoryLoadFinished(true);
    }, () => { if (!off) { setStories([]); setStoryLoadError(true); setStoryLoadFinished(true); } });
    return () => { off = true; };
  }, [user, userIdx, startIndex, initialStoryId, uid, storyLoadAttempt]);

  useEffect(() => {
    setEmojiOpen(false);
    setMyReactions(new Set());
    const version = ++reactionVersion.current;
    if (!story || !uid || uid === story.user_id) return;
    let off = false;
    getMyStoryReactions(story.id).then((emojis) => { if (!off && reactionVersion.current === version) setMyReactions(new Set(emojis)); }).catch(() => {});
    return () => { off = true; };
  }, [story?.id, uid]);

  useEffect(() => {
    if (!story) return;
    setProgress(0);
    stopTimer();
    const mtx = (story.media_transform || {}) as StoryMediaTransform;
    const hasTrim = typeof mtx.trimStart === "number" && typeof mtx.trimEnd === "number" && mtx.trimEnd > mtx.trimStart;
    setClock(story.media_type === "video" ? (Number(mtx.trimStart) || 0) : null);
    if (videoRef.current) { try { videoRef.current.volume = Math.max(0, Math.min(1, (mtx.mix?.orig ?? 100) / 100)); } catch {} }
    if (audioRef.current) { try { audioRef.current.volume = Math.max(0, Math.min(1, (mtx.mix?.music ?? 100) / 100)); } catch {} }
    const isVideo = story.media_type === "video";
    let dur = isVideo
      ? Math.max(1000, (story.duration_sec ?? 10) * 1000)
      : IMAGE_DURATION_MS;
    if (isVideo && hasTrim) dur = Math.max(800, ((mtx.trimEnd as number) - (mtx.trimStart as number)) * 1000);
    if (MUSIC_CATALOG_ENABLED && !isVideo && story.audio_url && story.audio_duration_sec && story.audio_duration_sec > 0) {
      dur = Math.min(Math.max(dur, story.audio_duration_sec * 1000), MAX_AUDIO_MS);
    }
    durRef.current = dur;
    startedAt.current = Date.now();
    if (document.hidden || callActive() || playbackPausedRef.current) { pauseNow(); return stopTimer; }
    timerRef.current = setInterval(() => {
      if (story.media_url && readyStoryRef.current !== story.id) { startedAt.current = Date.now(); return; }
      if (isVideo && videoRef.current) {
        // Video: the bar follows the player's own clock, so buffering stalls the bar instead of advancing past the picture.
        const el = videoRef.current; const t0 = Number(mtx.trimStart) || 0; const win = durRef.current / 1000;
        const p = Math.max(0, Math.min(1, (el.currentTime - t0) / win));
        if (el.ended || (el.currentTime - t0) >= win - 0.06) advance(); else setProgress(p);
        return;
      }
      const p = (Date.now() - startedAt.current) / durRef.current;
      if (p >= 1) advance();
      else setProgress(p);
    }, 50);
    return stopTimer;
  }, [story, advance, stopTimer]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (["Escape", "ArrowRight", "ArrowLeft"].includes(e.key)) e.preventDefault();
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") advance();
      if (e.key === "ArrowLeft") back();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, back, onClose]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, (story?.media_transform?.mix?.music ?? 100) / 100));
    if (mediaReady && !playbackPaused && !document.hidden && !callActive()) void audio.play().catch(() => {});
    else audio.pause();
  }, [story?.id, storyAudioUrl, mediaReady, playbackPaused, muted, story?.media_transform?.mix?.music]);

  useEffect(() => {
    if (story && mediaReady) void markStoryViewed(story.id);
  }, [story?.id, mediaReady]);

  useEffect(() => {
    let pausedByVisibility = false;
    const onVisibility = () => {
      if (document.hidden) {
        pausedByVisibility = !playbackPausedRef.current;
        if (pausedByVisibility) pauseNow();
      } else if (pausedByVisibility) {
        pausedByVisibility = false;
        resumeNow();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pauseNow, resumeNow]);

  useEffect(() => {
    if (!story?.expires_at) return;
    const remaining = Date.parse(story.expires_at) - Date.now();
    if (!Number.isFinite(remaining)) return;
    const expire = () => { pauseNow(); setStories([]); setStoryLoadFinished(true); };
    if (remaining <= 0) { expire(); return; }
    const timer = setTimeout(expire, Math.min(remaining, 2147483647));
    return () => clearTimeout(timer);
  }, [story?.id, story?.expires_at, pauseNow]);

  useEffect(() => {
    const stop = () => { manualPauseRef.current = true; pauseNow(); };
    window.addEventListener("platinum:stop-media", stop);
    if (callActive()) stop();
    return () => window.removeEventListener("platinum:stop-media", stop);
  }, [pauseNow]);

  if (!user) return null;

  const tb = story?.text_background as { kind?: string; color?: string; colors?: string[] } | null | undefined;
  const bg = tb && typeof tb === "object"
    ? tb.kind === "solid" && tb.color
      ? tb.color
      : tb.colors?.length
        ? "linear-gradient(135deg, " + tb.colors.join(", ") + ")"
        : undefined
    : undefined;

  const deleteCurrentStory = async () => {
    if (!uid || !story || uid !== story.user_id) return;
                if (deletingRef.current || !confirm("Delete this story everywhere?")) return;
                deletingRef.current = true;
                setActionError(null);
                try {
                  const { data, error } = await createClient().from("stories").delete().eq("id", story.id).eq("user_id", uid).select("id").maybeSingle();
                  if (error || !data) throw error || new Error("Deletion was not confirmed");
                  if (currentStoryRef.current !== story.id) return;
                  const rest = stories.filter((s) => s.id !== story.id);
                  setStories(rest);
                  if (rest.length === 0) nextUser(); else setItemIdx(Math.min(itemIdx, rest.length - 1));
                } catch { if (currentStoryRef.current === story.id) setActionError("The story could not be deleted. Please try again."); }
                finally { deletingRef.current = false; }
  };
  const openActivity = () => { setMoreOpen(false); setViewersOpen(true); overlayPausedRef.current = true; pauseNow(); };
  const closeMore = () => { setMoreOpen(false); overlayPausedRef.current = memoryOpen || viewersOpen || emojiOpen || !!replyText.trim(); resumeNow(); };
  const updateStorySettings = async (patch: Partial<Pick<StoryRow, "allow_replies" | "allow_reactions" | "allow_sharing">>) => {
    if (!story || !uid || story.user_id !== uid || settingsBusyRef.current) return;
    const id = story.id, owner = uid;
    settingsBusyRef.current = true; setSettingsBusy(true); setActionError(null);
    try {
      const client = createClient();
      const session = await client.auth.getSession();
      if (session.error || session.data.session?.user.id !== owner) throw new Error("Account changed");
      const { data, error } = await client.from("stories").update(patch).eq("id", id).eq("user_id", owner).select("id,allow_replies,allow_reactions,allow_sharing").maybeSingle();
      if (error || !data) throw error || new Error("Settings were not confirmed");
      if (viewerRef.current === owner && currentStoryRef.current === id) setStories(current => current.map(item => item.id === id ? { ...item, ...data } : item));
    } catch { if (viewerRef.current === owner && currentStoryRef.current === id) setActionError("Story settings could not be saved. Try again."); }
    finally { settingsBusyRef.current = false; setSettingsBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
      <style>{"@keyframes heartpop { 0% { transform: scale(0.3); opacity: 0; } 30% { transform: scale(1.18); opacity: 1; } 70% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.05); opacity: 0; } }"}</style>
      <button onClick={onClose} className="absolute right-4 top-4 z-30 hidden h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 md:flex" aria-label="Close story viewer">
        <X size={20} />
      </button>
      {userIdx > 0 || itemIdx > 0 ? (
        <button onClick={back} className="absolute left-3 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" title="Previous">
          <ChevronLeft size={22} />
        </button>
      ) : null}
      <button onClick={advance} className="absolute right-3 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" title="Next">
        <ChevronRight size={22} />
      </button>

      <div className="relative aspect-[9/16] h-[92vh] max-w-[94vw] overflow-hidden rounded-[28px] bg-[#111518]" style={bg ? { background: bg } : undefined}
        onFocusCapture={event => { const target = event.target as HTMLElement; if (target.closest("input,textarea,select,[contenteditable='true']")) { inputFocusedRef.current = true; pauseNow(); } }}
        onBlurCapture={event => { const next = event.relatedTarget as HTMLElement | null; if (!next?.closest("input,textarea,select,[contenteditable='true']")) { inputFocusedRef.current = false; resumeNow(); } }}
        onContextMenu={event => { if (holdConsumedClickRef.current) event.preventDefault(); }}
        onPointerDownCapture={event => { if (event.button === 0 && event.isPrimary !== false) { holdOrigin.current = { x: event.clientX, y: event.clientY }; holdStart(); } }}
        onPointerMoveCapture={event => { const origin = holdOrigin.current; if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 12) { holdOrigin.current = null; holdEnd(); } }}
        onPointerUpCapture={holdEnd} onPointerCancelCapture={holdEnd} onPointerLeave={holdEnd}
        onClickCapture={event => { if (holdConsumedClickRef.current && event.detail !== 0) { holdConsumedClickRef.current = false; event.preventDefault(); event.stopPropagation(); } }}>
        <div className="absolute inset-x-2 top-2 z-10 flex gap-1">
          {stories.map((s, i) => (
            <span key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
              <span className="block h-full bg-white" style={{ width: (i < itemIdx ? 100 : i === itemIdx ? Math.min(100, progress * 100) : 0) + "%" }} />
            </span>
          ))}
        </div>

        <div className="absolute inset-x-0 top-5 z-10 flex items-center gap-2 px-3">
          {user.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(user.avatar_url, 100) ?? user.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full border border-[#E8D3B6]/60 p-0.5 object-cover" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-xs font-semibold text-white">
              {(user.full_name ?? "?").charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1"><span className="flex items-center gap-1 truncate text-[13px] font-semibold text-white drop-shadow">{isOwn ? "Your story" : user.full_name}<VerifiedBadge userId={user.user_id} size={13} /></span>{story ? <span className="text-[11px] text-white/75 drop-shadow"><RelativeTime dateTime={story.created_at} /></span> : null}</div>
          {story ? <button type="button" onClick={togglePlayback} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white focus-visible:outline-2 focus-visible:outline-white" aria-label={playbackPaused ? "Play story" : "Pause story"}>{playbackPaused ? <Play size={18} /> : <Pause size={18} />}</button> : null}
          {story?.media_type === "video" || storyAudioUrl ? <button type="button" onClick={() => setMuted(!muted)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white" aria-label={muted ? "Unmute story" : "Mute story"}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button> : null}
          <button type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white" aria-label="Close story"><X size={21} /></button>
        </div>

        {story ? (
          <>
            {/* Until the frame is actually decoded the viewer showed black,
                which reads as a broken story rather than a loading one. A
                shimmer holds the space and clears on the first frame. */}
            {!mediaReady && story.media_url ? (
              <span className="absolute inset-0 z-[1] animate-pulse bg-white/[0.06]" aria-hidden />
            ) : null}
            {story.media_type === "text" ? (() => { const sharedPhoto = story.stickers_json?.find(s => s.kind === "post" && s.postMediaType !== "video" && s.postMediaUrl)?.postMediaUrl; return sharedPhoto ? <div className="pointer-events-none absolute inset-0"><img src={sharedPhoto} alt="" className="h-full w-full scale-110 object-cover blur-2xl" /><div className="absolute inset-0 bg-black/50" /></div> : null; })() : null}
            {story.media_transform?.bg && story.media_transform?.fit === "contain" ? (
              <div className="pointer-events-none absolute inset-0 z-0"><BgLayer bg={story.media_transform.bg} mediaUrl={story.media_type === "image" ? story.media_url : null} /></div>
            ) : null}
            {story.media_type === "video" && story.media_url ? (
              <video
                ref={videoRef}
                key={story.id + "-" + mediaRetry}
                src={story.media_url}
                autoPlay={!playbackPaused && !callActive()}
                onPlay={() => { if (playbackPausedRef.current || document.hidden || callActive()) videoRef.current?.pause(); }}
                playsInline
                preload="auto"
                muted={muted}
                onLoadedData={onMediaReady}
                onError={() => { if (currentStoryRef.current === story.id) { readyStoryRef.current = null; setFailedStoryId(story.id); } }}
                onLoadedMetadata={(e) => { const m = (story.media_transform || {}) as StoryMediaTransform; try { (e.target as HTMLVideoElement).playbackRate = Number(m.speed) || 1; } catch {} const t0 = Number(m.trimStart) || 0; if (t0 > 0.05) { try { (e.target as HTMLVideoElement).currentTime = t0; } catch {} } }}
                onTimeUpdate={(e) => { const el = e.target as HTMLVideoElement; const m = (story.media_transform || {}) as StoryMediaTransform; setClock(el.currentTime); const t1 = Number(m.trimEnd) || 0; if (t1 > 0 && el.currentTime >= t1) advance(); }}
                className="h-full w-full object-contain"
                style={mediaStyle(story.media_transform)}
              />
            ) : story.media_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={story.id + "-" + mediaRetry}
                src={story.media_url}
                alt=""
                onLoad={onMediaReady}
                onError={() => { if (currentStoryRef.current === story.id) { readyStoryRef.current = null; setFailedStoryId(story.id); } }}
                className="h-full w-full"
                style={mediaStyle(story.media_transform)}
              />
            ) : null}
            {failedStoryId === story.id ? (
              <div role="alert" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center text-sm text-white">
                <p>This story’s media could not load.</p>
                <button className="rounded-full border border-white/50 px-4 py-2" onClick={() => void refreshCurrentMedia()}>Retry</button>
              </div>
            ) : null}
            <FilterOverlay filterId={story.filter_id} amt={story.media_transform?.filterAmt ?? 100} />
            <AdjustOverlay adjust={story.media_transform?.adjust || null} />
            <DrawSvg stickers={story.stickers_json} />
            <style dangerouslySetInnerHTML={{ __html: STICKER_ANIM_CSS }} />
            {storyAudioUrl ? (
              <audio onPlay={() => { if (playbackPausedRef.current || document.hidden || callActive()) audioRef.current?.pause(); }}
                onTimeUpdate={event => { const limit = Number(story.audio_duration_sec); if (limit > 0 && event.currentTarget.currentTime >= limit) event.currentTarget.currentTime = 0; }}
                onSeeking={event => { const limit = Number(story.audio_duration_sec); if (limit > 0 && event.currentTarget.currentTime >= limit) event.currentTarget.currentTime = 0; }}
                ref={audioRef} key={story.id + "-audio"} src={storyAudioUrl} loop muted={muted} onError={() => setFailedStoryId(story.id)} />
            ) : null}
            {storyAudioUrl && story.audio_title ? (
              <span className="absolute left-3 top-14 z-10 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-[11px] font-medium text-white">
                <Music size={11} /> {story.audio_title}
              </span>
            ) : null}
            {story.dual_front_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={story.dual_front_url} alt="" className="absolute bottom-20 left-3 z-[2] h-32 w-24 rounded-xl border-2 border-white/70 object-cover shadow-lg" />
            ) : null}
            {!isOwn && uid && storyMentions.some((m) => m.mentioned_user_id === uid && !m.visible) ? (
              <span className="absolute right-3 top-14 z-10 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-[11px] font-medium text-white"><AtSign size={11} /> Mentioned you</span>
            ) : null}
            {isOwn && storyMentions.length > 0 ? (
              <span title={storyMentions.map((m) => "@" + (m.username || "user") + (m.visible ? "" : " (hidden)")).join(", ")} className="absolute right-3 top-14 z-10 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-[11px] font-medium text-white"><AtSign size={11} /> {storyMentions.length} mentioned</span>
            ) : null}
            {poll ? <StoryPollCard poll={poll} isOwn={isOwn} onUpdate={setPoll} /> : null}
            {story.stickers_json && story.stickers_json.length > 0 ? (
              <StickerLayer key={uid + ":" + story.id} stickers={story.stickers_json} clock={story.media_type === "video" ? clock : null} storyId={story.id} isOwn={isOwn} paused={playbackPaused} />
            ) : null}
            {story.caption ? (
              <p className={"absolute inset-x-0 z-[2] px-4 text-center text-[15px] font-medium text-white drop-shadow " + (isOwn ? "bottom-28" : "bottom-20")}>{String(story.caption).split(/(@[A-Za-z0-9_.]{2,30})/g).map((part, i) => part.startsWith("@") ? <a key={i} href={"/" + part.slice(1)} onClick={(e) => e.stopPropagation()} className="font-extrabold underline">{part}</a> : <span key={i}>{part}</span>)}</p>
            ) : null}
            {heartBurst ? (
              <span key={heartBurst} className="pointer-events-none absolute inset-0 z-[6] flex items-center justify-center">
                <span style={{ animation: "heartpop 700ms ease-out forwards" }}>
                  <Heart size={72} className="fill-red-500 text-red-500 drop-shadow-lg" />
                </span>
              </span>
            ) : null}
          </>
        ) : (
          <div className="relative z-10 flex h-full flex-col items-center justify-center gap-3 text-sm text-white/70">
            <p role={storyLoadError ? "alert" : "status"}>{storyLoadError ? "Stories could not load. Check your connection and try again." : storyLoadFinished ? "This story is no longer available." : "Loading"}</p>
            {storyLoadError ? <button type="button" className="min-h-11 rounded-lg border border-white/30 px-4 py-2 text-white" onClick={() => setStoryLoadAttempt(n => n + 1)}>Try again</button> : null}
          </div>
        )}

        <button onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd} onPointerCancel={holdEnd} onClick={(event) => { const consumed = holdConsumedClickRef.current; holdConsumedClickRef.current = false; if (event.detail === 0 || !consumed) back(); }} className="absolute inset-y-0 left-0 z-[3] w-1/3" aria-label="Previous" />
        <div onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd} onPointerCancel={holdEnd} onDoubleClick={() => react(REACTION_EMOJIS[0])} className="absolute inset-y-0 left-1/3 z-[3] w-1/3" aria-hidden="true" />
        <button onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd} onPointerCancel={holdEnd} onClick={(event) => { const consumed = holdConsumedClickRef.current; holdConsumedClickRef.current = false; if (event.detail === 0 || !consumed) advance(); }} className="absolute inset-y-0 right-0 z-[3] w-1/3" aria-label="Next" />

        {canReply || canReact ? (
          <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-8">
            {canReply ? (
              <>
                <input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onFocus={pauseNow}
                  onBlur={() => { if (!replyText.trim()) resumeNow(); }}
                  onKeyDown={(e) => { if (e.key === "Enter") sendReply(); }}
                  placeholder={"Reply to " + (user.full_name?.split(" ")[0] ?? "them")}
                  className="min-w-0 flex-1 rounded-full border border-white/30 bg-black/30 px-4 py-2.5 text-[14px] text-white placeholder:text-white/50 outline-none focus:border-white/60"
                />
                {replyText.trim() ? (
                  <button onClick={sendReply} disabled={sendingReply} className="rounded-full bg-white p-2.5 text-ink" aria-label="Send reply"><Send size={16} /></button>
                ) : null}
              </>
            ) : <span className="flex-1" />}
            {canReact && !replyText.trim() ? (
              <>
                <button onClick={() => react(REACTION_EMOJIS[0])} className="rounded-full bg-black/30 p-2.5" aria-label="Love">
                  <Heart size={18} className={myReactions.has(REACTION_EMOJIS[0]) ? "fill-red-500 text-red-500" : "text-white"} />
                </button>
                <button onClick={() => { setEmojiOpen(!emojiOpen); overlayPausedRef.current = !emojiOpen; if (!emojiOpen) pauseNow(); else resumeNow(); }} className="rounded-full bg-black/30 p-2.5 text-white" aria-label="React">
                  <Smile size={18} />
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {emojiOpen && canReact ? (
          <div className="absolute inset-x-0 bottom-16 z-20 flex justify-center gap-2 px-3">
            {REACTION_EMOJIS.map((e) => (
              <button key={e} onClick={() => { react(e); setEmojiOpen(false); overlayPausedRef.current = false; resumeNow(); }} className={"rounded-full px-2.5 py-2 text-[22px] " + (myReactions.has(e) ? "bg-white/30" : "bg-black/40")}>{e}</button>
            ))}
          </div>
        ) : null}
        {replyToast ? (
          <span className="absolute inset-x-0 bottom-20 z-30 mx-auto w-fit rounded-full bg-white px-4 py-1.5 text-[12px] font-semibold text-ink">Reply sent</span>
        ) : null}

        {uid && story && uid === story.user_id ? <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#111518] via-[#111518]/75 to-transparent px-6 pb-3 pt-5">
          <button type="button" className="mb-2 flex min-h-6 items-center gap-2 text-[11px] text-white/65" onClick={openActivity} aria-label="Story views"><Eye size={13} />{story.views_count || 0} views</button>
          <div className="flex items-end justify-between">
            <button type="button" onClick={openActivity} className="flex min-h-14 min-w-16 flex-col items-center gap-1.5 text-[10px] text-white" aria-label="Story activity"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"><Eye size={21} /></span>Activity</button>
            <SaveToMemory story={story} triggerLabel="Keep" triggerClassName="flex min-h-14 min-w-16 flex-col items-center gap-1.5 rounded-none bg-transparent px-0 py-0 text-[10px] text-white [&_svg]:h-10 [&_svg]:w-10 [&_svg]:rounded-full [&_svg]:bg-white/10 [&_svg]:p-2.5" onOpenChange={open => { setMemoryOpen(open); overlayPausedRef.current = open || viewersOpen || moreOpen || emojiOpen || !!replyText.trim(); if (open) pauseNow(); else resumeNow(); }} />
            <button type="button" onClick={() => { setMoreOpen(true); overlayPausedRef.current = true; pauseNow(); }} className="flex min-h-14 min-w-16 flex-col items-center gap-1.5 text-[10px] text-white" aria-label="Story options"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"><MoreHorizontal size={21} /></span>More</button>
          </div>
        </div> : null}
        {moreOpen && isOwn && story ? <div className="absolute inset-0 z-30 flex items-end bg-black/30" onClick={closeMore}><section role="dialog" aria-modal="true" aria-label="Story settings" className="w-full rounded-t-[28px] bg-[#FBF9F5] p-5 text-[#0B1E3D]" onClick={e => e.stopPropagation()}>
          <div className="mx-auto mb-5 h-1 w-9 rounded-full bg-black/20" /><div className="mb-4 flex items-center"><Settings2 size={21} /><h2 className="ml-2 flex-1 text-lg font-semibold">Story settings</h2><button type="button" aria-label="Close story settings" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/5" onClick={closeMore}><X size={19} /></button></div>
          {([['allow_replies','Allow replies'],['allow_reactions','Allow reactions'],['allow_sharing','Allow sharing']] as const).map(([key,label]) => <button key={key} type="button" role="switch" aria-checked={story[key] !== false} disabled={settingsBusy} onClick={() => void updateStorySettings({ [key]: story[key] === false })} className="flex min-h-14 w-full items-center justify-between border-b border-black/5 text-sm disabled:opacity-50">{label}<span className={"flex h-7 w-12 items-center rounded-full p-1 transition-colors " + (story[key] !== false ? "justify-end bg-[#0B1E3D]" : "justify-start bg-[#d6d7d9]")}><span className="h-5 w-5 rounded-full bg-white" /></span></button>)}
          <button type="button" className="mt-3 flex min-h-12 w-full items-center gap-3 text-sm font-semibold" onClick={openActivity}><Eye size={19} />View story activity<ChevronRight size={18} className="ml-auto" /></button>
          <button type="button" className="flex min-h-12 w-full items-center gap-3 text-sm font-semibold text-[#AD4339]" onClick={() => void deleteCurrentStory()}><Trash2 size={19} />Delete story</button>
        </section></div> : null}
        {actionError ? <p role="alert" className="absolute inset-x-4 bottom-24 z-30 rounded-lg bg-black/80 px-3 py-2 text-center text-sm text-white">{actionError}</p> : null}
        {viewersOpen && story ? <ViewersSheet storyId={story.id} viewsCount={story.views_count} audience={story.audience} onSettings={() => { setViewersOpen(false); setMoreOpen(true); overlayPausedRef.current = true; }} onClose={() => { setViewersOpen(false); overlayPausedRef.current = false; resumeNow(); }} /> : null}
      </div>
    </div>
  );
}

type ActivityPerson = { user_id: string; full_name: string | null; username: string | null; avatar_url: string | null; viewed_at?: string; emoji?: string; created_at?: string };
function ViewersSheet({ storyId, viewsCount, audience, onClose, onSettings }: { storyId: string; viewsCount?: number; audience?: string | null; onClose: () => void; onSettings: () => void }) {
  const [people, setPeople] = useState<ActivityPerson[]>([]);
  const [reactions, setReactions] = useState<ActivityPerson[]>([]);
  const [tab, setTab] = useState<"viewers" | "reactions">("viewers");
  const [loading, setLoading] = useState(true);
  const [loadedAudience, setLoadedAudience] = useState<string | null>(audience || null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const client = createClient();
    setPeople([]); setReactions([]); setLoading(true); setError(false);
    void Promise.all([client.rpc("get_story_viewers", { p_story_id: storyId }), client.rpc("get_story_reactions", { p_story_id: storyId }), client.from("stories").select("audience").eq("id", storyId).maybeSingle()]).then(([views, reacted, settings]) => {
      if (cancelled) return;
      if (views.error || reacted.error) throw views.error || reacted.error;
      setPeople((views.data || []) as ActivityPerson[]); setReactions((reacted.data || []) as ActivityPerson[]); setLoadedAudience(settings.error ? null : settings.data?.audience || null);
    }).catch(() => { if (!cancelled) setError(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [storyId, attempt]);
  const audienceLabel = ({ everyone: "Everyone", followers: "Followers", close_friends: "Close friends", only_with: "Selected", except: "Custom" } as Record<string, string>)[loadedAudience || ""] || (loadedAudience ? "Custom" : "—");
  const reactionMap = new Map<string, ActivityPerson & { emojis: string[] }>();
  reactions.forEach(person => { const current = reactionMap.get(person.user_id); if (current) { if (person.emoji) current.emojis.push(person.emoji); } else reactionMap.set(person.user_id, { ...person, emojis: person.emoji ? [person.emoji] : [] }); });
  const rows = tab === "viewers" ? people : [...reactionMap.values()];
  return <div className="absolute inset-0 z-30 flex items-end bg-black/30" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label="Story activity" className="max-h-[78%] w-full overflow-y-auto rounded-t-[28px] bg-[#FBF9F5] px-5 pb-5 pt-3 text-[#0B1E3D]" onClick={e => e.stopPropagation()}>
      <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-black/20" /><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold tracking-tight">Story activity</h2><button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/5" aria-label="Close story activity"><X size={20} /></button></div>
      <div className="mb-5 grid grid-cols-3 gap-2">{[{ icon: Eye, value: viewsCount ?? people.length, label: "Views" }, { icon: Heart, value: reactions.length, label: "Reactions" }, { icon: Globe2, value: audienceLabel, label: "Audience" }].map(stat => <div key={stat.label} className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl bg-[#F0EDE7] px-1 py-3 text-center"><stat.icon size={16} /><strong className="text-sm">{loading && stat.label === "Reactions" ? "—" : stat.value}</strong><span className="text-[10px] text-[#78808a]">{stat.label}</span></div>)}</div>
      <div role="tablist" aria-label="Story activity" className="mb-3 flex border-b border-[#dedbd6]">{([['viewers','Viewers'],['reactions','Reactions']] as const).map(([key,label]) => <button type="button" role="tab" aria-selected={tab === key} key={key} onClick={() => setTab(key)} className={"min-h-11 flex-1 border-b-2 text-sm font-semibold " + (tab === key ? "border-[#0B1E3D] text-[#0B1E3D]" : "border-transparent text-[#8c929a]")}>{label}</button>)}</div>
      {loading ? <p role="status" className="py-8 text-center text-sm text-[#78808a]">Loading activity…</p> : error ? <div role="alert" className="py-6 text-center text-sm text-[#78808a]">Activity could not load.<button type="button" className="mx-auto mt-3 block min-h-11 rounded-full bg-[#0B1E3D] px-5 text-xs font-semibold text-white" onClick={() => setAttempt(n => n + 1)}>Try again</button></div> : !rows.length ? <p className="py-8 text-center text-sm text-[#78808a]">{tab === "viewers" ? "No views yet." : "No reactions yet."}</p> : rows.map(person => <div key={person.user_id} className="flex min-h-16 items-center gap-3 border-b border-black/5 py-2">
        {person.avatar_url ?
          // eslint-disable-next-line @next/next/no-img-element
          <img src={displayImageUrl(person.avatar_url, 100) ?? person.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E8DDCA] text-sm font-semibold">{(person.full_name || person.username || "?").charAt(0)}</span>}
        <div className="min-w-0 flex-1"><p className="flex items-center gap-1 text-sm font-semibold">{person.username ? <a href={"/" + person.username} className="truncate">{person.full_name || person.username}</a> : person.full_name || "Member"}<VerifiedBadge userId={person.user_id} size={12} /></p>{person.username ? <p className="truncate text-xs text-[#8b9199]">@{person.username}</p> : null}</div><span className="text-lg">{reactionMap.get(person.user_id)?.emojis.join("")}</span>
      </div>)}
      <button type="button" onClick={onSettings} className="mt-5 flex min-h-12 w-full items-center gap-3 text-sm font-semibold"><Settings2 size={21} />Story settings<ChevronRight size={20} className="ml-auto" /></button>
    </section>
  </div>;
}
