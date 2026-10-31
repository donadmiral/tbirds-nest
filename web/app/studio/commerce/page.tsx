"use client";

import { errorMessage } from "@/lib/errors";

import { MarketOrders } from "@/components/MarketOrders";
import { decimalMinor, receiptCsv } from "../../../../shared/commerceMoney";
import { orderMoney, type OrderCursor } from "../../../../shared/marketOrders";
import { StudioLoadError } from "../LoadError";

import { CommerceOverview, CommerceRail } from "@/components/CommerceOverview";
import { StudioRailPortal } from "@/components/StudioRailPortal";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Download, Package, Plus, ShoppingBag, Star, Tag, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { can } from "@/lib/studio";
import { useStudio } from "@/components/StudioShell";
import { withTimeout } from "@/lib/withTimeout";

type Listing = { id: string; title: string; price: number | string; stock_quantity: number; currency: string; category: string; condition: string | null; images: string[]; status: string; hidden: boolean; created_at: string; delivery_available: boolean; delivery_fee: number | null; pending_offers: number; sold_count: number; in_posts: number };
type Order = { id: string; amount: number | string; currency: string; status: string; note: string | null; tx_id: string | null; created_at: string; completed_at: string | null; conversation_id: string; payer_id: string | null; payer_name: string; payer_username: string | null; payer_avatar: string | null; listing_id: string | null; listing_title: string | null; listing_image: string | null };
type Storefront = { tagline: string | null; featured_listing_ids: string[]; delivery_default: boolean; delivery_fee_default: number | null; delivery_note_default: string | null };

export default function CommercePage() {
  const { me, accountId } = useStudio();
  const [supabase] = useState(createClient);
  const editor = can(me?.role ?? null, "publish");
  const [view, setView] = useState<"catalog" | "orders" | "storefront">("catalog");
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [receiptCursor, setReceiptCursor] = useState<OrderCursor | null>(null); const [moreReceipts, setMoreReceipts] = useState(false);
  const [catalogCursor, setCatalogCursor] = useState<OrderCursor | null>(null); const [moreCatalog, setMoreCatalog] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]); const [caption, setCaption] = useState('');
  const publishRequest = useRef<{ key: string; ids: string[]; caption: string } | null>(null); const actionLock = useRef(false);
  const [sf, setSf] = useState<Storefront | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const mounted = useRef(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [priceFor, setPriceFor] = useState<string | null>(null);
  const [priceText, setPriceText] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "available" | "sold">("all");

  const load = useCallback(() => {
    const version = ++loadVersion.current;
    return withTimeout(Promise.all([supabase.rpc("business_catalog", { p_limit: 50 }), supabase.rpc("business_receipts", { p_limit: 50 }), supabase.rpc("studio_get_storefront")])).then(([c, o, s]) => {
      if (c.error || o.error || s.error) throw c.error || o.error || s.error;
      if (version !== loadVersion.current) return;
      setListings((c.data?.rows as Listing[]) ?? []); setCatalogCursor(c.data?.next_cursor ?? null); setMoreCatalog(!!c.data?.has_more);
      setOrders((o.data?.rows as Order[]) ?? []); setReceiptCursor(o.data?.next_cursor ?? null); setMoreReceipts(!!o.data?.has_more);
      const raw = s.data as Partial<Storefront> | null;
      setSf(raw ? { tagline: raw.tagline ?? "", featured_listing_ids: Array.isArray(raw.featured_listing_ids) ? raw.featured_listing_ids : [], delivery_default: !!raw.delivery_default, delivery_fee_default: raw.delivery_fee_default ?? null, delivery_note_default: raw.delivery_note_default ?? "" } : null);
      setLoaded(true); setLoadError(null);
    }).catch(() => {
      if (version === loadVersion.current) setLoadError("Commerce could not be refreshed. Your last loaded data is unchanged.");
    }).finally(() => { if (version === loadVersion.current) setLoading(false); });
  }, [supabase]);
  useEffect(() => { const requests = loadVersion; mounted.current = true; void load(); return () => { mounted.current = false; requests.current += 1; }; }, [load]);

  const assertAccount = async () => {
    const { data, error } = await withTimeout(supabase.auth.getSession());
    if (!mounted.current || error || !accountId || data.session?.user.id !== accountId) throw new Error("Your account changed. Reopen Commerce before continuing.");
    return accountId;
  };

  const loadMore = async (kind: 'catalog' | 'receipts') => {
    if (loading) return; const version = ++loadVersion.current; setLoading(true);
    const cursor = kind === 'catalog' ? catalogCursor : receiptCursor;
    try {
      const { data, error } = await withTimeout(supabase.rpc(kind === 'catalog' ? 'business_catalog' : 'business_receipts', { p_before: cursor?.created_at, p_before_id: cursor?.id, p_limit: 50 }));
      if (error) throw error; if (version !== loadVersion.current) return;
      if (kind === 'catalog') { setListings(old => [...old, ...(data.rows as Listing[]).filter(row => !old.some(x => x.id === row.id))]); setCatalogCursor(data.next_cursor); setMoreCatalog(data.has_more); }
      else { setOrders(old => [...old, ...(data.rows as Order[]).filter(row => !old.some(x => x.id === row.id))]); setReceiptCursor(data.next_cursor); setMoreReceipts(data.has_more); }
    } catch { if (version === loadVersion.current) setLoadError('Could not load the next page. Try again.'); }
    finally { if (version === loadVersion.current) setLoading(false); }
  };

  const setListing = async (l: Listing, patch: { status?: string; price?: number; delivery_available?: boolean; delivery_fee?: number | null }) => {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusyId(l.id);
    try {
      await assertAccount();
      const { error } = await supabase.rpc("studio_set_listing", { p_id: l.id, p_status: patch.status ?? null, p_price: patch.price ?? null, p_delivery_available: patch.delivery_available ?? null, p_delivery_fee: patch.delivery_fee ?? null, p_delivery_note: null });
      if (error) throw error;
      if (!mounted.current) return false;
      setListings(prev => prev.map(x => x.id === l.id ? { ...x, ...patch } as Listing : x));
      return true;
    } catch (e: unknown) { if (mounted.current) alert(errorMessage(e, "Could not update.")); return false; }
    finally { actionLock.current = false; if (mounted.current) setBusyId(null); }
  };

  const savePrice = async (l: Listing) => {
    const v = Number(priceText);
    if (!isFinite(v) || v < 0) { alert("Enter a valid price."); return; }
    if (await setListing(l, { price: v })) setPriceFor(null);
  };

  const publishProducts = async (ids: string[], text: string) => {
    if (!me || actionLock.current) return; actionLock.current = true; setBusyId(ids[0] || 'carousel');
    try {
      const user = await assertAccount();
      if (!publishRequest.current || JSON.stringify(publishRequest.current.ids) !== JSON.stringify(ids) || publishRequest.current.caption !== text) publishRequest.current = { key: crypto.randomUUID(), ids, caption: text };
      const { data: id, error } = await supabase.rpc('publish_product_carousel', { p_expected_user: user, p_request_key: publishRequest.current.key, p_listing_ids: ids, p_caption: text });
      if (error || !id) throw error || new Error('Publishing did not return a post.');
      if (!mounted.current) return;
      publishRequest.current = null; setSelectedProducts([]); setCaption('');
      setListings(old => old.map(l => ids.includes(l.id) ? { ...l, in_posts: l.in_posts + 1 } : l)); alert('Published to the feed.');
    } catch (e: unknown) { if (mounted.current) alert(e instanceof Error ? e.message : 'Could not publish. Try again with the same products.'); }
    finally { actionLock.current = false; if (mounted.current) setBusyId(null); }
  };
  const shareToFeed = (l: Listing) => publishProducts([l.id], l.title);
  const setStock = async (l: Listing) => {
    const value = window.prompt('Available stock, excluding units already reserved for accepted orders', String(l.stock_quantity));
    if (value === null || !/^\d+$/.test(value)) return; const stock = Number(value);
    if (stock > 1000000 || actionLock.current) return; actionLock.current = true; setBusyId(l.id);
    try {
      const user = await assertAccount();
      const { error } = await supabase.rpc('set_listing_stock', { p_expected_user: user, p_listing_id: l.id, p_available: stock, p_expected_available: l.stock_quantity });
      if (error) throw error; if (mounted.current) setListings(old => old.map(x => x.id === l.id ? { ...x, stock_quantity: stock } : x));
    } catch { if (mounted.current) alert('Stock changed or could not be saved. Refresh and try again.'); }
    finally { actionLock.current = false; if (mounted.current) setBusyId(null); }
  };

  const toggleFeatured = (id: string) => {
    if (!sf) return;
    const has = sf.featured_listing_ids.includes(id);
    if (!has && sf.featured_listing_ids.length >= 6) { alert("Up to six featured products."); return; }
    setSf({ ...sf, featured_listing_ids: has ? sf.featured_listing_ids.filter(x => x !== id) : [...sf.featured_listing_ids, id] });
  };
  const saveStorefront = async () => {
    if (!sf || actionLock.current) return;
    actionLock.current = true;
    setSaving(true);
    try {
      await assertAccount();
      const { error } = await supabase.rpc("studio_set_storefront", { p_tagline: sf.tagline || null, p_featured: sf.featured_listing_ids, p_delivery_default: sf.delivery_default, p_delivery_fee: sf.delivery_fee_default, p_delivery_note: sf.delivery_note_default || null });
      if (error) throw error;
      if (mounted.current) alert("Storefront saved.");
    } catch (e: unknown) { if (mounted.current) alert(errorMessage(e, "Could not save.")); }
    finally { actionLock.current = false; if (mounted.current) setSaving(false); }
  };

  const exportCsv = () => {
    const rows = [["date", "payer", "username", "amount", "currency", "status", "listing", "note", "tx_id"], ...orders.map(o => [o.created_at, o.payer_name, o.payer_username || "", String(o.amount), o.currency, o.status, o.listing_title || "", o.note || "", o.tx_id || ""])];
    const csv = receiptCsv(rows);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "receipts-loaded.csv"; a.click(); URL.revokeObjectURL(url);
  };

  const totals = useMemo(() => {
    const m: Record<string, { total: bigint; n: number }> = {};
    orders.filter(o => o.status === "completed").forEach(o => { (m[o.currency] ||= { total: BigInt(0), n: 0 }); m[o.currency].total += decimalMinor(o.amount); m[o.currency].n += 1; });
    return Object.entries(m);
  }, [orders]);
  const shownListings = listings.filter(l => statusFilter === "all" || l.status === statusFilter);
  const chip = (s: string) => s === "available" ? "bg-success/15 text-success" : s === "sold" ? "bg-pearl/15 text-accent" : "bg-surface text-muted";

  return (
    <div>
      <StudioLoadError message={loadError} retry={() => { setLoading(true); void load(); }} busy={loading} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[21px] leading-tight text-porcelain">Commerce</h1>
          <p className="mt-1 text-[13px] text-muted">Your catalog, the money that came in, and how your storefront presents itself.</p>
        </div>
        <div className="flex gap-1 rounded-full bg-surface p-1">
          {(["catalog", "orders", "storefront"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} className={"rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (view === v ? "bg-ink text-white" : "text-ink/60")}>
              {v === "catalog" ? "Catalog" : v === "orders" ? "Orders" : "Storefront"}
            </button>
          ))}
        </div>
      </div>

      {loaded ? <StudioRailPortal><CommerceRail orders={orders} listings={listings} /></StudioRailPortal> : null}
      {loaded ? <p className="mt-3 text-[12px] text-muted">Receipt totals and exports cover {orders.length} loaded payments. Load earlier receipts for more history. They are not your bank balance.</p> : null}
      {loaded ? <CommerceOverview orders={orders} listings={listings} /> : null}

      {loading && !loaded ? <p className="py-12 text-center text-sm text-muted">Loading</p> : !loaded ? null : view === "catalog" ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(["all", "available", "sold"] as const).map(f => (
              <button key={f} onClick={() => setStatusFilter(f)} className={"rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (statusFilter === f ? "bg-ink text-white" : "bg-surface text-ink/60")}>{f === "all" ? "All" : f === "available" ? "Available" : "Sold"}</button>
            ))}
            {editor ? <Link href="/market/new" className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-ink px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90"><Plus size={14} /> New listing</Link> : null}
          </div>
          {editor && <div className="mt-3 space-y-2 rounded-xl border border-ink/10 p-3"><p className="text-sm">Select up to ten catalog items to publish a shoppable carousel.</p><input aria-label="Carousel caption" maxLength={10000} value={caption} onChange={e => setCaption(e.target.value)} placeholder="Carousel caption" className="w-full rounded border border-ink/15 bg-transparent p-2 text-sm" /><button disabled={!selectedProducts.length || !!busyId} onClick={() => void publishProducts(selectedProducts, caption)} className="rounded-lg bg-ink px-3 py-2 text-sm text-white disabled:opacity-40">Publish {selectedProducts.length} selected products</button></div>}
          {shownListings.length === 0 ? <p className="py-12 text-center text-sm text-muted">No listings here yet. Everything you list in Market appears in this catalog.</p>
          : shownListings.map(l => (
            <div key={l.id} className="mt-2 flex items-start gap-3 rounded-2xl border border-ink/10 bg-white p-3">
              {editor && l.status === 'available' && <input type="checkbox" aria-label={'Select ' + l.title + ' for carousel'} checked={selectedProducts.includes(l.id)} disabled={!!busyId || (!selectedProducts.includes(l.id) && selectedProducts.length >= 10)} onChange={e => setSelectedProducts(old => e.target.checked ? [...old, l.id] : old.filter(id => id !== l.id))} />}
              {l.images?.[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.images[0]} alt="" className="h-16 w-16 rounded-lg object-cover" />
              ) : <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-surface text-muted"><Package size={18} /></span>}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={"/market/" + l.id} className="text-[14.5px] font-semibold text-ink hover:underline">{l.title}</Link>
                  <span className={"rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase " + chip(l.status)}>{l.status}</span>
                  {l.pending_offers > 0 ? <span className="rounded bg-pearl px-1.5 py-0.5 text-[10.5px] font-bold text-on-pearl">{l.pending_offers} offer{l.pending_offers > 1 ? "s" : ""} waiting</span> : null}
                </div>
                <p className="mt-1 text-[12.5px] text-muted">
                  {priceFor === l.id ? (
                    <span className="inline-flex items-center gap-1.5">
                      <input value={priceText} onChange={e => setPriceText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void savePrice(l); }} className="w-24 rounded-md border border-ink/15 bg-transparent px-2 py-0.5 text-[13px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" autoFocus />
                      <button onClick={() => savePrice(l)} className="rounded-md bg-ink px-2 py-0.5 text-[12px] text-white transition-opacity duration-[140ms] hover:opacity-90"><Check size={12} /></button>
                    </span>
                  ) : <button onClick={() => { if (editor) { setPriceFor(l.id); setPriceText(String(l.price)); } }} className="font-semibold text-ink hover:underline">{l.currency} {Number(l.price).toLocaleString()}</button>}
                  {" · "}{l.category}{l.condition ? " · " + l.condition : ""}{" · "}{l.sold_count} sold{" · "}in {l.in_posts} post{l.in_posts === 1 ? "" : "s"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {editor ? (
                    <>
                      <button disabled={!!busyId} onClick={() => void setStock(l)} className="rounded-md bg-surface px-2.5 py-1 text-[12px]">Stock: {l.stock_quantity}</button>
                      {l.status === "available" ? <button disabled={busyId === l.id} onClick={() => confirm("Mark as sold?") && setListing(l, { status: "sold" })} className="rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink">Mark sold</button>
                        : l.status === "sold" ? <button disabled={busyId === l.id} onClick={() => setListing(l, { status: "available" })} className="rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink">Relist</button> : null}
                      <button disabled={busyId === l.id} onClick={() => setListing(l, { delivery_available: !l.delivery_available })} className={"inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] transition-colors duration-[140ms] " + (l.delivery_available ? "bg-success/15 text-success" : "bg-surface text-ink/70")}><Truck size={12} /> {l.delivery_available ? "Delivers" + (l.delivery_fee ? " · " + l.currency + " " + l.delivery_fee : "") : "Collection only"}</button>
                      {l.status === "available" ? <button disabled={busyId === l.id} onClick={() => shareToFeed(l)} className="inline-flex items-center gap-1 rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink"><Tag size={12} /> Share to feed</button> : null}
                      <button onClick={() => toggleFeatured(l.id)} className={"inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] transition-colors duration-[140ms] " + (sf?.featured_listing_ids.includes(l.id) ? "bg-pearl/15 text-accent" : "bg-surface text-ink/70")}><Star size={12} /> {sf?.featured_listing_ids.includes(l.id) ? "Featured" : "Feature"}</button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
          {moreCatalog && <button disabled={loading} onClick={() => void loadMore('catalog')} className="mt-3 rounded-lg bg-surface px-4 py-2 text-sm">Load more catalog items</button>}
          {editor && sf ? <p className="mt-3 text-[12px] text-muted">Featured picks save from the Storefront tab.</p> : null}
        </>
      ) : view === "orders" ? (
        <>
          <MarketOrders />
          <h2 className="mt-5 text-lg font-semibold" id="orders">Payment receipts</h2>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {totals.length === 0 ? <p className="text-[13px] text-muted">No completed payments yet.</p>
              : totals.map(([cur, t]) => <span key={cur} className="rounded-2xl border border-ink/10 bg-white px-3.5 py-2 text-[13px] text-ink"><span className="font-display text-[18px] text-porcelain">{orderMoney(t.total.toString(), cur)}</span> <span className="text-muted">across {t.n} payment{t.n === 1 ? "" : "s"}</span></span>)}
            {orders.length ? <button onClick={exportCsv} className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:text-ink"><Download size={13} /> Export loaded receipts</button> : null}
          </div>
          {orders.length === 0 ? <p className="py-12 text-center text-sm text-muted">Payments customers send you in chat appear here with what they bought.</p>
          : orders.map(o => (
            <div key={o.id} className="mt-2 flex items-center gap-3 rounded-2xl border border-ink/10 bg-white p-3">
              {o.listing_image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={o.listing_image} alt="" className="h-12 w-12 rounded-lg object-cover" />
              ) : <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface text-muted"><ShoppingBag size={16} /></span>}
              <div className="min-w-0 flex-1">
                <p className="text-[14px] text-ink"><span className="font-semibold">{o.payer_name}</span>{o.payer_username ? <span className="text-muted"> @{o.payer_username}</span> : null}{o.listing_title ? <span className="text-ink/70"> · {o.listing_title}</span> : null}</p>
                <p className="mt-0.5 text-[12px] text-muted">{new Date(o.created_at).toLocaleString()}{o.note ? " · " + o.note : ""}{o.tx_id ? " · ref " + o.tx_id : ""}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-[17px] text-porcelain">{orderMoney(decimalMinor(o.amount).toString(), o.currency)}</p>
                <p className={"text-[11px] font-semibold uppercase " + (o.completed_at ? "text-success" : o.status === "failed" ? "text-danger" : "text-muted")}>{o.completed_at ? "paid" : o.status}</p>
              </div>
            </div>
          ))}
          {moreReceipts && <button disabled={loading} onClick={() => void loadMore('receipts')} className="mt-3 rounded-lg bg-surface px-4 py-2 text-sm">Load earlier receipts</button>}
        </>
      ) : sf ? (
        <div className="mt-5 max-w-[640px]">
          <div className="rounded-2xl border border-ink/10 bg-white p-4">
            <p className="text-[14px] font-semibold text-ink">Tagline</p>
            <p className="mt-1 text-[12.5px] text-muted">One line under your name on the storefront.</p>
            <input value={sf.tagline || ""} onChange={e => setSf({ ...sf, tagline: e.target.value })} maxLength={90} placeholder="Quality hardware, fair prices, same-day collection in Harare" className="mt-2 w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
          </div>
          <div className="mt-3 rounded-2xl border border-ink/10 bg-white p-4">
            <p className="text-[14px] font-semibold text-ink">Featured products</p>
            <p className="mt-1 text-[12.5px] text-muted">Up to six, shown first on your profile. Pick from the catalog.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {listings.filter(l => l.status === "available").map(l => {
                const on = sf.featured_listing_ids.includes(l.id);
                return <button key={l.id} onClick={() => toggleFeatured(l.id)} className={"rounded-full border px-3 py-1 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (on ? "border-ink bg-ink text-white" : "border-ink/10 text-ink/60")}>{l.title}</button>;
              })}
              {listings.filter(l => l.status === "available").length === 0 ? <p className="text-[12.5px] text-muted">No available listings to feature.</p> : null}
            </div>
          </div>
          <div className="mt-3 rounded-2xl border border-ink/10 bg-white p-4">
            <label className="flex items-center gap-2 text-[14px] font-semibold text-ink"><input type="checkbox" checked={sf.delivery_default} onChange={e => setSf({ ...sf, delivery_default: e.target.checked })} /> Offer delivery by default on new listings</label>
            <div className="mt-2 flex gap-2">
              <input value={sf.delivery_fee_default ?? ""} onChange={e => setSf({ ...sf, delivery_fee_default: e.target.value === "" ? null : Number(e.target.value) })} placeholder="Fee" inputMode="decimal" className="w-28 rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
              <input value={sf.delivery_note_default || ""} onChange={e => setSf({ ...sf, delivery_note_default: e.target.value })} placeholder="Delivery note, for example Harare CBD only" className="flex-1 rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
            </div>
          </div>
          {editor ? <button onClick={saveStorefront} disabled={saving} className="mt-4 rounded-md bg-ink px-4 py-2.5 text-[13px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">{saving ? "Saving" : "Save storefront"}</button> : null}
        </div>
      ) : null}
    </div>
  );
}
