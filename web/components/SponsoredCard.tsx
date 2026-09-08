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
      <PostCard post={promo} />
    </div>
  );
}