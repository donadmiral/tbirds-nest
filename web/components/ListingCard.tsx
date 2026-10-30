"use client";
import NextImage from "next/image";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Heart, ImageIcon, MapPin, Truck } from "lucide-react";
import { priceLabel, toggleSaved, type Listing } from "@/lib/market";
import { RelativeTime } from "@/components/RelativeTime";
import styles from "@/app/market/MarketWorkspace.module.css";

type ListingCardProps = { l: Listing; saved?: boolean; viewerId?: string | null; onSavedChange?: (on: boolean) => void };
export function ListingCard(props: ListingCardProps) {
  return <ListingCardContent key={`${props.viewerId ?? "guest"}:${props.l.id}`} {...props} />;
}
function ListingCardContent({ l, saved: initiallySaved = false, viewerId = null, onSavedChange }: ListingCardProps) {
  const router = useRouter();
  const sold = l.status !== "available";
  const [optimisticSaved, setSaved] = useState<boolean | null>(null);
  const saved = optimisticSaved ?? initiallySaved;
  const saving = useRef(false);
  const generation = useRef(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { generation.current += 1; return () => { generation.current += 1; }; }, []);
  async function onHeart() {
    if (!viewerId) { router.push("/login"); return; }
    if (saving.current) return;
    const token = generation.current;
    saving.current = true; setPending(true); setError("");
    const next = !saved; setSaved(next);
    try { await toggleSaved(l.id, next); if (token === generation.current) { onSavedChange?.(next); if (onSavedChange) setSaved(null); } }
    catch { if (token === generation.current) { setSaved(saved); setError("We couldn’t save that change. Try again."); } }
    finally { if (token === generation.current) { saving.current = false; setPending(false); } }
  }
  return <article className={styles.listing}>
    <Link href={"/market/" + l.id} aria-label={"View " + l.title}>
      <span className={styles.listingImage}>{l.images?.[0] ? <NextImage unoptimized width={600} height={600} src={displayImageUrl(l.images[0])!} onError={event => { if (event.currentTarget.src !== l.images[0]) event.currentTarget.src = l.images[0]; }} alt={l.title} loading="lazy" /> : <ImageIcon size={32} aria-hidden />}{l.condition ? <span className={styles.condition}>{l.condition}</span> : null}{sold ? <span className={styles.sold}>{l.status === "sold" ? "SOLD" : "UNAVAILABLE"}</span> : null}</span>
      <span className={styles.listingCopy}><strong>{priceLabel(l)}</strong><span className="text-sm font-semibold leading-relaxed">{l.title}</span><small>{l.location_city ? <><MapPin size={12} aria-hidden />{l.location_city}</> : null}{l.delivery_available ? <><Truck size={12} aria-hidden />Delivery available</> : null}</small><small><RelativeTime dateTime={l.created_at} /></small></span>
    </Link>
    <button type="button" onClick={() => void onHeart()} disabled={pending} aria-pressed={saved} aria-label={(saved ? "Unsave " : "Save ") + l.title} className={styles.save}><Heart size={18} strokeWidth={1.7} fill={saved ? "currentColor" : "none"} aria-hidden /></button>
    {error ? <p role="alert" className={styles.listingError}>{error}</p> : null}
  </article>;
}
