"use client";

import { useEffect, useState } from "react";
import { X, Search } from "lucide-react";

type Gif = { url: string; width: number; height: number; preview: string };
const KEY = process.env.NEXT_PUBLIC_GIPHY_KEY || "";

export function GifPicker({ onPick, onClose }: { onPick: (g: Gif) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!KEY) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const url = q.trim()
          ? "https://api.giphy.com/v1/gifs/search?api_key=" + KEY + "&q=" + encodeURIComponent(q.trim()) + "&limit=24&rating=pg-13"
          : "https://api.giphy.com/v1/gifs/trending?api_key=" + KEY + "&limit=24&rating=pg-13";
        const res = await fetch(url);
        const j = await res.json();
        setGifs(((j.data ?? []) as { images: { original: { url: string; width: string; height: string }; fixed_width: { url: string } } }[]).map((g) => ({
          url: g.images.original.url,
          width: Number(g.images.original.width) || 480,
          height: Number(g.images.original.height) || 480,
          preview: g.images.fixed_width.url,
        })));
      } catch { setGifs([]); }
      setLoading(false);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="flex h-[70vh] w-full max-w-lg flex-col rounded-xl border border-ink/10 bg-navy p-4" onClick={(e) => e.stopPropagation()}>
        <span className="flex items-center gap-2">
          <span className="flex flex-1 items-center gap-2 rounded-md bg-surface px-3 py-2">
            <Search size={15} className="text-ink/40" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search GIFs" autoFocus
              className="w-full bg-transparent text-[14px] text-ink placeholder:text-ink/30 outline-none" />
          </span>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-ink/40 hover:bg-surface hover:text-ink"><X size={16} /></button>
        </span>
        {!KEY ? (
          <p className="py-10 text-center text-[13px] text-danger">No GIF key configured. Restart the dev server after the env copy.</p>
        ) : loading ? (
          <p className="py-10 text-center text-[13px] text-ink/40">Loading</p>
        ) : (
          <div className="mt-3 grid flex-1 grid-cols-3 gap-1.5 overflow-y-auto">
            {gifs.map((g) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={g.url} src={g.preview} alt="GIF option" role="button" tabIndex={0}
                onClick={() => onPick(g)}
                onKeyDown={(e) => { if (e.key === "Enter") onPick(g); }}
                className="h-28 w-full cursor-pointer rounded-md bg-surface object-cover hover:opacity-80"
              />
            ))}
          </div>
        )}
        <p className="pt-2 text-center text-[10px] text-ink/30">Powered by GIPHY</p>
      </div>
    </div>
  );
}