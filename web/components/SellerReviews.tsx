"use client";

import { useCallback, useEffect, useState } from "react";
import { Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/feed";

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer: { id: string; full_name: string | null; avatar_url: string | null } | null;
};

export function SellerReviews({ sellerId, listingId, viewerId }: { sellerId: string; listingId?: string | null; viewerId: string | null }) {
  const [avg, setAvg] = useState(0);
  const [count, setCount] = useState(0);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: rate }, { data: rows }] = await Promise.all([
      supabase.rpc("get_seller_rating", { p_seller_id: sellerId }),
      supabase
        .from("seller_reviews")
        .select("id, rating, comment, created_at, reviewer:profiles!seller_reviews_reviewer_id_fkey(id, full_name, avatar_url)")
        .eq("seller_id", sellerId)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    const r = Array.isArray(rate) ? rate[0] : rate;
    setAvg(Number(r?.avg_rating ?? 0));
    setCount(Number(r?.review_count ?? 0));
    setReviews((rows ?? []) as unknown as Review[]);
  }, [sellerId]);

  useEffect(() => { load(); }, [load]);

  async function submit() {
    if (busy) return;
    if (!viewerId) { setNote("Sign in to leave a review."); return; }
    if (rating < 1) { setNote("Pick a rating between one and five stars."); return; }
    setBusy(true);
    setNote(null);
    const supabase = createClient();
    const { error } = await supabase.from("seller_reviews").upsert({
      seller_id: sellerId, reviewer_id: viewerId, listing_id: listingId ?? null,
      rating, comment: comment.trim() || null, updated_at: new Date().toISOString(),
    }, { onConflict: "seller_id,reviewer_id,listing_id" });
    setBusy(false);
    if (error) { setNote(error.message); return; }
    setRating(0);
    setComment("");
    load();
  }

  return (
    <section className="mt-7 border-t border-ink/10 pt-5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold text-ink">Seller reviews</h2>
        {count > 0 ? (
          <span className="flex items-center gap-1 text-[13px] text-ink/50">
            <Star size={13} className="text-pearl" /> {avg.toFixed(1)} · {count}
          </span>
        ) : (
          <span className="text-[13px] text-ink/40">No reviews yet</span>
        )}
      </div>

      {viewerId && viewerId !== sellerId ? (
        <div className="mt-3 rounded-lg border border-ink/10 p-3">
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)} title={n + " stars"}>
                <Star size={20} className={n <= rating ? "text-pearl" : "text-ink/20"} fill={n <= rating ? "currentColor" : "none"} />
              </button>
            ))}
          </div>
          <textarea value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="How was this seller?"
            rows={2}
            className="mt-2 w-full resize-none rounded-md bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink/30 outline-none focus:bg-surface-elevated"
          />
          {note ? <p className="mt-1 text-[12px] text-danger">{note}</p> : null}
          <button onClick={submit} disabled={busy} className="mt-2 rounded-md bg-pearl px-4 py-2 text-[13px] font-semibold text-ink disabled:opacity-40">
            {busy ? "Saving" : "Post review"}
          </button>
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-3">
        {reviews.map((r) => (
          <div key={r.id} className="flex gap-3">
            {r.reviewer?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.reviewer.avatar_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-semibold text-white">
                {(r.reviewer?.full_name ?? "?").charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="font-semibold text-ink">{r.reviewer?.full_name ?? "Member"}</span>
                <span className="flex items-center gap-0.5 text-pearl">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} size={11} fill={n <= r.rating ? "currentColor" : "none"} className={n <= r.rating ? "" : "text-ink/20"} />
                  ))}
                </span>
                <span className="text-ink/40">{timeAgo(r.created_at)}</span>
              </div>
              {r.comment ? <p className="mt-0.5 text-[13px] text-ink/80">{r.comment}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}