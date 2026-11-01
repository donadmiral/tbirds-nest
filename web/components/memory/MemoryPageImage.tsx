"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from 'react';

/** The full memory stays sharp. A poster is only a fallback for failed media. */
export function MemoryPageImage({ src, poster, onRetry, onReady, style, active = true }: {
  src?: string | null;
  poster?: string | null;
  onRetry: () => void;
  onReady?: () => void;
  style?: CSSProperties;
  active?: boolean;
}) {
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState<string | null>(null);
  const node = useRef<HTMLImageElement>(null), alive = useRef(true), readyCallback = useRef(onReady);
  useLayoutEffect(() => { readyCallback.current = onReady; }, [onReady]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const image = [src, poster].find(value => value && !failed.has(value));
  const loaded = (element: HTMLImageElement) => {
    const current = () => alive.current && node.current === element && element.isConnected && element.getAttribute('src') === image;
    if (!current() || !element.complete || !element.naturalWidth) return;
    void (typeof element.decode === 'function' ? element.decode() : Promise.resolve()).then(() => {
      if (current()) setReady(image!);
    }).catch(() => { if (current()) setFailed(previous => new Set(previous).add(image!)); });
  };
  useEffect(() => { if (node.current) loaded(node.current); }, [image]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (active && image && ready === image) readyCallback.current?.(); }, [active, image, ready]);
  useEffect(() => {
    if (!active || !image || ready === image) return;
    const timer = setTimeout(() => setFailed(previous => new Set(previous).add(image)), 20_000);
    return () => clearTimeout(timer);
  }, [active, image, ready]);
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img key={image} ref={node} src={image} alt="Memory photograph" className="h-full w-full object-contain" style={style}
      onLoad={event => loaded(event.currentTarget)} onError={() => setFailed(previous => new Set(previous).add(image))} />;
  }
  return <div className="media-frame flex h-full w-full flex-col items-center justify-center gap-2 bg-[#0B1E3D] p-4 text-center text-sm text-white">
    <p>This memory image could not load.</p>
    <button type="button" className="min-h-11 rounded-full border border-white/35 px-4 py-2 font-semibold"
      onClick={() => { setFailed(new Set()); onRetry(); }}>Retry memory image</button>
  </div>;
}
