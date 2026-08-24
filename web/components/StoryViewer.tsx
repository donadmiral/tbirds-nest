"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { getUserStories, markStoryViewed, type CatchupUser, type StoryRow } from "@/lib/stories";
import { timeAgo } from "@/lib/feed";
import { SaveToMemory } from "@/components/SaveToMemory";

const IMAGE_DURATION_MS = 5000;

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
  const user = users[userIdx];
  const story = stories[itemIdx];

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
    durRef.current = isVideo
      ? Math.max(1000, (story.duration_sec ?? 10) * 1000)
      : IMAGE_DURATION_MS;
    startedAt.current = Date.now();
    timerRef.current = setInterval(() => {
      const p = (Date.now() - startedAt.current) / durRef.current;
      if (p >= 1) advance();
      else setProgress(p);
    }, 50);
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
              <video ref={videoRef} key={story.id} src={story.media_url} autoPlay playsInline className="h-full w-full object-contain" />
            ) : story.media_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={story.id} src={story.media_url} alt="" className="h-full w-full object-contain" />
            ) : null}
            {story.dual_front_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={story.dual_front_url} alt="" className="absolute bottom-20 left-3 h-32 w-24 rounded-xl border-2 border-white/70 object-cover shadow-lg" />
            ) : null}
            {story.caption ? (
              <p className="absolute inset-x-0 bottom-6 px-4 text-center text-[15px] font-medium text-white drop-shadow">{story.caption}</p>
            ) : null}
          </>
        ) : (
          <p className="flex h-full items-center justify-center text-sm text-white/50">Loading</p>
        )}

        {story ? <SaveToMemory story={story} /> : null}
        <button onClick={back} className="absolute inset-y-0 left-0 w-1/3" aria-label="Previous" />
        <button onClick={advance} className="absolute inset-y-0 right-0 w-1/3" aria-label="Next" />
      </div>
    </div>
  );
}