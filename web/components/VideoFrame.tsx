'use client';
/**
 * A video shown as a still. The caller passes the placeholder it would otherwise show; this renders a real frame of the
 * video in its place once the still has come within reach of the screen and the frame has been decoded, and the
 * placeholder until then or when no frame can be had. The frame is an ordinary image that takes the caller's classes,
 * so a tile looks exactly as it does with a stored cover.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useVideoFrame } from '@/lib/videoFrames';

export function VideoFrame({ url, at, sourceVersion, className, alt = '', fallback }: { url: string; at?: number | null; sourceVersion?: string; className?: string; alt?: string; fallback: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = anchor.current;
    if (near || !node) return;
    if (typeof IntersectionObserver !== 'function') { setNear(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setNear(true); observer.disconnect(); } }, { rootMargin: '600px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);
  const frame = useVideoFrame(near ? url : null, at ?? undefined, sourceVersion);
  if (frame.src) return <img src={frame.src} alt={alt} decoding="async" draggable={false} className={className} data-video-frame="ready" />;
  return <span ref={anchor} className="block h-full w-full" data-video-frame={near ? frame.state : 'idle'}>{fallback}</span>;
}
