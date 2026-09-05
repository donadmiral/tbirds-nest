"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Megaphone, Pause, Play, Plus, Send, Square, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { can } from "@/lib/studio";
import { useStudio } from "@/components/StudioShell";

type Ad = { id: string; post_id: string; label: string; status: string; total_cap: number | null; impressions: number; clicks: number; starts_at: string | null; ends_at: string | null; content: string; thumb: string | null; products: number };
type Campaign = { id: string; name: string; objective: string; budget: number; currency: string; payment_method: string | null; payment_ref: string | null; paid_amount: number; starts_at: string | null; ends_at: string | null; status: string; review_note: string | null; created_at: string; impressions: number; clicks: number; ads: Ad[] };
type MyPost = { id: string; content: string; created_at: string; thumb: string | null; products: number; likes: number };
type Form = { id: string | null; name: string; objective: string; budget: string; currency: string; payment_method: string; starts_at: string; ends_at: string };

const OBJECTIVES = [["reach", "Reach"], ["traffic", "Website visits"], ["messages", "Messages"], ["storefront", "Storefront visits"], ["applications", "Job applications"]] as const;
const toLocalInput = (iso: string | null) => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
const emptyForm = (): Form => ({ id: null, name: "", objective: "reach", budget: "", currency: "USD", payment_method: "", starts_at: "", ends_at: "" });

export default function AdsManagerPage() {
  const { me } = useStudio();
  const supabase = useRef(createClient()).current;
  const spender = can(me?.role ?? null, "spend");
  const editor = can(me?.role ?? null, "publish");
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Form>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [addFor, setAddFor] = useState<Campaign | null>(null);
  const [posts, setPosts] = useState<MyPost[]>([]);
  const [label, setLabel] = useState("Sponsored");
  const [cap, setCap] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("studio_campaigns");
      if (error) { setErr(error.message); return; }
      setRows((data as Campaign[]) ?? []);
    } finally { setLoading(false); }
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => PromiseLike<{ error: any }>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    try { const { error } = await fn(); if (error) throw error; after?.(); await load(); }
    catch (e: any) { alert(e?.message || "Action failed."); }
    finally { setBusy(false); }
  };

  const openNew = () => { setF(emptyForm()); setOpen(true); };
  const openEdit = (c: Campaign) => { setF({ id: c.id, name: c.name, objective: c.objective, budget: String(c.budget || ""), currency: c.currency, payment_method: c.payment_method || "", starts_at: toLocalInput(c.starts_at), ends_at: toLocalInput(c.ends_at) }); setOpen(true); };
  const save = () => act(() => supabase.rpc("studio_save_campaign", {
    p_id: f.id, p_name: f.name.trim(), p_objective: f.objective, p_budget: Number(f.budget || 0), p_currency: f.currency, p_payment_method: f.payment_method || null,
    p_starts_at: f.starts_at ? new Date(f.starts_at).toISOString() : null, p_ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null,
  }), () => setOpen(false));
  const openAdd = async (c: Campaign) => {
    setAddFor(c); setLabel("Sponsored"); setCap("");
    const { data } = await supabase.rpc("studio_my_posts_for_ads", { p_limit: 40 });
    setPosts((data as MyPost[]) ?? []);
  };
  const addAd = (postId: string) => { if (!addFor) return; void act(() => supabase.rpc("studio_add_ad", { p_campaign: addFor.id, p_post_id: postId, p_label: label || "Sponsored", p_total_cap: cap ? Number(cap) : null }), () => setAddFor(null)); };

  const statusChip = (s: string) => s === "live" ? "bg-success/15 text-success" : s === "approved" ? "bg-pearl/15 text-pearl" : s === "submitted" ? "bg-navy/20 text-ink" : s === "rejected" ? "bg-red-500/15 text-red-400" : s === "paused" ? "bg-surface text-ink/70" : "bg-surface text-ink/45";
  const ctr = (i: number, c: number) => i > 0 ? ((c / i) * 100).toFixed(1) + "%" : "0%";

  if (err) return <p className="py-16 text-center text-sm text-red-400">{err}</p>;

  return (
    <div className="max-w-[960px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[21px] leading-tight text-porcelain">Ads Manager</h1>
          <p className="mt-1 text-[13px] text-ink/50">Campaigns with an objective, budget and schedule. Ads inside them run as Sponsored posts once the campaign is approved and live.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/ads" className="rounded-md bg-surface px-3.5 py-2 text-[13px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:text-ink">Quick promotions</Link>
          {spender ? <button onClick={openNew} className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90"><Plus size={14} /> New campaign</button> : null}
        </div>
      </div>

      {loading ? <p className="py-12 text-center text-sm text-ink/40">Loading</p>
      : rows.length === 0 ? <p className="py-12 text-center text-sm text-ink/40">No campaigns yet. Create one, add ads from your posts, submit it for review, then set it live.</p>
      : rows.map(c => (
        <div key={c.id} className="mt-3 rounded-2xl border border-ink/10 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Megaphone size={16} className="text-pearl" />
            <span className="text-[15px] font-semibold text-ink">{c.name}</span>
            <span className={"rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase " + statusChip(c.status)}>{c.status}</span>
            <span className="text-[12px] text-ink/45">{OBJECTIVES.find(o => o[0] === c.objective)?.[1] || c.objective} · {c.currency} {Number(c.budget).toLocaleString()}{c.payment_method ? " via " + (c.payment_method === "crisp" ? "Crisp" : "IntoBank") : ""}</span>
            <span className="ml-auto text-[12px] text-ink/45">{c.starts_at ? new Date(c.starts_at).toLocaleDateString() : "no start"} to {c.ends_at ? new Date(c.ends_at).toLocaleDateString() : "open end"}</span>
          </div>
          <p className="mt-1.5 text-[13px] text-ink/60">{Number(c.impressions).toLocaleString()} impressions · {Number(c.clicks).toLocaleString()} clicks · CTR {ctr(c.impressions, c.clicks)}{c.paid_amount ? " · paid " + c.currency + " " + Number(c.paid_amount).toLocaleString() : ""}</p>
          {c.status === "rejected" && c.review_note ? <p className="mt-1.5 flex items-center gap-1 text-[12.5px] text-red-400"><AlertTriangle size={12} /> {c.review_note}</p> : null}
          {c.status === "submitted" ? <p className="mt-1.5 flex items-center gap-1 text-[12.5px] text-ink/50"><Clock size={12} /> Awaiting review. You are notified when it is approved.</p> : null}
          {c.status === "approved" ? <p className="mt-1.5 flex items-center gap-1 text-[12.5px] text-success"><CheckCircle2 size={12} /> Approved. Set it live when ready.</p> : null}

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {spender && ["draft", "rejected", "paused", "approved"].includes(c.status) ? <button onClick={() => openEdit(c)} className="rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink">Edit</button> : null}
            {editor && c.status !== "ended" ? <button onClick={() => openAdd(c)} className="inline-flex items-center gap-1 rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink"><Plus size={12} /> Add ad</button> : null}
            {spender && ["draft", "rejected"].includes(c.status) ? <button disabled={busy} onClick={() => act(() => supabase.rpc("studio_submit_campaign", { p_id: c.id }))} className="inline-flex items-center gap-1 rounded-md bg-ink px-2.5 py-1 text-[12px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90"><Send size={12} /> Submit for review</button> : null}
            {spender && ["approved", "paused"].includes(c.status) ? <button disabled={busy} onClick={() => act(() => supabase.rpc("studio_set_campaign_status", { p_id: c.id, p_status: "live" }))} className="inline-flex items-center gap-1 rounded-md bg-success/15 px-2.5 py-1 text-[12px] font-semibold text-success transition-opacity duration-[140ms] hover:opacity-80"><Play size={12} /> Set live</button> : null}
            {spender && c.status === "live" ? <button disabled={busy} onClick={() => act(() => supabase.rpc("studio_set_campaign_status", { p_id: c.id, p_status: "paused" }))} className="inline-flex items-center gap-1 rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink"><Pause size={12} /> Pause</button> : null}
            {spender && ["live", "paused", "approved"].includes(c.status) ? <button disabled={busy} onClick={() => confirm("End this campaign? Its ads stop serving.") && act(() => supabase.rpc("studio_set_campaign_status", { p_id: c.id, p_status: "ended" }))} className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2.5 py-1 text-[12px] text-red-400 transition-colors duration-[140ms] hover:bg-red-500/15"><Square size={12} /> End</button> : null}
            {spender && ["draft", "rejected"].includes(c.status) ? <button disabled={busy} onClick={() => confirm("Delete this draft? Its ads are removed with it.") && act(() => supabase.rpc("studio_delete_campaign", { p_id: c.id }))} className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2.5 py-1 text-[12px] text-red-400 transition-colors duration-[140ms] hover:bg-red-500/15"><Trash2 size={12} /> Delete</button> : null}
          </div>

          {c.ads.length === 0 ? <p className="mt-3 text-[12.5px] text-ink/40">No ads in this campaign yet.</p> : c.ads.map(a => (
            <div key={a.id} className="mt-2 flex items-center gap-3.5 rounded-lg bg-surface p-3">
              {a.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.thumb} alt="" className="h-14 w-14 rounded-md object-cover" />
              ) : <span className="h-14 w-14 rounded-md bg-ink/10" />}
              <div className="min-w-0 flex-1">
                <Link href={"/post/" + a.post_id} className="line-clamp-1 text-[13.5px] text-ink hover:underline">{a.content || "Media post"}</Link>
                <p className="text-[11.5px] text-ink/45">{a.label} · {a.status} · {a.impressions.toLocaleString()} / {a.total_cap ? a.total_cap.toLocaleString() : "∞"} impressions · {a.clicks} clicks · CTR {ctr(a.impressions, a.clicks)}{a.products ? " · " + a.products + " product cards" : ""}</p>
              </div>
              {editor && c.status !== "ended" ? <button disabled={busy} onClick={() => confirm("Remove this ad from the campaign?") && act(() => supabase.rpc("studio_remove_ad", { p_promo: a.id }))} className="rounded-md p-1.5 text-red-400 transition-colors duration-[140ms] hover:bg-red-500/10" aria-label="Remove"><Trash2 size={13} /></button> : null}
            </div>
          ))}
        </div>
      ))}

      {open ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/55 sm:items-center" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-[520px] rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[15px] font-semibold text-ink">{f.id ? "Edit campaign" : "New campaign"}</p>
              <button onClick={() => setOpen(false)} className="rounded-full p-1.5 text-ink/50 transition-colors duration-[140ms] hover:bg-black/5" aria-label="Close"><X size={16} /></button>
            </div>
            <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} maxLength={80} placeholder="Campaign name, for example Spring counter kit" className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
            <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink/40">Objective</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {OBJECTIVES.map(([k, l]) => <button key={k} onClick={() => setF({ ...f, objective: k })} className={"rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors duration-[140ms] " + (f.objective === k ? "border-ink bg-ink text-white" : "border-ink/10 text-ink/60")}>{l}</button>)}
            </div>
            <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink/40">Budget and payment</p>
            <div className="mb-3 flex gap-2">
              <select value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })} className="rounded-lg border border-ink/15 px-2 py-2 text-[13.5px] text-ink outline-none"><option>USD</option><option>ZWG</option></select>
              <input value={f.budget} onChange={e => setF({ ...f, budget: e.target.value })} inputMode="decimal" placeholder="Budget" className="w-32 rounded-lg border border-ink/15 px-3 py-2 text-[13.5px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
              <div className="flex flex-1 gap-1.5">
                {[["crisp", "Crisp"], ["intobank", "IntoBank"]].map(([k, l]) => <button key={k} onClick={() => setF({ ...f, payment_method: k })} className={"flex-1 rounded-lg border px-2 py-2 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (f.payment_method === k ? "border-ink bg-black/[0.03] text-ink" : "border-ink/10 text-ink/60")}>{l}</button>)}
              </div>
            </div>
            <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink/40">Schedule</p>
            <div className="mb-4 flex gap-2">
              <input type="datetime-local" value={f.starts_at} onChange={e => setF({ ...f, starts_at: e.target.value })} className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-[13px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
              <input type="datetime-local" value={f.ends_at} onChange={e => setF({ ...f, ends_at: e.target.value })} className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-[13px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
            </div>
            <p className="mb-3 text-[12px] text-ink/45">Leave the end empty for a campaign that runs until you end it. Payment is settled with the review team on Crisp or IntoBank before the campaign goes live.</p>
            <button onClick={save} disabled={busy || !f.name.trim()} className="w-full rounded-md bg-ink py-2.5 text-sm font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">{busy ? "Saving" : f.id ? "Save changes" : "Create campaign"}</button>
          </div>
        </div>
      ) : null}

      {addFor ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/55 sm:items-center" onClick={() => !busy && setAddFor(null)}>
          <div className="flex max-h-[85vh] w-full max-w-[560px] flex-col rounded-t-2xl bg-white sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
              <p className="text-[15px] font-semibold text-ink">Add an ad to {addFor.name}</p>
              <button onClick={() => setAddFor(null)} className="rounded-full p-1.5 text-ink/50 transition-colors duration-[140ms] hover:bg-black/5" aria-label="Close"><X size={16} /></button>
            </div>
            <div className="flex gap-2 px-4 pt-3">
              <input value={label} onChange={e => setLabel(e.target.value)} maxLength={24} placeholder="Label" className="w-36 rounded-lg border border-ink/15 px-3 py-1.5 text-[13px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
              <input value={cap} onChange={e => setCap(e.target.value)} inputMode="numeric" placeholder="Impression cap (optional)" className="flex-1 rounded-lg border border-ink/15 px-3 py-1.5 text-[13px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
            </div>
            <p className="px-4 pt-2 text-[12px] text-ink/45">Pick one of your posts. Posts with product cards become carousel ads automatically.</p>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {posts.length === 0 ? <p className="py-8 text-center text-[13px] text-ink/45">No posts yet. Publish one from the Planner first.</p> : posts.map(p => (
                <button key={p.id} disabled={busy} onClick={() => addAd(p.id)} className="mb-1.5 flex w-full items-center gap-3 rounded-2xl border border-ink/10 bg-white p-2 text-left transition-colors duration-[140ms] hover:bg-black/[0.03]">
                  {p.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumb} alt="" className="h-10 w-10 rounded-md object-cover" />
                  ) : <span className="h-10 w-10 rounded-md bg-ink/10" />}
                  <span className="min-w-0 flex-1"><span className="line-clamp-1 text-[13px] text-ink">{p.content || "Media post"}</span><span className="text-[11px] text-ink/45">{new Date(p.created_at).toLocaleDateString()} · {p.likes} likes{p.products ? " · " + p.products + " products" : ""}</span></span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}