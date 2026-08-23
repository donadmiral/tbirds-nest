"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellPlus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Alert = { id: string; query: string; max_price: number | null; city: string | null };

export function MarketAlerts({ initialQuery, onClose }: { initialQuery: string; onClose: () => void }) {
  const supabase = useRef(createClient()).current;
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [q, setQ] = useState(initialQuery);
  const [price, setPrice] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("market_alerts").select("id, query, max_price, city").order("created_at", { ascending: false });
    setAlerts((data ?? []) as Alert[]);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true);
    setErr(null);
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) { setErr("Sign in first."); setBusy(false); return; }
    const mp = price.trim() ? Number(price.replace(/,/g, "")) : null;
    const { error } = await supabase.from("market_alerts").insert({
      user_id: uid, query: q.trim(), max_price: Number.isFinite(mp as number) ? mp : null, city: city.trim() || null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setQ(""); setPrice(""); setCity("");
    load();
  }

  async function remove(id: string) {
    await supabase.from("market_alerts").delete().eq("id", id);
    load();
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-ink/10 bg-navy p-5" onClick={(e) => e.stopPropagation()}>
        <p className="flex items-center justify-between text-[15px] font-semibold text-ink">
          <span className="flex items-center gap-2"><BellPlus size={17} className="text-pearl" /> Market alerts</span>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-ink/40 hover:bg-surface hover:text-ink"><X size={16} /></button>
        </p>
        <p className="mt-1 text-[12px] text-ink/45">The moment a matching listing appears, you get notified.</p>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="What are you looking for, iPhone, Toyota Aqua, apartment" maxLength={80}
          className="mt-3 w-full rounded-md bg-surface px-3 py-2.5 text-[13.5px] text-ink placeholder:text-ink/25 outline-none focus:bg-surface-elevated" />
        <span className="mt-2 flex gap-2">
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Max price, optional" inputMode="numeric"
            className="w-1/2 rounded-md bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink/25 outline-none" />
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City, optional"
            className="w-1/2 rounded-md bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink/25 outline-none" />
        </span>
        {err ? <p className="mt-2 text-[12px] text-danger">{err}</p> : null}
        <button onClick={save} disabled={busy || q.trim().length < 2}
          className="mt-3 w-full rounded-md bg-pearl py-2.5 text-[13px] font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-40">
          {busy ? "Saving" : "Create alert"}
        </button>
        {alerts.length > 0 ? (
          <div className="mt-4 flex flex-col gap-1.5 border-t border-ink/10 pt-3">
            {alerts.map((a) => (
              <span key={a.id} className="flex items-center gap-2 rounded-md bg-surface px-3 py-2 text-[13px] text-ink">
                <span className="min-w-0 flex-1 truncate">
                  {a.query}
                  {a.max_price !== null ? " under $" + a.max_price : ""}
                  {a.city ? " in " + a.city : ""}
                </span>
                <button onClick={() => remove(a.id)} aria-label="Delete alert" className="shrink-0 text-ink/40 hover:text-danger"><Trash2 size={14} /></button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}