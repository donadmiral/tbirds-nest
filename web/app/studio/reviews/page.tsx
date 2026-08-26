"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessageSquare, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Review = { id: string; rating: number; body: string | null; created_at: string; helpful_count: number; user_id: string; name: string; username: string | null; avatar_url: string | null; reply: string | null; replied_at: string | null };
type Data = { average: number; count: number; distribution: Record<string, number>; reviews: Review[] };

export default function ReviewsPage() {
  const supabase = useRef(createClient()).current;
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unanswered" | "low">("all");
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await supabase.rpc("studio_reviews"); setD(data as Data); } finally { setLoading(false); }
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  const save = async (r: Review) => {
    if (busy) return;
    setBusy(true);
    try { const { error } = await supabase.rpc("studio_reply_review", { p_review: r.id, p_body: text }); if (error) throw error; setReplyFor(null); setText(""); await load(); }
    catch (e: any) { alert(e?.message || "Could not save the reply."); }
    finally { setBusy(false); }
  };

  const stars = (n: number) => <span className="inline-flex gap-0.5">{[1, 2, 3, 4, 5].map(i => <Star key={i} size={12} className={i <= n ? "fill-pearl text-pearl" : "text-ink/20"} />)}</span>;
  const shown = (d?.reviews || []).filter(r => filter === "all" ? true : filter === "unanswered" ? !r.reply : r.rating <= 3);

  return (
    <div className="max-w-[860px]">
      <h1 className="font-display text-2xl text-porcelain">Reviews</h1>
      <p className="mt-1 text-[13px] text-ink/50">Reply in public. A calm answer to a bad review is read by more people than the review itself.</p>

      {loading || !d ? <p className="py-12 text-center text-sm text-ink/40">Loading</p> : (
        <>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-[200px_1fr]">
            <div className="rounded-xl border border-ink/10 px-4 py-4 text-center">
              <p className="font-display text-[40px] leading-none text-porcelain">{Number(d.average).toFixed(1)}</p>
              <div className="mt-2 flex justify-center">{stars(Math.round(Number(d.average)))}</div>
              <p className="mt-1 text-[12px] text-ink/45">{d.count} review{d.count === 1 ? "" : "s"}</p>
            </div>
            <div className="rounded-xl border border-ink/10 px-4 py-3">
              {[5, 4, 3, 2, 1].map(n => { const c = Number(d.distribution?.[String(n)] || 0); const w = d.count ? (c / d.count) * 100 : 0; return (
                <div key={n} className="flex items-center gap-2 py-1 text-[12px] text-ink/60"><span className="w-3">{n}</span><Star size={11} className="fill-pearl text-pearl" /><div className="h-1.5 flex-1 rounded-full bg-surface"><div className="h-1.5 rounded-full bg-pearl" style={{ width: w + "%" }} /></div><span className="w-6 text-right">{c}</span></div>
              ); })}
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            {(["all", "unanswered", "low"] as const).map(f => <button key={f} onClick={() => setFilter(f)} className={"rounded-full px-3 py-1.5 text-[12.5px] font-semibold " + (filter === f ? "bg-ink text-porcelain" : "bg-surface text-ink/60")}>{f === "all" ? "All" : f === "unanswered" ? "Unanswered" : "3 stars and below"}</button>)}
          </div>

          {shown.length === 0 ? <p className="py-12 text-center text-sm text-ink/40">{d.count === 0 ? "No reviews yet. Customers leave them on your profile." : "Nothing in this filter."}</p> : shown.map(r => (
            <div key={r.id} className="mt-2 rounded-xl border border-ink/10 p-3">
              <div className="flex items-start gap-3">
                {r.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-[12px] font-semibold text-porcelain">{r.name.charAt(0)}</span>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={r.username ? "/" + r.username : "#"} className="text-[13.5px] font-semibold text-ink hover:underline">{r.name}</Link>
                    {stars(r.rating)}
                    <span className="text-[11.5px] text-ink/40">{new Date(r.created_at).toLocaleDateString()}{r.helpful_count ? " · " + r.helpful_count + " found helpful" : ""}</span>
                  </div>
                  {r.body ? <p className="mt-1 text-[13.5px] text-ink/80">{r.body}</p> : <p className="mt-1 text-[12.5px] italic text-ink/40">No written review.</p>}
                  {r.reply && replyFor !== r.id ? (
                    <div className="mt-2 rounded-lg bg-surface p-2.5">
                      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink/40"><MessageSquare size={11} /> Your reply{r.replied_at ? " · " + new Date(r.replied_at).toLocaleDateString() : ""}</p>
                      <p className="mt-1 text-[13px] text-ink/80">{r.reply}</p>
                    </div>
                  ) : null}
                  {replyFor === r.id ? (
                    <div className="mt-2">
                      <textarea value={text} onChange={e => setText(e.target.value)} maxLength={600} placeholder="Thank them, address the point, say what happens next." className="h-20 w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none" autoFocus />
                      <div className="mt-1.5 flex gap-2">
                        <button onClick={() => save(r)} disabled={busy} className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-semibold text-porcelain disabled:opacity-40">{r.reply ? "Update reply" : "Post reply"}</button>
                        {r.reply ? <button onClick={() => { setText(""); void save(r); }} disabled={busy} className="rounded-md bg-red-500/10 px-3 py-1.5 text-[12px] text-red-400">Remove reply</button> : null}
                        <button onClick={() => setReplyFor(null)} className="rounded-md bg-surface px-3 py-1.5 text-[12px] text-ink/60">Cancel</button>
                      </div>
                    </div>
                  ) : <button onClick={() => { setReplyFor(r.id); setText(r.reply || ""); }} className="mt-2 rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 hover:text-ink">{r.reply ? "Edit reply" : "Reply"}</button>}
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
