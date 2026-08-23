"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { displayImageUrl } from "@/lib/media";

type MediaItem = { id: string; url: string; media_type: string; width?: number | null; height?: number | null };

const MAX_H = 580;

// The doctrine's rule: scale = min(availW / w, maxH / h), both dimensions
// scale together, the whole frame stays visible, leftover space is background.
function fitted(w: number | null | undefined, h: number | null | undefined, availW: number) {
  if (!w || !h || !availW) return null;
  const scale = Math.min(availW / w, MAX_H / h);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

export function MediaGallery({ media, postId, viewsCount }: { media: MediaItem[]; postId: string; viewsCount?: number | null }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [availW, setAvailW] = useState(0);
  const [idx, setIdx] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setAvailW(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (lightbox === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(null);
      else if (e.key === "ArrowRight") setLightbox((v) => (v === null ? v : Math.min(v + 1, media.length - 1)));
      else if (e.key === "ArrowLeft") setLightbox((v) => (v === null ? v : Math.max(v - 1, 0)));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, media.length]);

  if (media.length === 0) return null;
  const item = media[Math.min(idx, media.length - 1)];
  const dims = fitted(item.width, item.height, availW);

  return (
    <div ref={wrapRef} className="mt-3">
      <div className="relative overflow-hidden rounded-lg bg-black/40">
        <div className="flex items-center justify-center" style={dims ? { height: dims.h + "px" } : undefined}>
          {item.media_type === "video" ? (
            <div style={dims ? { width: dims.w + "px", height: dims.h + "px" } : { width: "100%" }}>
              <VideoPlayer src={item.url} postId={postId} viewsCount={viewsCount} width={item.width ?? undefined} height={item.height ?? undefined} />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(item.url)!}
              onError={(e) => { if (e.currentTarget.src !== item.url) e.currentTarget.src = item.url; }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLightbox(idx); }}
              alt="" loading="lazy"
              style={dims ? { width: dims.w + "px", height: dims.h + "px" } : undefined}
              className={"cursor-zoom-in object-contain " + (dims ? "" : "max-h-[580px] w-full")}
            />
          )}
        </div>

        {media.length > 1 ? (
          <>
            {idx > 0 ? (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIdx(idx - 1); }} title="Previous" className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-ink/70 p-1.5 text-white hover:bg-ink/90"><ChevronLeft size={18} /></button>
            ) : null}
            {idx < media.length - 1 ? (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIdx(idx + 1); }} title="Next" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-ink/70 p-1.5 text-white hover:bg-ink/90"><ChevronRight size={18} /></button>
            ) : null}
            <span className="absolute right-2 top-2 rounded-md bg-ink/70 px-2 py-0.5 text-[11px] font-semibold text-white">{idx + 1}/{media.length}</span>
            <span className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
              {media.map((m, i) => (
                <button key={m.id} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIdx(i); }} title={"Item " + (i + 1)} className={"h-1.5 w-1.5 rounded-full " + (i === idx ? "bg-pearl" : "bg-white/40")} />
              ))}
            </span>
          </>
        ) : null}
      </div>

      {lightbox !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLightbox(null); }}>
          <button onClick={() => setLightbox(null)} title="Close" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><X size={18} /></button>
          {lightbox > 0 ? (
            <button onClick={(e) => { e.stopPropagation(); setLightbox(lightbox - 1); }} title="Previous" className="absolute left-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><ChevronLeft size={20} /></button>
          ) : null}
          {lightbox < media.length - 1 ? (
            <button onClick={(e) => { e.stopPropagation(); setLightbox(lightbox + 1); }} title="Next" className="absolute right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><ChevronRight size={20} /></button>
          ) : null}
          {media[lightbox].media_type === "video" ? (
            <video src={media[lightbox].url} controls autoPlay playsInline className="max-h-[94vh] max-w-[96vw] object-contain" onClick={(e) => e.stopPropagation()} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={media[lightbox].url} alt="" className="max-h-[94vh] max-w-[96vw] object-contain" onClick={(e) => e.stopPropagation()} />
          )}
        </div>
      ) : null}
    </div>
  );
}