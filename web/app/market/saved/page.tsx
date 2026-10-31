"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bookmark, Package } from "lucide-react";
import styles from "../MarketWorkspace.module.css";
import { createClient } from "@/lib/supabase/client";
import { getSavedListingIds, type Listing } from "@/lib/market";
import { ListingCard } from "@/components/ListingCard";

export default function SavedListingsPage() {
  const [supabase] = useState(createClient);
  const account = useRef<string | null | undefined>(undefined);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [viewerId, setViewerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ data: session, error: sessionError }, saved] = await Promise.all([supabase.auth.getSession(), getSavedListingIds()]);
        if (sessionError) throw sessionError;
        const ids = Array.from(saved);
        let rows: Listing[] = [];
        if (ids.length > 0) {
          const { data, error: savedError } = await supabase.from("marketplace_listings").select("*").in("id", ids).order("created_at", { ascending: false });
          if (savedError) throw savedError;
          rows = (data ?? []) as Listing[];
        }
        if (!cancelled) { account.current = session.session?.user.id ?? null; setListings(rows); setViewerId(account.current); }
      } catch { if (!cancelled) setError(true); }
      finally { if (!cancelled) setLoading(false); }
    })();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (next !== account.current) { account.current = next; cancelled = true; setListings([]); setViewerId(next); setLoading(true); setError(false); setRetry(value => value + 1); }
    });
    return () => { cancelled = true; listener.subscription.unsubscribe(); };
  }, [supabase, retry]);

  return <div className={styles.workspace}>
    <Link href="/market" className={styles.back}><ArrowLeft size={17} aria-hidden />Back to Market</Link>
    <header className={styles.header}><div><h1>Saved listings</h1><p>Keep the things you love close for later.</p></div><Link href="/market/orders" className={styles.button}><Package size={17} aria-hidden />Your orders</Link></header>
    {loading ? <div className={styles.state} role="status"><p>Loading saved listings…</p></div> : error ? <div className={styles.state} role="alert"><p>Could not load saved listings.</p><button onClick={() => { setLoading(true); setError(false); setListings([]); setRetry(value => value + 1); }} className={styles.primary}>Try again</button></div> : !viewerId ? <div className={styles.state}><Bookmark size={28} aria-hidden /><h2>Save your favourites</h2><p>Sign in to keep a collection of the things you like.</p><Link href="/login" className={styles.primary}>Sign in</Link></div> : listings.length === 0 ? <div className={styles.state}><Bookmark size={28} aria-hidden /><h2>No saved listings yet</h2><p>Save items from the market to find them here.</p><Link href="/market" className={styles.primary}>Browse the market</Link></div> : <div className={styles.grid}>{listings.map(listing => <ListingCard key={viewerId + listing.id} l={listing} saved viewerId={viewerId} onSavedChange={on => { if (!on) setListings(rows => rows.filter(row => row.id !== listing.id)); }} />)}</div>}
  </div>;
}
