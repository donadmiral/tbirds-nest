"use client";

import { useEffect, useRef } from "react";
import { PostCard } from "@/components/PostCard";
import { recordAdEvent, type PromoRow } from "@/lib/ads";

export function SponsoredCard({ promo }: { promo: PromoRow }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.intersectionRatio >= 0.5) {
        recordAdEvent(promo.promo_id, "impression");
        io.disconnect();
      }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [promo.promo_id]);

  return (
    <div ref={ref} onClickCapture={() => recordAdEvent(promo.promo_id, "click")} className="relative">
      <span className="absolute right-1 top-2 z-10 rounded-sm bg-surface px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/50">
        {promo.promo_label || "Sponsored"}
      </span>
      <PostCard post={promo} />
    </div>
  );
}