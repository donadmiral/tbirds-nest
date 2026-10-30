"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarketAlerts } from "@/components/MarketAlerts";
import { BellPlus, Package, Bookmark, ShoppingBag, LayoutGrid, Laptop, Car, Building2, Shirt, Armchair, Sprout, Wrench, Briefcase, Sparkles, SearchX, X, type LucideIcon } from "lucide-react";
import { ProductDialog } from "@/components/ProductDialog";
import styles from "./MarketWorkspace.module.css";
import Link from "next/link";
import { Search, MessageCircle, SlidersHorizontal, Plus } from "lucide-react";
import { MarketUnreadDot } from "@/components/MarketUnreadDot";
import { createClient } from "@/lib/supabase/client";
import { getMarketFeed, getListings, myListings, getSavedListingIds, MARKET_CATEGORIES, MARKET_CONDITIONS, type Listing, type MarketFilters } from "@/lib/market";
import { ListingCard } from "@/components/ListingCard";

const TABS = [
  { id: "browse", label: "Browse" },
  { id: "saved", label: "Saved" },
  { id: "selling", label: "Selling" },
] as const;

const CATEGORY_ICONS: Record<string, LucideIcon> = { All: LayoutGrid, Electronics: Laptop, Vehicles: Car, Property: Building2, Fashion: Shirt, Home: Armchair, Agriculture: Sprout, Services: Wrench, "Jobs Gear": Briefcase, Beauty: Sparkles, Other: Package };

const EMPTY: MarketFilters = { minPrice: null, maxPrice: null, condition: null, city: null, sort: "recent" };

export default function MarketPage() {
  const [supabase] = useState(createClient);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("browse");
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [filters, setFilters] = useState<MarketFilters>(EMPTY);
  const [draft, setDraft] = useState<MarketFilters>(EMPTY);
  const [uid, setUid] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const account = useRef<string | null | undefined>(undefined);
  const [filterError, setFilterError] = useState("");
  const load = useCallback(async () => {
    const token = request.current += 1;
    setLoading(true); setError(null);
    try {
      const [{ data: session, error: sessionError }, ids] = await Promise.all([
        supabase.auth.getSession(), getSavedListingIds(),
      ]);
      if (token !== request.current) return;
      setLoading(true); setError(null);
      if (sessionError) throw sessionError;
      const viewerId = session.session?.user.id ?? null;
      account.current = viewerId;
      let rows: Listing[];
      if (tab === "selling") {
        rows = viewerId ? await myListings(viewerId) : [];
      } else if (tab === "saved") {
        if (ids.size === 0) rows = [];
        else {
          const { data, error: savedError } = await supabase.from("marketplace_listings").select("*")
            .in("id", Array.from(ids)).order("created_at", { ascending: false });
          if (savedError) throw savedError;
          rows = (data ?? []) as Listing[];
        }
      } else {
        const noExplicit = filters.minPrice == null && filters.maxPrice == null && !filters.condition && !filters.city && (!filters.sort || filters.sort === "recent");
        rows = noExplicit
          ? await getMarketFeed({ search: applied || null, category, limit: 30 })
          : await getListings({ ...filters, search: applied || null, category, limit: 30 });
      }
      if (token !== request.current) return;
      setUid(viewerId);
      setSavedIds(ids);
      setListings(rows);
    } catch {
      if (token === request.current) setError("Could not load listings. Please try again.");
    } finally {
      if (token === request.current) setLoading(false);
    }
  }, [supabase, tab, category, applied, filters]);

  useEffect(() => {
    // Skip a fetch if React cleans up this effect before its queued start.
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; request.current += 1; };
  }, [load]);

  useEffect(() => {
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (next === account.current) return;
      account.current = next; request.current += 1; setUid(next); setListings([]); setSavedIds(new Set());
      setFiltersOpen(false); setAlertsOpen(false);
      queueMicrotask(() => { if (active) void load(); });
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [supabase, load]);

  const cats = useMemo(() => ["All", ...MARKET_CATEGORIES], []);
  const filtersActive = filters.minPrice != null || filters.maxPrice != null || !!filters.condition || !!filters.city || (filters.sort && filters.sort !== "recent");
  const num = (v: string) => { const n = Number(v.replace(/,/g, "")); return v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null; };
  const clearAll = () => { setSearch(""); setApplied(""); setCategory("All"); setFilters(EMPTY); };
  return <div className={styles.workspace}>
    <header className={styles.header}><div><h1>Market</h1><p>Find something you love, connect with sellers, and keep orders in one place.</p></div><div className={styles.actions}>
      <Link href="/market/orders" className={styles.button}><Package size={17} aria-hidden />Orders</Link>
      <Link href="/market/messages" className={styles.button + " relative"}><MessageCircle size={17} aria-hidden />Messages<MarketUnreadDot /></Link>
      <Link href="/market/new" className={styles.primary}><Plus size={17} aria-hidden />Sell an item</Link>
    </div></header>
    <div className={styles.tabs} role="group" aria-label="Market views">{TABS.map(option => <button type="button" key={option.id} aria-pressed={tab === option.id} onClick={() => { if (tab !== option.id) setLoading(true); setTab(option.id); }}>{option.id === "saved" ? <Bookmark size={16} aria-hidden /> : option.id === "selling" ? <ShoppingBag size={16} aria-hidden /> : null}{option.label}</button>)}</div>
    {tab === "browse" ? <>
      <form className={styles.toolbar} role="search" onSubmit={event => { event.preventDefault(); setApplied(search.trim()); }}>
        <div className={styles.search}><Search size={18} aria-hidden /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search the market" aria-label="Search the market" />{search ? <button type="button" aria-label="Clear market search" className={styles.iconButton} onClick={() => { setSearch(""); setApplied(""); }}><X size={16} aria-hidden /></button> : null}</div>
        <button type="submit" className={styles.primary}>Search</button>
        <button type="button" className={styles.button} onClick={() => setAlertsOpen(true)}><BellPlus size={17} aria-hidden />Alerts</button>
        <button type="button" aria-expanded={filtersOpen} className={styles.button} onClick={() => { setDraft(filters); setFilterError(""); setFiltersOpen(true); }}><SlidersHorizontal size={17} aria-hidden />Filters{filtersActive ? " · Active" : ""}</button>
      </form>
      <div className={styles.categories} role="group" aria-label="Market category">{cats.map(categoryName => { const Icon = CATEGORY_ICONS[categoryName] ?? Package; return <button type="button" key={categoryName} aria-pressed={category === categoryName} onClick={() => setCategory(categoryName)}><Icon size={16} strokeWidth={1.7} aria-hidden />{categoryName}</button>; })}</div>
    </> : null}
    <div className={styles.results}><span role="status">{loading ? "Finding listings…" : error ? "Listings unavailable" : listings.length + (listings.length === 1 ? " listing shown" : " listings shown")}</span>{tab === "browse" && (filtersActive || category !== "All" || applied) ? <button type="button" onClick={clearAll}>Clear search and filters</button> : null}</div>
    {loading ? <div className={styles.state} role="status"><ShoppingBag size={28} aria-hidden /><p>Loading listings…</p></div>
      : error ? <div className={styles.state} role="alert"><SearchX size={28} aria-hidden /><h2>We couldn’t load listings</h2><p>{error}</p><button onClick={() => void load()} className={styles.primary}>Try again</button></div>
      : !uid && tab !== "browse" ? <div className={styles.state}><ShoppingBag size={28} aria-hidden /><h2>{tab === "saved" ? "Keep your favourites together" : "Your shop starts here"}</h2><p>Sign in to {tab === "saved" ? "view your saved listings." : "publish and manage your listings."}</p><Link href="/login" className={styles.primary}>Sign in</Link></div>
      : listings.length === 0 ? <div className={styles.state}><ShoppingBag size={28} aria-hidden /><h2>{tab === "saved" ? "No saved listings yet" : tab === "selling" ? "Ready for a new home?" : "No matching listings"}</h2><p>{tab === "saved" ? "Save an item to keep it here for later." : tab === "selling" ? "Give your item a clear description and photos to help buyers find it." : "Try another search or category to see more from the market."}</p>{tab === "selling" ? <Link href="/market/new" className={styles.primary}>Create a listing</Link> : <button type="button" className={styles.button} onClick={() => { setTab("browse"); clearAll(); }}>Browse all listings</button>}</div>
      : <div className={styles.grid}>{listings.map(listing => <ListingCard key={(uid ?? "guest") + listing.id} l={listing} saved={savedIds.has(listing.id)} viewerId={uid} onSavedChange={on => { setSavedIds(previous => { const next = new Set(previous); if (on) next.add(listing.id); else next.delete(listing.id); return next; }); if (!on && tab === "saved") setListings(rows => rows.filter(row => row.id !== listing.id)); }} />)}</div>}
    {alertsOpen ? <MarketAlerts initialQuery={applied || search} onClose={() => setAlertsOpen(false)} /> : null}
    <ProductDialog open={filtersOpen} title="Market filters" description="Narrow your search by price, location and condition." onClose={() => setFiltersOpen(false)}>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); if (draft.minPrice != null && draft.maxPrice != null && draft.minPrice > draft.maxPrice) { setFilterError("The maximum price must be at least the minimum price."); return; } setFilters(draft); setFiltersOpen(false); }}>
        <div className={styles.fields}><label>Minimum price<input type="number" min="0" step="0.01" inputMode="decimal" value={draft.minPrice ?? ""} onChange={event => setDraft(value => ({ ...value, minPrice: num(event.target.value) }))} /></label><label>Maximum price<input type="number" min="0" step="0.01" inputMode="decimal" value={draft.maxPrice ?? ""} onChange={event => setDraft(value => ({ ...value, maxPrice: num(event.target.value) }))} /></label></div>
        <label>City<input value={draft.city ?? ""} onChange={event => setDraft(value => ({ ...value, city: event.target.value || null }))} placeholder="Any city" maxLength={120} /></label>
        <label>Condition<select value={draft.condition ?? ""} onChange={event => setDraft(value => ({ ...value, condition: event.target.value || null }))}><option value="">Any condition</option>{MARKET_CONDITIONS.map(condition => <option key={condition}>{condition}</option>)}</select></label>
        <label>Sort listings<select value={draft.sort ?? "recent"} onChange={event => setDraft(value => ({ ...value, sort: event.target.value as MarketFilters["sort"] }))}><option value="recent">Newest first</option><option value="price_low">Price low to high</option><option value="price_high">Price high to low</option></select></label>
        {filterError ? <p role="alert" className={styles.error}>{filterError}</p> : null}
        <div className={styles.actions}><button type="button" className={styles.button} onClick={() => { setDraft(EMPTY); setFilterError(""); }}>Reset</button><button type="button" className={styles.button} onClick={() => setFiltersOpen(false)}>Cancel</button><button type="submit" className={styles.primary}>Apply filters</button></div>
      </form>
    </ProductDialog>
  </div>;
}
