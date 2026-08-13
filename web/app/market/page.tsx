"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, MessageCircle, SlidersHorizontal, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMarketFeed, getListings, myListings, getSavedListingIds, MARKET_CATEGORIES, MARKET_CONDITIONS, type Listing, type MarketFilters } from "@/lib/market";
import { ListingCard } from "@/components/ListingCard";

const TABS = [
  { id: "browse", label: "Browse" },
  { id: "saved", label: "Saved" },
  { id: "selling", label: "Selling" },
] as const;

const EMPTY: MarketFilters = { minPrice: null, maxPrice: null, condition: null, city: null, sort: "recent" };

export default function MarketPage() {
  const supabase = useRef(createClient()).current;
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("browse");
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<MarketFilters>(EMPTY);
  const [draft, setDraft] = useState<MarketFilters>(EMPTY);
  const [uid, setUid] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const { data: s0 } = await supabase.auth.getSession();
    setUid(s0.session?.user.id ?? null);
    setSavedIds(await getSavedListingIds());
    if (tab === "selling") {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      setListings(uid ? await myListings(uid) : []);
      setLoading(false);
      return;
    }
    if (tab === "saved") {
      const ids = Array.from(await getSavedListingIds());
      if (ids.length === 0) { setListings([]); setLoading(false); return; }
      const { data } = await supabase.from("marketplace_listings").select("*").in("id", ids).order("created_at", { ascending: false });
      setListings((data ?? []) as Listing[]);
      setLoading(false);
      return;
    }
    const cat = category === "All" ? null : category;
    const noExplicit = filters.minPrice == null && filters.maxPrice == null && !filters.condition && !filters.city && (!filters.sort || filters.sort === "recent");
    const rows = noExplicit
      ? await getMarketFeed({ search: applied || null, category: cat, limit: 30 })
      : await getListings({ ...filters, search: applied || null, category: cat, limit: 30 });
    setListings(rows);
    setLoading(false);
  }, [supabase, tab, category, applied, filters]);

  useEffect(() => { load(); }, [load]);

  const cats = useMemo(() => ["All", ...MARKET_CATEGORIES], []);
  const filtersActive = filters.minPrice != null || filters.maxPrice != null || !!filters.condition || !!filters.city || (filters.sort && filters.sort !== "recent");
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")) || null);
  const inputCls = "rounded-md bg-surface px-3 py-2 text-[13px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated";

  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-3">
        <h1 className="font-display text-2xl text-porcelain">Market</h1>
        <Link href="/market/messages" title="Market messages" className="rounded-md p-2 text-white/60 transition-colors hover:bg-surface hover:text-white"><MessageCircle size={19} /></Link>
          <Link href="/market/new" className="ml-1 flex items-center gap-1.5 rounded-md bg-pearl px-3 py-2 text-[13px] font-semibold text-ink transition-opacity hover:opacity-90"><Plus size={16} /> Sell</Link>
      </div>

      <div className="flex gap-2 px-1 pb-3">
        {TABS.map((t) => (
          <button key={t.id}
            onClick={() => setTab(t.id)}
            className={"rounded-md px-3.5 py-1.5 text-[13px] transition-colors " + (tab === t.id ? "bg-pearl font-semibold text-ink" : "bg-surface text-white/70 hover:text-white")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "browse" ? (
        <>
          <div className="flex gap-2 px-1">
            <div className="relative flex-1">
              <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
              <input value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setApplied(search.trim()); }}
                placeholder="Search the market"
                className="w-full rounded-md bg-surface py-3 pl-10 pr-4 text-[14px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated"
              />
            </div>
            <button onClick={() => { setDraft(filters); setFiltersOpen((v) => !v); }}
              className={"flex items-center gap-1.5 rounded-md px-3.5 text-[13px] transition-colors " + (filtersActive ? "bg-pearl font-semibold text-ink" : "bg-surface text-white/70 hover:text-white")}
            >
              <SlidersHorizontal size={15} /> Filters
            </button>
          </div>

          {filtersOpen ? (
            <div className="mx-1 mt-3 flex flex-col gap-3 rounded-lg border border-white/10 p-4">
              <div className="flex gap-2">
                <input className={inputCls + " w-28"} inputMode="numeric" placeholder="Min price" defaultValue={draft.minPrice ?? ""} onChange={(e) => setDraft((d) => ({ ...d, minPrice: num(e.target.value) }))} />
                <input className={inputCls + " w-28"} inputMode="numeric" placeholder="Max price" defaultValue={draft.maxPrice ?? ""} onChange={(e) => setDraft((d) => ({ ...d, maxPrice: num(e.target.value) }))} />
                <input className={inputCls + " flex-1"} placeholder="City" defaultValue={draft.city ?? ""} onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value || null }))} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {MARKET_CONDITIONS.map((c) => (
                  <button key={c}
                    onClick={() => setDraft((d) => ({ ...d, condition: d.condition === c ? null : c }))}
                    className={"rounded-md px-3 py-1.5 text-[13px] " + (draft.condition === c ? "bg-surface-elevated font-semibold text-white" : "bg-surface text-white/60 hover:text-white")}
                  >
                    {c}
                  </button>
                ))}
                <select value={draft.sort ?? "recent"}
                  onChange={(e) => setDraft((d) => ({ ...d, sort: e.target.value as MarketFilters["sort"] }))}
                  className="ml-auto rounded-md bg-surface px-2 py-1.5 text-[13px] text-white/80 outline-none"
                >
                  <option value="recent" className="bg-navy">Newest first</option>
                  <option value="price_low" className="bg-navy">Price low to high</option>
                  <option value="price_high" className="bg-navy">Price high to low</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setFilters(draft); setFiltersOpen(false); }} className="rounded-md bg-pearl px-4 py-2 text-[13px] font-semibold text-ink">Apply</button>
                <button onClick={() => { setDraft(EMPTY); setFilters(EMPTY); setFiltersOpen(false); }} className="rounded-md bg-surface px-4 py-2 text-[13px] text-white">Clear all</button>
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex gap-2 overflow-x-auto px-1 pb-2">
            {cats.map((c) => (
              <button key={c}
                onClick={() => setCategory(c)}
                className={"shrink-0 rounded-md px-3 py-1.5 text-[13px] transition-colors " + (category === c ? "bg-pearl font-semibold text-ink" : "bg-surface text-white/60 hover:text-white")}
              >
                {c}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {loading ? (
        <p className="py-16 text-center text-sm text-white/40">Loading</p>
      ) : listings.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/40">
          {tab === "saved" ? "Listings you save will appear here." : tab === "selling" ? "Your listings will appear here." : "Nothing listed here yet."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 px-1 pt-2 sm:grid-cols-3">
          {listings.map((l) => (
            <ListingCard key={l.id} l={l} saved={savedIds.has(l.id)} viewerId={uid} />
          ))}
        </div>
      )}
    </div>
  );
}