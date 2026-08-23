"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, RotateCcw, RotateCw, Maximize, Minimize, Eye, Gauge } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

let activeStop: (() => void) | null = null;
let mutedPref = true;
const viewSession = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

export function VideoPlayer({ src, postId, viewsCount }: { src: string; postId: string; viewsCount?: number | null }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dwellStart = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(mutedPref);
  const [progress, setProgress] = useState(0);
  const [fs, setFs] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [speedMenu, setSpeedMenu] = useState(false);
  const [unplayable, setUnplayable] = useState(false);
  const [portrait, setPortrait] = useState(false);

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

  const playNow = useCallback(() => {
    if (activeStop && activeStop !== stop) activeStop();
    activeStop = stop;
    const v = ref.current;
    if (!v) return;
    v.muted = muted;
    v.play().then(() => {
      setPlaying(true);
      if (!dwellStart.current) dwellStart.current = Date.now();
    }, () => {});
  }, [muted, stop]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      if (document.fullscreenElement === el) return;
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

  useEffect(() => {
    function onFsChange() { setFs(document.fullscreenElement === wrapRef.current); }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  function togglePlay() {
    if (ref.current?.paused) playNow();
    else stop();
  }

  function toggleMute() {
    const next = !muted;
    mutedPref = next;
    setMuted(next);
    if (ref.current) ref.current.muted = next;
  }

  function seekBy(delta: number) {
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

  function toggleFullscreen() {
    if (document.fullscreenElement === wrapRef.current) document.exitFullscreen?.();
    else wrapRef.current?.requestFullscreen?.();
  }

  function pickSpeed(s: number) {
    setSpeed(s);
    setSpeedMenu(false);
    if (ref.current) ref.current.playbackRate = s;
  }

  function onKey(e: React.KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") { e.preventDefault(); togglePlay(); }
    else if (k === "m") { e.preventDefault(); toggleMute(); }
    else if (k === "f") { e.preventDefault(); toggleFullscreen(); }
    else if (k === "arrowleft") { e.preventDefault(); seekBy(-10); }
    else if (k === "arrowright") { e.preventDefault(); seekBy(10); }
  }

  const btn = "rounded-full bg-ink/60 p-1.5 text-white transition-colors hover:bg-ink/80";

  return (
    <div ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKey}
      onClick={() => wrapRef.current?.focus()}
      className={"group relative overflow-hidden bg-black outline-none " + (fs ? "flex h-full w-full items-center justify-center" : "rounded-lg")}
    >
      <video ref={ref}
        src={src}
        playsInline
        preload="metadata"
        onClick={(e) => { e.stopPropagation(); wrapRef.current?.focus(); togglePlay(); }}
        onTimeUpdate={() => {
          const v = ref.current;
          if (!v) return;
          if (v.duration) setProgress(v.currentTime / v.duration);
          if (!unplayable && !v.paused && v.currentTime > 1.2) {
            const q = (v as HTMLVideoElement & { getVideoPlaybackQuality?: () => { totalVideoFrames: number } }).getVideoPlaybackQuality?.();
            const decoded = q ? q.totalVideoFrames : (v as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount;
            if (typeof decoded === "number" && decoded === 0) setUnplayable(true);
          }
        }}
        onEnded={() => stop()}
        onError={() => setUnplayable(true)}
        onLoadedMetadata={() => { const v = ref.current; if (!v) return; if (v.videoWidth === 0) setUnplayable(true); else setPortrait(v.videoHeight > v.videoWidth); }}
        className={fs ? "h-full max-h-none w-full object-contain" : portrait ? "mx-auto block h-[560px] w-auto max-w-full object-contain" : "max-h-[480px] w-full object-contain"}
      />
      {unplayable ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/80 px-6 text-center">
          <span className="text-[13px] font-semibold text-white">This video plays in the Platinum Circles app</span>
          <span className="text-[11px] text-white/50">It was recorded in a format browsers cannot decode. Web playback for these is coming.</span>
        </span>
      ) : null}
      {typeof viewsCount === "number" && viewsCount > 0 ? (
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-ink/60 px-1.5 py-0.5 text-[11px] text-white">
          <Eye size={12} /> {viewsCount >= 1000 ? (viewsCount / 1000).toFixed(1).replace(/\.0$/, "") + "K" : viewsCount}
        </span>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <div onClick={scrub} className="h-1.5 w-full cursor-pointer overflow-hidden rounded-full bg-white/25">
          <div className="h-full bg-pearl" style={{ width: progress * 100 + "%" }} />
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} title={playing ? "Pause (Space)" : "Play (Space)"} className={btn}>
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); seekBy(-10); }} title="Back 10 seconds" className={btn}><RotateCcw size={15} /></button>
          <button onClick={(e) => { e.stopPropagation(); seekBy(10); }} title="Forward 10 seconds" className={btn}><RotateCw size={15} /></button>
          <button onClick={(e) => { e.stopPropagation(); toggleMute(); }} title={muted ? "Unmute (M)" : "Mute (M)"} className={btn}>
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <span className="relative ml-auto">
            <button onClick={(e) => { e.stopPropagation(); setSpeedMenu((v) => !v); }} title="Playback speed" className={btn + " flex items-center gap-1 px-2 text-[11px] font-semibold"}>
              <Gauge size={14} /> {speed}x
            </button>
            {speedMenu ? (
              <span className="absolute bottom-9 right-0 z-20 overflow-hidden rounded-lg border border-white/15 bg-navy shadow-2xl">
                {SPEEDS.map((s) => (
                  <button key={s} onClick={(e) => { e.stopPropagation(); pickSpeed(s); }} className={"block w-full px-4 py-1.5 text-left text-[12px] " + (s === speed ? "bg-surface-elevated font-semibold text-pearl" : "text-white/80 hover:bg-surface-elevated")}>
                    {s}x
                  </button>
                ))}
              </span>
            ) : null}
          </span>
          <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} title={fs ? "Exit fullscreen (F)" : "Fullscreen (F)"} className={btn}>
            {fs ? <Minimize size={15} /> : <Maximize size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}