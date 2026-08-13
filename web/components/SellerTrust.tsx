"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function SellerTrust({ sellerId }: { sellerId: string }) {
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const [{ data: prof }, { count: sold }, { data: rate }] = await Promise.all([
        supabase.from("profiles").select("created_at, is_verified").eq("id", sellerId).maybeSingle(),
        supabase.from("marketplace_listings").select("id", { count: "exact", head: true }).eq("seller_id", sellerId).eq("status", "sold"),
        supabase.rpc("get_seller_rating", { p_seller_id: sellerId }),
      ]);
      const r = Array.isArray(rate) ? rate[0] : rate;
      const avg = Number(r?.avg_rating ?? 0);
      const reviews = Number(r?.review_count ?? 0);
      const joined = prof?.created_at ? new Date(prof.created_at) : null;
      const months = joined ? Math.max(0, Math.round((Date.now() - joined.getTime()) / 2592000000)) : null;
      const age = months === null ? null
        : months < 1 ? "Joined this month"
        : months < 12 ? "Joined " + months + (months === 1 ? " month ago" : " months ago")
        : "Joined " + Math.round(months / 12) + (Math.round(months / 12) === 1 ? " year ago" : " years ago");
      const bits: string[] = [];
      if (reviews > 0) bits.push("★ " + avg.toFixed(1) + " (" + reviews + ")");
      else bits.push("New seller");
      if ((sold ?? 0) > 0) bits.push(sold + " sold");
      if (age) bits.push(age);
      setLine(bits.join(" · "));
    })();
  }, [sellerId]);

  if (!line) return null;
  return (
    <span className="flex items-center gap-1 text-[12px] text-white/50">
      <Star size={12} className="text-pearl" /> {line}
    </span>
  );
}