"use client";

import Link from "next/link";
import { priceLabel, type Listing } from "@/lib/market";
import { timeAgo } from "@/lib/feed";

export function ListingCard({ l }: { l: Listing }) {
  const sold = l.status !== "available";
  return (
    <Link href={"/market/" + l.id} className="overflow-hidden rounded-lg border border-white/10 transition-colors hover:bg-surface">
      <span className="relative block aspect-square bg-surface">
        {l.images?.[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={l.images[0]} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : null}
        {l.condition ? (
          <span className="absolute left-2 top-2 rounded-sm bg-ink/70 px-1.5 py-0.5 text-[10px] font-bold text-white">{l.condition}</span>
        ) : null}
        {sold ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-[13px] font-extrabold tracking-widest text-white">
            {l.status === "sold" ? "SOLD" : "UNAVAILABLE"}
          </span>
        ) : null}
      </span>
      <span className="block px-3 py-2">
        <span className="block text-[15px] font-semibold text-pearl">{priceLabel(l)}</span>
        <span className="block truncate text-[13px] text-white">{l.title}</span>
        <span className="block truncate text-[12px] text-white/40">
          {[l.location_city, l.delivery_available ? "Delivers" : null, timeAgo(l.created_at)].filter(Boolean).join(" · ")}
        </span>
      </span>
    </Link>
  );
}