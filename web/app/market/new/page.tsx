"use client";

import { useEffect, useRef, useState } from "react";
import { checkUploadable } from "@/lib/media";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImagePlus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { MARKET_CATEGORIES, MARKET_CONDITIONS } from "@/lib/market";

const inputCls = "rounded-md bg-surface px-4 py-3 text-[14px] text-ink placeholder:text-ink/30 outline-none focus:bg-surface-elevated";

type Photo = { file: File; preview: string };

export default function CreateListingPage() {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [marketOn, setMarketOn] = useState(true);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<"USD" | "ZWG">("USD");
  const [category, setCategory] = useState<string>(MARKET_CATEGORIES[0]);
  const [condition, setCondition] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const [deliveryOn, setDeliveryOn] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [shareToFeed, setShareToFeed] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("feature_flags").select("key, enabled").eq("key", "market").maybeSingle();
      if (data && data.enabled === false) setMarketOn(false);
    })();
  }, [supabase]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...photos];
    Array.from(list).slice(0, 8 - next.length).forEach((f) => {
      if (f.type.startsWith("image/")) next.push({ file: f, preview: URL.createObjectURL(f) });
    });
    setPhotos(next);
  }

  const priceNumber = Number(price.replace(/,/g, ""));
  const priceOk = price.trim().length > 0 && Number.isFinite(priceNumber) && priceNumber >= 0;
  const titleOk = title.trim().length >= 3;

  async function submit() {
    if (pending) return;
    if (!titleOk) { setError("Give it a title of at least 3 characters."); return; }
    if (!priceOk) { setError("Enter a price. Use 0 for free."); return; }
    if (photos.length === 0) { setError("Add at least one photo."); return; }
    setPending(true);
    setError(null);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) { router.push("/login"); return; }

    const urls: string[] = [];
    for (const p of photos) {
      const ext = (p.file.name.split(".").pop() || "jpg").toLowerCase();
      const path = "listings/" + uid + "/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
      const bad = checkUploadable(p.file);
      if (bad) { setError(bad); setPending(false); return; }
      const { error: upErr } = await supabase.storage.from("market-media").upload(path, p.file, { contentType: p.file.type });
      if (upErr) { setError("Photo upload failed: " + upErr.message); setPending(false); return; }
      const { data: pub } = supabase.storage.from("market-media").getPublicUrl(path);
      urls.push(pub.publicUrl);
    }

    const { data: listing, error: insErr } = await supabase
      .from("marketplace_listings")
      .insert({
        seller_id: uid,
        title: title.trim(),
        description: description.trim() || null,
        price: priceNumber,
        currency,
        category,
        condition,
        location_city: city.trim() || null,
        images: urls,
        delivery_available: deliveryOn,
        delivery_fee: deliveryOn && deliveryFee.trim() ? Number(deliveryFee.replace(/,/g, "")) || null : null,
        delivery_note: deliveryOn ? deliveryNote.trim() || null : null,
      })
      .select("*")
      .single();
    if (insErr || !listing) {
      setError(insErr?.message || "Could not publish the listing.");
      setPending(false);
      return;
    }

    if (shareToFeed) {
      try {
        const { data: newPost } = await supabase
          .from("posts")
          .insert({ user_id: uid, body: title.trim() })
          .select()
          .single();
        if (newPost?.id) {
          await supabase.rpc("set_post_products", {
            p_post_id: newPost.id,
            p_products: [{
              id: "listing-" + listing.id,
              title: title.trim(),
              subtitle: null,
              price: priceNumber,
              currency,
              image_url: urls[0] || null,
              listing_id: listing.id,
              link_url: null,
              cta_label: "View listing",
              sort_order: 0,
            }],
          });
        }
      } catch { /* share failures never block the listing */ }
    }

    router.push("/market/" + listing.id);
  }

  if (!marketOn) {
    return (
      <div className="flex flex-col items-center gap-3 px-1 py-24 text-center">
        <p className="text-[15px] text-ink/70">The market is temporarily switched off by Platinum Circles operations.</p>
        <Link href="/market" className="mt-2 rounded-md bg-pearl px-5 py-2.5 text-sm font-semibold text-ink">Back to Market</Link>
      </div>
    );
  }

  return (
    <div className="px-1">
      <div className="flex items-center gap-3 pb-4">
        <Link href="/market" className="text-sm text-ink/50 hover:text-ink">← Market</Link>
        <h1 className="font-display text-xl text-porcelain">New listing</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <span key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.preview} alt="" className="h-24 w-24 rounded-md object-cover" />
            <button onClick={() => setPhotos(photos.filter((_, x) => x !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-0.5 text-ink/70 hover:text-ink">
              <X size={14} />
            </button>
          </span>
        ))}
        {photos.length < 8 ? (
          <button onClick={() => fileRef.current?.click()} className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-ink/20 text-ink/40 hover:border-pearl hover:text-pearl">
            <ImagePlus size={20} />
            <span className="text-[11px]">Add photos</span>
          </button>
        ) : null}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        <textarea className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the item, its condition, what is included" rows={4} />
        <div className="flex gap-2">
          <button onClick={() => setCurrency(currency === "USD" ? "ZWG" : "USD")} className="rounded-md bg-surface px-4 py-3 text-[14px] font-semibold text-pearl hover:bg-surface-elevated">
            {currency}
          </button>
          <input className={inputCls + " flex-1"} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price. Use 0 for free" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            {MARKET_CATEGORIES.map((c) => <option key={c} value={c} className="bg-navy">{c}</option>)}
          </select>
          <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
        </div>
        <div className="flex flex-wrap gap-2">
          {MARKET_CONDITIONS.map((c) => (
            <button key={c}
              onClick={() => setCondition(condition === c ? null : c)}
              className={"rounded-md px-3 py-1.5 text-[13px] " + (condition === c ? "bg-surface-elevated font-semibold text-ink" : "bg-surface text-ink/60 hover:text-ink")}
            >
              {c}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-[14px] text-ink/80">
          <input type="checkbox" checked={deliveryOn} onChange={(e) => setDeliveryOn(e.target.checked)} className="accent-[#C9BFB0]" /> Offer delivery
        </label>
        {deliveryOn ? (
          <div className="flex gap-2">
            <input className={inputCls + " w-40"} inputMode="numeric" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} placeholder={"Fee in " + currency} />
            <input className={inputCls + " flex-1"} value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} placeholder="Delivery note, e.g. Harare CBD only" />
          </div>
        ) : null}

        <label className="flex items-center gap-2 text-[14px] text-ink/80">
          <input type="checkbox" checked={shareToFeed} onChange={(e) => setShareToFeed(e.target.checked)} className="accent-[#C9BFB0]" /> Share to feed
        </label>

        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
        <button onClick={submit} disabled={pending} className="mt-1 self-start rounded-md bg-pearl px-6 py-3 text-[15px] font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-40">
          {pending ? "Publishing" : "Publish listing"}
        </button>
      </div>
    </div>
  );
}