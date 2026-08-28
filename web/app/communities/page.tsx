"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Radio, Search, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIES } from "@/lib/categories";
import { COMM_COLORS } from "@/lib/communities";

type Comm = {
  id: string; name: string; description: string | null; icon_url: string | null;
  cover_color: string; category: string | null; join_mode: string;
  member_count: number; is_member: boolean; my_role: string | null; has_pending: boolean;
};

export default function CommunitiesPage() {
  const supabase = createClient();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Comm[]>([]);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [gName, setGName] = useState("");
  const [gDesc, setGDesc] = useState("");
  const [gRules, setGRules] = useState("");
  const [gMode, setGMode] = useState<"open" | "approval" | "invite">("open");
  const [gColor, setGColor] = useState("sky");
  const [gCat, setGCat] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMe(data.session?.user.id ?? null));
  }, [supabase]);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const { data } = await supabase.rpc("get_communities", { p_query: query.trim() || null, p_limit: 40 });
      setRows((data as Comm[]) ?? []);
    } finally { setLoading(false); }
  }, [supabase]);

  useEffect(() => {
    const t = setTimeout(() => { void load(q); }, 250);
    return () => clearTimeout(t);
  }, [q, load]);

  const join = async (c: Comm) => {
    const { data, error } = await supabase.rpc("join_community", { p_community: c.id });
    if (error) { alert(error.message); return; }
    if (data === "joined") setRows(prev => prev.map(r => r.id === c.id ? { ...r, is_member: true, my_role: r.my_role || "member", member_count: (r.member_count || 0) + 1 } : r));
    else setRows(prev => prev.map(r => r.id === c.id ? { ...r, has_pending: true } : r));
  };

  const create = async () => {
    const nm = gName.trim();
    if (!nm || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_community", {
        p_name: nm, p_description: gDesc.trim() || null, p_category: gCat,
        p_join_mode: gMode, p_cover_color: gColor, p_rules: gRules.trim() || null,
      });
      if (error) throw error;
      setCreating(false);
      const id = typeof data === "string" ? data : (data as any)?.id;
      if (id) window.location.href = "/communities/" + id;
      else void load(q);
    } catch (err: any) { alert(err?.message || "Could not create the community."); }
    finally { setBusy(false); }
  };

  const catLabel = (key: string | null) => key ? (CATEGORIES.find(c => c.key === key)?.label || key) : null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[640px] px-4 py-6">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-ink"><Users size={19} /> Communities</h1>
        {me ? (
          <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90"><Plus size={14} /> New community</button>
        ) : null}
      </div>
      <div className="mb-3 flex gap-2">
        <Link href="/channels" className="inline-flex items-center gap-1.5 rounded-full bg-ink/5 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink/60 transition-colors duration-[140ms] hover:text-ink"><Radio size={13} /> Channels</Link>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-white"><Users size={13} /> Communities</span>
      </div>
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-ink/5 px-3 py-2 transition-colors duration-[140ms] focus-within:bg-ink/[0.07]">
        <Search size={15} className="text-ink/40" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search communities"
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink/40" />
        {q ? <button onClick={() => setQ("")} className="rounded-full p-0.5 transition-colors duration-[140ms] hover:bg-ink/10"><X size={15} className="text-ink/40" /></button> : null}
      </div>
      {loading ? (
        <p className="py-16 text-center text-sm text-ink/40">Loading&hellip;</p>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink/40">{q ? "No communities match." : "No communities yet. Create the first one."}</p>
      ) : (
        <ul>
          {rows.map(c => (
            <li key={c.id} className="flex items-center gap-3 border-b border-ink/5 py-3">
              <Link href={"/communities/" + c.id} className="flex min-w-0 flex-1 items-center gap-3">
                {c.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.icon_url} alt="" className="h-11 w-11 rounded-xl object-cover" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl text-[#1F2937]" style={{ background: COMM_COLORS[c.cover_color] || COMM_COLORS.sky }}><Users size={17} /></span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-semibold text-ink">{c.name}</span>
                  <span className="block truncate text-[12.5px] text-ink/45">
                    {String(c.member_count || 0)} {c.member_count === 1 ? "member" : "members"}
                    {catLabel(c.category) ? " · " + catLabel(c.category) : ""}
                    {c.description ? " · " + c.description : ""}
                  </span>
                </span>
              </Link>
              {c.is_member ? (
                <span className="rounded-full bg-ink/5 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink/50">Joined</span>
              ) : c.has_pending ? (
                <span className="rounded-full bg-ink/5 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink/50">Requested</span>
              ) : c.join_mode === "invite" ? (
                <span className="rounded-full bg-ink/5 px-3 py-1.5 text-[12px] font-semibold text-ink/40">Invite only</span>
              ) : me ? (
                <button onClick={() => join(c)} className="rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90">{c.join_mode === "approval" ? "Request" : "Join"}</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={() => setCreating(false)}>
          <div className="max-h-[88vh] w-full max-w-[460px] overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[15px] font-semibold text-ink">New community</p>
              <button onClick={() => setCreating(false)} className="rounded-full p-1.5 text-ink/50 transition-colors duration-[140ms] hover:bg-black/5" aria-label="Close"><X size={16} /></button>
            </div>
            <input value={gName} onChange={e => setGName(e.target.value)} maxLength={60} placeholder="Community name"
              className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
            <input value={gDesc} onChange={e => setGDesc(e.target.value)} maxLength={200} placeholder="What is it about? (optional)"
              className="mb-3 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Who can join</p>
            <div className="mb-3 flex gap-2">
              {(["open", "approval", "invite"] as const).map(k => (
                <button key={k} onClick={() => setGMode(k)}
                  className={"flex-1 rounded-lg border px-2 py-2 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (gMode === k ? "border-ink bg-black/[0.03] text-ink" : "border-ink/10 text-ink/60")}>
                  {k === "open" ? "Open" : k === "approval" ? "Approval" : "Invite only"}
                </button>
              ))}
            </div>
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Category</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {CATEGORIES.map(c => (
                <button key={c.key} onClick={() => setGCat(gCat === c.key ? null : c.key)}
                  className={"rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors duration-[140ms] " + (gCat === c.key ? "border-ink bg-ink text-white" : "border-ink/10 text-ink/60")}>
                  {c.label}
                </button>
              ))}
            </div>
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Cover color</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {Object.entries(COMM_COLORS).map(([k, v]) => (
                <button key={k} onClick={() => setGColor(k)} aria-label={k}
                  className={"h-8 w-8 rounded-full border-2 transition-colors duration-[140ms] " + (gColor === k ? "border-ink" : "border-transparent")} style={{ background: v }} />
              ))}
            </div>
            <textarea value={gRules} onChange={e => setGRules(e.target.value)} maxLength={600} placeholder="Rules shown to people when they join (optional)"
              className="mb-4 h-20 w-full rounded-lg border border-ink/15 px-3 py-2 text-[13.5px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
            <button onClick={create} disabled={!gName.trim() || busy}
              className="w-full rounded-full bg-ink py-2.5 text-sm font-bold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">
              {busy ? "Creating\u2026" : "Create community"}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}