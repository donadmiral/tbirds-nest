"use client";

import { useEffect, useRef, useState } from "react";
import { useSocialPages } from "@/lib/useSocialPages";
import { SocialPageFooter } from "@/components/SocialPageFooter";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Radio, Search, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Ch = { id: string; name: string; description: string | null; icon_url: string | null; member_count: number; is_member: boolean; my_role: string | null; owner_username: string | null };

export default function ChannelsPage() {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const page = useSocialPages<Ch>("get_channels_page", { p_query: query.trim() || null });
  const { items: rows, setItems: setRows, loading } = page;
  const [actionError, setActionError] = useState<string | null>(null);
  const locks = useRef(new Set<string>());
  const [creating, setCreating] = useState(false);
  const [cName, setCName] = useState("");
  const [cDesc, setCDesc] = useState("");
  const [cAud, setCAud] = useState<"everyone" | "followers">("everyone");
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    let alive = true; let known = false;
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => { known = true; if (alive) setMe(session?.user.id ?? null); });
    supabase.auth.getSession().then(({ data }) => { if (alive && !known) setMe(data.session?.user.id ?? null); });
    return () => { alive = false; auth.subscription.unsubscribe(); };
  }, [supabase]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const join = async (ch: Ch) => {
    if (locks.current.has(ch.id)) return;
    locks.current.add(ch.id); setActionError(null);
    const version = page.version();
    try {
      const { error } = await supabase.rpc("join_channel", { p_channel: ch.id });
      if (error) throw error;
      if (version !== page.version()) return;
      setRows(prev => prev.map(r => r.id === ch.id ? { ...r, is_member: true, member_count: r.member_count + 1, my_role: r.my_role || "member" } : r));
    } catch { setActionError("Could not join this channel. Please try again."); }
    finally { locks.current.delete(ch.id); }
  };

  const create = async () => {
    const nm = cName.trim();
    if (!nm || locks.current.has("create")) return;
    locks.current.add("create"); setActionError(null);
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_channel", { p_name: nm, p_description: cDesc.trim() || null, p_audience: cAud });
      if (error) throw error;
      setCreating(false); setCName(""); setCDesc("");
      const id = typeof data === "string" ? data : (data as any)?.id;
      if (id) router.push("/channels/" + id);
      else void page.reload();
    } catch { setActionError("Could not create this channel. Please try again."); } finally { locks.current.delete("create"); setBusy(false); }
  };

  const chLink = (ch: Ch) => "/channels/" + ch.id;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[640px] px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-ink"><Radio size={19} /> Channels</h1>
        {me ? (
          <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90"><Plus size={14} /> New channel</button>
        ) : null}
      </div>
      <div className="mb-3 flex gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-white"><Radio size={13} /> Channels</span>
        <Link href="/communities" className="inline-flex items-center gap-1.5 rounded-full bg-ink/5 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink/60 transition-colors duration-[140ms] hover:text-ink"><Users size={13} /> Communities</Link>
      </div>
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-ink/5 px-3 py-2 transition-colors duration-[140ms] focus-within:bg-ink/[0.07]">
        <Search size={15} className="text-muted" />
        <input value={q} onChange={e => setQ(e.target.value)} aria-label="Search channels" placeholder="Search channels"
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-muted" />
        {q ? <button onClick={() => setQ("")} className="rounded-full p-0.5 transition-colors duration-[140ms] hover:bg-ink/10"><X size={15} className="text-muted" /></button> : null}
      </div>
      {actionError ? <p role="alert" className="py-2 text-sm text-danger">{actionError}</p> : null}
      {loading && rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">Loading…</p>
      ) : rows.length === 0 && !page.error ? (
        <p className="py-16 text-center text-sm text-muted">{q ? "No channels match." : "No channels yet. Create the first one."}</p>
      ) : (
        <ul>
          {rows.map(ch => (
            <li key={ch.id} className="flex items-center gap-3 border-b border-ink/5 py-3">
              <Link href={chLink(ch)} className="flex min-w-0 flex-1 items-center gap-3">
                {ch.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ch.icon_url} alt="" className="h-11 w-11 rounded-full object-cover" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-navy text-white"><Radio size={17} /></span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-semibold text-ink">{ch.name}</span>
                  <span className="block truncate text-[12.5px] text-muted">
                    {String(ch.member_count || 0)} {ch.member_count === 1 ? "member" : "members"}
                    {ch.description ? " · " + ch.description : ""}
                  </span>
                </span>
              </Link>
              {me && !ch.is_member ? (
                <button onClick={() => join(ch)} className="rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90">Join</button>
              ) : ch.is_member ? (
                <span className="rounded-full bg-ink/5 px-3.5 py-1.5 text-[12.5px] font-semibold text-muted">Joined</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <SocialPageFooter {...page} />
      {creating ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={() => setCreating(false)}>
          <div className="w-full max-w-[440px] rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[15px] font-semibold text-ink">New channel</p>
              <button onClick={() => setCreating(false)} className="rounded-full p-1.5 text-muted transition-colors duration-[140ms] hover:bg-black/5" aria-label="Close"><X size={16} /></button>
            </div>
            <input value={cName} onChange={e => setCName(e.target.value)} maxLength={60} placeholder="Channel name"
              className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
            <input value={cDesc} onChange={e => setCDesc(e.target.value)} maxLength={160} placeholder="What is it about? (optional)"
              className="mb-3 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
            <div className="mb-4 flex gap-2">
              {(["everyone", "followers"] as const).map(k => (
                <button key={k} onClick={() => setCAud(k)}
                  className={"flex-1 rounded-lg border px-3 py-2 text-[13px] font-semibold transition-colors duration-[140ms] " + (cAud === k ? "border-ink bg-black/[0.03] text-ink" : "border-ink/10 text-ink/60")}>
                  {k === "everyone" ? "Everyone can join" : "My followers"}
                </button>
              ))}
            </div>
            {actionError ? <p role="alert" className="mb-2 text-sm text-danger">{actionError}</p> : null}
            <button onClick={create} disabled={!cName.trim() || busy}
              className="w-full rounded-full bg-ink py-2.5 text-sm font-bold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">
              {busy ? "Creating…" : "Create channel"}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}