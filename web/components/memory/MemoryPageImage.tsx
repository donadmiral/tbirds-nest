"use client";

import { useState } from "react";

/** The full memory stays sharp. A poster is only a fallback for failed media. */
export function MemoryPageImage({ src, poster, onRetry }: {
  src?: string | null;
  poster?: string | null;
  onRetry: () => void;
}) {
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const image = [src, poster].find(value => value && !failed.has(value));
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="Memory photograph" className="h-full w-full object-contain"
      onError={() => setFailed(previous => new Set(previous).add(image))} />;
  }
  return <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#0B1E3D] p-4 text-center text-sm text-white">
    <p>This memory image could not load.</p>
    <button type="button" className="min-h-11 rounded-full border border-white/35 px-4 py-2 font-semibold"
      onClick={() => { setFailed(new Set()); onRetry(); }}>Retry memory image</button>
  </div>;
}
