"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import { X, ChevronLeft, ChevronRight, Volume2, VolumeX, Eye, Trash2, Music, Heart, Smile, Send } from "lucide-react";
import { getUserStories, markStoryViewed, toggleStoryReaction, getMyStoryReactions, STORY_FILTERS, REACTION_EMOJIS, type CatchupUser, type StoryRow, type StoryMediaTransform, type StoryTextSticker } from "@/lib/stories";
import { timeAgo } from "@/lib/feed";
import { SaveToMemory } from "@/components/SaveToMemory";
import { createClient } from "@/lib/supabase/client";

const IMAGE_DURATION_MS = 5000;
const MAX_AUDIO_MS = 30000;

function isColorLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return false;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

function stickerCss(st: StoryTextSticker): React.CSSProperties {
  const fs = st.fontSizeOverride || 28;
  const pill = !!st.bgEnabled && st.style !== "highlight";
  const base: React.CSSProperties = { fontSize: fs, fontWeight: 700, color: st.color, lineHeight: 1.25, whiteSpace: "pre-wrap", textAlign: st.textAlign || "center" };
  if (pill) {
    return { ...base, background: st.color, color: isColorLight(st.color) ? "#000000" : "#FFFFFF", padding: "6px 12px", borderRadius: 20 };
  }
  switch (st.style) {
    case "bold": return { ...base, fontWeight: 800, letterSpacing: -0.5, textShadow: "0 2px 4px rgba(0,0,0,0.35)" };
    case "typewriter": return { ...base, fontWeight: 400, fontFamily: "ui-monospace, monospace", letterSpacing: 0.5, background: "rgba(0,0,0,0.55)", padding: "6px 10px", borderRadius: 6 };
    case "neon": return { ...base, fontWeight: 800, textShadow: "0 0 14px " + st.color + ", 0 0 26px " + st.color };
    case "highlight": return { ...base, background: st.color, color: isColorLight(st.color) ? "#000000" : "#FFFFFF", padding: "4px 10px", borderRadius: 8, boxDecorationBreak: "clone" as const, WebkitBoxDecorationBreak: "clone" as const };
    case "outline": return { ...base, color: "#FFFFFF", WebkitTextStroke: "1.5px " + st.color } as React.CSSProperties;
    case "shadow3d": return { ...base, fontWeight: 800, textShadow: "2px 2px 0 rgba(0,0,0,0.5), 4px 4px 0 rgba(0,0,0,0.25)" };
    case "retro": return { ...base, letterSpacing: 1, textShadow: "2px 2px 0 rgba(0,0,0,0.6)" };
    case "script": return { ...base, fontFamily: "Georgia, serif", fontStyle: "italic", fontWeight: 400 };
    default: return { ...base, textShadow: "0 1px 3px rgba(0,0,0,0.45)" };
  }
}

function StickerLayer({ stickers }: { stickers: StoryTextSticker[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[2]">
      {stickers.map((st) => {
        const pos: React.CSSProperties = { position: "absolute", left: (st.nx * 100) + "%", top: (st.ny * 100) + "%", transform: "translate(-50%, -50%) rotate(" + (st.rotation || 0) + "rad) scale(" + (st.scale || 1) + ")", opacity: st.opacity ?? 1, maxWidth: "82%" };
        const kind = st.kind || "text";
        if (kind === "text" || kind === "emoji") {
          return <div key={st.id} style={{ ...pos, ...stickerCss(st) }}>{st.text}</div>;
        }
        const pillCls = "pointer-events-auto inline-flex max-w-full items-center gap-1 truncate rounded-full bg-black/55 px-3 py-1.5 text-[12px] font-semibold text-white";
        if (kind === "link" && st.url) {
          return <a key={st.id} href={st.url} target="_blank" rel="noopener noreferrer" style={pos} className={pillCls}>{"\uD83D\uDD17 "}{st.text || st.url}</a>;
        }
        if (kind === "mention" && st.mentionUsername) {
          return <a key={st.id} href={"/" + st.mentionUsername} style={pos} className={pillCls}>@{st.mentionUsername}</a>;
        }
        if (kind === "hashtag" && st.hashtag) {
          return <a key={st.id} href={"/topic/" + encodeURIComponent(st.hashtag)} style={pos} className={pillCls}>#{st.hashtag}</a>;
        }
        if (kind === "location") {
          return <span key={st.id} style={pos} className={pillCls}>{"\uD83D\uDCCD "}{st.locationDisplayName || st.locationName || st.text}</span>;
        }
        if (kind === "post" && st.postId) {
          return (
            <a key={st.id} href={"/post/" + st.postId} style={{ ...pos, maxWidth: 260 }} className="pointer-events-auto block rounded-xl bg-black/60 p-3 text-white">
              <span className="block text-[12px] font-semibold">{st.postAuthorName || "Post"}</span>
              <span className="mt-0.5 block max-h-16 overflow-hidden text-[12px] text-white/80">{st.postText || "View post"}</span>
            </a>
          );
        }
        if (kind === "question" || kind === "slider" || kind === "quiz") {
          const label = st.questionPrompt || st.sliderLabel || st.quizQuestion || st.text;
          return <span key={st.id} style={pos} className="inline-flex max-w-full items-center rounded-xl bg-porcelain px-4 py-2.5 text-[13px] font-semibold text-ink">{(kind === "slider" && st.sliderEmoji ? st.sliderEmoji + " " : "") + label}</span>;
        }
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

function FilterOverlay({ filterId }: { filterId: string | null | undefined }) {
  if (!filterId) return null;
  const f = STORY_FILTERS.find((x) => x.id === filterId);
  if (!f) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[1]">
      {f.layers.map((l, i) => (
        <div key={i} className="pointer-events-none absolute inset-0" style={{ backgroundColor: l.color, opacity: l.opacity }} />
      ))}
    </div>
  );
}

export function StoryViewer({ users, startIndex, onClose }: {
  users: CatchupUser[];
  startIndex: number;
  onClose: () => void;
}) {
  const [userIdx, setUserIdx] = useState(startIndex);
  const [stories, setStories] = useState<StoryRow[]>([]);
  const [itemIdx, setItemIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const durRef = useRef(IMAGE_DURATION_MS);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldRef = useRef(false);
  const pausedAtRef = useRef(0);
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set());
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [heartBurst, setHeartBurst] = useState(0);
  const [mediaReady, setMediaReady] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyToast, setReplyToast] = useState(false);
  const user = users[userIdx];
  const story = stories[itemIdx];

  // Reset on every advance, otherwise the previous story's ready flag hides the
  // shimmer for the next one and it flashes black again.
  useEffect(() => { setMediaReady(false); }, [story?.id]);

  // Preload the next frame while this one is on screen. A story lasts several
  // seconds; using that time is the difference between instant and a stall at
  // every tap.
  useEffect(() => {
    const next = stories[itemIdx + 1];
    if (!next?.media_url) return;
    if (next.media_type === "video") {
      const v = document.createElement("video");
      v.preload = "auto";
      v.src = next.media_url;
    } else {
      const img = new Image();
      img.src = next.media_url;
    }
  }, [stories, itemIdx]);
  const storyAudioUrl = story && story.media_type !== "video" ? (story.audio_url ?? null) : null;
  const isOwn = !!(uid && story && uid === story.user_id);
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
    stopTimer();
    if (itemIdx > 0) setItemIdx(itemIdx - 1);
    else if (userIdx > 0) { setUserIdx(userIdx - 1); setItemIdx(0); }
  }, [itemIdx, userIdx, stopTimer]);

  const pauseNow = useCallback(() => {
    if (heldRef.current) return;
    heldRef.current = true;
    pausedAtRef.current = (Date.now() - startedAt.current) / durRef.current;
    stopTimer();
    videoRef.current?.pause();
    audioRef.current?.pause();
  }, [stopTimer]);

  const resumeNow = useCallback(() => {
    if (!heldRef.current) return;
    startedAt.current = Date.now() - pausedAtRef.current * durRef.current;
    timerRef.current = setInterval(() => {
      const p = (Date.now() - startedAt.current) / durRef.current;
      if (p >= 1) advance();
      else setProgress(p);
    }, 50);
    videoRef.current?.play().catch(() => {});
    audioRef.current?.play().catch(() => {});
    setTimeout(() => { heldRef.current = false; }, 60);
  }, [advance]);

  const holdStart = useCallback(() => {
    holdRef.current = setTimeout(() => { pauseNow(); }, 200);
  }, [pauseNow]);

  const holdEnd = useCallback(() => {
    if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; }
    if (!heldRef.current) return;
    resumeNow();
  }, [resumeNow]);

  const react = useCallback(async (emoji: string) => {
    if (!story || !canReact) return;
    const had = myReactions.has(emoji);
    const next = new Set(myReactions);
    if (had) next.delete(emoji); else next.add(emoji);
    setMyReactions(next);
    if (!had && emoji === REACTION_EMOJIS[0]) { setHeartBurst(Date.now()); setTimeout(() => setHeartBurst(0), 900); }
    const res = await toggleStoryReaction(story.id, emoji);
    if (res) {
      const synced = new Set(myReactions);
      if (res.reacted) synced.add(emoji); else synced.delete(emoji);
      setMyReactions(synced);
    } else {
      setMyReactions(myReactions);
    }
  }, [story, canReact, myReactions]);

  const sendReply = useCallback(async () => {
    if (!story || !uid || !canReply) return;
    const trimmed = replyText.trim();
    if (!trimmed || sendingReply) return;
    setSendingReply(true);
    try {
      const supabase = createClient();
      const ownerId = story.user_id;
      const sorted = [uid, ownerId].sort();
      const messageText = "Replied to your story:\n" + trimmed;
      const { data: existing } = await supabase.from("conversations").select("id")
        .or("and(user_1.eq." + uid + ",user_2.eq." + ownerId + "),and(user_1.eq." + ownerId + ",user_2.eq." + uid + ")")
        .eq("type", "direct").eq("is_group", false).maybeSingle();
      let convId = existing?.id as string | undefined;
      if (!convId) {
        const { data: created } = await supabase.from("conversations")
          .insert({ user_1: sorted[0], user_2: sorted[1], last_message: "", last_message_time: new Date().toISOString() })
          .select("id").single();
        convId = created?.id;
      }
      if (!convId) { setSendingReply(false); return; }
      const { error: msgErr } = await supabase.from("messages")
        .insert({ conversation_id: convId, sender_id: uid, receiver_id: ownerId, text: messageText });
      if (!msgErr) {
        await supabase.from("conversations").update({ last_message: messageText, last_message_time: new Date().toISOString() }).eq("id", convId);
        setReplyText("");
        setReplyToast(true);
        setTimeout(() => setReplyToast(false), 2000);
      }
    } finally {
      setSendingReply(false);
      resumeNow();
    }
  }, [story, uid, canReply, replyText, sendingReply, resumeNow]);

  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => setUid(data.session?.user.id ?? null));
  }, []);

  useEffect(() => {
    if (!user) return;
    let off = false;
    getUserStories(user.user_id).then((rows) => {
      if (off) return;
      setStories(rows);
      setItemIdx(0);
    });
    return () => { off = true; };
  }, [user]);

  useEffect(() => {
    setEmojiOpen(false);
    if (!story || !uid || uid === story.user_id) { setMyReactions(new Set()); return; }
    let off = false;
    getMyStoryReactions(story.id).then((emojis) => { if (!off) setMyReactions(new Set(emojis)); });
    return () => { off = true; };
  }, [story?.id, uid]);

  useEffect(() => {
    if (!story) return;
    markStoryViewed(story.id);
    setProgress(0);
    stopTimer();
    const isVideo = story.media_type === "video";
    let dur = isVideo
      ? Math.max(1000, (story.duration_sec ?? 10) * 1000)
      : IMAGE_DURATION_MS;
    if (!isVideo && story.audio_url && story.audio_duration_sec && story.audio_duration_sec > 0) {
      dur = Math.min(Math.max(dur, story.audio_duration_sec * 1000), MAX_AUDIO_MS);
    }
    durRef.current = dur;
    startedAt.current = Date.now();
    timerRef.current = setInterval(() => {
      const p = (Date.now() - startedAt.current) / durRef.current;
      if (p >= 1) advance();
      else setProgress(p);
    }, 50);
    audioRef.current?.play().catch(() => {});
    return stopTimer;
  }, [story, advance, stopTimer]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") advance();
      if (e.key === "ArrowLeft") back();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, back, onClose]);

  if (!user) return null;

  const bg = typeof story?.text_background === "object" && story?.text_background?.colors?.length
    ? "linear-gradient(135deg, " + story.text_background.colors.join(", ") + ")"
    : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
      <style>{"@keyframes heartpop { 0% { transform: scale(0.3); opacity: 0; } 30% { transform: scale(1.18); opacity: 1; } 70% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.05); opacity: 0; } }"}</style>
      <button onClick={onClose} className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" title="Close">
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

      <div className="relative aspect-[9/16] h-[92vh] max-w-[94vw] overflow-hidden rounded-xl bg-ink" style={bg ? { background: bg } : undefined}>
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
            <img src={displayImageUrl(user.avatar_url, 100) ?? user.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-xs font-semibold text-white">
              {(user.full_name ?? "?").charAt(0).toUpperCase()}
            </span>
          )}
          <span className="text-[13px] font-semibold text-white drop-shadow">{user.full_name}</span>
          {story ? <span className="text-[12px] text-white/70 drop-shadow">{timeAgo(story.created_at)}</span> : null}
        </div>

        {story ? (
          <>
            {/* Until the frame is actually decoded the viewer showed black,
                which reads as a broken story rather than a loading one. A
                shimmer holds the space and clears on the first frame. */}
            {!mediaReady && story.media_url ? (
              <span className="absolute inset-0 z-[1] animate-pulse bg-white/[0.06]" aria-hidden />
            ) : null}
            {story.media_type === "video" && story.media_url ? (
              <video
                ref={videoRef}
                key={story.id}
                src={story.media_url}
                autoPlay
                playsInline
                preload="auto"
                muted={muted}
                onLoadedData={() => setMediaReady(true)}
                className="h-full w-full object-contain"
              />
            ) : story.media_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={story.id}
                src={story.media_url}
                alt=""
                onLoad={() => setMediaReady(true)}
                onError={() => setMediaReady(true)}
                className="h-full w-full"
                style={mediaStyle(story.media_transform)}
              />
            ) : null}
            <FilterOverlay filterId={story.filter_id} />
            {storyAudioUrl ? (
              <audio ref={audioRef} key={story.id + "-audio"} src={storyAudioUrl} autoPlay muted={muted} />
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
            {story.stickers_json && story.stickers_json.length > 0 ? (
              <StickerLayer stickers={story.stickers_json} />
            ) : null}
            {story.caption ? (
              <p className="absolute inset-x-0 bottom-20 z-[2] px-4 text-center text-[15px] font-medium text-white drop-shadow">{story.caption}</p>
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
          <p className="flex h-full items-center justify-center text-sm text-white/50">Loading</p>
        )}

        {story ? <SaveToMemory story={story} /> : null}
        <button onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd} onClick={() => { if (!heldRef.current) back(); }} className="absolute inset-y-0 left-0 z-[3] w-1/3" aria-label="Previous" />
        <button onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd} onDoubleClick={() => react(REACTION_EMOJIS[0])} className="absolute inset-y-0 left-1/3 z-[3] w-1/3" aria-label="Pause" />
        <button onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd} onClick={() => { if (!heldRef.current) advance(); }} className="absolute inset-y-0 right-0 z-[3] w-1/3" aria-label="Next" />

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
                <button onClick={() => { setEmojiOpen(!emojiOpen); if (!emojiOpen) pauseNow(); else resumeNow(); }} className="rounded-full bg-black/30 p-2.5 text-white" aria-label="React">
                  <Smile size={18} />
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {emojiOpen && canReact ? (
          <div className="absolute inset-x-0 bottom-16 z-20 flex justify-center gap-2 px-3">
            {REACTION_EMOJIS.map((e) => (
              <button key={e} onClick={() => { react(e); setEmojiOpen(false); resumeNow(); }} className={"rounded-full px-2.5 py-2 text-[22px] " + (myReactions.has(e) ? "bg-white/30" : "bg-black/40")}>{e}</button>
            ))}
          </div>
        ) : null}
        {replyToast ? (
          <span className="absolute inset-x-0 bottom-20 z-30 mx-auto w-fit rounded-full bg-white px-4 py-1.5 text-[12px] font-semibold text-ink">Reply sent</span>
        ) : null}

        <div className="absolute right-2 top-12 z-20 flex flex-col gap-2">
          {story?.media_type === "video" || storyAudioUrl ? (
            <button onClick={() => setMuted(!muted)} className="rounded-full bg-black/40 p-2 text-white" aria-label="Mute">
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
          ) : null}
          {uid && story && uid === story.user_id ? (
            <>
              <button onClick={() => { setViewersOpen(true); }} className="rounded-full bg-black/40 p-2 text-white" title="Viewers"><Eye size={15} /></button>
              <button onClick={async () => {
                if (!confirm("Delete this story everywhere?")) return;
                await createClient().from("stories").delete().eq("id", story.id);
                const rest = stories.filter((s) => s.id !== story.id);
                setStories(rest);
                if (rest.length === 0) nextUser(); else setItemIdx(Math.min(itemIdx, rest.length - 1));
              }} className="rounded-full bg-black/40 p-2 text-white" title="Delete story"><Trash2 size={15} /></button>
            </>
          ) : null}
        </div>
        {viewersOpen && story ? <ViewersSheet storyId={story.id} onClose={() => setViewersOpen(false)} /> : null}
      </div>
    </div>
  );
}

function ViewersSheet({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const [people, setPeople] = useState<{ id: string; full_name: string | null; username: string | null; avatar_url: string | null }[]>([]);
  useEffect(() => {
    const supabase = createClient();
    supabase.from("story_views").select("user_id").eq("story_id", storyId).then(async ({ data }) => {
      const ids = (data ?? []).map((r) => r.user_id);
      if (ids.length === 0) { setPeople([]); return; }
      const { data: profs } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", ids);
      setPeople(profs ?? []);
    });
  }, [storyId]);
  return (
    <div className="absolute inset-x-0 bottom-0 z-30 max-h-[55%] overflow-y-auto rounded-t-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[14px] font-semibold text-ink">Viewers · {people.length}</p>
        <button onClick={onClose} className="rounded-full p-1.5 text-ink/50" aria-label="Close"><X size={16} /></button>
      </div>
      {people.length === 0 ? <p className="py-6 text-center text-[13px] text-ink/40">No views yet.</p> : people.map((p) => (
        <div key={p.id} className="flex items-center gap-2.5 py-1.5">
          {p.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pearl text-[12px] font-semibold text-ink">{(p.full_name ?? "?").charAt(0)}</span>}
          <span className="text-[13px] text-ink">{p.full_name} <span className="text-ink/40">@{p.username}</span></span>
        </div>
      ))}
    </div>
  );
}