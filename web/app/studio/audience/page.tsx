"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, Plus, Search, Trash2, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Person = { id: string; name: string; username: string | null; avatar_url: string | null; location: string | null; followed_at: string; label: string | null; note: string | null; paid: number; messages: number };
type Lead = { id: string; contact_id: string | null; name: string; phone: string | null; email: string | null; source: string | null; note: string | null; status: string; created_at: string; username: string | null; avatar_url: string | null };
type Summary = { followers: number; new_30d: number; customers: number; labels: Record<string, number>; top_cities: { city: string; n: number }[] };
const LABELS = ["customer", "lead", "vip", "supplier", "partner"];
const STATUSES = ["new", "contacted", "converted", "lost"];

export default function AudiencePage() {
  const supabase = useRef(createClient()).current;
  const [view, setView] = useState<"followers" | "leads">("followers");
  const [people, setPeople] = useState<Person[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [q, setQ] = useState("");
  const [label, setLabel] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ id: string | null; name: string; phone: string; email: string; source: string; note: string; status: string; contact_id: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, l, s] = await Promise.all([
        supabase.rpc("studio_audience", { p_q: q.trim() || null, p_label: label || null, p_limit: 300 }),
        supabase.rpc("studio_leads"), supabase.rpc("studio_audience_summary"),
      ]);
      setPeople((a.data as Person[]) ?? []); setLeads((l.data as Lead[]) ?? []); setSum(s.data as Summary);
    } finally { setLoading(false); }
  }, [supabase, q, label]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 250); return () => clearTimeout(t); }, [load]);

  const setPersonLabel = async (p: Person, l: string) => {
    setPeople(prev => prev.map(x => x.id === p.id ? { ...x, label: l || null } : x));
    const { error } = await supabase.rpc("studio_set_contact_label", { p_contact: p.id, p_label: l || null, p_note: null });
    if (error) { alert(error.message); void load(); }
  };
  const saveLead = async () => {
    if (!form || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("studio_upsert_lead", { p_id: form.id, p_name: form.name, p_phone: form.phone || null, p_email: form.email || null, p_source: form.source || null, p_note: form.note || null, p_status: form.status, p_contact: form.contact_id });
      if (error) throw error;
      setForm(null); await load();
    } catch (e: any) { alert(e?.message || "Could not save."); }
    finally { setBusy(false); }
  };
  const deleteLead = async (l: Lead) => { if (!confirm("Delete this lead?")) return; await supabase.rpc("studio_delete_lead", { p_id: l.id }); await load(); };
  const setLeadStatus = async (l: Lead, status: string) => {
    setLeads(prev => prev.map(x => x.id === l.id ? { ...x, status } : x));
    const { error } = await supabase.rpc("studio_upsert_lead", { p_id: l.id, p_name: l.name, p_phone: l.phone, p_email: l.email, p_source: l.source, p_note: l.note, p_status: status, p_contact: l.contact_id });
    if (error) { alert(error.message); void load(); }
  };
  const exportCsv = () => {
    const rows = view === "followers"
      ? [["name", "username", "location", "label", "followed", "paid", "messages"], ...people.map(p => [p.name, p.username || "", p.location || "", p.label || "", p.followed_at, String(p.paid), String(p.messages)])]
      : [["name", "phone", "email", "source", "status", "note", "created"], ...leads.map(l => [l.name, l.phone || "", l.email || "", l.source || "", l.status, l.note || "", l.created_at])];
    const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = view + ".csv"; a.click(); URL.revokeObjectURL(url);
  };
  const chip = (s: string) => s === "converted" ? "bg-success/15 text-success" : s === "lost" ? "bg-surface text-ink/40" : s === "contacted" ? "bg-pearl/15 text-pearl" : "bg-navy/20 text-ink";

  return (
    <div className="max-w-[960px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[21px] leading-tight text-porcelain">Audience</h1>
          <p className="mt-0.5 text-[13px] text-ink/50">Who follows you, where they are, and what they respond to.</p>
          <p className="mt-1 text-[13px] text-ink/50">Who follows you, who pays you, and the leads you are working.</p>
        </div>
        <div className="flex gap-1 rounded-full bg-surface p-1">
          {(["followers", "leads"] as const).map(v => <button key={v} onClick={() => setView(v)} className={"rounded-full px-3 py-1.5 text-[12.5px] font-semibold " + (view === v ? "bg-ink text-white" : "text-ink/60")}>{v === "followers" ? "Followers" : "Leads"}</button>)}
        </div>
      </div>

      {sum ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[["Followers", sum.followers], ["New in 30 days", sum.new_30d], ["Paying customers", sum.customers], ["Labelled", Object.values(sum.labels || {}).reduce((a, b) => a + Number(b), 0)]].map(([l, n]) => (
            <div key={String(l)} className="rounded-xl border border-ink/10 px-4 py-3"><p className="text-[11.5px] text-ink/45">{l}</p><p className="mt-0.5 font-display text-[22px] text-porcelain">{Number(n).toLocaleString()}</p></div>
          ))}
        </div>
      ) : null}
      {sum && sum.top_cities.length ? <p className="mt-2 text-[12.5px] text-ink/50">Top cities: {sum.top_cities.map(c => c.city + " " + c.n).join(" · ")}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {view === "followers" ? (
          <>
            <div className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2"><Search size={14} className="text-ink/40" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search followers" className="w-48 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink/40" /></div>
            <select value={label} onChange={e => setLabel(e.target.value)} className="rounded-md bg-surface px-2 py-2 text-[12.5px] text-ink/70 outline-none"><option value="">All labels</option>{LABELS.map(l => <option key={l} value={l}>{l}</option>)}</select>
          </>
        ) : <button onClick={() => setForm({ id: null, name: "", phone: "", email: "", source: "", note: "", status: "new", contact_id: null })} className="inline-flex items-center gap-1.5 rounded-md bg-pearl px-3.5 py-2 text-[13px] font-semibold text-ink"><Plus size={14} /> New lead</button>}
        <button onClick={exportCsv} className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 hover:text-ink"><Download size={13} /> Export CSV</button>
      </div>

      {loading ? <p className="py-12 text-center text-sm text-ink/40">Loading</p> : view === "followers" ? (
        people.length === 0 ? <p className="py-12 text-center text-sm text-ink/40">No followers match.</p> : people.map(p => (
          <div key={p.id} className="mt-2 flex items-center gap-3 rounded-xl border border-ink/10 px-3 py-2.5">
            {p.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy text-[13px] font-semibold text-white">{p.name.charAt(0)}</span>}
            <div className="min-w-0 flex-1">
              <Link href={p.username ? "/" + p.username : "#"} className="text-[14px] font-semibold text-ink hover:underline">{p.name}</Link>
              <p className="text-[12px] text-ink/45">{p.username ? "@" + p.username + " · " : ""}{p.location ? p.location + " · " : ""}followed {new Date(p.followed_at).toLocaleDateString()}{p.paid ? " · " + p.paid + " payment" + (p.paid > 1 ? "s" : "") : ""}{p.messages ? " · " + p.messages + " messages" : ""}</p>
            </div>
            <select value={p.label || ""} onChange={e => setPersonLabel(p, e.target.value)} className="rounded-md bg-surface px-2 py-1 text-[12px] text-ink/70 outline-none" aria-label="Label"><option value="">No label</option>{LABELS.map(l => <option key={l} value={l}>{l}</option>)}</select>
            <button onClick={() => { setView("leads"); setForm({ id: null, name: p.name, phone: "", email: "", source: "follower", note: "", status: "new", contact_id: p.id }); }} className="rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 hover:text-ink">Make lead</button>
          </div>
        ))
      ) : (
        leads.length === 0 ? <p className="py-12 text-center text-sm text-ink/40">No leads yet. Add one, or turn a follower into a lead.</p> : leads.map(l => (
          <div key={l.id} className="mt-2 flex items-center gap-3 rounded-xl border border-ink/10 px-3 py-2.5">
            {l.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy text-white"><Users size={15} /></span>}
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-ink">{l.name} <span className={"ml-1 rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase " + chip(l.status)}>{l.status}</span></p>
              <p className="text-[12px] text-ink/45">{[l.phone, l.email, l.source ? "via " + l.source : null, l.username ? "@" + l.username : null].filter(Boolean).join(" · ")}{l.note ? " · " + l.note : ""}</p>
            </div>
            <select value={l.status} onChange={e => setLeadStatus(l, e.target.value)} className="rounded-md bg-surface px-2 py-1 text-[12px] text-ink/70 outline-none" aria-label="Status">{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select>
            <button onClick={() => setForm({ id: l.id, name: l.name, phone: l.phone || "", email: l.email || "", source: l.source || "", note: l.note || "", status: l.status, contact_id: l.contact_id })} className="rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 hover:text-ink">Edit</button>
            <button onClick={() => deleteLead(l)} className="rounded-md p-1.5 text-red-400 hover:bg-red-500/10" aria-label="Delete"><Trash2 size={13} /></button>
          </div>
        ))
      )}

      {form ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/55 sm:items-center" onClick={() => !busy && setForm(null)}>
          <div className="w-full max-w-[460px] rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><p className="text-[15px] font-semibold text-ink">{form.id ? "Edit lead" : "New lead"}</p><button onClick={() => setForm(null)} className="rounded-full p-1.5 text-ink/50 hover:bg-black/5" aria-label="Close"><X size={16} /></button></div>
            {[["name", "Name"], ["phone", "Phone"], ["email", "Email"], ["source", "Source, for example walk-in, referral, ad"], ["note", "Note"]].map(([k, ph]) => (
              <input key={k} value={(form as any)[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} placeholder={ph} className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/40" />
            ))}
            <div className="mb-4 flex gap-1.5">{STATUSES.map(s => <button key={s} onClick={() => setForm({ ...form, status: s })} className={"flex-1 rounded-lg border px-2 py-1.5 text-[12.5px] font-semibold " + (form.status === s ? "border-ink bg-ink text-white" : "border-ink/10 text-ink/60")}>{s}</button>)}</div>
            <button onClick={saveLead} disabled={busy || !form.name.trim()} className="w-full rounded-md bg-ink py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Saving" : "Save lead"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
