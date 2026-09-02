"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { displayImageUrl } from "@/lib/media";

// App-wide lightbox: any surface dispatches pc-view-media with a url.
// Zoom the Instagram way: pinch on touch, wheel on desktop, both about the
// point under the fingers; drag to pan while zoomed; double-tap or
// double-click toggles between fit and 2.5x at that point; ESC closes.
export function GlobalMediaLightbox() {
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [live, setLive] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number; cx: number; cy: number; tx: number; ty: number } | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    function onView(e: Event) {
      setZoom(1); setTx(0); setTy(0);
      setUrl((e as CustomEvent).detail?.url ?? null);
    }
    window.addEventListener("pc-view-media", onView);
    return () => window.removeEventListener("pc-view-media", onView);
  }, []);

  useEffect(() => {
    if (!url) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setUrl(null); }
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [url]);

  const clampZ = (z: number) => Math.max(1, Math.min(4, z));
  // Zoom about a viewport point p: keep the image point under p fixed.
  // The image is centred in the viewport, so its untransformed centre is the
  // viewport centre; with translate(t) scale(z) about that centre,
  // t' = (p - c) - (p - c - t) * (nz / z).
  const zoomAbout = (nz: number, px: number, py: number) => {
    if (nz <= 1.001) { setZoom(1); setTx(0); setTy(0); return; }
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const k = nz / zoom;
    setZoom(nz);
    setTx((px - cx) - (px - cx - tx) * k);
    setTy((py - cy) - (py - cy - ty) * k);
  };
  const toggleAt = (px: number, py: number) => { zoomAbout(zoom > 1 ? 1 : 2.5, px, py); };

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setLive(true);
    if (pts.current.size === 2) {
      const [a, b] = Array.from(pts.current.values());
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, tx, ty };
      drag.current = null;
    } else if (pts.current.size === 1) {
      const now = Date.now();
      if (e.pointerType === "touch" && now - lastTap.current < 280) { lastTap.current = 0; toggleAt(e.clientX, e.clientY); return; }
      lastTap.current = now;
      if (zoom > 1) drag.current = { x: e.clientX, y: e.clientY, tx, ty };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pts.current.size >= 2) {
      const [a, b] = Array.from(pts.current.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const nz = clampZ(pinch.current.z * (d / Math.max(1, pinch.current.d)));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      // Pan follows the midpoint drift; scale about the original midpoint.
      const k = nz / pinch.current.z;
      setZoom(nz);
      setTx(pinch.current.tx * k + (mx - pinch.current.cx) + (pinch.current.cx - window.innerWidth / 2) * (1 - k));
      setTy(pinch.current.ty * k + (my - pinch.current.cy) + (pinch.current.cy - window.innerHeight / 2) * (1 - k));
    } else if (drag.current) {
      setTx(drag.current.tx + (e.clientX - drag.current.x));
      setTy(drag.current.ty + (e.clientY - drag.current.y));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) pinch.current = null;
    if (pts.current.size === 0) { drag.current = null; setLive(false); if (zoom <= 1.02) { setZoom(1); setTx(0); setTy(0); } }
  };
  const onWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    const nz = clampZ(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    const k = nz / zoom;
    setZoom(nz);
    if (nz <= 1.001) { setTx(0); setTy(0); return; }
    setTx(tx * k + (e.clientX - window.innerWidth / 2) * (1 - k));
    setTy(ty * k + (e.clientY - window.innerHeight / 2) * (1 - k));
  };

  if (!url) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Media viewer" className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden bg-black/95" onClick={() => setUrl(null)}>
      <button onClick={() => setUrl(null)} aria-label="Close" className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><X size={18} /></button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} src={displayImageUrl(url, 2000)!}
        onError={(e) => { if (e.currentTarget.src !== url) e.currentTarget.src = url; }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => { e.stopPropagation(); toggleAt(e.clientX, e.clientY); }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onWheel={onWheel}
        draggable={false}
        alt="Shared media"
        style={{ transform: "translate(" + tx + "px, " + ty + "px) scale(" + zoom + ")", transition: live ? "none" : "transform 160ms cubic-bezier(0.16,1,0.3,1)", cursor: zoom > 1 ? "grab" : "zoom-in", touchAction: "none", willChange: "transform" }}
        className="max-h-[94vh] max-w-[96vw] select-none object-contain"
      />
    </div>
  );
}
