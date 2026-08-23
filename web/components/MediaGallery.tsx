"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { displayImageUrl } from "@/lib/media";

type MediaItem = { id: string; url: string; media_type: string; width?: number | null; height?: number | null; alt_text?: string | null };
type Dims = { w: number; h: number };

function fitted(w: number | null | undefined, h: number | null | undefined, availW: number, maxH: number): Dims | null {
  if (!w || !h || !availW) return null;
  const scale = Math.min(availW / w, maxH / h);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

function srcSetFor(url: string): { srcSet: string; sizes: string } {
  const widths = [480, 960, 1440];
  return {
    srcSet: widths.map((w) => displayImageUrl(url, w) + " " + w + "w").join(", "),
    sizes: "(max-width: 700px) 92vw, 640px",
  };
}

export function MediaGallery({ media, postId, viewsCount }: { media: MediaItem[]; postId: string; viewsCount?: number | null }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const touchX = useRef<number | null>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [availW, setAvailW] = useState(608);
  const [maxH, setMaxH] = useState(720);
  const [recovered, setRecovered] = useState<Record<string, Dims>>({});
  const [idx, setIdx] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const el = wrapRef.current;
    if (!el) return;
    setAvailW(Math.round(el.getBoundingClientRect().width) || 608);
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e && e.contentRect.width > 0) setAvailW(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    const onResize = () => setMaxH(Math.max(520, Math.min(Math.round(window.innerHeight * 0.8), 880)));
    onResize();
    window.addEventListener("resize", onResize);
    return () => { ro.disconnect(); window.removeEventListener("resize", onResize); };
  }, []);

  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  useEffect(() => {
    if (lightbox === null) return;
    openerRef.current = document.activeElement as HTMLElement;
    const prevOverflow = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = gap + "px";
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(null);
      else if (e.key === "ArrowRight") { resetZoom(); setLightbox((v) => (v === null ? v : Math.min(v + 1, media.length - 1))); }
      else if (e.key === "ArrowLeft") { resetZoom(); setLightbox((v) => (v === null ? v : Math.max(v - 1, 0))); }
      else if (e.key === "Tab") {
        const focusables = modalRef.current?.querySelectorAll<HTMLElement>("button, video, [tabindex]");
        if (!focusables || focusables.length === 0) return;
        const list = Array.from(focusables);
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPad;
      window.removeEventListener("keydown", onKey);
      resetZoom();
      openerRef.current?.focus();
    };
  }, [lightbox, media.length, resetZoom]);

  const recover = useCallback((id: string, w: number, h: number) => {
    if (w > 0 && h > 0) setRecovered((r) => (r[id] ? r : { ...r, [id]: { w, h } }));
  }, []);

  if (media.length === 0) return null;
  const item = media[Math.min(idx, media.length - 1)];
  const known = item.width && item.height ? { w: item.width, h: item.height } : recovered[item.id] ?? null;
  const dims = fitted(known?.w, known?.h, availW, maxH);
  const portrait = !!(known && known.h > known.w);
  const altOf = (m: MediaItem, i: number) => m.alt_text || "Post media " + (i + 1);

  function goTo(next: number) { resetZoom(); setLightbox(next); }
  function onTouchStart(e: React.TouchEvent) { touchX.current = e.touches[0]?.clientX ?? null; }
  function onFeedTouchEnd(e: React.TouchEvent) {
    const start = touchX.current;
    touchX.current = null;
    if (start === null || media.length < 2) return;
    const dx = (e.changedTouches[0]?.clientX ?? start) - start;
    if (dx < -40 && idx < media.length - 1) setIdx(idx + 1);
    else if (dx > 40 && idx > 0) setIdx(idx - 1);
  }
  function onModalTouchEnd(e: React.TouchEvent) {
    const start = touchX.current;
    touchX.current = null;
    if (start === null || lightbox === null || zoom > 1) return;
    const dx = (e.changedTouches[0]?.clientX ?? start) - start;
    if (dx < -40 && lightbox < media.length - 1) goTo(lightbox + 1);
    else if (dx > 40 && lightbox > 0) goTo(lightbox - 1);
  }
  function onWheelZoom(e: React.WheelEvent) {
    e.stopPropagation();
    setZoom((z) => Math.min(4, Math.max(1, z + (e.deltaY < 0 ? 0.25 : -0.25))));
    if (zoom <= 1.25 && pan.x !== 0) setPan({ x: 0, y: 0 });
  }
  function onDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (zoom > 1) resetZoom(); else setZoom(2.2);
  }
  function onDragStart(e: React.MouseEvent) {
    if (zoom <= 1) return;
    e.preventDefault();
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  }
  function onDragMove(e: React.MouseEvent) {
    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
  }
  function onDragEnd() { dragRef.current = null; }

  const arrow = "absolute top-1/2 -translate-y-1/2 rounded-full bg-ink/70 p-1.5 text-white hover:bg-ink/90";
  const heightTransition = reduced ? "" : " transition-[height] duration-200";

  return (
    <div ref={wrapRef} className="mt-3">
      <div className="relative overflow-hidden rounded-lg bg-black/40" onTouchStart={onTouchStart} onTouchEnd={onFeedTouchEnd}>
        {portrait && item.media_type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={displayImageUrl(item.url, 60)!} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl" />
        ) : null}
        <div className={"relative flex items-center justify-center" + heightTransition}
          style={dims ? { height: dims.h + "px" } : known ? { aspectRatio: known.w + " / " + known.h } : undefined}
        >
          {item.media_type === "video" ? (
            <div style={dims ? { width: dims.w + "px", height: dims.h + "px" } : { width: "100%" }}>
              <VideoPlayer src={item.url} postId={postId} viewsCount={viewsCount}
                width={known?.w} height={known?.h}
                onDims={(w, h) => recover(item.id, w, h)}
              />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(item.url)!}
              {...srcSetFor(item.url)}
              onError={(e) => { if (e.currentTarget.src !== item.url) { e.currentTarget.removeAttribute("srcset"); e.currentTarget.src = item.url; } }}
              onLoad={(e) => { if (!known) recover(item.id, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight); }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLightbox(idx); }}
              alt={altOf(item, idx)}
              loading="lazy"
              style={dims ? { width: dims.w + "px", height: dims.h + "px" } : undefined}
              className={"relative cursor-zoom-in object-contain " + (dims ? "" : "max-h-[80vh] w-full")}
            />
          )}
        </div>

        {media.length > 1 ? (
          <>
            {idx > 0 ? (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIdx(idx - 1); }} aria-label="Previous media" className={arrow + " left-2"}><ChevronLeft size={18} /></button>
            ) : null}
            {idx < media.length - 1 ? (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIdx(idx + 1); }} aria-label="Next media" className={arrow + " right-2"}><ChevronRight size={18} /></button>
            ) : null}
            <span className="absolute right-2 top-2 rounded-md bg-ink/70 px-2 py-0.5 text-[11px] font-semibold text-white">{idx + 1}/{media.length}</span>
            <span className="absolute inset-x-0 bottom-0 flex justify-center">
              {media.map((m, i) => (
                <button key={m.id}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIdx(i); }}
                  aria-label={"Go to media " + (i + 1)}
                  className="flex h-8 w-7 items-center justify-center"
                >
                  <span className={"h-1.5 w-1.5 rounded-full " + (i === idx ? "bg-pearl" : "bg-white/40")} />
                </button>
              ))}
            </span>
          </>
        ) : null}
      </div>

      {lightbox !== null ? (
        <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Media viewer"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLightbox(null); }}
          onTouchStart={onTouchStart} onTouchEnd={onModalTouchEnd}
          onMouseMove={onDragMove} onMouseUp={onDragEnd} onMouseLeave={onDragEnd}
        >
          <button ref={closeRef} onClick={() => setLightbox(null)} aria-label="Close viewer" className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><X size={18} /></button>
          <span className="absolute left-4 top-5 z-10 text-[12px] font-semibold text-white/70">{lightbox + 1} / {media.length}</span>
          {lightbox > 0 ? (
            <button onClick={(e) => { e.stopPropagation(); goTo(lightbox - 1); }} aria-label="Previous media" className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><ChevronLeft size={20} /></button>
          ) : null}
          {lightbox < media.length - 1 ? (
            <button onClick={(e) => { e.stopPropagation(); goTo(lightbox + 1); }} aria-label="Next media" className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><ChevronRight size={20} /></button>
          ) : null}
          {media[lightbox].media_type === "video" ? (
            <div className="h-[94vh] w-[96vw]" onClick={(e) => e.stopPropagation()}>
              <VideoPlayer src={media[lightbox].url} postId={postId} viewsCount={viewsCount} immersive
                width={media[lightbox].width ?? recovered[media[lightbox].id]?.w}
                height={media[lightbox].height ?? recovered[media[lightbox].id]?.h}
              />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(media[lightbox].url, 2000)!}
              onError={(e) => { if (e.currentTarget.src !== media[lightbox].url) e.currentTarget.src = media[lightbox].url; }}
              alt={altOf(media[lightbox], lightbox)}
              onClick={(e) => e.stopPropagation()}
              onWheel={onWheelZoom}
              onDoubleClick={onDoubleClick}
              onMouseDown={onDragStart}
              draggable={false}
              style={{ transform: "translate(" + pan.x + "px," + pan.y + "px) scale(" + zoom + ")", transition: dragRef.current || reduced ? "none" : "transform 120ms", cursor: zoom > 1 ? "grab" : "zoom-in" }}
              className="max-h-[94vh] max-w-[96vw] select-none object-contain"
            />
          )}
          {media[lightbox].media_type === "image" && media[lightbox + 1] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(media[lightbox + 1].url, 2000)!} alt="" aria-hidden className="hidden" />
          ) : null}
          {media[lightbox].media_type === "image" && media[lightbox - 1] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(media[lightbox - 1].url, 2000)!} alt="" aria-hidden className="hidden" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}