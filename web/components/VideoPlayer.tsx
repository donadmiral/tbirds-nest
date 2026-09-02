"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, RotateCcw, RotateCw, Maximize, Minimize, Eye, Gauge } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { autoplayEnabled, dataSaverEnabled } from "@/lib/mediaPrefs";

let activeStop: (() => void) | null = null;
// Remembered across sessions, not just across posts in one tab.
const PREF_KEY = "pc:video-prefs";
function readPrefs(): { muted: boolean; speed: number } {
  if (typeof window === "undefined") return { muted: true, speed: 1 };
  try { const p = JSON.parse(window.localStorage.getItem(PREF_KEY) || "{}"); return { muted: p.muted ?? true, speed: p.speed ?? 1 }; } catch { return { muted: true, speed: 1 }; }
}
function writePrefs(p: Partial<{ muted: boolean; speed: number }>) {
  try { window.localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), ...p })); } catch { /* private mode */ }
}
let mutedPref = readPrefs().muted;
// One playback identity per src: feed and fullscreen resume each other
// and share the view session, so expanding never double-counts or restarts.
const positions: Record<string, number> = {};
const viewSession = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

export type PostMediaEditRecipe = { scale?: number; translateNX?: number; translateNY?: number; fit?: "cover" | "contain"; filterId?: string | null; filterAmt?: number; adjust?: { bri?: number; warm?: number; tint?: number; sat?: number; fade?: number; vig?: number } | null; trimStart?: number | null; trimEnd?: number | null; muted?: boolean };

export function VideoPlayer({ src, postId, viewsCount, width, height, onDims, immersive = false, edit = null }: {
  src: string; postId: string; viewsCount?: number | null;
  width?: number; height?: number;
  onDims?: (w: number, h: number) => void;
  edit?: PostMediaEditRecipe | null;
  immersive?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dwellStart = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(edit?.muted ? true : mutedPref);
  const [skipHint, setSkipHint] = useState<number>(0);
  const [progress, setProgress] = useState(0);
  const [fs, setFs] = useState(false);
  const [speed, setSpeed] = useState(() => readPrefs().speed);
  const [speedMenu, setSpeedMenu] = useState(false);
  const [unplayable, setUnplayable] = useState(false);
  const [portrait, setPortrait] = useState(() => !!(width && height && height > width));
  const [posterBg, setPosterBg] = useState<string | null>(null);
  // Expanded view fills the whole area by default; Fit shows the uncropped frame.
  const [fill, setFill] = useState(true);
  const posterTried = useRef(false);

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
    const v = ref.current;
    if (v) positions[src] = v.currentTime;
    v?.pause();
    setPlaying(false);
    reportDwell();
  }, [reportDwell, src]);

  const playNow = useCallback(() => {
    if (activeStop && activeStop !== stop) activeStop();
    activeStop = stop;
    const v = ref.current;
    if (!v) return;
    v.muted = muted;
    if (positions[src] && Math.abs(v.currentTime - positions[src]) > 1 && positions[src] < (v.duration || Infinity) - 1) {
      v.currentTime = positions[src];
    }
    v.play().then(() => {
      setPlaying(true);
      if (!dwellStart.current) dwellStart.current = Date.now();
    }, () => {});
  }, [muted, stop, src]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (immersive) {
      playNow();
      return () => stop();
    }
    const io = new IntersectionObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      if (document.fullscreenElement === el) return;
      if (e.intersectionRatio >= 0.6) {
        if (ref.current?.paused && autoplayEnabled() && !dataSaverEnabled()) playNow();
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

  async function togglePip() {
    const v = ref.current as (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }) | null;
    if (!v || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture?.();
    } catch { /* not supported for this stream */ }
  }

  function toggleMute() {
    const next = !muted;
    mutedPref = next;
    writePrefs({ muted: next });
    setMuted(next);
    if (ref.current) ref.current.muted = next;
  }

  function seekBy(delta: number) {
    const v = ref.current;
    if (v) { v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta)); positions[src] = v.currentTime; }
  }

  function scrub(e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation();
    const v = ref.current;
    if (!v || !v.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = ((e.clientX - r.left) / r.width) * v.duration;
    positions[src] = v.currentTime;
  }

  function toggleFullscreen() {
    if (document.fullscreenElement === wrapRef.current) document.exitFullscreen?.();
    else wrapRef.current?.requestFullscreen?.();
  }

  function pickSpeed(s: number) {
    setSpeed(s);
    setSpeedMenu(false);
    if (ref.current) ref.current.playbackRate = s;
    writePrefs({ speed: s });
  }

  function onKey(e: React.KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") { e.preventDefault(); togglePlay(); }
    else if (k === "m") { e.preventDefault(); toggleMute(); }
    else if (k === "f") { e.preventDefault(); toggleFullscreen(); }
    else if (k === "p") { e.preventDefault(); void togglePip(); }
    else if (k === "arrowleft") { e.preventDefault(); seekBy(-10); }
    else if (k === "arrowright") { e.preventDefault(); seekBy(10); }
  }

  const btn = "rounded-full bg-ink/60 p-1.5 text-white transition-colors hover:bg-ink/80";

  return (
    <div ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKey}
      onClick={() => wrapRef.current?.focus()}
      style={!fs && !immersive && width && height ? { aspectRatio: width + " / " + height } : undefined}
      className={"group relative overflow-hidden outline-none " + (fs || immersive ? "flex h-full w-full flex-col items-stretch bg-[#0b0b0d]" : "h-full w-full rounded-lg bg-black")}
    >
      <video ref={ref}
        src={src}
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        onClick={(e) => { e.stopPropagation(); wrapRef.current?.focus(); const el = ref.current; const now = Date.now(); const last = (el as any)?._pcLastTap || 0; if (el) (el as any)._pcLastTap = now; if (now - last < 300 && el) { const r = el.getBoundingClientRect(); const dir = e.clientX < r.left + r.width / 2 ? -1 : 1; el.currentTime = Math.max(0, Math.min(el.duration || el.currentTime + dir * 10, el.currentTime + dir * 10)); if (el.paused) el.play().catch(() => {}); setSkipHint(dir); window.setTimeout(() => setSkipHint(0), 600); return; } window.setTimeout(() => { const el2 = ref.current; if (!el2) return; if (Date.now() - ((el2 as any)._pcLastTap || 0) >= 300) togglePlay(); }, 300); }}
        onTimeUpdate={() => {
          const v = ref.current;
          if (!v) return;
          // Post edit recipe: loop inside the trim window.
          const t0 = Number(edit?.trimStart) || 0; const t1 = Number(edit?.trimEnd) || 0;
          if (t1 > t0 && v.currentTime >= t1 - 0.05) { try { v.currentTime = t0; } catch {} }
          if (v.duration) setProgress(v.currentTime / v.duration);
          positions[src] = v.currentTime;
          if (!posterTried.current && v.currentTime > 0.1 && v.videoWidth > 0) {
            posterTried.current = true;
            try {
              const c = document.createElement("canvas");
              c.width = 96;
              c.height = Math.round((96 * v.videoHeight) / v.videoWidth);
              c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
              setPosterBg(c.toDataURL("image/jpeg", 0.6));
            } catch { posterTried.current = true; }
          }
          if (!unplayable && !v.paused && v.currentTime > 1.2) {
            const q = (v as HTMLVideoElement & { getVideoPlaybackQuality?: () => { totalVideoFrames: number } }).getVideoPlaybackQuality?.();
            const decoded = q ? q.totalVideoFrames : (v as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount;
            if (typeof decoded === "number" && decoded === 0) setUnplayable(true);
          }
        }}
        onEnded={() => { positions[src] = 0; stop(); }}
        onError={() => setUnplayable(true)}
        onLoadedMetadata={() => { { const vv = ref.current; const t0 = Number(edit?.trimStart) || 0; if (vv && t0 > 0.05 && vv.currentTime < t0) { try { vv.currentTime = t0; } catch {} } } const v = ref.current; if (!v) return; if (v.videoWidth === 0) setUnplayable(true); else { setPortrait(v.videoHeight > v.videoWidth); onDims?.(v.videoWidth, v.videoHeight); if (v.paused && !positions[src] && !posterTried.current) { try { v.currentTime = 0.15; } catch { /* fine */ } } } }}
        onSeeked={() => {
          const v = ref.current;
          if (!v || posterTried.current || v.videoWidth === 0 || !v.paused) return;
          posterTried.current = true;
          try {
            const c = document.createElement("canvas");
            c.width = 320;
            c.height = Math.round((320 * v.videoHeight) / v.videoWidth);
            c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
            setPosterBg(c.toDataURL("image/jpeg", 0.7));
          } catch { /* tainted or unavailable, fine */ }
        }}
        className={(fs || immersive) ? ("relative mx-auto block min-h-0 flex-1 " + (fill ? "object-cover" : "max-w-full object-contain")) : "relative h-full w-full object-cover"}
        style={(fs || immersive) && fill ? { aspectRatio: String(Math.max(width && height ? width / height : 0.8, 0.8)), maxWidth: "100%" } : undefined}
      />
      {skipHint !== 0 ? (<div className={"pointer-events-none absolute inset-y-0 flex w-[45%] items-center justify-center " + (skipHint < 0 ? "left-0" : "right-0")}><div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white/20 text-[12px] font-bold text-white">{skipHint < 0 ? "\u25C0\u25C0" : "\u25B6\u25B6"}<span>10 seconds</span></div></div>) : null}

      {!playing && posterBg && !unplayable ? (
        <button onClick={(e) => { e.stopPropagation(); playNow(); }} aria-label="Play video" className={"z-[5] flex items-center justify-center " + ((fs || immersive) ? "absolute inset-x-0 top-0 bottom-[84px]" : "absolute inset-0")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={posterBg} alt="" aria-hidden
            className={(fs || immersive) ? ("relative mx-auto block " + (fill ? "h-full object-cover" : "max-h-full max-w-full object-contain")) : "absolute inset-0 h-full w-full object-cover"}
            style={(fs || immersive) && fill ? { aspectRatio: String(Math.max(width && height ? width / height : 0.8, 0.8)), maxWidth: "100%" } : undefined} />
          <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-ink/70 pl-1 text-white">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
          </span>
        </button>
      ) : null}
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
      <div className={(fs || immersive)
        ? "relative flex shrink-0 flex-col gap-3 bg-[#0b0b0d] px-6 pb-4 pt-4"
        : "absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"}>
        <div onClick={scrub} className={"relative w-full cursor-pointer rounded-full bg-white/20 " + ((fs || immersive) ? "h-1" : "h-1.5 overflow-hidden")}>
          <div className="h-full rounded-full bg-pearl" style={{ width: progress * 100 + "%" }} />
          {(fs || immersive) ? <span className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-pearl shadow" style={{ left: "calc(" + progress * 100 + "% - 7px)" }} aria-hidden /> : null}
        </div>
        <div className="flex items-center gap-1.5">
          {(fs || immersive) ? (
            <button onClick={(e) => { e.stopPropagation(); setFill((v) => !v); }} title={fill ? "Show the whole frame" : "Fill the screen"} className="mr-1 rounded-full border border-pearl/70 px-3 py-1 text-[12.5px] font-semibold text-pearl transition-colors hover:bg-pearl/10">
              {fill ? "Fit" : "Fill"}
            </button>
          ) : null}
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
                    <button onClick={(e) => { e.stopPropagation(); void togglePip(); }} title="Picture in picture (P)" className={btn} aria-label="Picture in picture">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="2" y="4" width="20" height="16" rx="2" /><rect x="12" y="11" width="8" height="6" rx="1" fill="currentColor" /></svg>
          </button>
<button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} title={fs ? "Exit fullscreen (F)" : "Fullscreen (F)"} className={btn}>
            {fs ? <Minimize size={15} /> : <Maximize size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}