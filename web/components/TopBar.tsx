"use client";
import { RecentSearchList } from "./RecentSearchList";
import { useRecentSearches } from "@/lib/useRecentSearches";
import NextImage from "next/image";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Bell, Bookmark, LogOut, Search, Settings, User, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useUnreadNotifications } from "@/lib/useUnreadNotifications";
import { parentDestination } from "@/lib/navigation";
import { withTimeout } from "@/lib/withTimeout";
import { Wordmark } from "@/components/Wordmark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NavigationPopover } from "./NavigationPopover";
import { CreateMenu, MoreMenu } from "./NavigationActions";
import chrome from "./NavigationChrome.module.css";

export function TopBar({ name, username, avatarUrl }: { name: string; username: string; avatarUrl?: string | null }) {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const pathname = usePathname();
  const unread = useUnreadNotifications() ?? 0;
  const [query, setQuery] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = useRecentSearches();
  const searchForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!searchForm.current?.contains(event.target as Node)) setHistoryOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  useEffect(() => { setHistoryOpen(false); setQuery(''); }, [pathname, history.owner]);
  const openSearch = (term: string) => {
    if (term.trim()) void history.record(term);
    setHistoryOpen(false);
    router.push(term.trim() ? '/search?q=' + encodeURIComponent(term.trim()) : '/search');
  };
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const signOutLock = useRef(false);
  const profileHref = username ? "/" + encodeURIComponent(username) : "/settings/username";
  const parent = parentDestination(pathname);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !event.altKey) {
        event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  async function signOut() {
    if (signOutLock.current) return;
    signOutLock.current = true;
    setSigningOut(true); setSignOutError(null);
    try {
      const { error } = await withTimeout(supabase.auth.signOut(), 15000);
      if (error) throw error;
      router.replace("/login"); router.refresh();
    } catch { setSignOutError("We could not sign you out. Please try again."); }
    finally { signOutLock.current = false; setSigningOut(false); }
  }
  return <header data-app-chrome className={chrome.topbar}>
    <div className={chrome.mobileBrand}><Link href="/home" aria-label="Platinum Circles home"><Wordmark size={19} /></Link></div>
    {parent ? <Link href={parent.href} className={chrome.backLink} title={parent.label}><ArrowLeft size={18} strokeWidth={1.8} aria-hidden /><span>{parent.label}</span></Link> : null}
    <form ref={searchForm} role="search" aria-label="Search Platinum Circles" className={chrome.search}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHistoryOpen(false); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); searchRef.current?.focus(); setHistoryOpen(false); }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && historyOpen) {
          const choices = Array.from(searchForm.current?.querySelectorAll<HTMLButtonElement>('[data-recent-search]') ?? []);
          if (choices.length) { event.preventDefault(); const current = choices.indexOf(document.activeElement as HTMLButtonElement); const next = event.key === 'ArrowDown' ? (current + 1) % choices.length : (current <= 0 ? choices.length - 1 : current - 1); choices[next].focus(); }
        }
      }} action="/search" onSubmit={event => {
      event.preventDefault(); openSearch(query);
    }}>
      <Search size={19} strokeWidth={1.75} aria-hidden />
      <label className="sr-only" htmlFor="global-search">Search Platinum Circles</label>
      <input id="global-search" ref={searchRef} aria-expanded={historyOpen} aria-controls="global-recent-searches" onFocus={() => setHistoryOpen(true)} onClick={() => setHistoryOpen(true)} name="q" type="search" autoComplete="off" maxLength={200} placeholder="Search Platinum Circles" value={query} onChange={event => { setQuery(event.target.value); setHistoryOpen(true); }} />
      {query ? <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); setHistoryOpen(true); searchRef.current?.focus(); }}><X size={17} aria-hidden /></button> : <kbd aria-hidden>⌘ K</kbd>}
      {historyOpen ? <div className={chrome.searchHistory}><RecentSearchList id="global-recent-searches" query={query} onSelect={openSearch} /></div> : null}
    </form>
    <div className={chrome.topActions}>
      <span className={chrome.mobileMore}><MoreMenu mobile profileHref={profileHref} /></span>
      <CreateMenu compact />
      <Link href="/notifications" className={`${chrome.control} ${chrome.headerNotifications}`} aria-label={unread ? `${unread} unread notifications` : "Notifications"} title="Notifications">
        <Bell size={21} strokeWidth={1.75} aria-hidden />{unread ? <span className={chrome.notificationBadge}>{unread > 99 ? "99+" : unread}</span> : null}
      </Link>
      <NavigationPopover label="Account menu" className={chrome.control} trigger={avatarUrl && failedAvatar !== avatarUrl ? <NextImage unoptimized width={36} height={36} src={avatarUrl} alt="" className={chrome.avatar} onError={() => setFailedAvatar(avatarUrl)} /> : <span className={chrome.avatar}>{name.trim().split(/\s+/).slice(0,2).map(value => value[0]).join("").toUpperCase() || "?"}</span>}>
        {close => <>
          <div className={chrome.menuHeading}><strong>{name}</strong><span>{username ? "@" + username : "Your Platinum Circles account"}</span></div>
          <Link href={profileHref} className={chrome.menuLink} onClick={close}><User size={20} aria-hidden /><span><strong>Your profile</strong></span></Link>
          <Link href="/saved" className={chrome.menuLink} onClick={close}><Bookmark size={20} aria-hidden /><span><strong>Saved collections</strong></span></Link>
          <Link href="/settings" className={chrome.menuLink} onClick={close}><Settings size={20} aria-hidden /><span><strong>Settings and privacy</strong></span></Link>
          <div className={chrome.menuDivider} />
          <div className={chrome.appearance}><span>Appearance</span><ThemeToggle /></div>
          <div className={chrome.menuDivider} />
          <button type="button" className={chrome.menuLink} onClick={() => void signOut()} disabled={signingOut}><LogOut size={20} aria-hidden /><span><strong>{signingOut ? "Signing out…" : "Sign out"}</strong></span></button>
          {signOutError ? <p role="alert" className={chrome.menuError}>{signOutError}</p> : null}
        </>}
      </NavigationPopover>
    </div>
  </header>;
}
