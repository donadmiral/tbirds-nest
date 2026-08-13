"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Bookmark, Share2, MessageCircle, Check, Tag, CircleCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getListing, getSavedListingIds, toggleSaved, priceLabel, type Listing } from "@/lib/market";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { SellerTrust } from "@/components/SellerTrust";
import { SellerReviews } from "@/components/SellerReviews";
import { timeAgo } from "@/lib/feed";

export default function ListingPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const [l, setL] = useState<Listing | null | undefined>(undefined);
  const [uid, setUid] = useState<string | null>(null);
  const [img, setImg] = useState(0);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerAmt, setOfferAmt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: sess }, listing, savedIds] = await Promise.all([
        supabase.auth.getSession(),
        getListing(id),
        getSavedListingIds(),
      ]);
      setUid(sess.session?.user.id ?? null);
      setL(listing ?? null);
      if (listing) setSaved(savedIds.has(listing.id));
    })();
  }, [supabase, id]);

  async function onSave() {
    if (!uid || !l) { router.push("/login"); return; }
    const next = !saved;
    setSaved(next);
    try { await toggleSaved(l.id, next); } catch { setSaved(!next); }
  }

  async function onShare() {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ url }); return; } catch { /* cancelled */ }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function messageSeller(): Promise<void> {
    if (!uid || !l) { router.push("/login"); return; }
    const { data } = await supabase.rpc("start_dm_ctx", { p_receiver_id: l.seller_id, p_context: "market", p_ref_id: l.id });
    router.push(data ? "/market/messages?c=" + data : "/market/messages");
  }

  async function sendOffer() {
    if (!l || busy) return;
    const amt = Number(offerAmt.replace(/,/g, ""));
    if (!amt || amt <= 0) return;
    setBusy(true);
    const { error } = await supabase.rpc("make_offer", { p_listing_id: l.id, p_amount: amt });
    setBusy(false);
    if (error) { alert("Could not send the offer: " + error.message); return; }
    await messageSeller();
  }

  async function markSold() {
    if (!l || !uid || busy) return;
    if (!window.confirm("Mark as sold? Buyers will no longer see this listing.")) return;
    setBusy(true);
    const { error } = await supabase.from("marketplace_listings").update({ status: "sold" }).eq("id", l.id).eq("seller_id", uid);
    setBusy(false);
    if (error) { alert("Could not update: " + error.message); return; }
    setL({ ...l, status: "sold" });
  }

  async function reportListing() {
    if (!uid || !l) { router.push("/login"); return; }
    const reasons = ["scam", "prohibited", "misleading", "inappropriate", "duplicate", "other"];
    const pick = window.prompt("Report this listing. Type one reason: " + reasons.join(", "));
    if (!pick) return;
    const reason = reasons.includes(pick.trim().toLowerCase()) ? pick.trim().toLowerCase() : "other";
    const detail = window.prompt("Anything to add? Optional.") || null;
    const { error } = await supabase.from("listing_reports").upsert({
      listing_id: l.id, reporter_id: uid, reason, detail: detail?.trim() || null,
    });
    alert(error ? "Could not send the report: " + error.message : "Report sent. Thank you.");
  }

  async function blockSeller() {
    if (!uid || !l) { router.push("/login"); return; }
    if (!window.confirm("Block this seller? You will not see each other on Platinum Circles.")) return;
    const { error } = await supabase.from("blocked_users").upsert({ blocker_id: uid, blocked_id: l.seller_id });
    if (error) { alert("Could not block: " + error.message); return; }
    router.push("/market");
  }

  if (l === undefined) return <p className="py-16 text-center text-sm text-white/40">Loading</p>;
  if (l === null) {
    return (
      <div className="flex flex-col items-center gap-3 px-1 py-24 text-center">
        <h1 className="font-display text-2xl text-porcelain">This listing is not available</h1>
        <Link href="/market" className="mt-2 rounded-md bg-pearl px-5 py-2.5 text-sm font-semibold text-ink">Back to Market</Link>
      </div>
    );
  }

  const sold = l.status !== "available";
  const isOwner = uid === l.seller_id;
  const btn = "flex items-center gap-1.5 rounded-md bg-surface px-3.5 py-2 text-[13px] text-white/80 transition-colors hover:bg-surface-elevated hover:text-white";

  return (
    <div className="px-1">
      <Link href="/market" className="mb-4 inline-block text-sm text-white/50 hover:text-white">← Market</Link>

      <div className="relative overflow-hidden rounded-lg bg-surface">
        {l.images?.[img] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={l.images[img]} alt="" className="max-h-[440px] w-full object-contain" />
        ) : (
          <div className="flex h-64 items-center justify-center text-white/30">No photos</div>
        )}
        {sold ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-[16px] font-extrabold tracking-widest text-white">
            {l.status === "sold" ? "SOLD" : "UNAVAILABLE"}
          </span>
        ) : null}
      </div>
      {l.images?.length > 1 ? (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {l.images.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt="" onClick={() => setImg(i)} className={"h-16 w-16 shrink-0 cursor-pointer rounded-md object-cover " + (i === img ? "ring-2 ring-pearl" : "opacity-60 hover:opacity-100")} />
          ))}
        </div>
      ) : null}

      <div className="mt-4">
        <p className="text-2xl font-semibold text-pearl">{priceLabel(l)}</p>
        <h1 className="mt-0.5 text-xl font-semibold text-white">{l.title}</h1>
        <p className="mt-1 text-[13px] text-white/40">
          {[l.category, l.condition, l.location_city, timeAgo(l.created_at)].filter(Boolean).join(" · ")}
        </p>
      </div>

      <p className="mt-2 text-[13px] text-white/60">Collection · Meet the seller{l.delivery_available ? " · Delivery" + (l.delivery_fee != null && Number(l.delivery_fee) > 0 ? " " + priceLabel({ ...l, price: Number(l.delivery_fee) }) : " available") : ""}</p>
      {l.delivery_available && l.delivery_note ? <p className="mt-0.5 text-[12px] text-white/40">{l.delivery_note}</p> : null}

      {isOwner ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {!sold ? (
            <button onClick={markSold} disabled={busy} className="flex items-center gap-1.5 rounded-md bg-danger px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
              <CircleCheck size={16} /> Mark as sold
            </button>
          ) : (
            <span className="rounded-md bg-surface px-4 py-2 text-[13px] text-white/60">This listing is marked {l.status}.</span>
          )}
          <button onClick={onSave} className={btn + (saved ? " text-pearl" : "")}>
            <Bookmark size={16} fill={saved ? "currentColor" : "none"} /> {saved ? "Saved" : "Save"}
          </button>
          <button onClick={onShare} className={btn}>
            {copied ? <Check size={16} className="text-success" /> : <Share2 size={16} />} Share
          </button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {!sold ? (
            <>
              <button onClick={messageSeller} className="flex items-center gap-1.5 rounded-md bg-pearl px-4 py-2 text-[13px] font-semibold text-ink transition-opacity hover:opacity-90">
                <MessageCircle size={16} /> Message seller
              </button>
              <button onClick={() => setOfferOpen((v) => !v)} className={btn}>
                <Tag size={16} /> Make offer
              </button>
            </>
          ) : null}
          <button onClick={onSave} className={btn + (saved ? " text-pearl" : "")}>
            <Bookmark size={16} fill={saved ? "currentColor" : "none"} /> {saved ? "Saved" : "Save"}
          </button>
          <button onClick={onShare} className={btn}>
            {copied ? <Check size={16} className="text-success" /> : <Share2 size={16} />} Share
          </button>
        </div>
      )}

      {offerOpen && !sold && !isOwner ? (
        <div className="mt-3 flex gap-2">
          <input value={offerAmt}
            onChange={(e) => setOfferAmt(e.target.value)}
            placeholder={"Your offer in " + l.currency}
            inputMode="numeric"
            className="w-44 rounded-md bg-surface px-4 py-2.5 text-[14px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated"
          />
          <button onClick={sendOffer} disabled={busy} className="rounded-md bg-pearl px-4 py-2.5 text-[13px] font-semibold text-ink disabled:opacity-40">
            {busy ? "Sending" : "Send offer"}
          </button>
        </div>
      ) : null}

      {l.description ? (
        <article className="mt-6 whitespace-pre-wrap border-t border-white/10 pt-5 text-[15px] leading-relaxed text-white/90">
          {l.description}
        </article>
      ) : null}

      {l.seller ? (
        <Link href={l.seller.username ? "/" + l.seller.username : "#"} className="mt-6 flex items-center gap-3 rounded-lg border border-white/10 p-4 transition-colors hover:bg-surface">
          {l.seller.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={l.seller.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-navy text-sm font-semibold text-porcelain">
              {(l.seller.full_name ?? "?").charAt(0).toUpperCase()}
            </span>
          )}
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-[14px] font-semibold text-white">
              {l.seller.full_name}
              {l.seller.is_verified ? <VerifiedBadge size={14} /> : null}
            </span>
            <SellerTrust sellerId={l.seller_id} />
          </span>
        </Link>
      ) : null}

      {!isOwner ? (
        <p className="mt-4 flex gap-4 text-[12px] text-white/40">
          <button onClick={reportListing} className="hover:text-white/70">Report listing</button>
          <button onClick={blockSeller} className="hover:text-danger">Block seller</button>
        </p>
      ) : null}
      <SellerReviews sellerId={l.seller_id} listingId={l.id} viewerId={uid} />
    </div>
  );
}