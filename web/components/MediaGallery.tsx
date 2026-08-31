"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, X, Maximize2, Minimize2, Heart, MessageCircle, Repeat2 } from "lucide-react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { RichText } from "@/components/RichText";
import { displayImageUrl, srcSetFor } from "@/lib/media";
import { dataSaverEnabled } from "@/lib/mediaPrefs";
import { createClient } from "@/lib/supabase/client";

type MediaItem = { id: string; url: string; media_type: string | null; width?: number | null; height?: number | null; alt_text?: string | null; is_sensitive?: boolean | null };
type Dims = { w: number; h: number };
export type ViewerPost = {
  post_id: string;
  author_name?: string | null;
  author_username?: string | null;
  author_avatar?: string | null;
  content?: string | null;
  likes_count?: number;
  comments_count?: number;
  reposts_count?: number;
  viewer_liked?: boolean;
  viewer_bookmarked?: boolean;
};

function fitted(w: number | null | undefined, h: number | null | undefined, availW: number, maxH: number): Dims | null {
  if (!w || !h || !availW) return null;
  const scale = Math.min(availW / w, maxH / h, 1.25);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

export function MediaGallery({ media, postId, viewsCount, post, onDoubleClick: onFeedDoubleClick }: { media: MediaItem[]; postId: string; viewsCount?: number | null; post?: ViewerPost; onDoubleClick?: (e: React.MouseEvent) => void }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const touchX = useRef<number | null>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const [availW, setAvailW] = useState(608);
  const [maxH, setMaxH] = useState(720);
  const [trueDims, setTrueDims] = useState<Record<string, Dims>>({});
  const [idx, setIdx] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [reduced, setReduced] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [liked, setLiked] = useState(!!post?.viewer_liked);
  const [likeN, setLikeN] = useState(post?.likes_count ?? 0);
  const [marked, setMarked] = useState(!!post?.viewer_bookmarked);

  async function toggleLike() {
    const supabase = createClient();
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid || !post) return;
    const on = !liked;
    setLiked(on);
    setLikeN((n) => Math.max(0, n + (on ? 1 : -1)));
    if (on) await supabase.from("post_likes").upsert({ post_id: post.post_id, user_id: uid }, { onConflict: "post_id,user_id" });
    else await supabase.from("post_likes").delete().eq("post_id", post.post_id).eq("user_id", uid);
  }
  async function toggleMark() {
    const supabase = createClient();
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid || !post) return;
    const on = !marked;
    setMarked(on);
    if (on) await supabase.from("post_bookmarks").upsert({ post_id: post.post_id, user_id: uid }, { onConflict: "post_id,user_id" });
    else await supabase.from("post_bookmarks").delete().eq("post_id", post.post_id).eq("user_id", uid);
  }

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
    const onResize = () => setMaxH(Math.min(Math.max(280, window.innerHeight - 200), 880));
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
        const focusables = modalRef.current?.querySelectorAll<HTMLElement>("button, a, video, [tabindex]");
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
      setImmersive(false);
      openerRef.current?.focus();
    };
  }, [lightbox, media.length, resetZoom]);

  const measure = useCallback((id: string, w: number, h: number) => {
    if (w > 0 && h > 0) setTrueDims((r) => (r[id] && r[id].w === w && r[id].h === h ? r : { ...r, [id]: { w, h } }));
  }, []);

  if (media.length === 0) return null;
  const item = media[Math.min(idx, media.length - 1)];
  const known = trueDims[item.id] ?? (item.width && item.height ? { w: item.width, h: item.height } : null);
  const fittedDims = fitted(known?.w, known?.h, availW, maxH);
  // Video takes the whole card width and caps its height at 4:5, exactly as
  // Instagram's feed does. A tall clip is cover-cropped to that box in the
  // feed; the full frame is one click away in the viewer.
  const dims = item.media_type === "video" && availW
    ? { w: availW, h: Math.round(Math.min(known?.w && known?.h ? availW * (known.h / known.w) : availW * 1.25, availW * 1.25)) }
    : fittedDims;
  const altOf = (m: MediaItem, i: number) => m.alt_text || "Post media " + (i + 1);
  const showPanel = !!post && !immersive;

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
  function onModalTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (!pinchRef.current) { pinchRef.current = { dist, zoom }; return; }
      setZoomClamped(pinchRef.current.zoom * (dist / pinchRef.current.dist));
    } else if (e.touches.length === 1 && zoom > 1) {
      const t0 = e.touches[0];
      if (!dragRef.current) { dragRef.current = { x: t0.clientX, y: t0.clientY, px: pan.x, py: pan.y }; return; }
      setPan(clampPan({ x: dragRef.current.px + (t0.clientX - dragRef.current.x), y: dragRef.current.py + (t0.clientY - dragRef.current.y) }, zoom));
    }
  }
  function onModalTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length === 0) dragRef.current = null;
    const start = touchX.current;
    touchX.current = null;
    if (start === null || lightbox === null || zoom > 1) return;
    const dx = (e.changedTouches[0]?.clientX ?? start) - start;
    if (dx < -40 && lightbox < media.length - 1) goTo(lightbox + 1);
    else if (dx > 40 && lightbox > 0) goTo(lightbox - 1);
  }
  function setZoomClamped(next: number) {
    const z = Math.min(4, Math.max(1, next));
    setZoom(z);
    if (z <= 1.01) setPan({ x: 0, y: 0 });
    else setPan((p) => clampPan(p, z));
  }
  function clampPan(p: { x: number; y: number }, z: number) {
    const pane = modalRef.current?.querySelector("[data-media-pane]") as HTMLElement | null;
    const limX = pane ? (pane.clientWidth * (z - 1)) / 2 : 400;
    const limY = pane ? (pane.clientHeight * (z - 1)) / 2 : 400;
    return { x: Math.max(-limX, Math.min(limX, p.x)), y: Math.max(-limY, Math.min(limY, p.y)) };
  }
  function onWheelZoom(e: React.WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    setZoomClamped(zoom + (e.deltaY < 0 ? 0.35 : -0.35));
  }
  function onDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (zoom > 1) resetZoom(); else setZoomClamped(2.2);
  }
  function onDragStart(e: React.MouseEvent) {
    if (zoom <= 1) return;
    e.preventDefault();
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  }
  function onDragMove(e: React.MouseEvent) {
    const d = dragRef.current;
    if (!d) return;
    setPan(clampPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) }, zoom));
  }
  function onDragEnd() { dragRef.current = null; }

  const arrow = "absolute top-1/2 -translate-y-1/2 rounded-full bg-ink/70 p-1.5 text-white transition-colors duration-[140ms] hover:bg-ink/90";
  const heightTransition = reduced ? "" : " transition-[height] duration-200";
  const count = (n?: number) => (n ?? 0) >= 1000 ? ((n ?? 0) / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(n ?? 0);

  return (
    <div ref={wrapRef} className="mt-3" onDoubleClick={onFeedDoubleClick}>
      <div style={dims ? { width: dims.w + "px" } : undefined} className="relative mx-auto max-w-full overflow-hidden rounded-xl bg-black" onTouchStart={onTouchStart} onTouchEnd={onFeedTouchEnd}>
        {lightbox !== null ? (
          <div style={dims ? { height: dims.h + "px" } : undefined} className="w-full" />
        ) : (
        <div className={"flex items-center justify-center" + heightTransition}
          style={dims ? { height: dims.h + "px" } : undefined}
        >
          {item.media_type === "video" ? (
            <div style={dims ? { width: dims.w + "px", height: dims.h + "px" } : { width: "100%" }}>
              <VideoPlayer src={item.url} postId={postId} viewsCount={viewsCount}
                width={known?.w} height={known?.h}
                onDims={(w, h) => measure(item.id, w, h)}
              />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(item.url, dataSaverEnabled() ? 480 : 1200)!}
              {...(dataSaverEnabled() ? {} : srcSetFor(item.url))}
              onError={(e) => { if (e.currentTarget.src !== item.url) { e.currentTarget.removeAttribute("srcset"); e.currentTarget.src = item.url; } }}
              onLoad={(e) => measure(item.id, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLightbox(idx); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setLightbox(idx); } }}
              role="button"
              tabIndex={0}
              aria-label={"Open " + altOf(item, idx)}
              alt={altOf(item, idx)}
              loading="lazy"
              style={dims ? { width: dims.w + "px", height: dims.h + "px" } : undefined}
              className={"cursor-zoom-in object-contain " + (dims ? "" : "max-h-[80vh] w-full")}
            />
          )}
        </div>
        )}

        {item.is_sensitive && !revealed[item.id] ? (
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRevealed((r) => ({ ...r, [item.id]: true })); }}
            className="absolute inset-0 z-[6] flex flex-col items-center justify-center gap-2 bg-ink/95"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/70" aria-hidden><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
            <span className="text-[13px] font-semibold text-white">Sensitive content</span>
            <span className="text-[12px] text-white/50">The author flagged this media. Tap to show.</span>
          </button>
        ) : null}
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
                  <span className={"h-1.5 w-1.5 rounded-full transition-colors duration-[140ms] " + (i === idx ? "bg-pearl" : "bg-white/40")} />
                </button>
              ))}
            </span>
          </>
        ) : null}
      </div>

      {lightbox !== null ? (
        <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Media viewer"
          className="fixed inset-0 z-50 flex bg-black/95"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLightbox(null); }}
          onTouchStart={onTouchStart} onTouchMove={onModalTouchMove} onTouchEnd={onModalTouchEnd}
          onMouseMove={onDragMove} onMouseUp={onDragEnd} onMouseLeave={onDragEnd}
        >
          <div data-media-pane className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden">
            <button ref={closeRef} onClick={() => setLightbox(null)} aria-label="Close viewer" className="absolute left-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white transition-colors duration-[140ms] hover:bg-white/20"><X size={18} /></button>
            <span className="absolute left-16 top-5 z-10 text-[12px] font-semibold text-white/70">{lightbox + 1} / {media.length}</span>
            {post ? (
              <button onClick={(e) => { e.stopPropagation(); setImmersive((v) => !v); }} aria-label={immersive ? "Show details" : "Immersive view"} className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white transition-colors duration-[140ms] hover:bg-white/20">
                {immersive ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              </button>
            ) : null}
            {lightbox > 0 ? (
              <button onClick={(e) => { e.stopPropagation(); goTo(lightbox - 1); }} aria-label="Previous media" className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition-colors duration-[140ms] hover:bg-white/20"><ChevronLeft size={20} /></button>
            ) : null}
            {lightbox < media.length - 1 ? (
              <button onClick={(e) => { e.stopPropagation(); goTo(lightbox + 1); }} aria-label="Next media" className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition-colors duration-[140ms] hover:bg-white/20"><ChevronRight size={20} /></button>
            ) : null}
            {media[lightbox].media_type === "video" ? (
              <div className="h-[94vh] w-full px-2" onClick={(e) => e.stopPropagation()}>
                <VideoPlayer src={media[lightbox].url} postId={postId} viewsCount={viewsCount} immersive
                  width={trueDims[media[lightbox].id]?.w ?? media[lightbox].width ?? undefined}
                  height={trueDims[media[lightbox].id]?.h ?? media[lightbox].height ?? undefined}
                />
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={displayImageUrl(media[lightbox].url)!}
                onError={(e) => { if (e.currentTarget.src !== media[lightbox].url) e.currentTarget.src = media[lightbox].url; }}
                alt={altOf(media[lightbox], lightbox)}
                onClick={(e) => e.stopPropagation()}
                onWheel={onWheelZoom}
                onDoubleClick={onDoubleClick}
                onMouseDown={onDragStart}
                draggable={false}
                style={{ transform: "translate(" + pan.x + "px," + pan.y + "px) scale(" + zoom + ")", transition: dragRef.current || reduced ? "none" : "transform 120ms", cursor: zoom > 1 ? "grab" : "zoom-in" }}
                className="max-h-[94vh] max-w-full select-none object-contain"
              />
            )}
            {media[lightbox].media_type === "image" ? (
              <span className="absolute bottom-4 right-4 z-10 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => setZoomClamped(zoom - 0.5)} aria-label="Zoom out" className="rounded-md bg-white/10 px-2.5 py-1.5 text-[13px] font-bold text-white transition-colors duration-[140ms] hover:bg-white/20">-</button>
                <button onClick={() => resetZoom()} aria-label="Reset zoom" className="rounded-md bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors duration-[140ms] hover:bg-white/20">{Math.round(zoom * 100)}%</button>
                <button onClick={() => setZoomClamped(zoom + 0.5)} aria-label="Zoom in" className="rounded-md bg-white/10 px-2.5 py-1.5 text-[13px] font-bold text-white transition-colors duration-[140ms] hover:bg-white/20">+</button>
              </span>
            ) : null}
          </div>

          {media[lightbox + 1]?.media_type === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(media[lightbox + 1].url, 1600)!} alt="" aria-hidden className="hidden" />
          ) : null}
          {media[lightbox - 1]?.media_type === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(media[lightbox - 1].url, 1600)!} alt="" aria-hidden className="hidden" />
          ) : null}

          {showPanel ? (
            <aside onClick={(e) => e.stopPropagation()} className="hidden w-[340px] shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-navy p-5 lg:flex">
              <div className="flex items-center gap-2.5">
                {post!.author_avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(post!.author_avatar, 100)!} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-sm font-semibold text-porcelain">{(post!.author_name ?? "?").charAt(0)}</span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-white">{post!.author_name}</span>
                  <span className="block truncate text-[12px] text-white/45">@{post!.author_username}</span>
                </span>
              </div>
              {post!.content ? (
                <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-white/85"><RichText text={post!.content} /></p>
              ) : null}
              <div className="-ml-2 mt-4 flex items-center gap-1 text-[13px]">
                <button onClick={toggleLike} className={"flex items-center gap-1.5 rounded-full px-2.5 py-2 transition-colors duration-[140ms] " + (liked ? "text-danger" : "text-white/55 hover:bg-white/10 hover:text-danger")}>
                  <Heart size={16} fill={liked ? "currentColor" : "none"} /> {count(likeN)}
                </button>
                <Link href={"/post/" + post!.post_id} className="flex items-center gap-1.5 rounded-full px-2.5 py-2 text-white/55 transition-colors duration-[140ms] hover:bg-white/10 hover:text-white">
                  <MessageCircle size={16} /> {count(post!.comments_count)}
                </Link>
                <span className="flex items-center gap-1.5 rounded-full px-2.5 py-2 text-white/55"><Repeat2 size={16} /> {count(post!.reposts_count)}</span>
                <button onClick={toggleMark} title={marked ? "Saved" : "Save"} className={"ml-auto rounded-full p-2 transition-colors duration-[140ms] " + (marked ? "text-pearl" : "text-white/55 hover:bg-white/10 hover:text-pearl")}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={marked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                </button>
              </div>
              <Link href={"/post/" + post!.post_id} className="mt-5 rounded-full bg-pearl px-4 py-2.5 text-center text-[13.5px] font-bold text-ink shadow-sm transition-opacity duration-[140ms] hover:opacity-90">
                Open post and comments
              </Link>
            </aside>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}