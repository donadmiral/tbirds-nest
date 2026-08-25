"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Briefcase, Check, CheckCircle2, MessageCircle, Plus, Star, Tag, Trash2, X, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { can, deleteReply, getAutoReplies, listReplies, setAutoReplies, upsertReply, type AutoReplies, type SavedReply } from "@/lib/studio";
import { useStudio } from "@/components/StudioShell";

type Item = {
  kind: "dm" | "offer" | "applicant" | "review"; id: string; ref: string; title: string; username: string | null; avatar_url: string | null;
  preview: string | null; at: string; context: string; unread: number; waiting: boolean; amount: number | null; currency: string | null; status: string | null;
  label: string | null; assignee: string | null; done: boolean; note: string | null;
};
type Member = { id: string; display_name: string; role: string };
const LABELS = ["lead", "customer", "vip", "urgent", "follow up", "spam"];
const KIND_ICON = { dm: MessageCircle, offer: Tag, applicant: Briefcase, review: Star } as const;

export default function InboxPage() {
  const { me } = useStudio();
  const supabase = useRef(createClient()).current;
  const canInbox = can(me?.role ?? null, "inbox") || can(me?.role ?? null, "recruit");
  const [items, setItems] = useState<Item[]>([]);
  const [team, setTeam] = useState<Member[]>([]);
  const [filter, setFilter] = useState<"all" | "dm" | "offer" | "applicant" | "review">("all");
  const [showDone, setShowDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"queue" | "replies" | "automations">("queue");
  const [replies, setReplies] = useState<SavedReply[]>([]);
  const [auto, setAuto] = useState<AutoReplies | null>(null);
  const [newReply, setNewReply] = useState({ shortcut: "", title: "", body: "" });
  const [saving, setSaving] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.rpc("studio_inbox", { p_filter: filter, p_limit: 120 });
      setItems((data as Item[]) ?? []);
    } finally { setLoading(false); }
  }, [supabase, filter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    supabase.rpc("studio_team").then(({ data }) => setTeam((data as Member[]) ?? []));
    listReplies().then(setReplies).catch(() => {});
    getAutoReplies().then(setAuto).catch(() => {});
  }, [supabase]);

  const setState = async (it: Item, patch: { label?: string | null; assignee?: string | null; done?: boolean; note?: string | null }) => {
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, ...patch } : x));
    const { error } = await supabase.rpc("studio_set_thread", { p_conversation: it.id, p_label: patch.label ?? null, p_assignee: patch.assignee ?? null, p_done: patch.done ?? null, p_note: patch.note ?? null });
    if (error) { alert(error.message); void load(); }
  };

  const respondOffer = async (it: Item, action: "accept" | "decline") => {
    const { error } = await supabase.rpc("respond_offer", { p_offer_id: it.id, p_action: action, p_counter_amount: null });
    if (error) { alert(error.message); return; }
    setItems(prev => prev.filter(x => x.id !== it.id));
  };

  const saveReply = async () => {
    if (!newReply.body.trim() || saving) return;
    setSaving(true);
    try { await upsertReply({ shortcut: newReply.shortcut || newReply.title, title: newReply.title || newReply.shortcut, body: newReply.body }); setNewReply({ shortcut: "", title: "", body: "" }); setReplies(await listReplies()); }
    catch (e: any) { alert(e?.message || "Could not save."); }
    finally { setSaving(false); }
  };
  const removeReply = async (r: SavedReply) => { await deleteReply(r.id); setReplies(prev => prev.filter(x => x.id !== r.id)); };
  const saveAuto = async () => {
    if (!auto || saving) return;
    setSaving(true);
    try { await setAutoReplies(auto); alert("Saved."); } catch (e: any) { alert(e?.message || "Could not save."); } finally { setSaving(false); }
  };

  const shown = items.filter(i => showDone || !i.done);
  const memberName = (id: string | null) => team.find(t => t.id === id)?.display_name || null;

  return (
    <div className="max-w-[960px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-porcelain">Inbox</h1>
          <p className="mt-1 text-[13px] text-ink/50">Messages, offers, applicants and reviews in one queue. Label, assign, and mark done.</p>
        </div>
        <div className="flex gap-1 rounded-full bg-surface p-1">
          {(["queue", "replies", "automations"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} className={"rounded-full px-3 py-1.5 text-[12.5px] font-semibold " + (view === v ? "bg-ink text-porcelain" : "text-ink/60")}>
              {v === "queue" ? "Queue" : v === "replies" ? "Saved replies" : "Automations"}
            </button>
          ))}
        </div>
      </div>

      {view === "queue" ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(["all", "dm", "offer", "applicant", "review"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} className={"rounded-full px-3 py-1.5 text-[12.5px] font-semibold " + (filter === f ? "bg-ink text-porcelain" : "bg-surface text-ink/60")}>
                {f === "all" ? "All" : f === "dm" ? "Messages" : f === "offer" ? "Offers" : f === "applicant" ? "Applicants" : "Reviews"}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1.5 text-[12.5px] text-ink/50"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show done</label>
          </div>
          {loading ? <p className="py-12 text-center text-sm text-ink/40">Loading</p>
          : shown.length === 0 ? <p className="py-12 text-center text-sm text-ink/40">Queue is clear.</p>
          : shown.map(it => {
            const Icon = KIND_ICON[it.kind];
            const href = it.kind === "dm" ? "/messages" : it.kind === "offer" ? "/market/" + it.ref : it.kind === "applicant" ? "/jobs" : (me?.username ? "/" + me.username : "/studio");
            return (
              <div key={it.kind + it.id} className={"mt-2 rounded-xl border border-ink/10 p-3 " + (it.done ? "opacity-60" : "")}>
                <div className="flex items-start gap-3">
                  {it.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy text-[13px] font-semibold text-porcelain">{it.title.charAt(0)}</span>}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold text-ink">{it.title}</span>
                      <span className="flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-ink/50"><Icon size={11} /> {it.kind === "dm" ? it.context : it.kind}</span>
                      {it.unread > 0 ? <span className="rounded-full bg-pearl px-1.5 text-[10.5px] font-bold text-ink">{it.unread}</span> : null}
                      {it.waiting && !it.done ? <span className="text-[10.5px] font-semibold uppercase text-pearl">waiting on you</span> : null}
                      {it.label ? <span className="rounded bg-navy/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink">{it.label}</span> : null}
                      {memberName(it.assignee) ? <span className="text-[11px] text-ink/45">to {memberName(it.assignee)}</span> : null}
                      <span className="ml-auto text-[11px] text-ink/40">{new Date(it.at).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13.5px] text-ink/80">{it.preview || ""}</p>
                    {it.note ? <p className="mt-1 text-[12px] italic text-ink/50">Note: {it.note}</p> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Link href={href} className="rounded-md bg-ink px-2.5 py-1 text-[12px] font-semibold text-porcelain">Open</Link>
                      {it.kind === "offer" && it.waiting && canInbox ? (
                        <>
                          <button onClick={() => respondOffer(it, "accept")} className="inline-flex items-center gap-1 rounded-md bg-success/15 px-2.5 py-1 text-[12px] font-semibold text-success"><Check size={12} /> Accept</button>
                          <button onClick={() => respondOffer(it, "decline")} className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2.5 py-1 text-[12px] font-semibold text-red-400"><X size={12} /> Decline</button>
                        </>
                      ) : null}
                      <select value={it.label || ""} onChange={e => setState(it, { label: e.target.value || null })} className="rounded-md bg-surface px-2 py-1 text-[12px] text-ink/70 outline-none" aria-label="Label">
                        <option value="">Label</option>
                        {LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                      {team.length ? (
                        <select value={it.assignee || ""} onChange={e => setState(it, { assignee: e.target.value || null })} className="rounded-md bg-surface px-2 py-1 text-[12px] text-ink/70 outline-none" aria-label="Assign">
                          <option value="">Assign</option>
                          {team.map(t => <option key={t.id} value={t.id}>{t.display_name}</option>)}
                        </select>
                      ) : null}
                      <button onClick={() => { setNoteFor(noteFor === it.id ? null : it.id); setNoteText(it.note || ""); }} className="rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70">Note</button>
                      <button onClick={() => setState(it, { done: !it.done })} className={"ml-auto inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-semibold " + (it.done ? "bg-surface text-ink/60" : "bg-success/15 text-success")}><CheckCircle2 size={12} /> {it.done ? "Reopen" : "Done"}</button>
                    </div>
                    {noteFor === it.id ? (
                      <div className="mt-2 flex gap-2">
                        <input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Internal note, only your team sees it" className="w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none" />
                        <button onClick={() => { void setState(it, { note: noteText }); setNoteFor(null); }} className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-semibold text-porcelain">Save</button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      ) : view === "replies" ? (
        <div className="mt-5 max-w-[640px]">
          <p className="text-[13px] text-ink/55">Type the shortcut with a slash in any chat to insert the reply. Keep them short and warm.</p>
          <div className="mt-3 rounded-xl border border-ink/10 p-3">
            <div className="flex gap-2">
              <input value={newReply.shortcut} onChange={e => setNewReply(r => ({ ...r, shortcut: e.target.value }))} placeholder="/hours" className="w-32 rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none" />
              <input value={newReply.title} onChange={e => setNewReply(r => ({ ...r, title: e.target.value }))} placeholder="Title" className="flex-1 rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none" />
            </div>
            <textarea value={newReply.body} onChange={e => setNewReply(r => ({ ...r, body: e.target.value }))} placeholder="Reply text" className="mt-2 h-20 w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none" />
            <button onClick={saveReply} disabled={saving || !newReply.body.trim()} className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-pearl px-3.5 py-1.5 text-[12.5px] font-semibold text-ink disabled:opacity-40"><Plus size={13} /> Save reply</button>
          </div>
          {replies.map(r => (
            <div key={r.id} className="mt-2 flex items-start gap-3 rounded-xl border border-ink/10 p-3">
              <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[12px] text-ink/70">/{r.shortcut}</span>
              <div className="min-w-0 flex-1"><p className="text-[13.5px] font-semibold text-ink">{r.title}</p><p className="mt-0.5 whitespace-pre-wrap text-[13px] text-ink/70">{r.body}</p></div>
              <button onClick={() => removeReply(r)} className="rounded-md px-2 py-1 text-red-400 hover:bg-red-500/10" aria-label="Delete"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      ) : auto ? (
        <div className="mt-5 max-w-[640px]">
          <div className="rounded-xl border border-ink/10 p-4">
            <label className="flex items-center gap-2 text-[14px] font-semibold text-ink"><input type="checkbox" checked={auto.welcome_enabled} onChange={e => setAuto({ ...auto, welcome_enabled: e.target.checked })} /> <Zap size={14} className="text-pearl" /> Welcome message</label>
            <p className="mt-1 text-[12.5px] text-ink/50">Sent once when someone messages you for the first time.</p>
            <textarea value={auto.welcome_text || ""} onChange={e => setAuto({ ...auto, welcome_text: e.target.value })} placeholder="Thanks for reaching out to us. How can we help today?" className="mt-2 h-20 w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none" />
          </div>
          <div className="mt-3 rounded-xl border border-ink/10 p-4">
            <label className="flex items-center gap-2 text-[14px] font-semibold text-ink"><input type="checkbox" checked={auto.away_enabled} onChange={e => setAuto({ ...auto, away_enabled: e.target.checked })} /> Away message</label>
            <p className="mt-1 text-[12.5px] text-ink/50">Sent outside your business hours, once per conversation per day.</p>
            <textarea value={auto.away_text || ""} onChange={e => setAuto({ ...auto, away_text: e.target.value })} placeholder="We are closed right now and reply during opening hours." className="mt-2 h-20 w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none" />
          </div>
          <div className="mt-3 rounded-xl border border-ink/10 p-4">
            <p className="text-[14px] font-semibold text-ink">Quick questions</p>
            <p className="mt-1 text-[12.5px] text-ink/50">Shown as tap-to-ask buttons when someone opens a chat with you. Up to five.</p>
            {auto.faq.map((f, i) => (
              <div key={i} className="mt-2 flex gap-2">
                <input value={f.q} onChange={e => setAuto({ ...auto, faq: auto.faq.map((x, j) => j === i ? { ...x, q: e.target.value } : x) })} placeholder="Question" className="w-2/5 rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none" />
                <input value={f.a} onChange={e => setAuto({ ...auto, faq: auto.faq.map((x, j) => j === i ? { ...x, a: e.target.value } : x) })} placeholder="Answer" className="flex-1 rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none" />
                <button onClick={() => setAuto({ ...auto, faq: auto.faq.filter((_, j) => j !== i) })} className="rounded-md px-2 text-red-400" aria-label="Remove"><X size={13} /></button>
              </div>
            ))}
            {auto.faq.length < 5 ? <button onClick={() => setAuto({ ...auto, faq: [...auto.faq, { q: "", a: "" }] })} className="mt-2 inline-flex items-center gap-1 rounded-md bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink/70"><Plus size={12} /> Add question</button> : null}
          </div>
          <button onClick={saveAuto} disabled={saving} className="mt-4 rounded-md bg-pearl px-4 py-2.5 text-[13px] font-semibold text-ink disabled:opacity-40">{saving ? "Saving" : "Save automations"}</button>
        </div>
      ) : <p className="py-12 text-center text-sm text-ink/40">Loading</p>}
    </div>
  );
}
