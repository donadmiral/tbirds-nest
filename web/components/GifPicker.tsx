"use client";

import { useEffect, useState } from "react";
import { X, Search } from "lucide-react";

type Gif = { url: string; width: number; height: number; preview: string };
const KEY = process.env.NEXT_PUBLIC_GIPHY_KEY || "";

export function GifPicker({ onPick, onClose, mode = 'gifs', busy = false }: { onPick: (g: Gif) => void; onClose: () => void; mode?: 'gifs' | 'stickers'; busy?: boolean }) {
  const [q, setQ] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(Boolean(KEY));
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!KEY) return;
    const controller = new AbortController();
    let current = true;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const url = q.trim()
          ? "https://api.giphy.com/v1/" + mode + "/search?api_key=" + KEY + "&q=" + encodeURIComponent(q.trim()) + "&limit=24&rating=pg-13"
          : "https://api.giphy.com/v1/" + mode + "/trending?api_key=" + KEY + "&limit=24&rating=pg-13";
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error('GIF search unavailable');
        const j = await res.json();
        if (!current) return;
        setGifs(((j.data ?? []) as { images: { original: { url: string; width: string; height: string }; fixed_width: { url: string } } }[]).map((g) => ({
          url: g.images.original.url,
          width: Number(g.images.original.width) || 480,
          height: Number(g.images.original.height) || 480,
          preview: g.images.fixed_width.url,
        })));
      } catch { if (current) { setGifs([]); setError(true); } }
      if (current) setLoading(false);
    }, 350);
    return () => { current = false; clearTimeout(t); controller.abort(); };
  }, [q, mode, retry]);

  return (
    <div role="dialog" aria-modal="true" aria-label={mode === 'stickers' ? 'Choose a sticker' : 'Choose a GIF'} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose} onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
      <div className="flex h-[70dvh] w-full max-w-lg flex-col rounded-xl border border-ink/10 bg-surface-elevated p-4 text-ink" onClick={(e) => e.stopPropagation()}>
        <span className="flex items-center gap-2">
          <span className="flex flex-1 items-center gap-2 rounded-md bg-surface px-3 py-2">
            <Search size={15} className="text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === 'stickers' ? 'Search stickers' : 'Search GIFs'} aria-label={mode === 'stickers' ? 'Search stickers' : 'Search GIFs'} autoFocus
              className="min-w-0 w-full bg-transparent text-[16px] text-ink placeholder:text-muted outline-none" />
          </span>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink"><X size={16} /></button>
        </span>
        {!KEY ? (
          <p className="py-10 text-center text-[13px] text-secondary">{mode === 'stickers' ? 'Sticker search' : 'GIF search'} is unavailable right now. You can still attach one from your device.</p>
        ) : loading ? (
          <p className="py-10 text-center text-[13px] text-muted">Loading</p>
        ) : error ? (
          <div role="alert" className="py-10 text-center text-sm"><p>Search could not load.</p><button type="button" onClick={() => setRetry(value => value + 1)} className="mt-3 rounded-lg bg-surface px-4 py-2">Try again</button></div>
        ) : gifs.length === 0 ? (
          <p role="status" className="py-10 text-center text-sm text-secondary">No results. Try another search.</p>
        ) : (
          <div className="mt-3 grid flex-1 grid-cols-3 gap-1.5 overflow-y-auto">
            {gifs.map((g) => (
              // eslint-disable-next-line @next/next/no-img-element
              <button type="button" key={g.url} disabled={busy} onClick={() => onPick(g)} aria-label={mode === 'stickers' ? 'Send sticker' : 'Send GIF'} className="rounded-md disabled:opacity-40"><img src={g.preview} alt="" className="h-28 w-full rounded-md bg-surface object-contain hover:opacity-80" /></button>
            ))}
          </div>
        )}
        <p className="pt-2 text-center text-[10px] text-muted">Powered by GIPHY</p>
      </div>
    </div>
  );
}
