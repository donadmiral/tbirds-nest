"use client";

import { useEffect, useRef, useState } from "react";
import { withTimeout } from "@/lib/withTimeout";
import { useSocialPages } from "@/lib/useSocialPages";
import { SocialPageFooter } from "@/components/SocialPageFooter";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Radio, Search, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIES } from "@/lib/categories";
import { COMM_COLORS } from "@/lib/communities";

type Comm = {
  id: string; name: string; description: string | null; icon_url: string | null;
  cover_color: string; category: string | null; join_mode: string;
  member_count: number; is_member: boolean; my_role: string | null; has_pending: boolean;
  has_invite?: boolean;
};

export default function CommunitiesPage() {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const page = useSocialPages<Comm>("get_communities_page", { p_query: query.trim() || null });
  const { items: rows, setItems: setRows, loading } = page;
  const [actionError, setActionError] = useState<string | null>(null);
  const locks = useRef(new Set<string>());const actionEpoch=useRef(0);
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
    let alive = true, uid:string|null|undefined;
    const bind=(next:string|null)=>{if(!alive||next===uid)return;uid=next;actionEpoch.current++;locks.current.clear();setBusy(false);setCreating(false);setGName('');setGDesc('');setGRules('');setMe(next);setActionError(null);};
    const {data:auth}=supabase.auth.onAuthStateChange((_event,session)=>bind(session?.user.id??null));
    withTimeout(supabase.auth.getSession()).then(({data,error})=>{if(error)throw error;if(uid===undefined)bind(data.session?.user.id??null);}).catch(()=>{if(alive)setActionError('Your session could not be loaded. Reload to try again.');});
    return()=>{alive=false;actionEpoch.current++;auth.subscription.unsubscribe();};
  }, [supabase]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const join = async (c: Comm) => {
    if (locks.current.has(c.id)) return;
    locks.current.add(c.id); setActionError(null);
    const version = actionEpoch.current;
    try {
    const { data, error } = await supabase.rpc("join_community", { p_community: c.id });
    if (error) throw error;
    if (version !== actionEpoch.current) return;
    await page.reload();
    } catch { if(version===actionEpoch.current)setActionError("Could not join this community. Please try again."); }
    finally { if(version===actionEpoch.current)locks.current.delete(c.id); }
  };

  const create = async () => {
    const nm = gName.trim();
    if (!nm || locks.current.has("create")) return;
    const version=actionEpoch.current;locks.current.add("create"); setActionError(null);
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_community", {
        p_name: nm, p_description: gDesc.trim() || null, p_category: gCat,
        p_join_mode: gMode, p_cover_color: gColor, p_rules: gRules.trim() || null,
      });
      if (error) throw error;
      if(version!==actionEpoch.current)return;setCreating(false);
      const id = typeof data === "string" ? data : (data as any)?.id;
      if (id) router.push("/communities/" + id);
      else void page.reload();
    } catch (err: any) { if(version===actionEpoch.current)setActionError(err?.message || "Could not create the community."); }
    finally { if(version===actionEpoch.current){locks.current.delete("create"); setBusy(false);} }
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
        <Search size={15} className="text-muted" />
        <input value={q} onChange={e => setQ(e.target.value)} aria-label="Search communities" placeholder="Search communities"
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-muted" />
        {q ? <button onClick={() => setQ("")} className="rounded-full p-0.5 transition-colors duration-[140ms] hover:bg-ink/10"><X size={15} className="text-muted" /></button> : null}
      </div>
      {actionError ? <p role="alert" className="py-2 text-sm text-danger">{actionError}</p> : null}
      {loading && rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">Loading&hellip;</p>
      ) : rows.length === 0 && !page.error ? (
        <p className="py-16 text-center text-sm text-muted">{q ? "No communities match." : "No communities yet. Create the first one."}</p>
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
                  <span className="block truncate text-[12.5px] text-muted">
                    {String(c.member_count || 0)} {c.member_count === 1 ? "member" : "members"}
                    {catLabel(c.category) ? " · " + catLabel(c.category) : ""}
                    {c.description ? " · " + c.description : ""}
                  </span>
                </span>
              </Link>
              {c.is_member ? (
                <span className="rounded-full bg-ink/5 px-3.5 py-1.5 text-[12.5px] font-semibold text-muted">Joined</span>
              ) : c.has_invite ? (
                <button onClick={() => join(c)} className="rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90">Accept invite</button>
              ) : c.has_pending ? (
                <span className="rounded-full bg-ink/5 px-3.5 py-1.5 text-[12.5px] font-semibold text-muted">Requested</span>
              ) : c.join_mode === "invite" ? (
                <span className="rounded-full bg-ink/5 px-3 py-1.5 text-[12px] font-semibold text-muted">Invite only</span>
              ) : me ? (
                <button onClick={() => join(c)} className="rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90">{c.join_mode === "approval" ? "Request" : "Join"}</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <SocialPageFooter {...page} />
      {creating ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={() => setCreating(false)}>
          <div className="max-h-[88vh] w-full max-w-[460px] overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[15px] font-semibold text-ink">New community</p>
              <button onClick={() => setCreating(false)} className="rounded-full p-1.5 text-muted transition-colors duration-[140ms] hover:bg-black/5" aria-label="Close"><X size={16} /></button>
            </div>
            <input value={gName} onChange={e => setGName(e.target.value)} maxLength={60} placeholder="Community name"
              className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
            <input value={gDesc} onChange={e => setGDesc(e.target.value)} maxLength={200} placeholder="What is it about? (optional)"
              className="mb-3 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Who can join</p>
            <div className="mb-3 flex gap-2">
              {(["open", "approval", "invite"] as const).map(k => (
                <button key={k} onClick={() => setGMode(k)}
                  className={"flex-1 rounded-lg border px-2 py-2 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (gMode === k ? "border-ink bg-black/[0.03] text-ink" : "border-ink/10 text-ink/60")}>
                  {k === "open" ? "Open" : k === "approval" ? "Approval" : "Invite only"}
                </button>
              ))}
            </div>
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Category</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {CATEGORIES.map(c => (
                <button key={c.key} onClick={() => setGCat(gCat === c.key ? null : c.key)}
                  className={"rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors duration-[140ms] " + (gCat === c.key ? "border-ink bg-ink text-white" : "border-ink/10 text-ink/60")}>
                  {c.label}
                </button>
              ))}
            </div>
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Cover color</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {Object.entries(COMM_COLORS).map(([k, v]) => (
                <button key={k} onClick={() => setGColor(k)} aria-label={k}
                  className={"h-8 w-8 rounded-full border-2 transition-colors duration-[140ms] " + (gColor === k ? "border-ink" : "border-transparent")} style={{ background: v }} />
              ))}
            </div>
            <textarea value={gRules} onChange={e => setGRules(e.target.value)} maxLength={600} placeholder="Rules shown to people when they join (optional)"
              className="mb-4 h-20 w-full rounded-lg border border-ink/15 px-3 py-2 text-[13.5px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
            {actionError ? <p role="alert" className="mb-2 text-sm text-danger">{actionError}</p> : null}
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