"use client";

import { PersonName } from "@/components/PersonName";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/Wordmark";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Home,
  Compass,
  Briefcase,
  Store,
  MessageCircle,
  Bell,
  Search,
  Megaphone,
  Radio,
  Users,
  LayoutDashboard,
  Settings,
  Bookmark,
  User,
  LogOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useUnreadNotifications } from "@/lib/useUnreadNotifications";
import chrome from "./NavigationChrome.module.css";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** an unread count, shown as a quiet pill */
  badge?: number;
  /** a red dot for "something happened", where a number would be noise */
  dot?: boolean;
  /** a short word like New, for a surface that just launched */
  tag?: string;
};

const items: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/search", label: "Search", icon: Search },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/market", label: "Market", icon: Store },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/channels", label: "Channels", icon: Radio },
  { href: "/communities", label: "Communities", icon: Users },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/ads", label: "Ads", icon: Megaphone },
  { href: "/settings", label: "Settings", icon: Settings },
];

const COLLAPSE_KEY = "pc:nav-collapsed";

export function Nav({ name, username, business = false, avatarUrl = null, verified = false, tier = null }: { name: string; username: string; business?: boolean; avatarUrl?: string | null; verified?: boolean; tier?: string | null }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const saved = window.localStorage.getItem(COLLAPSE_KEY) === "1";
    setCollapsed(saved);
    document.documentElement.classList.toggle("nav-collapsed", saved);
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      document.documentElement.classList.toggle("nav-collapsed", next);
      return next;
    });
  };
  const profileHref = username ? "/" + encodeURIComponent(username) : "/settings/username";
  const pathname = usePathname();
  const router = useRouter();
  // Inside Studio the grouped rail takes the left column, so the consumer nav
  // folds to icons; leaving Studio restores whatever the person had saved.
  const inStudio = pathname.startsWith("/studio");
  useEffect(() => {
    const saved = window.localStorage.getItem(COLLAPSE_KEY) === "1";
    const next = inStudio ? true : saved;
    setCollapsed(next);
    document.documentElement.classList.toggle("nav-collapsed", next);
  }, [inStudio]);
  const supabase = createClient();
  // One unread count from the server, live: the bell carries a dot and the number, and clears as rows are read anywhere.
  const unreadNotifs = useUnreadNotifications() ?? 0;
  const allItems: NavItem[] = [...items.map((it) => it.href === "/notifications" ? { ...it, dot: unreadNotifs > 0, badge: unreadNotifs > 0 ? unreadNotifs : undefined } : it), ...(business ? [{ href: "/studio", label: "Studio", icon: LayoutDashboard }] : []), { href: profileHref, label: "Profile", icon: User }];

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className={chrome.surface + " fixed inset-y-0 left-0 z-30 hidden min-h-0 flex-col overflow-visible border-r py-5 transition-[width] duration-200 md:flex " + (collapsed ? "w-[76px] px-2" : "w-[260px] px-4")}>
      <div className={"mb-5 flex shrink-0 items-center " + (collapsed ? "justify-center" : "justify-between px-3")}>
        <Link href="/home" className="flex items-center gap-2.5" aria-label="Platinum Circles home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-9 w-9 rounded-xl" />
          {!collapsed ? <Wordmark size={19} /> : null}
        </Link>
      </div>
      {/* A tab on the sidebar's edge, so it is visible whatever the wordmark
          width does and stays in the same place collapsed or expanded. */}
      <button
        onClick={toggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        aria-controls="desktop-navigation"
        title={collapsed ? "Expand" : "Collapse"}
        className={chrome.control + " absolute -right-6 top-5 z-10 border border-ink/15 bg-white shadow-sm"}
      >
        {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
      </button>
      <nav id="desktop-navigation" aria-label="Primary" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-1 [scrollbar-width:thin]">
        {allItems.map(({ href, label, icon: Icon, badge, dot, tag }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link key={label}
              href={href}
              aria-label={badge ? `${label}, ${badge} unread` : label}
              aria-current={pathname === href ? "page" : undefined}
              title={collapsed ? label : undefined}
              onClick={(e) => {
                // Tapping the item you are already on scrolls to the top rather
                // than re-navigating, which is what every app of this shape
                // does and what people reach for after a long scroll.
                if (pathname !== href || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
              }}
              className={
                chrome.navItem + " flex items-center gap-3.5 rounded-full px-3 py-2.5 text-[15px] transition-colors duration-[140ms] " +
                (active
                  ? "bg-pearl/18 font-semibold text-ink"
                  : "hover:bg-surface hover:text-ink")
              }
            >
              <span className="relative flex shrink-0 items-center">
                <Icon size={20} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                {dot ? <span className="absolute -right-0.5 -top-0.5 h-[7px] w-[7px] rounded-full bg-danger ring-2 ring-white" aria-hidden /> : null}
              </span>
              {!collapsed ? <span className="min-w-0 flex-1 truncate">{label}</span> : null}
              {tag && !collapsed ? (
                <span className="shrink-0 rounded-full bg-pearl/20 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-pearl-muted">{tag}</span>
              ) : null}
              {badge && !collapsed ? (
                <span className="shrink-0 rounded-full bg-surface-elevated px-1.5 py-[1px] text-[11px] font-semibold tabular-nums text-ink/70">{badge}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className={"mt-3 flex shrink-0 items-center gap-2 border-t border-ink/10 pt-3 " + (collapsed ? "justify-center px-0" : "px-1")}>
        <Link href={profileHref} title={name} aria-label="Your profile" className={chrome.control + " shrink-0"}>
          {avatarUrl ? <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-sm font-semibold text-white">{name ? name.charAt(0).toUpperCase() : "?"}</span>}
        </Link>
        {!collapsed ? (
          <span className="flex min-w-0 flex-1 flex-col">
            <PersonName name={name} verified={verified} tier={tier} className="text-sm font-semibold text-ink" badgeSize={13} />
            <span className={chrome.secondary + " truncate text-xs"}>{username ? "@" + username : "Set username"}</span>
          </span>
        ) : null}
        {!collapsed ? (
          <button onClick={signOut} title="Sign out" aria-label="Sign out" className={chrome.control + " shrink-0"}>
            <LogOut size={18} aria-hidden />
          </button>
        ) : null}
      </div>
      {!collapsed ? <p className={chrome.secondary + " shrink-0 px-3 pt-3 text-[11px]"}>© {new Date().getFullYear()} Platinum Circles</p> : null}
    </aside>
  );
}
