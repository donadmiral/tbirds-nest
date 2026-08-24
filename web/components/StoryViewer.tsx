"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Volume2, VolumeX, Eye, Trash2, Music } from "lucide-react";
import { getUserStories, markStoryViewed, STORY_FILTERS, type CatchupUser, type StoryRow, type StoryMediaTransform } from "@/lib/stories";
import { timeAgo } from "@/lib/feed";
import { SaveToMemory } from "@/components/SaveToMemory";
import { createClient } from "@/lib/supabase/client";

const IMAGE_DURATION_MS = 5000;
const MAX_AUDIO_MS = 30000;

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

function mediaStyle(mt: StoryMediaTransform | null | undefined): React.CSSProperties {
  if (!mt || typeof mt !== "object") return { objectFit: "contain" };
  const hasMove = (mt.scale && mt.scale !== 1) || mt.translateNX !== 0 || mt.translateNY !== 0;
  const style: React.CSSProperties = { objectFit: mt.fit === "contain" ? "contain" : "cover" };
  if (hasMove) {
    style.transform = "translate(" + ((mt.translateNX || 0) * 100) + "%, " + ((mt.translateNY || 0) * 100) + "%) scale(" + (mt.scale || 1) + ")";
  }
  return style;
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
  const user = users[userIdx];
  const story = stories[itemIdx];
  const storyAudioUrl = story && story.media_type !== "video" ? (story.audio_url ?? null) : null;

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

  const holdStart = useCallback(() => {
    holdRef.current = setTimeout(() => {
      heldRef.current = true;
      pausedAtRef.current = (Date.now() - startedAt.current) / durRef.current;
      stopTimer();
      videoRef.current?.pause();
      audioRef.current?.pause();
    }, 200);
  }, [stopTimer]);

  const holdEnd = useCallback(() => {
    if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; }
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
            <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-xs font-semibold text-porcelain">
              {(user.full_name ?? "?").charAt(0).toUpperCase()}
            </span>
          )}
          <span className="text-[13px] font-semibold text-white drop-shadow">{user.full_name}</span>
          {story ? <span className="text-[12px] text-white/70 drop-shadow">{timeAgo(story.created_at)}</span> : null}
        </div>

        {story ? (
          <>
            {story.media_type === "video" && story.media_url ? (
              <video ref={videoRef} key={story.id} src={story.media_url} autoPlay playsInline muted={muted} className="h-full w-full object-contain" />
            ) : story.media_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={story.id} src={story.media_url} alt="" className="h-full w-full" style={mediaStyle(story.media_transform)} />
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
            {story.caption ? (
              <p className="absolute inset-x-0 bottom-6 z-[2] px-4 text-center text-[15px] font-medium text-white drop-shadow">{story.caption}</p>
            ) : null}
          </>
        ) : (
          <p className="flex h-full items-center justify-center text-sm text-white/50">Loading</p>
        )}

        {story ? <SaveToMemory story={story} /> : null}
        <button onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd} onClick={() => { if (!heldRef.current) back(); }} className="absolute inset-y-0 left-0 z-[3] w-1/3" aria-label="Previous" />
        <button onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd} onClick={() => { if (!heldRef.current) advance(); }} className="absolute inset-y-0 right-0 z-[3] w-1/3" aria-label="Next" />
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