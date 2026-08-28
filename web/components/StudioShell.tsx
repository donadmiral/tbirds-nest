"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Briefcase, Home, Inbox, KeyRound, LayoutDashboard, Megaphone, Settings, ShoppingBag, Star, Users, CalendarClock } from "lucide-react";
import { ROOMS, bindMember, studioMe, type StudioMe } from "@/lib/studio";

const StudioCtx = createContext<{ me: StudioMe | null; refresh: () => Promise<void> }>({ me: null, refresh: async () => {} });
export const useStudio = () => useContext(StudioCtx);

const ICONS: Record<string, any> = {
  home: Home, inbox: Inbox, planner: CalendarClock, commerce: ShoppingBag, recruiter: Briefcase,
  ads: Megaphone, insights: BarChart3, audience: Users, reviews: Star, settings: Settings,
};

export function StudioShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<StudioMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => { setMe(await studioMe()); };
  useEffect(() => { (async () => { await refresh(); setLoading(false); })(); }, []);

  const bind = async () => {
    if (!code.trim() || busy) return;
    setBusy(true); setErr(null);
    try { await bindMember(code.trim()); setCode(""); await refresh(); }
    catch (e: any) { setErr(e?.message || "Code not recognised."); }
    finally { setBusy(false); }
  };

  if (loading) return <p className="py-20 text-center text-sm text-ink/40">Opening Studio</p>;

  if (!me || !me.is_business) {
    return (
      <div className="mx-auto max-w-[520px] px-6 py-16">
        <h1 className="font-display text-2xl text-porcelain">Business Studio</h1>
        <p className="mt-3 text-[14px] leading-6 text-ink/60">Studio opens for business sessions. Sign in through the business door with your access code, or ask the business owner for one.</p>
        <Link href="/business-login" className="mt-6 inline-flex items-center gap-2 rounded-full bg-pearl px-5 py-2.5 text-[13px] font-bold text-ink transition-opacity duration-[140ms] hover:opacity-90"><KeyRound size={15} /> Business sign in</Link>
      </div>
    );
  }

  if (me.needs_code) {
    return (
      <div className="mx-auto max-w-[460px] px-6 py-16">
        <h1 className="font-display text-2xl text-porcelain">Who is working?</h1>
        <p className="mt-3 text-[14px] leading-6 text-ink/60">Enter your personal access code once for this session. It sets what you can do in Studio for {me.business_name || "this business"}.</p>
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === "Enter") void bind(); }} placeholder="ACCESS CODE" autoFocus
          className="mt-5 w-full rounded-lg border border-ink/15 bg-transparent px-3 py-2.5 font-mono text-[15px] tracking-widest text-ink outline-none transition-colors duration-[140ms] focus:border-pearl" />
        {err ? <p className="mt-2 text-[12.5px] text-red-400">{err}</p> : null}
        <button onClick={bind} disabled={!code.trim() || busy} className="mt-4 w-full rounded-full bg-pearl py-2.5 text-[13px] font-bold text-ink transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">{busy ? "Checking" : "Continue"}</button>
      </div>
    );
  }

  return (
    <StudioCtx.Provider value={{ me, refresh }}>
      <div className="flex min-h-screen">
        <aside className="w-[220px] shrink-0 border-r border-ink/10 px-3 py-6">
          <div className="mb-6 flex items-center gap-3 px-2">
            {me.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.avatar_url} alt="" className="h-10 w-10 rounded-xl object-cover" />
            ) : <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy text-white"><LayoutDashboard size={18} /></span>}
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold text-ink">{me.business_name || "Business"}</span>
              <span className="block truncate text-[11.5px] text-ink/45">{me.display_name || "Member"} · {me.role}</span>
            </span>
          </div>
          <nav className="flex flex-col gap-0.5">
            {ROOMS.map(r => {
              const Icon = ICONS[r.key];
              const active = r.href === "/studio" ? pathname === "/studio" : pathname.startsWith(r.href);
              return (
                <Link key={r.key} href={r.ready ? r.href : "#"} aria-disabled={!r.ready}
                  className={"flex items-center gap-3 rounded-full px-3.5 py-2 text-[13.5px] transition-colors duration-[140ms] " + (active ? "bg-surface-elevated font-semibold text-ink" : r.ready ? "text-ink/70 hover:bg-surface hover:text-ink" : "cursor-default text-ink/30")}>
                  <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
                  <span className="flex-1">{r.label}</span>
                  {!r.ready ? <span className="text-[10px] uppercase tracking-wide text-ink/30">soon</span> : null}
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className="min-w-0 flex-1 px-8 py-7">{children}</div>
      </div>
    </StudioCtx.Provider>
  );
}