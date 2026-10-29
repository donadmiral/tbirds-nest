"use client";

import Link from 'next/link';
import { ArrowRight, ChevronLeft, ChevronRight, ShieldCheck, Star } from 'lucide-react';
import { useRef } from 'react';
import { marketplacePrice, marketplaceReputation, type MarketplaceRecommendation } from '../../shared/marketplaceRecommendations';

export function MarketplaceShelf({ items }: { items: MarketplaceRecommendation[] }) {
  const rail = useRef<HTMLDivElement>(null);
  if (!items.length) return null;
  return <section aria-label="From the marketplace" className="my-5 rounded-2xl border border-ink/10 bg-surface-elevated p-4 text-ink">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div><h2 className="text-[16px] font-semibold">From the marketplace</h2><p className="mt-1 text-xs text-muted">Discover sellers and their latest finds</p></div>
      <Link href="/market" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold">Explore <ArrowRight size={15}/></Link>
    </div>
    <div ref={rail} role="list" tabIndex={0} aria-label="Marketplace listings. Scroll sideways for more."
      className="flex gap-3 overflow-x-auto overscroll-x-contain pb-2 [scrollbar-width:thin]"
      style={{ scrollSnapType: 'x proximity' }}>
      {items.map(item => <Link key={item.id} role="listitem" href={'/market/' + item.id}
        aria-label={`${item.title}, ${marketplacePrice(item)}, ${marketplaceReputation(item)}`}
        className="w-40 shrink-0 overflow-hidden rounded-xl border border-ink/10 bg-surface outline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
        style={{ scrollSnapAlign: 'start' }}>
        {/* Keep the layout fixed while lazy images arrive. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.image_url} alt={item.title} loading="lazy" decoding="async" width={160} height={124} className="h-[124px] w-full object-cover" />
        <div className="space-y-1.5 p-3">
          <p className="truncate text-sm font-semibold">{marketplacePrice(item)}</p>
          <p className="line-clamp-2 min-h-9 text-xs leading-[18px]">{item.title}</p>
          <p className="flex items-center gap-1 text-xs text-muted">{Number(item.review_count) > 0 ? <Star size={12} className="shrink-0" /> : item.seller_verified ? <ShieldCheck size={12} className="shrink-0" /> : null}{marketplaceReputation(item)}</p>
          <p className="truncate text-[11px] text-muted">{item.seller_name}</p>
        </div>
      </Link>)}
    </div>
    {items.length > 2 ? <div className="mt-1 flex justify-end gap-1">
      <button type="button" aria-label="Previous marketplace listings" className="grid h-11 w-11 place-items-center rounded-full hover:bg-surface" onClick={() => rail.current?.scrollBy({ left: -344, behavior: 'smooth' })}><ChevronLeft size={18}/></button>
      <button type="button" aria-label="Next marketplace listings" className="grid h-11 w-11 place-items-center rounded-full hover:bg-surface" onClick={() => rail.current?.scrollBy({ left: 344, behavior: 'smooth' })}><ChevronRight size={18}/></button>
    </div> : null}
  </section>;
}
