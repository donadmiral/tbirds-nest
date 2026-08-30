"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, Image as ImageIcon, Plus, Send, Tag, Trash2, X, AlertTriangle, CheckCircle2, FileText, Users } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import { createClient } from "@/lib/supabase/client";
import { can, cancelScheduled, deleteScheduled, listScheduled, myListings, publishNow, savePost, uploadStudioMedia, type ScheduledPost } from "@/lib/studio";
import { useStudio } from "@/components/StudioShell";

type Draft = { id: string | null; content: string; body: string; category: string | null; community: string | null; media: ScheduledPost["media"]; products: ScheduledPost["products"]; publishAt: string };

const empty = (): Draft => ({ id: null, content: "", body: "", category: null, community: null, media: [], products: [], publishAt: "" });
const toLocalInput = (iso: string | null) => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export default function PlannerPage() {
  const { me } = useStudio();
  const supabase = useRef(createClient()).current;
  const editor = can(me?.role ?? null, "publish");
  const [rows, setRows] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"upcoming" | "drafts" | "published">("upcoming");
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Draft>(empty());
  const [busy, setBusy] = useState(false);
  const [listings, setListings] = useState<{ id: string; title: string; price: number; currency: string; images: string[] }[]>([]);
  const [communities, setCommunities] = useState<{ id: string; name: string }[]>([]);
  const [pickOpen, setPickOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [weekStart, setWeekStart] = useState(() => { const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() - t.getDay()); return t; });

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listScheduled()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    myListings().then(setListings).catch(() => {});
    supabase.rpc("get_communities", { p_query: null, p_limit: 60 }).then(({ data }) => {
      setCommunities(((data as any[]) ?? []).filter(c => c.my_role === "owner" || c.my_role === "moderator").map(c => ({ id: c.id, name: c.name })));
    });
  }, [supabase]);

  const shown = useMemo(() => rows.filter(r =>
    tab === "upcoming" ? ["scheduled", "publishing", "failed"].includes(r.status)
    : tab === "drafts" ? ["draft", "cancelled"].includes(r.status)
    : r.status === "published"), [rows, tab]);

  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => { const x = new Date(weekStart); x.setDate(x.getDate() + i); return x; }), [weekStart]);
  const byDay = useMemo(() => {
    const m: Record<string, ScheduledPost[]> = {};
    rows.filter(r => r.publish_at && r.status !== "cancelled").forEach(r => { const k = dayKey(new Date(r.publish_at!)); (m[k] ||= []).push(r); });
    return m;
  }, [rows]);

  const openNew = (when?: Date) => {
    const x = empty();
    if (when) { const t = new Date(when); t.setHours(10, 0, 0, 0); x.publishAt = toLocalInput(t.toISOString()); }
    setD(x); setOpen(true);
  };
  const openEdit = (r: ScheduledPost) => {
    setD({ id: r.id, content: r.content || "", body: r.body || "", category: r.category, community: r.community_id, media: r.media || [], products: r.products || [], publishAt: toLocalInput(r.publish_at) });
    setOpen(true);
  };

  const attach = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true);
    try {
      const added: ScheduledPost["media"] = [];
      for (const f of Array.from(files).slice(0, 4 - d.media.length)) added.push(await uploadStudioMedia(f));
      setD(x => ({ ...x, media: [...x.media, ...added] }));
    } catch (e: any) { alert(e?.message || "Upload failed."); }
    finally { setBusy(false); }
  };

  const toggleListing = (l: typeof listings[number]) => {
    setD(x => {
      const has = x.products.some(p => p.listing_id === l.id);
      return { ...x, products: has ? x.products.filter(p => p.listing_id !== l.id) : [...x.products, { title: l.title, price: l.price, currency: l.currency, image_url: l.images?.[0] || null, listing_id: l.id, cta_label: "View listing" }] };
    });
  };

  const save = async (mode: "draft" | "schedule" | "now") => {
    if (busy) return;
    if (!d.content.trim() && !d.body.trim() && d.media.length === 0) { alert("Write something or add media first."); return; }
    if (mode === "schedule" && !d.publishAt) { alert("Pick a date and time."); return; }
    setBusy(true);
    try {
      const id = await savePost({ id: d.id, content: d.content.trim() || null, body: d.body.trim() || null, category: d.category, community: d.community, media: d.media, products: d.products,
        publishAt: mode === "schedule" ? new Date(d.publishAt).toISOString() : null });
      if (mode === "now") {
        const postId = await publishNow(id);
        if (!postId) alert("Publishing failed. The post is kept as failed with the reason.");
      }
      setOpen(false); setD(empty());
      await load();
    } catch (e: any) { alert(e?.message || "Could not save."); }
    finally { setBusy(false); }
  };

  const remove = async (r: ScheduledPost) => {
    if (!confirm("Delete this " + (r.status === "published" ? "record" : r.status) + "?")) return;
    try { await deleteScheduled(r.id); await load(); } catch (e: any) { alert(e?.message || "Could not delete."); }
  };
  const cancel = async (r: ScheduledPost) => {
    try { await cancelScheduled(r.id); await load(); } catch (e: any) { alert(e?.message || "Could not cancel."); }
  };

  const statusChip = (s: ScheduledPost["status"]) =>
    s === "scheduled" ? "bg-pearl/15 text-pearl" : s === "published" ? "bg-success/15 text-success" : s === "failed" ? "bg-red-500/15 text-red-400" : "bg-surface text-ink/50";

  return (
    <div className="max-w-[960px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[21px] leading-tight text-porcelain">Planner</h1>
          <p className="mt-1 text-[13px] text-ink/50">Drafts, schedule and publish. Scheduled posts go out on the minute, even with Studio closed.</p>
        </div>
        {editor ? <button onClick={() => openNew()} className="inline-flex items-center gap-1.5 rounded-md bg-ink px-4 py-2.5 text-[13px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90"><Plus size={15} /> New post</button> : null}
      </div>

      <div className="mt-5 rounded-2xl border border-ink/10 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <button onClick={() => setWeekStart(w => { const x = new Date(w); x.setDate(x.getDate() - 7); return x; })} className="rounded-md px-2 py-1 text-[12.5px] text-ink/60 transition-colors duration-[140ms] hover:bg-surface">Previous</button>
          <span className="text-[12.5px] font-semibold text-ink/70">{week[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} to {week[6].toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          <button onClick={() => setWeekStart(w => { const x = new Date(w); x.setDate(x.getDate() + 7); return x; })} className="rounded-md px-2 py-1 text-[12.5px] text-ink/60 transition-colors duration-[140ms] hover:bg-surface">Next</button>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {week.map(day => {
            const k = dayKey(day); const items = byDay[k] || []; const today = k === dayKey(new Date());
            return (
              <button key={k} onClick={() => editor && openNew(day)} className={"min-h-[92px] rounded-lg border p-2 text-left transition-colors duration-[140ms] hover:bg-surface " + (today ? "border-pearl/60" : "border-ink/10")}>
                <span className={"text-[11px] font-semibold " + (today ? "text-pearl" : "text-ink/45")}>{day.toLocaleDateString(undefined, { weekday: "short" })} {day.getDate()}</span>
                {items.slice(0, 3).map(r => (
                  <span key={r.id} className={"mt-1 block truncate rounded px-1.5 py-0.5 text-[10.5px] " + statusChip(r.status)}>
                    {new Date(r.publish_at!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} {r.content || r.body || "Media"}
                  </span>
                ))}
                {items.length > 3 ? <span className="mt-1 block text-[10.5px] text-ink/40">+{items.length - 3} more</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex gap-2">
        {(["upcoming", "drafts", "published"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={"rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (tab === t ? "bg-ink text-white" : "bg-surface text-ink/60")}>
            {t === "upcoming" ? "Upcoming" : t === "drafts" ? "Drafts" : "Published"}
          </button>
        ))}
      </div>

      {loading ? <p className="py-12 text-center text-sm text-ink/40">Loading</p>
      : shown.length === 0 ? <p className="py-12 text-center text-sm text-ink/40">{tab === "upcoming" ? "Nothing scheduled. Tap a day above to plan one." : tab === "drafts" ? "No drafts." : "Nothing published from the Planner yet."}</p>
      : shown.map(r => (
        <div key={r.id} className="mt-2.5 flex items-start gap-3.5 rounded-2xl border border-ink/10 bg-white p-3.5">
          {r.media?.[0]?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.media[0].url} alt="" className="h-16 w-16 rounded-lg object-cover" />
          ) : <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-surface text-ink/30"><FileText size={20} /></span>}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={"rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase " + statusChip(r.status)}>{r.status}</span>
              {r.publish_at ? <span className="flex items-center gap-1 text-[12px] text-ink/50"><CalendarClock size={12} /> {new Date(r.publish_at).toLocaleString()}</span> : null}
              {r.products?.length ? <span className="flex items-center gap-1 text-[12px] text-ink/50"><Tag size={12} /> {r.products.length} products</span> : null}
              {r.community_id ? <span className="flex items-center gap-1 text-[12px] text-ink/50"><Users size={12} /> community</span> : null}
            </div>
            <p className="mt-1 line-clamp-2 text-[14px] text-ink">{r.content || r.body || "Media post"}</p>
            {r.status === "failed" && r.error ? <p className="mt-1 flex items-center gap-1 text-[12px] text-red-400"><AlertTriangle size={12} /> {r.error}</p> : null}
            {r.status === "published" && r.published_post_id ? <Link href={"/post/" + r.published_post_id} className="mt-1 inline-flex items-center gap-1 text-[12px] text-success"><CheckCircle2 size={12} /> View the live post</Link> : null}
          </div>
          {editor ? (
            <div className="flex shrink-0 flex-col gap-1">
              {r.status !== "published" && r.status !== "publishing" ? <button onClick={() => openEdit(r)} className="rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink">Edit</button> : null}
              {r.status === "scheduled" ? <button onClick={() => cancel(r)} className="rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink">Unschedule</button> : null}
              <button onClick={() => remove(r)} className="rounded-md px-2.5 py-1 text-[12px] text-red-400 transition-colors duration-[140ms] hover:bg-red-500/10"><Trash2 size={13} /></button>
            </div>
          ) : null}
        </div>
      ))}

      {open ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/55 sm:items-center" onClick={() => !busy && setOpen(false)}>
          <div className="flex max-h-[90vh] w-full max-w-[600px] flex-col rounded-t-2xl bg-white sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
              <p className="text-[15px] font-semibold text-ink">{d.id ? "Edit post" : "New post"}</p>
              <button onClick={() => setOpen(false)} className="rounded-full p-1.5 text-ink/50 transition-colors duration-[140ms] hover:bg-black/5" aria-label="Close"><X size={16} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <textarea value={d.content} onChange={e => setD(x => ({ ...x, content: e.target.value }))} maxLength={2000} placeholder="What do you want to say?"
                className="h-28 w-full resize-none rounded-lg border border-ink/15 px-3 py-2 text-[14.5px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
              <textarea value={d.body} onChange={e => setD(x => ({ ...x, body: e.target.value }))} maxLength={20000} placeholder="Longer text (optional)"
                className="mt-2 h-20 w-full resize-none rounded-lg border border-ink/15 px-3 py-2 text-[13.5px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
              {d.media.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {d.media.map((m, i) => (
                    <span key={i} className="relative">
                      {m.media_type === "video" ? <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-ink text-[10px] text-white">video</span>
                        // eslint-disable-next-line @next/next/no-img-element
                        : <img src={m.url} alt="" className="h-16 w-16 rounded-lg object-cover" />}
                      <button onClick={() => setD(x => ({ ...x, media: x.media.filter((_, j) => j !== i) }))} className="absolute -right-1 -top-1 rounded-full bg-ink p-0.5 text-white" aria-label="Remove"><X size={11} /></button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button onClick={() => fileRef.current?.click()} disabled={d.media.length >= 4 || busy} className="inline-flex items-center gap-1.5 rounded-full bg-ink/5 px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:bg-ink/10 disabled:opacity-40"><ImageIcon size={14} /> Media</button>
                <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={e => { void attach(e.target.files); e.target.value = ""; }} />
                <button onClick={() => setPickOpen(o => !o)} className="inline-flex items-center gap-1.5 rounded-full bg-ink/5 px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:bg-ink/10"><Tag size={14} /> Products {d.products.length ? "(" + d.products.length + ")" : ""}</button>
                {communities.length ? (
                  <select value={d.community || ""} onChange={e => setD(x => ({ ...x, community: e.target.value || null }))} className="rounded-full bg-ink/5 px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 outline-none">
                    <option value="">Main feed</option>
                    {communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ) : null}
              </div>
              {pickOpen ? (
                <div className="mt-2 max-h-40 overflow-y-auto rounded-2xl border border-ink/10 bg-white p-2">
                  {listings.length === 0 ? <p className="text-[12.5px] text-ink/50">No active listings. Create one in Market to attach product cards.</p>
                  : listings.map(l => {
                    const on = d.products.some(p => p.listing_id === l.id);
                    return (
                      <button key={l.id} onClick={() => toggleListing(l)} className={"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-[140ms] " + (on ? "bg-ink text-white" : "hover:bg-black/5")}>
                        {l.images?.[0] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.images[0]} alt="" className="h-8 w-8 rounded object-cover" />
                        ) : <span className="h-8 w-8 rounded bg-ink/10" />}
                        <span className="flex-1 truncate">{l.title}</span>
                        <span className={on ? "text-white/70" : "text-ink/50"}>{l.currency} {l.price}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <p className="mb-1.5 mt-3 text-[11.5px] font-semibold uppercase tracking-wide text-ink/40">Category</p>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map(c => (
                  <button key={c.key} onClick={() => setD(x => ({ ...x, category: x.category === c.key ? null : c.key }))}
                    className={"rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors duration-[140ms] " + (d.category === c.key ? "border-ink bg-ink text-white" : "border-ink/10 text-ink/60")}>{c.label}</button>
                ))}
              </div>
              <p className="mb-1.5 mt-3 text-[11.5px] font-semibold uppercase tracking-wide text-ink/40">Schedule</p>
              <input type="datetime-local" value={d.publishAt} onChange={e => setD(x => ({ ...x, publishAt: e.target.value }))}
                className="rounded-lg border border-ink/15 px-3 py-2 text-[13.5px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-ink/10 px-4 py-3">
              <button onClick={() => save("draft")} disabled={busy} className="rounded-md bg-ink/5 px-3.5 py-2 text-[13px] font-semibold text-ink/70 transition-opacity duration-[140ms] hover:opacity-80 disabled:opacity-40">Save draft</button>
              <button onClick={() => save("schedule")} disabled={busy || !d.publishAt} className="inline-flex items-center gap-1.5 rounded-md bg-ink/5 px-3.5 py-2 text-[13px] font-semibold text-ink transition-opacity duration-[140ms] hover:opacity-80 disabled:opacity-40"><CalendarClock size={14} /> Schedule</button>
              <button onClick={() => save("now")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40"><Send size={14} /> {busy ? "Working" : "Publish now"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}