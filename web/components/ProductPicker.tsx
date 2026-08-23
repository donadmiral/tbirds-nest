"use client";

import { useEffect, useRef, useState } from "react";
import { X, Check, Link2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { priceLabel, type Listing } from "@/lib/market";

export type ProductCard = {
  id: string;
  title: string;
  subtitle: string | null;
  price: number | null;
  currency: string | null;
  image_url: string | null;
  listing_id: string | null;
  link_url: string | null;
  cta_label: string | null;
  sort_order: number;
};

export function ProductPicker({ selected, onChange, onClose }: {
  selected: ProductCard[];
  onChange: (cards: ProductCard[]) => void;
  onClose: () => void;
}) {
  const supabase = useRef(createClient()).current;
  const [mine, setMine] = useState<Listing[] | null>(null);
  const [extOpen, setExtOpen] = useState(false);
  const [extTitle, setExtTitle] = useState("");
  const [extPrice, setExtPrice] = useState("");
  const [extCurrency, setExtCurrency] = useState<"USD" | "ZWG">("USD");
  const [extUrl, setExtUrl] = useState("");
  const [extImage, setExtImage] = useState("");

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) { setMine([]); return; }
      const { data } = await supabase
        .from("marketplace_listings")
        .select("*")
        .eq("seller_id", uid)
        .eq("status", "available")
        .order("created_at", { ascending: false })
        .limit(30);
      setMine((data ?? []) as Listing[]);
    })();
  }, [supabase]);

  function toggleListing(l: Listing) {
    const key = "listing-" + l.id;
    if (selected.some((c) => c.id === key)) {
      onChange(selected.filter((c) => c.id !== key));
    } else {
      onChange([...selected, {
        id: key,
        title: l.title,
        subtitle: null,
        price: Number(l.price),
        currency: l.currency,
        image_url: l.images?.[0] ?? null,
        listing_id: l.id,
        link_url: null,
        cta_label: "View listing",
        sort_order: selected.length,
      }]);
    }
  }

  function addExternal() {
    const title = extTitle.trim();
    const url = extUrl.trim();
    if (!title || !/^https?:\/\//.test(url)) return;
    onChange([...selected, {
      id: "ext-" + Date.now(),
      title,
      subtitle: null,
      price: extPrice.trim() ? Number(extPrice.replace(/,/g, "")) || null : null,
      currency: extPrice.trim() ? extCurrency : null,
      image_url: extImage.trim() || null,
      listing_id: null,
      link_url: url,
      cta_label: "Shop now",
      sort_order: selected.length,
    }]);
    setExtTitle("");
    setExtPrice("");
    setExtUrl("");
    setExtImage("");
    setExtOpen(false);
  }

  const inputCls = "rounded-md bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink/30 outline-none";

  return (
    <div className="mt-2 rounded-lg border border-ink/10 p-3">
      <div className="flex items-center justify-between pb-2">
        <p className="text-[13px] font-semibold text-ink">Attach products {selected.length > 0 ? "· " + selected.length : ""}</p>
        <button onClick={onClose} title="Done" className="rounded-full p-1 text-ink/50 hover:bg-surface hover:text-ink"><X size={15} /></button>
      </div>

      {mine === null ? (
        <p className="py-6 text-center text-[12px] text-ink/40">Loading your listings</p>
      ) : mine.length === 0 ? (
        <p className="py-3 text-[12px] text-ink/40">No available listings on your Market yet. You can still add an external product below.</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {mine.map((l) => {
            const on = selected.some((c) => c.id === "listing-" + l.id);
            return (
              <button key={l.id} onClick={() => toggleListing(l)} className={"relative w-28 shrink-0 overflow-hidden rounded-lg border text-left transition-colors " + (on ? "border-pearl" : "border-ink/10 hover:border-ink/25")}>
                {on ? <span className="absolute right-1 top-1 z-10 rounded-full bg-pearl p-0.5 text-ink"><Check size={11} /></span> : null}
                {l.images?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.images[0]} alt="" className="h-20 w-full bg-surface object-cover" />
                ) : <span className="block h-20 w-full bg-surface" />}
                <span className="block px-2 py-1.5">
                  <span className="block truncate text-[11px] font-semibold text-ink">{l.title}</span>
                  <span className="block text-[11px] text-pearl">{priceLabel(l)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {extOpen ? (
        <div className="mt-2 flex flex-col gap-2 border-t border-ink/10 pt-2">
          <input className={inputCls} value={extTitle} onChange={(e) => setExtTitle(e.target.value)} placeholder="Product name" />
          <div className="flex gap-2">
            <button onClick={() => setExtCurrency(extCurrency === "USD" ? "ZWG" : "USD")} className="rounded-md bg-surface px-3 py-2 text-[13px] font-semibold text-pearl">{extCurrency}</button>
            <input className={inputCls + " flex-1"} inputMode="numeric" value={extPrice} onChange={(e) => setExtPrice(e.target.value)} placeholder="Price, optional" />
          </div>
          <input className={inputCls} value={extUrl} onChange={(e) => setExtUrl(e.target.value)} placeholder="Product link, https://" />
          <input className={inputCls} value={extImage} onChange={(e) => setExtImage(e.target.value)} placeholder="Image link, optional" />
          <div className="flex gap-2">
            <button onClick={addExternal} disabled={!extTitle.trim() || !/^https?:\/\//.test(extUrl.trim())} className="rounded-md bg-pearl px-3.5 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-40">Add product</button>
            <button onClick={() => setExtOpen(false)} className="rounded-md bg-surface px-3.5 py-1.5 text-[12px] text-ink">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setExtOpen(true)} className="mt-2 flex items-center gap-1.5 text-[12px] text-pearl hover:underline">
          <Link2 size={13} /> Add an external product
        </button>
      )}
    </div>
  );
}