"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { displayImageUrl } from "@/lib/media";

// App-wide lightbox: any surface dispatches pc-view-media with a url.
export function GlobalMediaLightbox() {
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    function onView(e: Event) {
      setZoom(1);
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

  if (!url) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Media viewer" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95" onClick={() => setUrl(null)}>
      <button onClick={() => setUrl(null)} aria-label="Close" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><X size={18} /></button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={displayImageUrl(url, 2000)!}
        onError={(e) => { if (e.currentTarget.src !== url) e.currentTarget.src = url; }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => { e.stopPropagation(); setZoom(zoom > 1 ? 1 : 2); }}
        alt="Shared media"
        style={{ transform: "scale(" + zoom + ")", transition: "transform 120ms", cursor: zoom > 1 ? "zoom-out" : "zoom-in" }}
        className="max-h-[94vh] max-w-[96vw] select-none object-contain"
      />
    </div>
  );
}