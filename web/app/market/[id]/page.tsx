"use client";

import { profilePath } from "@/lib/profileLookup";
import { PersonName } from "@/components/PersonName";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Bookmark, Share2, MessageCircle, Check, Tag, CircleCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getListing, getSavedListingIds, toggleSaved, priceLabel, type Listing } from "@/lib/market";
import { SellerTrust } from "@/components/SellerTrust";
import { StoryAvatar } from "@/components/StoryAvatar";
import { MarketOrders } from "@/components/MarketOrders";
import { MarketReportForm } from "@/components/MarketReportForm";
import { SellerReviews } from "@/components/SellerReviews";
import { timeAgo } from "@/lib/feed";

export default function ListingPage() {
  const { id } = useParams<{ id: string }>();
  const [supabase] = useState(createClient);
  const router = useRouter();
  const [l, setL] = useState<Listing | null | undefined>(undefined);
  const [uid, setUid] = useState<string | null>(null);
  const [img, setImg] = useState(0);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerAmt, setOfferAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const messaging = useRef(false);
  const [savePending, setSavePending] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ data: sess, error: sessionError }, listing, savedIds] = await Promise.all([
          supabase.auth.getSession(), getListing(id), getSavedListingIds(),
        ]);
        if (sessionError) throw sessionError;
        if (cancelled) return;
        setLoadedId(id); setLoadError(false); setImg(0);
        setUid(sess.session?.user.id ?? null);
        setL(listing ?? null);
        setSaved(!!listing && savedIds.has(listing.id));
      } catch { if (!cancelled) { setLoadedId(id); setLoadError(true); } }
    })();
    return () => { cancelled = true; };
  }, [supabase, id, retry]);

  async function onSave() {
    if (!uid || !l) { router.push("/login"); return; }
    if (saving.current) return;
    saving.current = true;
    setSavePending(true);
    const next = !saved;
    setSaved(next);
    try { await toggleSaved(l.id, next); }
    catch { setSaved(!next); alert("Could not save listing. Please try again."); }
    finally { saving.current = false; setSavePending(false); }
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
    if (messaging.current) return;
    messaging.current = true;
    try {
      const { data, error } = await supabase.rpc("start_dm_ctx", { p_receiver_id: l.seller_id, p_context: "market", p_ref_id: l.id });
      if (error || !data) throw error || new Error("Could not start conversation");
      router.push("/market/messages?c=" + data);
    } catch { alert("Could not open the conversation. Please try again."); }
    finally { messaging.current = false; }
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

  async function blockSeller() {
    if (!uid || !l) { router.push("/login"); return; }
    if (!window.confirm("Block this seller? You will not see each other on Platinum Circles.")) return;
    const { error } = await supabase.from("blocked_users").upsert({ blocker_id: uid, blocked_id: l.seller_id });
    if (error) { alert("Could not block: " + error.message); return; }
    router.push("/market");
  }

  if (loadError && loadedId === id) return <p role="alert" className="py-16 text-center text-sm text-danger">Could not load listing. <button onClick={() => { setL(undefined); setLoadError(false); setRetry((n) => n + 1); }} className="underline">Retry</button></p>;
  if (l === undefined || loadedId !== id) return <p className="py-16 text-center text-sm text-muted">Loading</p>;
  if (l === null) {
    return (
      <div className="flex flex-col items-center gap-3 px-1 py-24 text-center">
        <h1 className="font-display text-2xl text-porcelain">This listing is not available</h1>
        <Link href="/market" className="mt-2 rounded-full bg-pearl px-5 py-2.5 text-sm font-bold text-on-pearl transition-opacity duration-[140ms] hover:opacity-90">Back to Market</Link>
      </div>
    );
  }

  const sold = l.status !== "available";
  const isOwner = uid === l.seller_id;
  const btn = "flex items-center gap-1.5 rounded-md bg-surface px-3.5 py-2 text-[13px] text-ink/80 transition-colors duration-[140ms] hover:bg-surface-elevated hover:text-ink";

  return (
    <div className="px-1">
      <Link href="/market" aria-label="Back to Market" className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink/60 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"><ArrowLeft size={19} /></Link>

      <div className="relative overflow-hidden rounded-lg bg-surface">
        {l.images?.[img] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={l.images[img]} alt="" className="max-h-[440px] w-full object-contain" />
        ) : (
          <div className="flex h-64 items-center justify-center text-muted">No photos</div>
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
            <img key={i} src={u} alt="" onClick={() => setImg(i)} className={"h-16 w-16 shrink-0 cursor-pointer rounded-md object-cover transition-opacity duration-[140ms] " + (i === img ? "ring-2 ring-pearl" : "opacity-60 hover:opacity-100")} />
          ))}
        </div>
      ) : null}

      <div className="mt-4">
        <p className="text-2xl font-semibold text-accent">{priceLabel(l)}</p>
        <h1 className="mt-0.5 text-xl font-semibold text-ink">{l.title}</h1>
        <p className="mt-1 text-[13px] text-muted">
          {[l.category, l.condition, l.location_city, timeAgo(l.created_at)].filter(Boolean).join(" · ")}
        </p>
      </div>

      <p className="mt-2 text-[13px] text-ink/60">Collection · Meet the seller{l.delivery_available ? " · Delivery" + (l.delivery_fee != null && Number(l.delivery_fee) > 0 ? " " + priceLabel({ ...l, price: Number(l.delivery_fee) }) : " available") : ""}</p>
      {l.delivery_available && l.delivery_note ? <p className="mt-0.5 text-[12px] text-muted">{l.delivery_note}</p> : null}

      {isOwner ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {!sold ? (
            <button onClick={markSold} disabled={busy} className="flex items-center gap-1.5 rounded-md bg-danger px-4 py-2 text-[13px] font-semibold text-ink transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">
              <CircleCheck size={16} /> Mark as sold
            </button>
          ) : (
            <span className="rounded-md bg-surface px-4 py-2 text-[13px] text-ink/60">This listing is marked {l.status}.</span>
          )}
          <button onClick={onSave} disabled={savePending} aria-pressed={saved} className={btn + (saved ? " text-accent" : "")}>
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
              <button onClick={messageSeller} className="flex items-center gap-1.5 rounded-md bg-pearl px-4 py-2 text-[13px] font-semibold text-on-pearl transition-opacity duration-[140ms] hover:opacity-90">
                <MessageCircle size={16} /> Message seller
              </button>
              <button onClick={() => setOfferOpen((v) => !v)} className={btn}>
                <Tag size={16} /> Make offer
              </button>
            </>
          ) : null}
          <button onClick={onSave} disabled={savePending} aria-pressed={saved} className={btn + (saved ? " text-accent" : "")}>
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
            className="w-44 rounded-md bg-surface px-4 py-2.5 text-[14px] text-ink placeholder:text-muted outline-none transition-colors duration-[140ms] focus:bg-surface-elevated"
          />
          <button onClick={sendOffer} disabled={busy} className="rounded-md bg-pearl px-4 py-2.5 text-[13px] font-semibold text-on-pearl transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">
            {busy ? "Sending" : "Send offer"}
          </button>
        </div>
      ) : null}

      {l.description ? (
        <article className="mt-6 whitespace-pre-wrap border-t border-ink/10 pt-5 text-[15px] leading-relaxed text-ink/90">
          {l.description}
        </article>
      ) : null}

      {l.seller ? (
        <Link href={profilePath(l.seller.username, l.seller_id)} className="mt-6 flex items-center gap-3.5 rounded-lg border border-ink/10 p-4 transition-colors duration-[140ms] hover:bg-surface">
          {l.seller.avatar_url ? (
            <StoryAvatar userId={l.seller_id} name={l.seller.full_name} avatarUrl={l.seller.avatar_url} size={56} />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy text-[17px] font-semibold text-white">
              {(l.seller.full_name ?? "?").charAt(0).toUpperCase()}
            </span>
          )}
          <span className="min-w-0">
            <PersonName name={l.seller.full_name ?? ""} userId={l.seller_id} className="text-[15px] font-semibold text-ink" badgeSize={14} />
            <SellerTrust sellerId={l.seller_id} />
          </span>
        </Link>
      ) : null}

      {!isOwner ? (
        <p className="mt-4 flex gap-4 text-[12px] text-muted">
          <button onClick={() => { if (!uid) router.push("/login"); else setReportOpen(true); }} className="transition-colors duration-[140ms] hover:text-ink/70">Report listing</button>
          <button onClick={blockSeller} className="transition-colors duration-[140ms] hover:text-danger">Block seller</button>
        </p>
      ) : null}
      {reportOpen && uid && <MarketReportForm key={l.id + uid} kind="listing" id={l.id} userId={uid} onClose={() => setReportOpen(false)} />}
      <MarketOrders listing={l} />
      <SellerReviews sellerId={l.seller_id} listingId={l.id} viewerId={uid} />
    </div>
  );
}