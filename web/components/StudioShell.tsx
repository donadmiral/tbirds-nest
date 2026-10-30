"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight, BarChart3, Briefcase, CalendarClock, ChevronRight, CircleHelp, FileText, Handshake, Home, Inbox, KeyRound, Megaphone, Menu, Newspaper, PanelRight, Search, Settings, ShoppingBag, Star, Users, Wallet, type LucideIcon } from "lucide-react";
import { GROUPS, ROOMS, bindMember, studioMe, type StudioMe } from "@/lib/studio";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { StudioSideRail } from "@/components/StudioSideRail";
import { STUDIO_RAIL_SLOT } from "@/components/StudioRailPortal";
import { StudioLoadError } from "@/app/studio/LoadError";
import { StudioDialog } from "@/components/StudioDialog";
import { createClient } from "@/lib/supabase/client";
import styles from "./StudioWorkspace.module.css";

const StudioCtx = createContext<{ me: StudioMe | null; accountId: string; refresh: () => Promise<void> }>({ me: null, accountId: "", refresh: async () => {} });
export const useStudio = () => useContext(StudioCtx);

const ICONS: Record<string, LucideIcon> = { home: Home, content: FileText, inbox: Inbox, planner: CalendarClock, newsroom: Newspaper, commerce: ShoppingBag, recruiter: Briefcase, ads: Megaphone, insights: BarChart3, audience: Users, reviews: Star, partnerships: Handshake, earnings: Wallet, team: Users, settings: Settings };
const DESCRIPTIONS: Record<string, string> = { home: "Your daily publishing and business overview", content: "Find drafts, scheduled and published content", planner: "Write, preview and schedule a post", newsroom: "Assignments, content rights and team approval", inbox: "Conversations, saved replies and customer support", insights: "Organic content and campaign performance", audience: "Your followers and audience activity", ads: "Campaigns, creative and platform advertising review", partnerships: "Creator briefs, deliverables and publishing permissions", commerce: "Products, orders and customer requests", recruiter: "Jobs and applications", reviews: "Customer feedback and ratings", earnings: "Creator earnings, payout status and IntoBank", team: "People, roles and organization access", settings: "Brand details, business hours and approved devices" };
const SURFACE_FOR: Record<string, string> = { newsroom: "planner", partnerships: "content", team: "settings", earnings: "commerce" };
const CREATOR_ROOMS = [
  { key: "home", href: "/studio", label: "Overview", ready: true },
  { key: "content", href: "/write", label: "Create content", ready: true },
  { key: "partnerships", href: "/studio/partnerships", label: "Partnerships", ready: true },
  { key: "earnings", href: "/studio/earnings", label: "Earnings", ready: true },
  { key: "inbox", href: "/messages", label: "Messages", ready: true },
  { key: "settings", href: "/settings", label: "Account settings", ready: true },
];
const CREATOR_PATHS = ["/studio", "/studio/partnerships", "/studio/earnings"];

export function StudioShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [accountId, setAccountId] = useState("");
  const account = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const [tier, setTier] = useState<string | null>(null);
  const [surfaces, setSurfaces] = useState<string[] | null>(null);
  const [me, setMe] = useState<StudioMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showRail, setShowRail] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const binding = useRef(false);

  const refresh = useCallback(async () => {
    const run = ++generation.current;
    const supabase = createClient();
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (run !== generation.current) return;
      const uid = session.session?.user.id || "";
      account.current = uid; setAccountId(uid);
      if (!uid) { setMe(null); setTier(null); setSurfaces(null); setLoadError(null); return; }
      const [studio, profile] = await Promise.all([
        studioMe(), supabase.from("profiles").select("full_name, username, avatar_url, is_verified, verified_tier").eq("id", uid).maybeSingle(),
      ]);
      if (run !== generation.current || account.current !== uid) return;
      if (profile.error) throw profile.error;
      const viewer = profile.data;
      const next: StudioMe = studio?.is_business ? studio : { is_business: false, bound: false, needs_code: false, member_id: null, role: null, display_name: viewer?.full_name ?? null, business_name: null, username: viewer?.username ?? null, avatar_url: viewer?.avatar_url ?? null };
      setMe(next); setLoadError(null);
      setTier(viewer?.verified_tier ?? (viewer?.is_verified ? "verified" : null));
      if (next.is_business && !next.needs_code) {
        const result = await supabase.rpc("studio_surfaces");
        if (run !== generation.current || account.current !== uid) return;
        if (result.error) { setSurfaces(null); setLoadError("Your desk preferences could not be refreshed. Access is still checked when you open a tool."); }
        else setSurfaces(Array.isArray(result.data) ? result.data as string[] : null);
      } else setSurfaces(null);
    } catch { if (run === generation.current) { setMe(null); setLoadError("Studio could not verify this session. Please try again."); } }
    finally { if (run === generation.current) setLoading(false); }
  }, []);

  useEffect(() => {
    let live = true;
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user.id || "";
      if (uid === account.current) return;
      account.current = uid; generation.current++; setAccountId(uid); setMe(null); setTier(null); setSurfaces(null); setCode(""); setErr(null); setLoading(true); setSearchOpen(false); setMenuOpen(false); binding.current = false; setBusy(false);
      queueMicrotask(() => { if (live) void refresh(); });
    });
    void refresh();
    return () => { live = false; generation.current++; data.subscription.unsubscribe(); };
  }, [refresh]);
  useEffect(() => { setSearchOpen(false); setMenuOpen(false); setQuery(""); }, [pathname]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(value => !value); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);

  const rooms = useMemo(() => me?.is_business ? ROOMS.filter(room => room.key === "home" || surfaces === null || surfaces.length === 0 || surfaces.includes(SURFACE_FOR[room.key] ?? room.key)) : CREATOR_ROOMS, [me?.is_business, surfaces]);
  const activeRoom = [...rooms].sort((a,b) => b.href.length - a.href.length).find(room => room.href === "/studio" ? pathname === room.href : pathname === room.href || pathname.startsWith(room.href + "/"));
  const searchRooms = rooms.filter(room => `${room.label} ${DESCRIPTIONS[room.key]}`.toLowerCase().includes(query.trim().toLowerCase()));
  const bind = async () => {
    if (!code.trim() || binding.current) return;
    binding.current = true; setBusy(true); setErr(null);
    const owner = account.current;
    try { await bindMember(code.trim()); if (owner !== account.current) return; setCode(""); await refresh(); }
    catch (error) { if (owner === account.current) setErr(error instanceof Error ? error.message : "Code not recognised."); }
    finally { if (owner === account.current) { binding.current = false; setBusy(false); } }
  };

  if (loading) return <div className={styles.empty} role="status"><p>Opening your workspace…</p></div>;
  if (!me && loadError) return <div className={styles.dialogBody}><StudioLoadError message={loadError} retry={() => { void refresh(); }} /></div>;
  if (!me) return <div className={styles.empty}><KeyRound size={30} /><h1>Open your Studio</h1><p>Sign in to create content, collaborate and manage your professional tools.</p><Link className={styles.buttonPrimary} href="/login?next=%2Fstudio">Sign in</Link><Link className={styles.button} href="/business-login">Business sign in</Link></div>;
  if (me.needs_code) return <div className="mx-auto max-w-[500px] px-6 py-16"><Link href="/home" className={styles.button}><ArrowLeft size={16} /> Back to Platinum Circles</Link><h1 className="mt-8 text-2xl font-bold">Who is working?</h1><p className="mb-5 mt-3 text-sm text-muted">Enter your personal access code for {me.business_name || "this business"}. Your role determines which actions you can take.</p><form onSubmit={event => { event.preventDefault(); void bind(); }}><label className={styles.field}>Access code<input value={code} onChange={event => setCode(event.target.value.toUpperCase())} autoComplete="one-time-code" autoFocus disabled={busy} maxLength={64} /></label>{err ? <p role="alert" className={`${styles.notice} ${styles.error}`}>{err}</p> : null}<button className={styles.buttonPrimary} disabled={!code.trim() || busy}>{busy ? "Checking…" : "Continue"}</button></form></div>;

  const isBusiness = me.is_business;
  const name = me.business_name || me.display_name || "Your workspace";
  const initials = name.split(/\s+/).slice(0,2).map(word => word[0]).join("").toUpperCase();
  const allowedPage = isBusiness || CREATOR_PATHS.some(path => pathname === path || path !== "/studio" && pathname.startsWith(path + "/"));
  const nav = (mobile = false) => <nav aria-label={mobile ? "Studio mobile navigation" : "Studio navigation"} className={styles.navigation}>{(isBusiness ? GROUPS : [{ label: "Creator workspace", keys: CREATOR_ROOMS.map(room => room.key) }]).map(group => {
    const groupRooms = rooms.filter(room => group.keys.includes(room.key));
    if (!groupRooms.length) return null;
    return <div key={group.label || "overview"} className={styles.navigationGroup}>{group.label ? <p className={styles.groupName}>{group.label}</p> : null}{groupRooms.map(room => { const Icon = ICONS[room.key]; const active = activeRoom?.key === room.key; return <Link className={styles.navLink} href={room.href} key={room.key} aria-current={active ? "page" : undefined} onClick={() => setMenuOpen(false)}><Icon size={19} strokeWidth={1.65} aria-hidden="true" />{room.label}</Link>; })}</div>;
  })}</nav>;

  return <StudioCtx.Provider key={[accountId, me.member_id, me.role].join(":")} value={{ me, accountId, refresh }}>
    <div className={styles.workspace}>
      <aside className={styles.rail}>
        <Link href="/studio" className={styles.wordmark}>Platinum Circles<small>STUDIO</small></Link>
        <Link href="/home" className={styles.exit}><ArrowLeft size={16} strokeWidth={1.7} /> Back to Platinum Circles</Link>
        <Link href={me.username ? `/${me.username}` : "/studio"} className={styles.business}><span className={styles.businessAvatar}>{initials}</span><span><strong>{name}{tier ? <VerifiedBadge tier={tier} size={14} /> : null}</strong><small>{isBusiness ? "Business workspace" : "Creator workspace"}</small></span></Link>
        {nav()}
        <div className={styles.railFooter}><Link href="/settings/support"><CircleHelp size={17} /> Help and support</Link></div>
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <button type="button" className={`${styles.iconButton} ${styles.mobileMenu}`} aria-label="Open Studio navigation" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
          <nav aria-label="Breadcrumb" className={styles.breadcrumbs}><Link href="/studio">Studio</Link><ChevronRight size={13} aria-hidden="true" /><Link href={me.username ? `/${me.username}` : "/studio"}>{name}</Link><ChevronRight size={13} aria-hidden="true" /><strong>{activeRoom?.label || "Workspace"}</strong></nav>
          <div className={styles.tools}>
            <button className={styles.searchButton} type="button" onClick={() => setSearchOpen(true)} aria-label="Search Studio tools"><Search size={17} strokeWidth={1.7} /><span>Search Studio</span><kbd>⌘ K</kbd></button>
            {isBusiness ? <button type="button" className={styles.iconButton} aria-label={showRail ? "Hide workspace panel" : "Show workspace panel"} aria-pressed={showRail} onClick={() => setShowRail(value => !value)}><PanelRight size={19} strokeWidth={1.7} /></button> : null}
            <Link href={isBusiness ? "/studio/team" : "/settings"} className={styles.accountLink}><span>{(me.display_name || name).split(/\s+/).slice(0,2).map(word => word[0]).join("")}</span><span><strong>{me.display_name || name}</strong><small>{me.role || "Creator tools"}</small></span></Link>
          </div>
        </header>
        <div className={styles.content}>
          <StudioLoadError message={loadError} retry={() => { void refresh(); }} />
          <div className={`${styles.contentGrid} ${showRail && isBusiness ? styles.contentWithRail : ""}`}>
            <div className={styles.desk}>{allowedPage ? children : <div className={styles.empty}><Briefcase size={30} /><h1>A business workspace is required</h1><p>Use your business access to open this tool, or return to your creator workspace.</p><Link href="/business-login" className={styles.buttonPrimary}>Business sign in</Link><Link href="/studio" className={styles.button}>Back to Creator Studio</Link></div>}</div>
            {isBusiness ? <aside hidden={!showRail} className={styles.contextRail} aria-label="Workspace details"><div><div id={STUDIO_RAIL_SLOT} />{showRail ? <StudioSideRail role={me.role} username={me.username} /> : null}</div></aside> : null}
          </div>
        </div>
      </div>
    </div>
    <StudioDialog title="Search Studio" description="Find a tool or workspace destination." open={searchOpen} onClose={() => setSearchOpen(false)}>
      <label className={styles.searchInput}><Search size={18} aria-hidden="true" /><input ref={searchRef} aria-label="Find a Studio tool" placeholder="Content, campaigns, team…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className={styles.searchResults}>{searchRooms.length ? searchRooms.map(room => { const Icon = ICONS[room.key]; return <Link key={room.key} href={room.href} className={styles.searchResult} onClick={() => setSearchOpen(false)}><Icon size={20} strokeWidth={1.7} /><span><strong>{room.label}</strong><small>{DESCRIPTIONS[room.key]}</small></span><ArrowRight size={16} /></Link>; }) : <p className={styles.empty}>No tools match “{query}”. Try content, ads or team.</p>}</div>
    </StudioDialog>
    <StudioDialog title="Studio navigation" open={menuOpen} onClose={() => setMenuOpen(false)}><div className={styles.rail} style={{ display: "flex", position: "static", height: "auto", padding: 18 }}><Link className={styles.exit} href="/home"><ArrowLeft size={16} /> Back to Platinum Circles</Link>{nav(true)}</div></StudioDialog>
  </StudioCtx.Provider>;
}
