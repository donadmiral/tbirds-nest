"use client";
import NextImage from "next/image";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Music, Pause, Play } from "lucide-react";
import type { StoryTextSticker } from "@/lib/stories";
import { storyLayerWindow } from "../../shared/storyPresentation";
import studio from "./StoryStudio.module.css";

function useFrames(url: string | null, duration: number) {
  const [frameResult, setFrameResult] = useState<{ url: string; duration: number; frames: string[] } | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false; const video = document.createElement("video"), canvas = document.createElement("canvas");
    video.muted = true; video.playsInline = true; video.preload = "auto"; video.crossOrigin = "anonymous"; canvas.width = 96; canvas.height = 128;
    let cancelWait: (() => void) | null = null;
    const wait = (event: string, action?: () => void) => new Promise<boolean>(resolve => {
      const finish = (ok: boolean) => { clearTimeout(timer); video.removeEventListener(event, ready); video.removeEventListener("error", fail); cancelWait = null; resolve(ok); };
      const ready = () => finish(true), fail = () => finish(false), timer = setTimeout(fail, 2500);
      cancelWait = fail; video.addEventListener(event, ready, { once: true }); video.addEventListener("error", fail, { once: true }); action?.();
    });
    void (async () => {
      if (!await wait("loadeddata", () => { video.src = url; video.load(); }) || cancelled) return;
      const actual = Number.isFinite(video.duration) ? video.duration : duration, result: string[] = [];
      for (let i = 0; i < 8 && !cancelled; i++) {
        const time = Math.min(Math.max(0, actual - .1), (i + .15) / 8 * Math.max(.25, actual));
        if (!await wait("seeked", () => { video.currentTime = time; }) || cancelled) break;
        try { const context = canvas.getContext("2d"); if (!context) break; const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight), w = video.videoWidth * scale, h = video.videoHeight * scale; context.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h); result.push(canvas.toDataURL("image/jpeg", .55)); setFrameResult({ url, duration, frames: [...result] }); } catch { break; }
      }
    })();
    return () => { cancelled = true; cancelWait?.(); video.pause(); video.removeAttribute("src"); video.load(); };
  }, [url, duration]);
  return frameResult?.url === url && frameResult.duration === duration ? frameResult.frames : [];
}

function LayerRange({ title, label, start, end, duration, color, children, onChange, onSeek, minLength = .25, maxLength = duration }: {
  title: string; label: string; start: number; end: number; duration: number; color: string; children?: React.ReactNode;
  onChange: (start: number, end: number) => void; onSeek: (time: number) => void; minLength?: number; maxLength?: number;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ edge: 'start' | 'end'; x: number; start: number; end: number; width: number } | null>(null);
  const update = (edge: 'start' | 'end', delta: number, origin = { start, end }) => {
    const from = edge === 'start' ? Math.max(0, origin.end - maxLength, Math.min(origin.end - minLength, origin.start + delta)) : origin.start;
    const to = edge === 'end' ? Math.min(duration, from + maxLength, Math.max(from + minLength, origin.end + delta)) : origin.end;
    onChange(Math.round(from * 100) / 100, Math.round(to * 100) / 100); onSeek(edge === 'start' ? from : to);
  };
  return <div className={studio.timingRow}><span className={studio.timingLabel}>{title}</span><div ref={track} className={studio.timingTrack}>
    {children}
    <div className={studio.timingRange} style={{ left: `${start / duration * 100}%`, width: `${(end - start) / duration * 100}%`, background: color }}>
      {!children ? <span>{label}</span> : null}
      {(['start','end'] as const).map(edge => <button key={edge} type="button" role="slider" aria-label={`${edge === 'start' ? 'Start' : 'End'} of ${label}`} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={edge === 'start' ? start : end} aria-valuetext={`${(edge === 'start' ? start : end).toFixed(1)} seconds`} className={studio.timingHandle} data-edge={edge}
        onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { edge, x: event.clientX, start, end, width: track.current?.getBoundingClientRect().width || 1 }; }}
        onPointerMove={event => { const d = drag.current; if (!d || !event.currentTarget.hasPointerCapture(event.pointerId)) return; update(d.edge, (event.clientX - d.x) / d.width * duration, d); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); update(edge, (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : .25)); } }}><span /></button>)}
    </div>
  </div></div>;
}

export function StoryTiming({ url, duration, start, end, clock, playing, stickers, audioTitle, onClose, onToggle, onSeek, onTrim, onChange }: {
  url: string | null; duration: number; start: number; end: number; clock: number; playing: boolean; stickers: StoryTextSticker[]; audioTitle?: string | null;
  onClose: () => void; onToggle: () => void; onSeek: (time: number) => void; onTrim: (start: number, end: number) => void; onChange: (stickers: StoryTextSticker[]) => void;
}) {
  const frames = useFrames(url, duration);
  const format = (time: number) => `${Math.floor(time / 60).toString().padStart(2, '0')}:${Math.floor(time % 60).toString().padStart(2, '0')}`;
  useEffect(() => { const close = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close); }, [onClose]);
  return <div role="dialog" aria-modal="true" aria-label="Story timing and layers" className={studio.timingOverlay}>
    <div className={studio.timingHeader}><button type="button" className={studio.icon} aria-label="Back to story editing" onClick={onClose}><ArrowLeft size={22} /></button><h2>Timing</h2><button type="button" className={studio.primary} onClick={onClose}>Done</button></div>
    <section className={studio.timingPanel}>
      <div className={studio.timingPlayback}><button type="button" className={studio.icon} aria-label={playing ? 'Pause timeline preview' : 'Play timeline preview'} onClick={onToggle}>{playing ? <Pause size={20} /> : <Play size={20} />}</button><span>{format(clock)} / {format(duration)}</span><input aria-label="Preview time" type="range" min={0} max={duration} step={.05} value={clock} onChange={e => onSeek(Number(e.target.value))} /></div>
      <div className={studio.timingRuler}>{[0,.25,.5,.75,1].map(p => <span key={p}>{Math.round(duration * p)}s</span>)}</div>
      <div className={studio.timingLayers}>
        <LayerRange title="Video" label="Video" start={start} end={end} duration={duration} color="transparent" minLength={Math.min(1,duration)} maxLength={60} onChange={onTrim} onSeek={onSeek}><div className={studio.timingFrames}>{frames.length ? frames.map((src, index) => <NextImage unoptimized width={96} height={128} key={index} src={src} alt="" />) : <span>Preparing video frames…</span>}</div></LayerRange>
        {stickers.filter(sticker => sticker.kind !== 'drawing').map(sticker => { const window = storyLayerWindow(sticker.startSec, sticker.endSec, duration); return <LayerRange key={sticker.id} title={!sticker.kind || sticker.kind === 'text' ? 'Text' : 'Sticker'} label={sticker.text || sticker.kind || 'Text'} start={window.start} end={window.end} duration={duration} color={!sticker.kind || sticker.kind === 'text' ? '#cdbba2' : '#9ba58e'} onSeek={onSeek} onChange={(from,to) => onChange(stickers.map(s => s.id === sticker.id ? { ...s, startSec: from, endSec: to } : s))} />; })}
        {audioTitle ? <div className={studio.timingRow}><span className={studio.timingLabel}>Music</span><div className={studio.timingAudio}><Music size={17} />{audioTitle}</div></div> : null}
      </div>
      <p className={studio.note}>Drag the ends to set duration. Arrow keys move a selected handle precisely.</p>
    </section>
  </div>;
}
