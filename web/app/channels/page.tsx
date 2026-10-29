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
  const { items: rows, loading } = page;
  const [actionError, setActionError] = useState<string | null>(null);
  const locks = useRef(new Set<string>());
  const [creating, setCreating] = useState(false);
  const [cName, setCName] = useState("");
  const [cDesc, setCDesc] = useState("");
  const [cAud, setCAud] = useState<"everyone" | "followers">("everyone");
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const account = useRef<string | null>(null);
  const mounted = useRef(true), scope = useRef(0);

  useEffect(() => {
    let alive = true; let known = false;
    mounted.current = true;
    const bind = (id: string | null) => {
      if (!alive) return;
      if (account.current !== id) { ++scope.current; account.current = id; setCreating(false); setCName(""); setCDesc(""); setBusy(false); setActionError(null); }
      setMe(id);
    };
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => { known = true; bind(session?.user.id ?? null); });
    supabase.auth.getSession().then(({ data, error }) => { if (!known && !error) bind(data.session?.user.id ?? null); }, () => { if (alive && !known) setActionError("Your session could not be loaded. Reload to retry."); });
    return () => { alive = false; mounted.current = false; ++scope.current; auth.subscription.unsubscribe(); };
  }, [supabase]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const join = async (ch: Ch) => {
    const key = me + ":join:" + ch.id;
    if (!me || account.current !== me || locks.current.has(key)) return;
    locks.current.add(key); setActionError(null);
    const version = page.version();
    try {
      const { error } = await supabase.rpc("join_channel", { p_channel: ch.id });
      if (error) throw error;
      if (version !== page.version()) return;
      await page.reload();
    } catch { if (mounted.current && account.current === me && version === page.version()) setActionError("Could not join this channel. Please try again."); }
    finally { locks.current.delete(key); }
  };

  const create = async () => {
    const nm = cName.trim();
    const key = me + ":create", version = scope.current;
    const current = () => mounted.current && version === scope.current && account.current === me;
    if (!nm || !me || !current() || locks.current.has(key)) return;
    locks.current.add(key); setActionError(null);
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_channel", { p_name: nm, p_description: cDesc.trim() || null, p_audience: cAud });
      if (error) throw error;
      if (!current()) return;
      const id = typeof data === "string" ? data : (data as any)?.id;
      if (!id) throw new Error("Creation was not confirmed.");
      setCreating(false); setCName(""); setCDesc(""); setCAud("everyone");
      router.push("/channels/" + id);
    } catch { if (current()) setActionError("Channel creation was not confirmed. Refresh the directory before retrying."); } finally { locks.current.delete(key); if (current()) setBusy(false); }
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
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={() => { if (!busy) setCreating(false); }}>
          <div role="dialog" aria-modal="true" aria-label="New channel" className="w-full max-w-[440px] rounded-t-2xl bg-surface p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[15px] font-semibold text-ink">New channel</p>
              <button disabled={busy} onClick={() => setCreating(false)} className="rounded-full p-1.5 text-muted transition-colors duration-[140ms] hover:bg-ink/5 disabled:opacity-40" aria-label="Close"><X size={16} /></button>
            </div>
            <input disabled={busy} value={cName} onChange={e => setCName(e.target.value)} maxLength={60} placeholder="Channel name"
              className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
            <input disabled={busy} value={cDesc} onChange={e => setCDesc(e.target.value)} maxLength={160} placeholder="What is it about? (optional)"
              className="mb-3 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" />
            <div className="mb-4 flex gap-2">
              {(["everyone", "followers"] as const).map(k => (
                <button key={k} disabled={busy} onClick={() => setCAud(k)}
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
