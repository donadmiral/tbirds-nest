"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getSavedListingIds, type Listing } from "@/lib/market";
import { ListingCard } from "@/components/ListingCard";

export default function SavedListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [viewerId, setViewerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const [{ data: session, error: sessionError }, saved] = await Promise.all([supabase.auth.getSession(), getSavedListingIds()]);
        if (sessionError) throw sessionError;
        const ids = Array.from(saved);
        let rows: Listing[] = [];
        if (ids.length > 0) {
          const { data, error: savedError } = await supabase.from("marketplace_listings").select("*").in("id", ids).order("created_at", { ascending: false });
          if (savedError) throw savedError;
          rows = (data ?? []) as Listing[];
        }
        if (!cancelled) { setListings(rows); setViewerId(session.session?.user.id ?? null); }
      } catch { if (!cancelled) setError(true); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [retry]);

  return (
    <div>
      <div className="flex items-center gap-3 px-1 pb-4">
        <Link href="/market" className="text-sm text-muted hover:text-ink">← Market</Link>
        <h1 className="font-display text-xl text-porcelain">Saved listings</h1>
      </div>
      {error ? <p role="alert" className="py-3 text-sm text-danger">Could not load saved listings. <button onClick={() => { setLoading(true); setError(false); setRetry((n) => n + 1); }} className="underline">Retry</button></p> : null}
      {loading ? (
        <p className="py-16 text-center text-sm text-muted">Loading</p>
      ) : listings.length === 0 && !error ? (
        <p className="py-16 text-center text-sm text-muted">Listings you save will appear here.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 px-1 sm:grid-cols-3">
          {listings.map((l) => (
            <ListingCard key={l.id} l={l} saved viewerId={viewerId} onSavedChange={(on) => { if (!on) setListings((rows) => rows.filter((row) => row.id !== l.id)); }} />
          ))}
        </div>
      )}
    </div>
  );
}