"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Radio, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Ch = { id: string; name: string; description: string | null; icon_url: string | null; member_count: number; is_member: boolean; my_role: string | null; owner_username: string | null };

export default function ChannelsPage() {
  const supabase = createClient();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Ch[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [cName, setCName] = useState("");
  const [cDesc, setCDesc] = useState("");
  const [cAud, setCAud] = useState<"everyone" | "followers">("everyone");
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMe(data.session?.user.id ?? null));
  }, [supabase]);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const { data } = await supabase.rpc("get_channels", { p_query: query.trim() || null, p_limit: 40 });
      setRows((data as Ch[]) ?? []);
    } finally { setLoading(false); }
  }, [supabase]);

  useEffect(() => {
    const t = setTimeout(() => { void load(q); }, 250);
    return () => clearTimeout(t);
  }, [q, load]);

  const join = async (ch: Ch) => {
    setRows(prev => prev.map(r => r.id === ch.id ? { ...r, is_member: true, member_count: (r.member_count || 0) + 1 } : r));
    const { error } = await supabase.rpc("join_channel", { p_channel: ch.id });
    if (error) setRows(prev => prev.map(r => r.id === ch.id ? { ...r, is_member: false, member_count: Math.max((r.member_count || 1) - 1, 0) } : r));
  };

  const create = async () => {
    const nm = cName.trim();
    if (!nm || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_channel", { p_name: nm, p_description: cDesc.trim() || null, p_audience: cAud });
      if (error) throw error;
      setCreating(false); setCName(""); setCDesc("");
      const id = typeof data === "string" ? data : (data as any)?.id;
      if (id) window.location.href = "/channels/" + id + "?n=" + encodeURIComponent(nm) + "&r=owner&j=1";
      else void load(q);
    } catch { /* leave modal open */ } finally { setBusy(false); }
  };

  const chLink = (ch: Ch) =>
    "/channels/" + ch.id + "?n=" + encodeURIComponent(ch.name) + "&r=" + encodeURIComponent(ch.my_role || "") + "&m=" + String(ch.member_count || 0) + "&j=" + (ch.is_member ? "1" : "0") + (ch.icon_url ? "&i=" + encodeURIComponent(ch.icon_url) : "");

  return (
    <main className="mx-auto min-h-screen w-full max-w-[640px] px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-ink"><Radio size={19} /> Channels</h1>
        {me ? (
          <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white"><Plus size={14} /> New channel</button>
        ) : null}
      </div>
      <div className="mb-4 flex items-center gap-2 rounded-xl bg-ink/5 px-3 py-2">
        <Search size={15} className="text-ink/40" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search channels"
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink/40" />
        {q ? <button onClick={() => setQ("")}><X size={15} className="text-ink/40" /></button> : null}
      </div>
      {loading ? (
        <p className="py-16 text-center text-sm text-ink/40">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink/40">{q ? "No channels match." : "No channels yet. Create the first one."}</p>
      ) : (
        <ul>
          {rows.map(ch => (
            <li key={ch.id} className="flex items-center gap-3 border-b border-ink/5 py-3">
              <Link href={chLink(ch)} className="flex min-w-0 flex-1 items-center gap-3">
                {ch.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ch.icon_url} alt="" className="h-11 w-11 rounded-full object-cover" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0B1E3D] text-white"><Radio size={17} /></span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-semibold text-ink">{ch.name}</span>
                  <span className="block truncate text-[12.5px] text-ink/45">
                    {String(ch.member_count || 0)} {ch.member_count === 1 ? "member" : "members"}
                    {ch.description ? " · " + ch.description : ""}
                  </span>
                </span>
              </Link>
              {me && !ch.is_member ? (
                <button onClick={() => join(ch)} className="rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-white">Join</button>
              ) : ch.is_member ? (
                <span className="rounded-full bg-ink/5 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink/50">Joined</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={() => setCreating(false)}>
          <div className="w-full max-w-[440px] rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[15px] font-semibold text-ink">New channel</p>
              <button onClick={() => setCreating(false)} className="rounded-full p-1.5 text-ink/50 hover:bg-black/5" aria-label="Close"><X size={16} /></button>
            </div>
            <input value={cName} onChange={e => setCName(e.target.value)} maxLength={60} placeholder="Channel name"
              className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/40" />
            <input value={cDesc} onChange={e => setCDesc(e.target.value)} maxLength={160} placeholder="What is it about? (optional)"
              className="mb-3 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/40" />
            <div className="mb-4 flex gap-2">
              {(["everyone", "followers"] as const).map(k => (
                <button key={k} onClick={() => setCAud(k)}
                  className={"flex-1 rounded-lg border px-3 py-2 text-[13px] font-semibold " + (cAud === k ? "border-ink bg-black/[0.03] text-ink" : "border-ink/10 text-ink/60")}>
                  {k === "everyone" ? "Everyone can join" : "My followers"}
                </button>
              ))}
            </div>
            <button onClick={create} disabled={!cName.trim() || busy}
              className="w-full rounded-md bg-ink py-2.5 text-sm font-semibold text-white disabled:opacity-40">
              {busy ? "Creating…" : "Create channel"}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
