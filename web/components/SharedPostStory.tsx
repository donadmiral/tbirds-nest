"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Layers, Volume2, VolumeX } from "lucide-react";
import { normalizePostPlayback, applyPostPlayback } from '../../shared/postVoiceEffects';
import { postTrimWindow } from '../../shared/postMediaEditing';
import { sharedPostFrame } from "../../shared/storyPresentation";
import type { StoryTextSticker } from "@/lib/stories";
import { StoryPixelGrade } from './StoryPixelGrade';

/** Media URLs have already passed the story/post authorization hydrator. */
export function SharedPostStory({ sticker, paused, preview = false }: { sticker: StoryTextSticker; paused: boolean; preview?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const [stage, setStage] = useState({ width: 390, height: 693 });
  const [size, setSize] = useState({ width: sticker.postMediaWidth, height: sticker.postMediaHeight });
  const [muted, setMuted] = useState(true);
  const isVideo = sticker.postMediaType === "video";
  const playback = normalizePostPlayback(sticker.postMediaPlayback);
  useEffect(()=>{if(video.current)applyPostPlayback(video.current,playback);},[playback.speed,playback.voiceEffect,sticker.postMediaUrl]);
  useEffect(() => {
    const parent = preview ? ref.current?.closest('[data-story-stage]') : ref.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      // Review thumbnails scale the whole story stage. Lay out in its local
      // coordinates so that the card is scaled exactly once with that stage.
      const r = parent.getBoundingClientRect();
      const width = preview ? parent.clientWidth : r.width;
      const height = preview ? parent.clientHeight : r.height;
      if (width && height) setStage({ width, height });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(parent);
    return () => observer.disconnect();
  }, [preview]);
  useEffect(() => {
    const el = video.current; if (!el) return;
    const sync = () => { if (paused || document.hidden || document.documentElement.dataset.platinumCallActive === "true") el.pause(); else void el.play().catch(() => {}); };
    sync(); document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [paused, sticker.postMediaUrl]);
  const frame = sharedPostFrame({ stageWidth: stage.width, stageHeight: stage.height, mediaWidth: size.width, mediaHeight: size.height, caption: sticker.postText, title: sticker.postArticleTitle, hasMedia: !!sticker.postMediaUrl });
  const top = Math.max(92 + frame.height / 2, Math.min(sticker.ny * stage.height, stage.height - 78 - frame.height / 2));
  const href = preview ? undefined : "/post/" + sticker.postId;
  const Link = preview ? "span" : "a";
  return <div ref={ref} className={preview ? "pointer-events-none relative text-white" : "pointer-events-auto absolute text-white"} style={{ width: frame.width, ...(preview ? { minHeight: frame.height } : { left: Math.max(frame.width / 2 + 8, Math.min(sticker.nx * stage.width, stage.width - frame.width / 2 - 8)), top, transform: `translate(-50%,-50%) rotate(${sticker.rotation || 0}rad) scale(${sticker.scale || 1})`, opacity: sticker.opacity ?? 1 }) }}>
    {sticker.postText || sticker.postArticleTitle ? <Link href={href} className="flex flex-col justify-end pb-3.5 text-center text-[16px] leading-[22px] text-white [text-shadow:0_2px_8px_#0008]" style={{ minHeight: frame.captionHeight, ...(!sticker.postMediaUrl ? { padding: 20, borderRadius: 18, background: "rgba(0,0,0,.24)", border: "1px solid rgba(255,255,255,.18)" } : {}) }}>
      {sticker.postArticleTitle ? <span className="line-clamp-2 font-bold">{sticker.postArticleTitle}</span> : null}
      {sticker.postText ? <span className="line-clamp-3 font-medium" style={!sticker.postMediaUrl ? { WebkitLineClamp: 8 } : undefined}>{sticker.postText}</span> : null}
    </Link> : null}
    {sticker.postMediaUrl ? <div className="relative overflow-hidden rounded-2xl bg-black/10" style={{ height: frame.mediaHeight }}>
      <Link href={href} aria-label="Open shared post" className="block h-full w-full">
        {isVideo ? <video ref={video} src={sticker.postMediaUrl} playsInline muted={muted||playback.muted} loop preload="metadata" onLoadedMetadata={e => {const element=e.currentTarget;applyPostPlayback(element,playback);const window=postTrimWindow(element.duration,playback.trimStart,playback.trimEnd);element.currentTime=window.start;setSize({ width: element.videoWidth, height: element.videoHeight });}} onTimeUpdate={e=>{const element=e.currentTarget,window=postTrimWindow(element.duration,playback.trimStart,playback.trimEnd);if(window.duration&&(element.currentTime<window.start||element.currentTime>=window.end))element.currentTime=window.start;}} className="h-full w-full object-contain" /> :
          // eslint-disable-next-line @next/next/no-img-element
          <StoryPixelGrade className="h-full w-full"><img src={sticker.postMediaUrl} alt="Shared post" onLoad={e => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} className="h-full w-full object-contain" /></StoryPixelGrade>}
      </Link>
      {(sticker.postMediaCount || 0) > 1 ? <span className="absolute right-2 top-2 flex items-center gap-1 rounded-lg bg-black/30 p-1.5 text-[10px]"><Layers size={18} />1/{sticker.postMediaCount}</span> : null}
      {isVideo && !preview && !playback.muted ? <button type="button" aria-label={muted ? "Unmute shared video" : "Mute shared video"} className="absolute bottom-2 right-2 flex h-11 w-11 items-center justify-center rounded-full bg-black/50" onClick={() => setMuted(v => !v)}>{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button> : null}
    </div> : null}
    <div className="flex h-[54px] items-center gap-3">
      <Link href={!preview && sticker.postUsername ? "/" + sticker.postUsername.replace(/^@/, "") : href} className="flex min-h-11 min-w-0 flex-1 items-center truncate text-[14px] font-semibold">{sticker.postUsername ? "@" + sticker.postUsername.replace(/^@/, "") : sticker.postAuthorName || "Post"}</Link>
      <Link href={href} className="flex min-h-11 items-center gap-1.5 rounded-full border border-white/20 bg-white/20 px-4 text-[14px] font-semibold backdrop-blur-xl">View post<ArrowUpRight size={16} /></Link>
    </div>
  </div>;
}
