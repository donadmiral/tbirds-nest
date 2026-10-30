"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellPlus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ProductDialog } from "@/components/ProductDialog";
import styles from "@/app/market/MarketWorkspace.module.css";

type Alert = { id: string; query: string; max_price: number | null; city: string | null };
export function MarketAlerts({ initialQuery, onClose }: { initialQuery: string; onClose: () => void }) {
  const [supabase] = useState(createClient);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [q, setQ] = useState(initialQuery), [price, setPrice] = useState(""), [city, setCity] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const generation = useRef(0), lock = useRef(false), account = useRef<string | null | undefined>(undefined);
  const load = useCallback(async () => {
    const token = ++generation.current;
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (token !== generation.current) return;
      const uid = session.session?.user.id ?? null; account.current = uid; setSignedOut(!uid); setError("");
      if (!uid) { setAlerts([]); return; }
      const { data, error: readError } = await supabase.from("market_alerts").select("id, query, max_price, city").eq("user_id", uid).order("created_at", { ascending: false });
      if (readError) throw readError;
      if (token === generation.current) setAlerts((data ?? []) as Alert[]);
    } catch { if (token === generation.current) setError("Could not load your alerts. Please try again."); }
    finally { if (token === generation.current) setLoading(false); }
  }, [supabase]);
  useEffect(() => {
    let active = true, queued = false;
    // Install the account listener before starting the read. Coalesce initial
    // session callbacks and discard queued work when the dialog closes.
    const scheduleLoad = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; if (active) void load(); });
    };
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { const next = session?.user.id ?? null; if (account.current === undefined) { account.current = next; scheduleLoad(); return; } if (next !== account.current) { generation.current++; setAlerts([]); onClose(); } });
    scheduleLoad();
    return () => { active = false; generation.current++; listener.subscription.unsubscribe(); };
  }, [load, onClose, supabase]);
  async function save() {
    if (lock.current || q.trim().length < 2) return;
    const maximum = price.trim() ? Number(price) : null;
    if (maximum !== null && (!Number.isFinite(maximum) || maximum < 0)) { setError("Enter a maximum price of zero or more."); return; }
    const token = generation.current; lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      const uid = session.session?.user.id;
      if (sessionError || !uid || uid !== account.current) throw new Error("Account changed");
      if (token !== generation.current) return;
      const { data, error: writeError } = await supabase.from("market_alerts").insert({ user_id: uid, query: q.trim(), max_price: maximum, city: city.trim() || null }).select("id, query, max_price, city").single();
      if (writeError || !data) throw writeError || new Error("Alert not confirmed");
      if (token === generation.current) { setAlerts(previous => [data as Alert, ...previous]); setQ(""); setPrice(""); setCity(""); setNotice("Alert created."); }
    } catch { if (token === generation.current) setError("Could not create the alert. Your search is still here; try again."); }
    finally { if (token === generation.current) { lock.current = false; setBusy(false); } }
  }
  async function remove(id: string) {
    if (lock.current || !account.current) return;
    const token = generation.current; lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const { error: deleteError } = await supabase.from("market_alerts").delete().eq("id", id).eq("user_id", account.current);
      if (deleteError) throw deleteError;
      if (token === generation.current) { setAlerts(previous => previous.filter(alert => alert.id !== id)); setNotice("Alert removed."); }
    } catch { if (token === generation.current) setError("Could not remove the alert. Please try again."); }
    finally { if (token === generation.current) { lock.current = false; setBusy(false); } }
  }
  return <ProductDialog open title="Market alerts" description="Save a search to receive alerts for matching listings." busy={busy} onClose={onClose}>
    {loading ? <p role="status" className={styles.help}>Loading alerts…</p> : signedOut ? <div className={styles.form}><p className={styles.help}>Sign in to create and manage your saved searches.</p><Link href="/login" className={styles.primary}>Sign in</Link></div> : <form className={styles.form} onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>What are you looking for?<input value={q} onChange={event => setQ(event.target.value)} placeholder="For example, a desk lamp" minLength={2} maxLength={80} required disabled={busy} /></label>
      <div className={styles.fields}><label>Maximum price (optional)<input type="number" min="0" step="0.01" value={price} onChange={event => setPrice(event.target.value)} disabled={busy} /></label><label>City (optional)<input value={city} onChange={event => setCity(event.target.value)} maxLength={120} disabled={busy} /></label></div>
      <div className={styles.actions}><button type="button" disabled={busy} onClick={onClose} className={styles.button}>Cancel</button><button type="submit" disabled={busy || q.trim().length < 2} className={styles.primary}><BellPlus size={17} aria-hidden />{busy ? "Saving…" : "Create alert"}</button></div>
    </form>}
    {error ? <p role="alert" className={styles.error + " mt-3"}>{error} {!busy ? <button type="button" onClick={() => { setLoading(true); setError(""); void load(); }} className="underline">Refresh alerts</button> : null}</p> : null}{notice ? <p role="status" className={styles.help + " mt-3"}>{notice}</p> : null}
    {alerts.length ? <section className="mt-6"><h3 className="mb-3 text-sm font-semibold">Your saved searches</h3><ul className="space-y-2">{alerts.map(alert => <li key={alert.id} className={styles.notice}><span className="min-w-0 flex-1 break-words"><strong>{alert.query}</strong><span className={styles.help + " block"}>{[alert.max_price !== null ? "Maximum price " + alert.max_price : null, alert.city].filter(Boolean).join(" · ")}</span></span><button type="button" disabled={busy} onClick={() => void remove(alert.id)} aria-label={"Delete alert for " + alert.query} className={styles.iconButton}><Trash2 size={17} aria-hidden /></button></li>)}</ul></section> : null}
  </ProductDialog>;
}
