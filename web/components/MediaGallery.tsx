"use client";

import { displayImageUrl } from "@/lib/media";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { VideoPlayer } from "@/components/VideoPlayer";

type MediaItem = { id: string; url: string; media_type: string };

export function MediaGallery({ media, postId, viewsCount, onDoubleClick }: {
  media: MediaItem[];
  postId: string;
  viewsCount?: number | null;
  onDoubleClick?: (e: React.MouseEvent) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [zoom, setZoom] = useState(false);
  const many = media.length > 1;
  const item = media[Math.min(idx, media.length - 1)];

  useEffect(() => {
    if (lightbox === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setLightbox(null); setZoom(false); }
      if (e.key === "ArrowRight") setLightbox((v) => (v === null ? v : Math.min(media.length - 1, v + 1)));
      if (e.key === "ArrowLeft") setLightbox((v) => (v === null ? v : Math.max(0, v - 1)));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, media.length]);

  if (media.length === 0) return null;

  const arrow = "absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-ink/60 p-1.5 text-white transition-colors hover:bg-ink/85";

  return (
    <>
      <div onDoubleClick={onDoubleClick} className="relative mt-3">
        {item.media_type === "video" ? (
          <VideoPlayer src={item.url} postId={postId} viewsCount={viewsCount} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={displayImageUrl(item.url)!} onError={(e) => { if (e.currentTarget.src !== item.url) e.currentTarget.src = item.url; }}
            alt=""
            loading="lazy"
            onClick={(e) => { e.stopPropagation(); setLightbox(idx); }}
            className="max-h-[480px] w-full cursor-zoom-in rounded-lg bg-surface object-cover"
          />
        )}
        {many ? (
          <>
            {idx > 0 ? (
              <button onClick={(e) => { e.stopPropagation(); setIdx(idx - 1); }} title="Previous" className={arrow + " left-2"}><ChevronLeft size={18} /></button>
            ) : null}
            {idx < media.length - 1 ? (
              <button onClick={(e) => { e.stopPropagation(); setIdx(idx + 1); }} title="Next" className={arrow + " right-2"}><ChevronRight size={18} /></button>
            ) : null}
            <span className="absolute right-2 top-2 rounded-md bg-ink/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">{idx + 1}/{media.length}</span>
            <span className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
              {media.map((_, i) => (
                <span key={i} className={"h-1.5 w-1.5 rounded-full " + (i === idx ? "bg-pearl" : "bg-white/40")} />
              ))}
            </span>
          </>
        ) : null}
      </div>

      {lightbox !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95" onClick={() => { setLightbox(null); setZoom(false); }}>
          <button onClick={() => { setLightbox(null); setZoom(false); }} title="Close" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><X size={20} /></button>
          {lightbox > 0 ? (
            <button onClick={(e) => { e.stopPropagation(); setLightbox(lightbox - 1); setZoom(false); }} title="Previous" className={arrow + " left-4"}><ChevronLeft size={22} /></button>
          ) : null}
          {lightbox < media.length - 1 ? (
            <button onClick={(e) => { e.stopPropagation(); setLightbox(lightbox + 1); setZoom(false); }} title="Next" className={arrow + " right-4"}><ChevronRight size={22} /></button>
          ) : null}
          {many ? <span className="absolute top-5 rounded-md bg-white/10 px-2 py-0.5 text-[12px] text-white">{lightbox + 1}/{media.length}</span> : null}
          {media[lightbox].media_type === "video" ? (
            <video src={media[lightbox].url} controls autoPlay playsInline className="max-h-[92vh] max-w-[94vw]" onClick={(e) => e.stopPropagation()} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(media[lightbox].url)!} onError={(e) => { if (e.currentTarget.src !== media[lightbox].url) e.currentTarget.src = media[lightbox].url; }}
              alt=""
              onClick={(e) => { e.stopPropagation(); setZoom((z) => !z); }}
              className={"max-h-[92vh] max-w-[94vw] transition-transform " + (zoom ? "scale-150 cursor-zoom-out" : "cursor-zoom-in")}
            />
          )}
        </div>
      ) : null}
    </>
  );
}