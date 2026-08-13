"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Clock, MapPin, Phone, Globe, Star, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { openNow, todaySummary, hasHours, DAY_ORDER, DAY_LABEL, type Hours } from "@/lib/businessHours";
import { StoryAvatar } from "@/components/StoryAvatar";
import { timeAgo } from "@/lib/feed";

type Biz = { hours: Hours | null; avg_rating: number | null; review_count: number | null; category: string | null; phone: string | null; email: string | null; website: string | null; address: string | null };
type Product = { product_id: string; post_id: string; title: string; subtitle: string | null; price: number | null; currency: string | null; image_url: string | null; listing_id: string | null; link_url: string | null; cta_label: string | null };
type Review = { review_id: string; rating: number; body: string | null; created_at: string; reviewer_id: string; reviewer_name: string | null; reviewer_username: string | null; reviewer_avatar: string | null; is_mine: boolean };

export function BusinessProfile({ profileId, postsSlot }: { profileId: string; postsSlot: React.ReactNode }) {
  const supabase = useRef(createClient()).current;
  const [biz, setBiz] = useState<Biz | null>(null);
  const [tab, setTab] = useState<"posts" | "products" | "reviews">("posts");
  const [weekOpen, setWeekOpen] = useState(false);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [myRating, setMyRating] = useState(0);
  const [myBody, setMyBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("business_profiles")
      .select("hours, avg_rating, review_count, category, phone, email, website, address")
      .eq("profile_id", profileId)
      .maybeSingle()
      .then(({ data }) => setBiz((data ?? {}) as Biz));
  }, [supabase, profileId]);

  const loadProducts = useCallback(() => {
    supabase.rpc("get_business_products", { p_business_id: profileId, p_limit: 60 }).then(({ data }) => setProducts((data ?? []) as Product[]));
  }, [supabase, profileId]);
  const loadReviews = useCallback(() => {
    supabase.rpc("get_business_reviews", { p_business_id: profileId, p_limit: 30 }).then(({ data }) => setReviews((data ?? []) as Review[]));
  }, [supabase, profileId]);

  useEffect(() => {
    if (tab === "products" && products === null) loadProducts();
    if (tab === "reviews" && reviews === null) loadReviews();
  }, [tab, products, reviews, loadProducts, loadReviews]);

  async function submitReview() {
    if (busy || myRating < 1) { if (myRating < 1) setNote("Pick a rating between one and five stars."); return; }
    setBusy(true);
    setNote(null);
    const { error } = await supabase.rpc("set_business_review", { p_business_id: profileId, p_rating: myRating, p_body: myBody.trim() || null });
    setBusy(false);
    if (error) { setNote(error.message); return; }
    setMyRating(0);
    setMyBody("");
    loadReviews();
  }

  const open = openNow(biz?.hours);
  const summary = todaySummary(biz?.hours);
  const tabBtn = (k: typeof tab, label: string) =>
    <button key={k} onClick={() => setTab(k)} className={"flex-1 py-3 text-[14px] transition-colors " + (tab === k ? "font-semibold text-white" : "text-white/50 hover:text-white/80")}>
      <span className={"border-b-2 pb-2.5 " + (tab === k ? "border-pearl" : "border-transparent")}>{label}</span>
    </button>;

  return (
    <div>
      {biz ? (
        <div className="flex flex-col gap-1.5 px-1 pb-4">
          {summary ? (
            <button onClick={() => setWeekOpen((v) => !v)} className="flex items-center gap-2 text-left text-[13px]">
              <Clock size={14} className={open ? "text-success" : "text-danger"} />
              <span className={"font-semibold " + (open ? "text-success" : "text-danger")}>{open ? "Open" : "Closed"}</span>
              <span className="text-white/60">· {summary}</span>
              {weekOpen ? <ChevronUp size={13} className="text-white/40" /> : <ChevronDown size={13} className="text-white/40" />}
            </button>
          ) : null}
          {weekOpen && hasHours(biz.hours) ? (
            <div className="ml-6 flex flex-col gap-0.5 text-[12px] text-white/60">
              {DAY_ORDER.map((d) => (
                <span key={d} className="flex gap-3">
                  <span className="w-20 text-white/40">{DAY_LABEL[d]}</span>
                  <span>{(biz.hours?.[d] ?? []).length > 0 ? (biz.hours![d]).map((r) => r[0] + " – " + r[1]).join(", ") : "Closed"}</span>
                </span>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-white/55">
            {(biz.review_count ?? 0) > 0 ? (
              <span className="flex items-center gap-1 font-semibold text-pearl"><Star size={13} fill="currentColor" /> {Number(biz.avg_rating ?? 0).toFixed(1)} <span className="font-normal text-white/45">({biz.review_count})</span></span>
            ) : null}
            {biz.address ? <span className="flex items-center gap-1"><MapPin size={13} /> {biz.address}</span> : null}
            {biz.phone ? <a href={"tel:" + biz.phone} className="flex items-center gap-1 hover:text-white"><Phone size={13} /> {biz.phone}</a> : null}
            {biz.website ? <a href={biz.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-white"><Globe size={13} /> Website</a> : null}
          </div>
        </div>
      ) : null}

      <div className="flex border-b border-white/10">
        {tabBtn("posts", "Posts")}
        {tabBtn("products", "Products")}
        {tabBtn("reviews", "Reviews")}
      </div>

      {tab === "posts" ? postsSlot : null}

      {tab === "products" ? (
        products === null ? <p className="py-12 text-center text-sm text-white/40">Loading</p>
        : products.length === 0 ? <p className="py-12 text-center text-sm text-white/40">No products yet.</p>
        : (
          <div className="grid grid-cols-2 gap-3 pt-4 sm:grid-cols-3">
            {products.map((p) => {
              const inner = (
                <>
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" loading="lazy" className="aspect-square w-full bg-surface object-cover" />
                  ) : <span className="block aspect-square w-full bg-surface" />}
                  <span className="block px-3 py-2">
                    <span className="flex items-center gap-1 truncate text-[13px] font-semibold text-white">{p.title}{p.link_url ? <ExternalLink size={11} className="shrink-0 text-white/40" /> : null}</span>
                    {p.subtitle ? <span className="block truncate text-[12px] text-white/45">{p.subtitle}</span> : null}
                    {p.price != null ? <span className="block text-[13px] text-pearl">{(p.currency === "USD" ? "$" : (p.currency ?? "") + " ") + Number(p.price).toLocaleString()}</span> : null}
                  </span>
                </>
              );
              return p.listing_id ? (
                <Link key={p.product_id} href={"/market/" + p.listing_id} className="overflow-hidden rounded-lg border border-white/10 transition-colors hover:bg-surface">{inner}</Link>
              ) : (
                <a key={p.product_id} href={p.link_url ?? "#"} target="_blank" rel="noopener noreferrer" className="overflow-hidden rounded-lg border border-white/10 transition-colors hover:bg-surface">{inner}</a>
              );
            })}
          </div>
        )
      ) : null}

      {tab === "reviews" ? (
        <div className="pt-4">
          <div className="rounded-lg border border-white/10 p-3">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setMyRating(n)} title={n + " stars"}>
                  <Star size={20} className={n <= myRating ? "text-pearl" : "text-white/20"} fill={n <= myRating ? "currentColor" : "none"} />
                </button>
              ))}
            </div>
            <textarea value={myBody} onChange={(e) => setMyBody(e.target.value)} placeholder="How was this business?" rows={2} className="mt-2 w-full resize-none rounded-md bg-surface px-3 py-2 text-[13px] text-white placeholder:text-white/30 outline-none" />
            {note ? <p className="mt-1 text-[12px] text-danger">{note}</p> : null}
            <button onClick={submitReview} disabled={busy} className="mt-2 rounded-md bg-pearl px-4 py-2 text-[13px] font-semibold text-ink disabled:opacity-40">{busy ? "Saving" : "Post review"}</button>
          </div>
          {reviews === null ? <p className="py-10 text-center text-sm text-white/40">Loading</p>
          : reviews.length === 0 ? <p className="py-10 text-center text-sm text-white/40">No reviews yet.</p>
          : (
            <div className="mt-4 flex flex-col gap-3">
              {reviews.map((r) => (
                <div key={r.review_id} className="flex gap-3">
                  <StoryAvatar userId={r.reviewer_id} name={r.reviewer_name} avatarUrl={r.reviewer_avatar} size={36} href={r.reviewer_username ? "/" + r.reviewer_username : null} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[13px]">
                      <span className="font-semibold text-white">{r.reviewer_name ?? "Member"}{r.is_mine ? <span className="ml-1 text-[11px] text-pearl">· You</span> : null}</span>
                      <span className="flex items-center gap-0.5 text-pearl">
                        {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={11} fill={n <= r.rating ? "currentColor" : "none"} className={n <= r.rating ? "" : "text-white/20"} />)}
                      </span>
                      <span className="text-white/40">{timeAgo(r.created_at)}</span>
                    </p>
                    {r.body ? <p className="mt-0.5 text-[13px] text-white/80">{r.body}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}