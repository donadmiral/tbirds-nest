"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Briefcase, Home, Inbox, KeyRound, LayoutDashboard, Megaphone, Settings, ShoppingBag, Star, Users, CalendarClock } from "lucide-react";
import { ExternalLink } from "lucide-react";
import { ROOMS, bindMember, studioMe, type StudioMe } from "@/lib/studio";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { StudioSideRail } from "@/components/StudioSideRail";
import { createClient } from "@/lib/supabase/client";

const StudioCtx = createContext<{ me: StudioMe | null; refresh: () => Promise<void> }>({ me: null, refresh: async () => {} });
export const useStudio = () => useContext(StudioCtx);

const ICONS: Record<string, any> = {
  home: Home, inbox: Inbox, planner: CalendarClock, commerce: ShoppingBag, recruiter: Briefcase,
  ads: Megaphone, insights: BarChart3, audience: Users, reviews: Star, settings: Settings,
};

export function StudioShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // studio_me carries no verification fields, so the seal comes from the
  // profile rather than being assumed from the business role.
  const [tier, setTier] = useState<string | null>(null);
  const [me, setMe] = useState<StudioMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => { setMe(await studioMe()); };

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;
      const { data } = await supabase.from("profiles").select("is_verified, verified_tier").eq("id", uid).maybeSingle();
      setTier(data?.verified_tier ?? (data?.is_verified ? "business" : null));
    })();
  }, []);
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
      <div className="mx-auto max-w-[1360px] px-6 py-6">
        {/* The desk nav runs across the top rather than down the side. Studio
            already sits inside the app's left rail, and a second vertical nav
            beside it left the desks about 700px wide, which is not enough for
            a table and a chart side by side. */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-[26px] leading-tight text-porcelain">Studio</h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-[15px] font-semibold text-ink">
              {greeting()}, {me.business_name || me.display_name || "team"}
              {tier ? <VerifiedBadge tier={tier} size={15} /> : null}
            </p>
            <p className="mt-0.5 text-[13px] text-ink/50">Build your brand. Inspire your audience. Grow your business.</p>
          </div>
          {me.username ? (
            <Link
              href={"/" + me.username}
              className="flex shrink-0 items-center gap-2 rounded-full border border-pearl/50 px-4 py-2 text-[12.5px] font-semibold text-pearl-muted transition-colors duration-[140ms] hover:bg-pearl/10"
            >
              View public profile <ExternalLink size={13} />
            </Link>
          ) : null}
        </header>

        <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-ink/10">
          {ROOMS.map((r) => {
            const Icon = ICONS[r.key];
            const active = r.href === "/studio" ? pathname === "/studio" : pathname.startsWith(r.href);
            return (
              <Link
                key={r.key}
                href={r.ready ? r.href : "#"}
                aria-disabled={!r.ready}
                className={
                  "relative flex shrink-0 items-center gap-2 px-3.5 py-3 text-[13.5px] transition-colors duration-[140ms] " +
                  (active ? "font-semibold text-ink" : r.ready ? "text-ink/55 hover:text-ink" : "cursor-default text-ink/25")
                }
              >
                <Icon size={15} className={active ? "text-pearl" : undefined} />
                {r.label}
                <span
                  className={"absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-pearl transition-opacity duration-[160ms] " + (active ? "opacity-100" : "opacity-0")}
                  aria-hidden
                />
              </Link>
            );
          })}
        </nav>

        {/* Every desk is a centre column and a rail. The desks were rendering
            full width, which left a third of the screen empty on anything but
            the widest tables and made each one look unfinished. */}
        <div className="mt-6 flex gap-6">
          <div className="min-w-0 flex-1">{children}</div>
          <aside className="hidden w-[300px] shrink-0 2xl:block">
            <div className="sticky top-[88px] flex flex-col gap-4">
              <StudioSideRail role={me.role} username={me.username} />
            </div>
          </aside>
        </div>
      </div>
    </StudioCtx.Provider>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
