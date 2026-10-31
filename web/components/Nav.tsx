"use client";
import NextImage from "next/image";

import { useEffect, useState } from "react";
import { NavigationLink as Link } from './NavigationLink';
import { usePathname } from "next/navigation";
import { BarChart3, PanelLeftClose, PanelLeftOpen, User } from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { PersonName } from "@/components/PersonName";
import { useUnreadNotifications } from "@/lib/useUnreadNotifications";
import { PRIMARY_DESTINATIONS, isDestinationActive } from "@/lib/navigation";
import { CreateMenu, MoreMenu, NAV_ICONS } from "./NavigationActions";
import chrome from "./NavigationChrome.module.css";

const COLLAPSE_KEY = "pc:nav-collapsed";
function savedCollapse(): boolean {
  try { return window.localStorage.getItem(COLLAPSE_KEY) === "1"; }
  catch { return false; }
}

export function Nav({ name, username, business = false, avatarUrl = null, verified = false, tier = null }: {
  name: string; username: string; business?: boolean; avatarUrl?: string | null; verified?: boolean; tier?: string | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState<string | null>(null);
  const pathname = usePathname();
  const unread = useUnreadNotifications() ?? 0;
  const profileHref = username ? "/" + encodeURIComponent(username) : "/settings/username";
  useEffect(() => {
    const restore = () => { const value = savedCollapse(); setCollapsed(value); document.documentElement.classList.toggle("nav-collapsed", value); };
    restore();
    const storage = (event: StorageEvent) => { if (event.key === COLLAPSE_KEY || event.key === null) restore(); };
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener("storage", storage); document.documentElement.classList.remove("nav-collapsed"); };
  }, []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.classList.toggle("nav-collapsed", next);
    try { window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* Navigation remains available with storage blocked. */ }
  };
  const repeat = (event: React.MouseEvent, href: string) => {
    if (pathname !== href || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  return <aside data-app-chrome className={chrome.sidebar + (collapsed ? " " + chrome.collapsed : "")}>
    <div className={chrome.brandRow}>
      <Link href="/home" aria-label="Platinum Circles home" className={chrome.brand}>
        {collapsed ? <NextImage unoptimized  src="/logo.png" alt="" width={36} height={36} /> : <Wordmark size={21} />}
      </Link>
      <button type="button" onClick={toggle} className={chrome.collapseButton} aria-expanded={!collapsed} aria-controls="desktop-navigation" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? <PanelLeftOpen size={17} strokeWidth={1.8} aria-hidden /> : <PanelLeftClose size={17} strokeWidth={1.8} aria-hidden />}
      </button>
    </div>
    <nav id="desktop-navigation" aria-label="Primary" className={chrome.navigation}>
      {PRIMARY_DESTINATIONS.map(item => {
        const active = isDestinationActive(pathname, item.href), Icon = NAV_ICONS[item.icon];
        const count = item.href === "/notifications" ? unread : 0;
        return <Link key={item.href} href={item.href} onClick={event => repeat(event, item.href)} className={chrome.navItem}
          aria-current={active ? "page" : undefined} aria-label={count ? `${item.label}, ${count} unread` : item.label} title={collapsed ? item.label : undefined}>
          <span className={chrome.navIcon}><Icon size={22} strokeWidth={active ? 2.1 : 1.75} aria-hidden />{count > 0 && collapsed ? <i className={chrome.unreadDot} /> : null}</span>
          {collapsed ? null : <><span>{item.label}</span>{count > 0 ? <b className={chrome.badge}>{count > 99 ? "99+" : count}</b> : null}</>}
        </Link>;
      })}
      <Link href={profileHref} onClick={event => repeat(event, profileHref)} className={chrome.navItem} aria-current={isDestinationActive(pathname, profileHref) ? "page" : undefined} title={collapsed ? "Profile" : undefined} aria-label="Profile">
        <User size={22} strokeWidth={1.75} aria-hidden />{collapsed ? null : <span>Profile</span>}
      </Link>
      <MoreMenu compact={collapsed} />
      <div className={chrome.createSlot}><CreateMenu compact={collapsed} sidebar /></div>
      <Link href="/studio" className={chrome.navItem} title={collapsed ? "Studio" : undefined} aria-label={business ? "Business Studio" : "Studio"}>
        <BarChart3 size={22} strokeWidth={1.75} aria-hidden />{collapsed ? null : <span>Studio</span>}
      </Link>
    </nav>
    <Link href={profileHref} className={chrome.sidebarAccount} aria-label="Your profile" title={collapsed ? name : undefined}>
      {avatarUrl && avatarFailed !== avatarUrl ? <NextImage unoptimized width={36} height={36} src={avatarUrl} alt="" onError={() => setAvatarFailed(avatarUrl)} /> : <span className={chrome.avatar}>{name.trim().split(/\s+/).slice(0,2).map(value => value[0]).join("").toUpperCase() || "?"}</span>}
      {collapsed ? null : <span className={chrome.accountCopy}><PersonName name={name} verified={verified} tier={tier} className="text-sm font-semibold text-ink" badgeSize={13} /><small>{username ? "@" + username : "Set your username"}</small></span>}
    </Link>
  </aside>;
}
