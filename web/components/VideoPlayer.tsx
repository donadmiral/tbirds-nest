"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, RotateCcw, RotateCw, Maximize, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// One video plays at a time, mute preference persists across the session,
// and views report the phone's dwell contract: record_video_view once per
// session, seconds capped at sixty, server counts past three.
let activeStop: (() => void) | null = null;
let mutedPref = true;
const viewSession = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());

export function VideoPlayer({ src, postId, viewsCount }: { src: string; postId: string; viewsCount?: number | null }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dwellStart = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(mutedPref);
  const [progress, setProgress] = useState(0);

  const reportDwell = useCallback(async () => {
    const start = dwellStart.current;
    dwellStart.current = null;
    if (!start) return;
    const seconds = Math.min(Math.round((Date.now() - start) / 1000), 60);
    if (seconds < 1) return;
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return;
    supabase.rpc("record_video_view", { p_post_id: postId, p_viewer_id: uid, p_session: viewSession, p_duration: seconds }).then(() => {}, () => {});
  }, [postId]);

  const stop = useCallback(() => {
    ref.current?.pause();
    setPlaying(false);
    reportDwell();
  }, [reportDwell]);

  function playNow() {
    if (activeStop && activeStop !== stop) activeStop();
    activeStop = stop;
    const v = ref.current;
    if (!v) return;
    v.muted = muted;
    v.play().then(() => {
      setPlaying(true);
      if (!dwellStart.current) dwellStart.current = Date.now();
    }, () => {});
  }

  // Autoplay muted when mostly visible, stop when leaving the viewport.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      if (e.intersectionRatio >= 0.6) {
        if (ref.current?.paused) playNow();
      } else if (!ref.current?.paused) {
        stop();
      }
    }, { threshold: [0, 0.6] });
    io.observe(el);
    return () => { io.disconnect(); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMute(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !muted;
    mutedPref = next;
    setMuted(next);
    if (ref.current) ref.current.muted = next;
  }

  function seekBy(delta: number, e: React.MouseEvent) {
    e.stopPropagation();
    const v = ref.current;
    if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
  }

  function scrub(e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation();
    const v = ref.current;
    if (!v || !v.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = ((e.clientX - r.left) / r.width) * v.duration;
  }

  function fullscreen(e: React.MouseEvent) {
    e.stopPropagation();
    wrapRef.current?.requestFullscreen?.();
  }

  const btn = "rounded-full bg-ink/60 p-1.5 text-white transition-colors hover:bg-ink/80";

  return (
    <div ref={wrapRef} className="group relative overflow-hidden rounded-lg bg-black">
      <video ref={ref}
        src={src}
        playsInline
        preload="metadata"
        onClick={(e) => { e.stopPropagation(); if (ref.current?.paused) playNow(); else stop(); }}
        onTimeUpdate={() => { const v = ref.current; if (v?.duration) setProgress(v.currentTime / v.duration); }}
        onEnded={() => stop()}
        className="max-h-[480px] w-full object-contain"
      />
      {typeof viewsCount === "number" && viewsCount > 0 ? (
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-ink/60 px-1.5 py-0.5 text-[11px] text-white">
          <Eye size={12} /> {viewsCount >= 1000 ? (viewsCount / 1000).toFixed(1).replace(/\.0$/, "") + "K" : viewsCount}
        </span>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <div onClick={scrub} className="h-1.5 w-full cursor-pointer overflow-hidden rounded-full bg-white/25">
          <div className="h-full bg-pearl" style={{ width: progress * 100 + "%" }} />
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={(e) => { e.stopPropagation(); if (ref.current?.paused) playNow(); else stop(); }} title={playing ? "Pause" : "Play"} className={btn}>
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button onClick={(e) => seekBy(-10, e)} title="Back 10 seconds" className={btn}><RotateCcw size={15} /></button>
          <button onClick={(e) => seekBy(10, e)} title="Forward 10 seconds" className={btn}><RotateCw size={15} /></button>
          <button onClick={toggleMute} title={muted ? "Unmute" : "Mute"} className={btn}>
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <button onClick={fullscreen} title="Fullscreen" className={btn + " ml-auto"}><Maximize size={15} /></button>
        </div>
      </div>
    </div>
  );
}