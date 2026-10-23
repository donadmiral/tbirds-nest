"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, RotateCcw, RotateCw, Maximize, Minimize, Eye, RectangleHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { autoplayEnabled, dataSaverEnabled } from "@/lib/mediaPrefs";
import { PLAYBACK_SPEEDS, playbackWindow, clampVideoTime, formatVideoTime } from "@/lib/videoPlayback";

let activeStop: (() => void) | null = null;
const PREF_KEY = "pc:video-prefs";
function readPrefs(): { muted: boolean; speed: number } {
  try {
    const prefs = JSON.parse(window.localStorage.getItem(PREF_KEY) || "{}");
    return { muted: typeof prefs.muted === "boolean" ? prefs.muted : true, speed: PLAYBACK_SPEEDS.includes(prefs.speed) ? prefs.speed : 1 };
  } catch { return { muted: true, speed: 1 }; }
}
function writePrefs(prefs: Partial<{ muted: boolean; speed: number }>) {
  try { window.localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), ...prefs })); } catch { /* Storage may be unavailable. */ }
}
// Bounded, in-tab resume positions let feed and theater share playback.
const positions = new Map<string, number>();
function remember(src: string, time: number) {
  positions.delete(src);
  positions.set(src, time);
  if (positions.size > 200) positions.delete(positions.keys().next().value!);
}
const viewSession = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());

type WebVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };
export type PostMediaEditRecipe = { scale?: number; translateNX?: number; translateNY?: number; fit?: "cover" | "contain"; filterId?: string | null; filterAmt?: number; adjust?: { bri?: number; warm?: number; tint?: number; sat?: number; fade?: number; vig?: number } | null; trimStart?: number | null; trimEnd?: number | null; muted?: boolean };
type Props = {
  src: string; postId: string; viewsCount?: number | null;
  width?: number; height?: number; onDims?: (w: number, h: number) => void;
  edit?: PostMediaEditRecipe | null; immersive?: boolean; onExpand?: () => void;
  allowPlayback?: boolean;
};

export function VideoPlayer(props: Props) {
  return <VideoPlayback key={props.src + ":" + props.postId} {...props} />;
}

function VideoPlayback({ src, postId, viewsCount, width, height, onDims, immersive = false, edit = null, onExpand, allowPlayback = true }: Props) {
  const ref = useRef<WebVideo | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dwellStart = useRef<number | null>(null);
  const playRequest = useRef(0);
  const wantsPlayback = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(() => edit?.muted || readPrefs().muted);
  const [speed, setSpeed] = useState(() => readPrefs().speed);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [fs, setFs] = useState(false);
  const [pip, setPip] = useState(false);
  const [pipAvailable, setPipAvailable] = useState(false);
  const [fill, setFill] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const trimStart = edit?.trimStart;
  const trimEnd = edit?.trimEnd;
  const range = playbackWindow(duration, trimStart, trimEnd);
  const elapsed = Math.max(0, Math.min(range.duration, time - range.start));
  const expanded = fs || immersive;

  const reportDwell = useCallback(async () => {
    const start = dwellStart.current;
    dwellStart.current = null;
    if (start === null) return;
    const seconds = Math.min(Math.round((Date.now() - start) / 1000), 60);
    if (seconds < 1) return;
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (uid) await supabase.rpc("record_video_view", { p_post_id: postId, p_viewer_id: uid, p_session: viewSession, p_duration: seconds });
    } catch { /* Analytics must not interrupt playback. */ }
  }, [postId]);

  const stop = useCallback(function stopVideo() {
    playRequest.current++;
    wantsPlayback.current = false;
    const v = ref.current;
    if (v) { remember(src, v.currentTime); v.pause(); }
    if (activeStop === stopVideo) activeStop = null;
    setPlaying(false);
    void reportDwell();
  }, [reportDwell, src]);

  const playNow = useCallback((explicit = false) => {
    const v = ref.current;
    if (!v || !allowPlayback) return;
    if (activeStop && activeStop !== stop) activeStop();
    activeStop = stop;
    wantsPlayback.current = true;
    const request = ++playRequest.current;
    const bounds = playbackWindow(v.duration, trimStart, trimEnd);
    if (bounds.duration) {
      const resume = v.ended ? bounds.start : positions.get(src) ?? v.currentTime;
      v.currentTime = clampVideoTime(resume >= bounds.end ? bounds.start : resume, bounds);
    }
    v.play().then(() => {
      if (request !== playRequest.current || activeStop !== stop) return;
      setNotice("");
    }, () => {
      if (request !== playRequest.current) return;
      if (explicit) setNotice("Playback could not start. Try playing again.");
    });
  }, [allowPlayback, stop, src, trimStart, trimEnd]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !allowPlayback) return;
    const outsidePage = () => {
      if (document.hidden && document.pictureInPictureElement !== ref.current) stop();
    };
    document.addEventListener("visibilitychange", outsidePage);
    // Opening theater is an explicit viewing action. Feed playback follows preferences.
    if (immersive) playNow();
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      if (!entry || document.fullscreenElement === el || document.pictureInPictureElement === ref.current) return;
      if (entry.intersectionRatio >= 0.6 && !document.hidden) {
        if (!immersive && ref.current?.paused && autoplayEnabled() && !dataSaverEnabled()) playNow();
      } else stop();
    }, { threshold: [0, 0.6] });
    io?.observe(el);
    return () => { io?.disconnect(); document.removeEventListener("visibilitychange", outsidePage); stop(); };
  }, [allowPlayback, immersive, playNow, stop]);

  useEffect(() => {
    const v = ref.current;
    function onFsChange() { setFs(document.fullscreenElement === wrapRef.current); }
    function onPipChange() { setPip(document.pictureInPictureElement === v); }
    document.addEventListener("fullscreenchange", onFsChange);
    v?.addEventListener("enterpictureinpicture", onPipChange);
    v?.addEventListener("leavepictureinpicture", onPipChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      v?.removeEventListener("enterpictureinpicture", onPipChange);
      v?.removeEventListener("leavepictureinpicture", onPipChange);
    };
  }, []);

  function togglePlay() { if (ref.current?.paused) playNow(true); else stop(); }
  async function togglePip() {
    const v = ref.current;
    if (!v || !pipAvailable) return;
    try {
      if (document.pictureInPictureElement === v) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
      setNotice("");
    } catch { setNotice("Picture in picture could not open in this browser. You can use fullscreen instead."); }
  }
  function toggleMute() {
    if (edit?.muted) return;
    const next = !ref.current?.muted;
    setMuted(next);
    writePrefs({ muted: next });
    if (ref.current) ref.current.muted = next;
  }
  function seekTo(next: number) {
    const v = ref.current;
    if (!v) return;
    const bounds = playbackWindow(v.duration, trimStart, trimEnd);
    if (!bounds.duration) return;
    const target = clampVideoTime(next, bounds);
    v.currentTime = target;
    setTime(target);
    remember(src, target);
  }
  function seekBy(delta: number) { if (ref.current) seekTo(ref.current.currentTime + delta); }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === wrapRef.current) await document.exitFullscreen();
      else if (wrapRef.current?.requestFullscreen) await wrapRef.current.requestFullscreen();
      else if (ref.current?.webkitEnterFullscreen) ref.current.webkitEnterFullscreen();
      else setNotice("Fullscreen is unavailable in this browser.");
    } catch {
      try {
        if (ref.current?.webkitEnterFullscreen) ref.current.webkitEnterFullscreen();
        else setNotice("Fullscreen could not open. Try again from the video controls.");
      } catch { setNotice("Fullscreen could not open. Try again from the video controls."); }
    }
  }
  function pickSpeed(next: number) {
    if (!PLAYBACK_SPEEDS.includes(next)) return;
    setSpeed(next);
    if (ref.current) ref.current.playbackRate = next;
    writePrefs({ speed: next });
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, select, textarea, [contenteditable='true']")) return;
    const key = e.key.toLowerCase();
    if ((key === " " || key === "enter") && target.closest("button, a")) return;
    if (key === " " || key === "k") togglePlay();
    else if (key === "m") toggleMute();
    else if (key === "f") void toggleFullscreen();
    else if (key === "p" && pipAvailable) void togglePip();
    else if (key === "t" && onExpand) onExpand();
    else if (key === "arrowleft") seekBy(-5);
    else if (key === "arrowright") seekBy(5);
    else if (key === "j") seekBy(-10);
    else if (key === "l") seekBy(10);
    else if (key === "home") seekTo(range.start);
    else if (key === "end") seekTo(range.end);
    else if (/^[0-9]$/.test(key)) seekTo(range.start + range.duration * Number(key) / 10);
    else if (key === ">") pickSpeed(PLAYBACK_SPEEDS[Math.min(PLAYBACK_SPEEDS.length - 1, PLAYBACK_SPEEDS.indexOf(speed) + 1)]);
    else if (key === "<") pickSpeed(PLAYBACK_SPEEDS[Math.max(0, PLAYBACK_SPEEDS.indexOf(speed) - 1)]);
    else return;
    e.preventDefault(); e.stopPropagation();
  }

  const btn = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink/60 text-white transition-colors hover:bg-ink/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pearl disabled:opacity-40";
  return (
    <div ref={wrapRef} role="group" aria-label="Video player" tabIndex={0} onKeyDown={onKey}
      style={!expanded && width && height ? { aspectRatio: width + " / " + height } : undefined}
      className={"video-player group relative overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-pearl " + (expanded ? "flex h-full w-full flex-col items-stretch bg-[#0b0b0d]" : "h-full w-full rounded-lg bg-black")}>
      <video ref={ref} src={src} playsInline muted={edit?.muted || muted} preload={allowPlayback && !dataSaverEnabled() ? "metadata" : "none"}
        onClick={(e) => { e.stopPropagation(); wrapRef.current?.focus(); togglePlay(); }}
        onDoubleClick={(e) => { e.stopPropagation(); void toggleFullscreen(); }}
        onPlay={() => {
          if (!allowPlayback || !wantsPlayback.current || (activeStop && activeStop !== stop)) { ref.current?.pause(); return; }
          activeStop = stop; setPlaying(true);
          if (dwellStart.current === null) dwellStart.current = Date.now();
        }}
        onPause={() => { setPlaying(false); void reportDwell(); }}
        onEnded={() => { stop(); remember(src, range.start); }}
        onError={() => { stop(); setFailed(true); setNotice(""); }}
        onLoadedMetadata={() => {
          const v = ref.current;
          if (!v) return;
          setDuration(v.duration); setFailed(false); v.playbackRate = speed;
          const bounds = playbackWindow(v.duration, trimStart, trimEnd);
          if (bounds.duration) { v.currentTime = clampVideoTime(positions.get(src) ?? bounds.start, bounds); setTime(v.currentTime); }
          setPipAvailable(!!document.pictureInPictureEnabled && typeof v.requestPictureInPicture === "function" && v.videoWidth > 0);
          if (v.videoWidth && v.videoHeight) onDims?.(v.videoWidth, v.videoHeight);
        }}
        onDurationChange={() => setDuration(ref.current?.duration || 0)}
        onTimeUpdate={() => {
          const v = ref.current;
          if (!v) return;
          const bounds = playbackWindow(v.duration, trimStart, trimEnd);
          if (bounds.duration && v.currentTime < bounds.start) v.currentTime = bounds.start;
          if (trimEnd && bounds.duration && v.currentTime >= bounds.end && !v.paused) v.currentTime = bounds.start;
          setTime(v.currentTime); remember(src, v.currentTime);
        }}
        className={expanded ? "block min-h-0 w-full flex-1 " + (fill ? "object-cover" : "object-contain") : "relative h-full w-full object-cover"}
      />
      {!playing && !failed && allowPlayback ? <button type="button" onClick={() => playNow(true)} aria-label="Play video" className={"absolute left-1/2 top-1/2 z-[5] flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink/70 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-pearl"}><Play size={24} /></button> : null}
      {failed ? <div role="status" className="absolute inset-x-3 top-3 z-10 rounded-xl bg-black/85 p-4 text-center text-sm text-white">
        <p>This video could not load. Check your connection or try again.</p>
        <button type="button" className="mt-2 rounded-full border border-white/40 px-4 py-2" onClick={() => { setFailed(false); setNotice(""); ref.current?.load(); playNow(true); }}>Retry video</button>
      </div> : null}
      {typeof viewsCount === "number" && viewsCount > 0 && !failed ? <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-ink/60 px-1.5 py-0.5 text-[11px] text-white"><Eye size={12} /> {viewsCount >= 1000 ? (viewsCount / 1000).toFixed(1).replace(/\.0$/, "") + "K" : viewsCount}</span> : null}
      <div className={expanded ? "relative flex shrink-0 flex-col gap-1 bg-[#0b0b0d] px-3 pb-3 pt-2" : "absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/90 to-transparent px-2 pb-1 pt-4 opacity-100 transition-opacity focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus:opacity-100"} onClick={(e) => e.stopPropagation()}>
        <input type="range" min={0} max={range.duration || 1} step={0.1} value={elapsed} disabled={!range.duration || !allowPlayback} aria-label="Video position" aria-valuetext={`${formatVideoTime(elapsed)} of ${formatVideoTime(range.duration)}`}
          onChange={(e) => seekTo(range.start + Number(e.target.value))} className="h-5 w-full cursor-pointer accent-pearl disabled:cursor-default" />
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" onClick={togglePlay} disabled={!allowPlayback} aria-label={playing ? "Pause video" : "Play video"} title={playing ? "Pause (K)" : "Play (K)"} className={btn}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
          <button type="button" onClick={() => seekBy(-10)} disabled={!range.duration} aria-label="Back 10 seconds" title="Back 10 seconds (J)" className={btn}><RotateCcw size={16} /></button>
          <button type="button" onClick={() => seekBy(10)} disabled={!range.duration} aria-label="Forward 10 seconds" title="Forward 10 seconds (L)" className={btn}><RotateCw size={16} /></button>
          {edit?.muted ? null : <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute video" : "Mute video"} title="Mute or unmute (M)" className={btn}>{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>}
          <span className="whitespace-nowrap px-1 text-[11px] tabular-nums text-white/85">{formatVideoTime(elapsed)} / {formatVideoTime(range.duration)}</span>
          <select value={speed} onChange={(e) => pickSpeed(Number(e.target.value))} aria-label="Playback speed" title="Playback speed (< or >)" className="ml-auto h-10 rounded-full bg-ink/80 px-2 text-[12px] text-white">{PLAYBACK_SPEEDS.map((value) => <option key={value} value={value}>{value}x</option>)}</select>
          {expanded ? <button type="button" onClick={() => setFill((value) => !value)} aria-label={fill ? "Show the whole frame" : "Fill the screen"} aria-pressed={fill} className="h-10 rounded-full border border-pearl/70 px-3 text-[12px] font-semibold text-pearl">{fill ? "Fit" : "Fill"}</button> : null}
          {onExpand && !fs ? <button type="button" onClick={onExpand} aria-label="Open theater view" title="Theater view (T)" className={btn}><RectangleHorizontal size={18} /></button> : null}
          {pipAvailable ? <button type="button" onClick={() => void togglePip()} aria-label={pip ? "Exit picture in picture" : "Picture in picture"} aria-pressed={pip} title="Picture in picture (P)" className={btn}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="2" y="4" width="20" height="16" rx="2" /><rect x="12" y="11" width="8" height="6" rx="1" fill="currentColor" /></svg></button> : null}
          <button type="button" onClick={() => void toggleFullscreen()} aria-label={fs ? "Exit fullscreen" : "Fullscreen"} title="Fullscreen (F)" className={btn}>{fs ? <Minimize size={17} /> : <Maximize size={17} />}</button>
        </div>
        {notice ? <p role="status" className="px-1 text-xs text-white">{notice}</p> : null}
      </div>
    </div>
  );
}
