"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getSavedListingIds, type Listing } from "@/lib/market";
import { ListingCard } from "@/components/ListingCard";

export default function SavedListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const ids = Array.from(await getSavedListingIds());
      if (ids.length === 0) { setLoading(false); return; }
      const supabase = createClient();
      const { data } = await supabase.from("marketplace_listings").select("*").in("id", ids).order("created_at", { ascending: false });
      setListings((data ?? []) as Listing[]);
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <div className="flex items-center gap-3 px-1 pb-4">
        <Link href="/market" className="text-sm text-white/50 hover:text-white">← Market</Link>
        <h1 className="font-display text-xl text-porcelain">Saved listings</h1>
      </div>
      {loading ? (
        <p className="py-16 text-center text-sm text-white/40">Loading</p>
      ) : listings.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/40">Listings you save will appear here.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 px-1 sm:grid-cols-3">
          {listings.map((l) => (
            <ListingCard key={l.id} l={l} />
          ))}
        </div>
      )}
    </div>
  );
}