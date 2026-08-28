"use client";

import { displayImageUrl } from "@/lib/media";

import Link from "next/link";
import { useState } from "react";
import { Heart } from "lucide-react";
import { priceLabel, toggleSaved, type Listing } from "@/lib/market";
import { timeAgo } from "@/lib/feed";

export function ListingCard({ l, saved: initiallySaved = false, viewerId = null }: { l: Listing; saved?: boolean; viewerId?: string | null }) {
  const sold = l.status !== "available";
  const [saved, setSaved] = useState(initiallySaved);

  async function onHeart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!viewerId) return;
    const next = !saved;
    setSaved(next);
    try { await toggleSaved(l.id, next); } catch { setSaved(!next); }
  }

  return (
    <Link href={"/market/" + l.id} className="overflow-hidden rounded-lg border border-ink/10 transition-colors duration-[140ms] hover:bg-surface">
      <span className="relative block aspect-square bg-surface">
        {l.images?.[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={displayImageUrl(l.images[0])!} onError={(e) => { if (e.currentTarget.src !== l.images[0]) e.currentTarget.src = l.images[0]; }} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : null}
        {l.condition ? (
          <span className="absolute left-2 top-2 rounded-sm bg-ink/70 px-1.5 py-0.5 text-[10px] font-bold text-white">{l.condition}</span>
        ) : null}
        {viewerId ? (
          <button onClick={onHeart} title={saved ? "Unsave" : "Save"} className="absolute right-2 top-2 rounded-full bg-ink/60 p-1.5 transition-colors duration-[140ms] hover:bg-ink/80">
            <Heart size={15} className={saved ? "text-danger" : "text-white/85"} fill={saved ? "currentColor" : "none"} />
          </button>
        ) : null}
        {sold ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-[13px] font-extrabold tracking-widest text-white">
            {l.status === "sold" ? "SOLD" : "UNAVAILABLE"}
          </span>
        ) : null}
      </span>
      <span className="block px-3 py-2.5">
        <span className="block text-[15px] font-semibold text-pearl">{priceLabel(l)}</span>
        <span className="block truncate text-[13px] text-ink">{l.title}</span>
        <span className="block truncate text-[12px] text-ink/40">
          {[l.location_city, l.delivery_available ? "Delivers" : null, timeAgo(l.created_at)].filter(Boolean).join(" · ")}
        </span>
      </span>
    </Link>
  );
}