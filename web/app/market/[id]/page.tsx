"use client";

import { profilePath } from "@/lib/profileLookup";
import { PersonName } from "@/components/PersonName";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Bookmark, Share2, MessageCircle, Check, Tag, CircleCheck, MapPin, Truck, Package, ImageIcon, Flag, ShieldBan } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getListing, getSavedListingIds, toggleSaved, priceLabel, type Listing } from "@/lib/market";
import { SellerTrust } from "@/components/SellerTrust";
import { MarketOrders } from "@/components/MarketOrders";
import { MarketReportForm } from "@/components/MarketReportForm";
import { SellerReviews } from "@/components/SellerReviews";
import { RelativeTime } from "@/components/RelativeTime";
import { ProductDialog } from "@/components/ProductDialog";
import styles from "../MarketWorkspace.module.css";

export default function ListingPage() {
  const { id } = useParams<{ id: string }>();
  return <ListingDetails key={id} id={id} />;
}
function ListingDetails({ id }: { id: string }) {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const [listing, setListing] = useState<Listing | null | undefined>();
  const [uid, setUid] = useState<string | null>(null);
  const [img, setImg] = useState(0);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerReview, setOfferReview] = useState(false);
  const [offerAmt, setOfferAmt] = useState("");
  const [confirmation, setConfirmation] = useState<"sold" | "block" | null>(null);
  const [busy, setBusy] = useState(false);
  const [messagePending, setMessagePending] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState("");
  const [status, setStatus] = useState("");
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const saving = useRef(false), messaging = useRef(false), mutating = useRef(false);
  const generation = useRef(0);
  const account = useRef<string | null | undefined>(undefined);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    const token = ++generation.current;
    saving.current = false; messaging.current = false; mutating.current = false;
    (async () => {
      try {
        const [{ data: session, error: sessionError }, result, savedIds] = await Promise.all([
          supabase.auth.getSession(), getListing(id), getSavedListingIds(),
        ]);
        if (sessionError) throw sessionError;
        if (!active || token !== generation.current) return;
        const viewer = session.session?.user.id ?? null;
        account.current = viewer; setUid(viewer); setListing(result ?? null);
        setSaved(!!result && savedIds.has(result.id)); setLoadedId(id);
      } catch { if (active && token === generation.current) { setLoadedId(id); setLoadError(true); } }
    })();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (account.current === next) return;
      account.current = next; generation.current++; setUid(next); setListing(undefined); setLoadedId(null);
      setLoadError(false); setImg(0); setSaved(false); setCopied(false);
      setOfferOpen(false); setOfferReview(false); setOfferAmt(""); setReportOpen(false); setConfirmation(null);
      setBusy(false); setMessagePending(false); setSavePending(false); setActionError(""); setStatus("");
      queueMicrotask(() => { if (active) setRetry(value => value + 1); });
    });
    return () => { active = false; generation.current++; listener.subscription.unsubscribe(); if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, [supabase, id, retry]);

  async function currentAccount() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !uid || data.session?.user.id !== uid) throw new Error("Your account changed. Refresh before continuing.");
  }
  async function onSave() {
    if (!uid || !listing) { router.push("/login"); return; }
    if (saving.current) return;
    const token = generation.current, next = !saved;
    saving.current = true; setSavePending(true); setSaved(next); setActionError("");
    try { await currentAccount(); if (token !== generation.current) return; await toggleSaved(listing.id, next); }
    catch { if (token === generation.current) { setSaved(!next); setActionError("Could not save this listing. Please try again."); } }
    finally { if (token === generation.current) { saving.current = false; setSavePending(false); } }
  }
  async function onShare() {
    const token = generation.current, url = window.location.origin + "/market/" + id;
    setActionError("");
    try {
      if (navigator.share) {
        try { await navigator.share({ title: listing?.title, url }); return; }
        catch (reason) { if (reason instanceof Error && reason.name === "AbortError") return; }
      }
      await navigator.clipboard.writeText(url);
      if (token !== generation.current) return;
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch { if (token === generation.current) setActionError("The link couldn’t be copied. Copy the page address to share this item."); }
  }
  async function messageSeller() {
    if (!uid || !listing) { router.push("/login"); return; }
    if (messaging.current) return;
    const token = generation.current;
    messaging.current = true; setMessagePending(true); setActionError("");
    try {
      await currentAccount(); if (token !== generation.current) return;
      const { data, error } = await supabase.rpc("start_dm_ctx", { p_receiver_id: listing.seller_id, p_context: "market", p_ref_id: listing.id });
      if (error || !data) throw error || new Error("Conversation unavailable");
      if (token === generation.current) router.push("/market/messages?c=" + encodeURIComponent(String(data)));
    } catch { if (token === generation.current) setActionError("Could not open the conversation. Please try again."); }
    finally { if (token === generation.current) { messaging.current = false; setMessagePending(false); } }
  }
  function reviewOffer() {
    const amount = Number(offerAmt.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) { setActionError("Enter an offer greater than zero."); return; }
    setActionError(""); setOfferReview(true);
  }
  async function sendOffer() {
    if (!listing || !uid || mutating.current || !offerReview) return;
    const amount = Number(offerAmt.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) { setActionError("Enter an offer greater than zero."); return; }
    const token = generation.current;
    mutating.current = true; setBusy(true); setActionError("");
    try {
      await currentAccount(); if (token !== generation.current) return;
      const { error } = await supabase.rpc("make_offer", { p_listing_id: listing.id, p_amount: amount });
      if (error) throw error;
      if (token !== generation.current) return;
      setOfferOpen(false); setOfferReview(false); setOfferAmt(""); setStatus("Offer sent to the seller.");
      await messageSeller();
    } catch { if (token === generation.current) setActionError("The offer could not be confirmed. Check Market messages before trying again."); }
    finally { if (token === generation.current) { mutating.current = false; setBusy(false); } }
  }
  async function confirmAction() {
    if (!listing || !uid || !confirmation || mutating.current) return;
    const token = generation.current;
    mutating.current = true; setBusy(true); setActionError("");
    try {
      await currentAccount(); if (token !== generation.current) return;
      if (confirmation === "sold") {
        const { data, error } = await supabase.from("marketplace_listings").update({ status: "sold" }).eq("id", listing.id).eq("seller_id", uid).select("id, status").maybeSingle();
        if (error || !data) throw error || new Error("Listing change unavailable");
        if (token === generation.current) { setListing({ ...listing, status: data.status }); setConfirmation(null); setStatus("This listing is marked as sold."); }
      } else {
        const { error } = await supabase.from("blocked_users").upsert({ blocker_id: uid, blocked_id: listing.seller_id });
        if (error) throw error;
        if (token === generation.current) router.push("/market");
      }
    } catch { if (token === generation.current) setActionError("The change could not be confirmed. Please try again."); }
    finally { if (token === generation.current) { mutating.current = false; setBusy(false); } }
  }

  if (loadError && loadedId === id) return <div className={styles.workspace}><Link href="/market" className={styles.back}><ArrowLeft size={17} aria-hidden />Back to Market</Link><div role="alert" className={styles.state}><Package size={28} aria-hidden /><h1 className="text-xl font-bold">We couldn’t load this listing</h1><p>Check your connection and try again.</p><button onClick={() => { setLoadedId(null); setListing(undefined); setLoadError(false); setRetry(value => value + 1); }} className={styles.primary}>Try again</button></div></div>;
  if (listing === undefined || loadedId !== id) return <div className={styles.state} role="status"><p>Loading listing…</p></div>;
  if (listing === null) return <div className={styles.state}><Package size={28} aria-hidden /><h1 className="text-xl font-bold">This listing is not available</h1><p>It may have been sold, removed, or made unavailable.</p><Link href="/market" className={styles.primary}>Back to Market</Link></div>;
  const sold = listing.status !== "available", isOwner = uid === listing.seller_id;
  return <div className={styles.workspace}>
    <Link href="/market" className={styles.back}><ArrowLeft size={17} aria-hidden />Back to Market</Link>
    <div className={styles.detail}>
      <div className={styles.detailMain}>
        <div className={styles.gallery}>{listing.images?.[img] ? <img src={listing.images[img]} alt={listing.title + ", photo " + (img + 1)} /> : <div className={styles.help}><ImageIcon size={32} aria-hidden /><p>No photos available</p></div>}{sold ? <span className={styles.sold}>{listing.status === "sold" ? "SOLD" : "UNAVAILABLE"}</span> : null}</div>
        {listing.images?.length > 1 ? <div className={styles.thumbnails} role="group" aria-label="Listing photos">{listing.images.map((url, index) => <button type="button" key={index} aria-label={"Show photo " + (index + 1) + " of " + listing.images.length} aria-pressed={img === index} onClick={() => setImg(index)}><img src={url} alt="" /></button>)}</div> : null}
        {listing.description ? <section className={styles.panel}><h2>About this item</h2><p className={styles.description}>{listing.description}</p></section> : null}
        {listing.seller ? <section className={styles.panel}><h2>Meet the seller</h2><div className={styles.seller}>{listing.seller.avatar_url ? <img className={styles.avatar} src={listing.seller.avatar_url} alt="" /> : <span className={styles.avatar} aria-hidden>{(listing.seller.full_name ?? "?").charAt(0).toUpperCase()}</span>}<div><PersonName name={listing.seller.full_name ?? ""} userId={listing.seller_id} className="text-sm font-semibold" badgeSize={14} /><SellerTrust sellerId={listing.seller_id} /></div><Link href={profilePath(listing.seller.username, listing.seller_id)} className={styles.button}>View profile <ArrowRight size={15} aria-hidden /></Link></div></section> : null}
        <section className={styles.panel + " " + styles.reviews}><SellerReviews sellerId={listing.seller_id} listingId={listing.id} viewerId={uid} /></section>
      </div>
      <aside className={styles.detailSide} aria-label="Item details and orders">
        <section className={styles.panel}>
          <h1 className={styles.detailTitle}>{listing.title}</h1><p className={styles.price}>{priceLabel(listing)}</p>
          <div className={styles.meta}>{listing.category ? <span><Tag size={14} aria-hidden />{listing.category}</span> : null}{listing.condition ? <span>{listing.condition}</span> : null}{listing.location_city ? <span><MapPin size={14} aria-hidden />{listing.location_city}</span> : null}<span><RelativeTime dateTime={listing.created_at} /></span></div>
          <p className={styles.notice + " mt-5"}><Truck size={19} aria-hidden /><span>Collection arranged with the seller{listing.delivery_available ? ". Delivery " + (listing.delivery_fee != null && Number(listing.delivery_fee) > 0 ? priceLabel({ ...listing, price: Number(listing.delivery_fee) }) : "available") : ""}.{listing.delivery_available && listing.delivery_note ? <span className="mt-1 block">{listing.delivery_note}</span> : null}</span></p>
          <div className={styles.actions + " mt-5"}>{isOwner ? !sold ? <button onClick={() => { setActionError(""); setConfirmation("sold"); }} className={styles.primary}><CircleCheck size={17} aria-hidden />Mark as sold</button> : <p className={styles.help}>This listing is marked {listing.status}.</p> : !sold ? <><button onClick={() => void messageSeller()} disabled={messagePending} className={styles.primary}><MessageCircle size={17} aria-hidden />{messagePending ? "Opening…" : "Message seller"}</button><button onClick={() => { if (!uid) { router.push("/login"); return; } setActionError(""); setOfferReview(false); setOfferOpen(true); }} className={styles.button}><Tag size={17} aria-hidden />Make offer</button></> : null}</div>
          <div className={styles.actions + " mt-3"}><button onClick={() => void onSave()} disabled={savePending} aria-pressed={saved} className={styles.button}><Bookmark size={17} fill={saved ? "currentColor" : "none"} aria-hidden />{saved ? "Saved" : "Save"}</button><button onClick={() => void onShare()} className={styles.button}>{copied ? <Check size={17} aria-hidden /> : <Share2 size={17} aria-hidden />}{copied ? "Link copied" : "Share"}</button><Link href="/market/orders" className={styles.button}><Package size={17} aria-hidden />Your orders</Link></div>
          {actionError && !offerOpen && !confirmation ? <p role="alert" className={styles.error + " mt-3"}>{actionError}</p> : null}{status ? <p role="status" className={styles.help + " mt-3"}>{status}</p> : null}
        </section>
        <MarketOrders listing={listing} />
        {!isOwner ? <div className={styles.actions}><button onClick={() => { if (!uid) router.push("/login"); else setReportOpen(true); }} className={styles.button}><Flag size={15} aria-hidden />Report listing</button><button onClick={() => { if (!uid) { router.push("/login"); return; } setActionError(""); setConfirmation("block"); }} className={styles.button}><ShieldBan size={15} aria-hidden />Block seller</button></div> : null}
      </aside>
    </div>
    {reportOpen && uid ? <MarketReportForm key={listing.id + uid} kind="listing" id={listing.id} userId={uid} onClose={() => setReportOpen(false)} /> : null}
    <ProductDialog open={offerOpen} title={offerReview ? "Review offer" : "Make an offer"} description={listing.title} busy={busy} onClose={() => setOfferOpen(false)}>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); if (offerReview) void sendOffer(); else reviewOffer(); }}>
        {offerReview ? <dl className={styles.review}><div><dt>Your offer</dt><dd>{priceLabel({ ...listing, price: Number(offerAmt.replace(/,/g, "")) })}</dd></div><div><dt>Listed price</dt><dd>{priceLabel(listing)}</dd></div><div><dt>Sent to</dt><dd>{listing.seller?.full_name ?? "The seller"}</dd></div></dl> : <label>Your offer ({listing.currency})<input type="number" min="0.01" step="0.01" inputMode="decimal" required value={offerAmt} onChange={event => setOfferAmt(event.target.value)} /></label>}
        <p className={styles.notice}>The seller will receive your offer in Market messages. Sending an offer does not charge you.</p>
        {actionError ? <p role="alert" className={styles.error}>{actionError}</p> : null}
        <div className={styles.actions}><button type="button" disabled={busy} className={styles.button} onClick={() => offerReview ? setOfferReview(false) : setOfferOpen(false)}>{offerReview ? "Edit offer" : "Cancel"}</button><button type="submit" disabled={busy} className={styles.primary}>{busy ? "Sending…" : offerReview ? "Send offer" : "Review offer"}</button></div>
      </form>
    </ProductDialog>
    <ProductDialog open={confirmation !== null} title={confirmation === "sold" ? "Mark this item as sold?" : "Block this seller?"} busy={busy} onClose={() => setConfirmation(null)}>
      <p className={styles.help}>{confirmation === "sold" ? "New buyers will no longer be able to request this item. Existing orders remain in Your orders." : "You will not see each other on Platinum Circles. Your existing order history remains available."}</p>
      {actionError ? <p role="alert" className={styles.error + " mt-3"}>{actionError}</p> : null}
      <div className={styles.actions + " mt-5"}><button disabled={busy} onClick={() => setConfirmation(null)} className={styles.button}>Cancel</button><button disabled={busy} onClick={() => void confirmAction()} className={styles.primary}>{busy ? "Saving…" : confirmation === "sold" ? "Mark as sold" : "Block seller"}</button></div>
    </ProductDialog>
  </div>;
}
