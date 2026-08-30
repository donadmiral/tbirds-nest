"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
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
  { href: "/market", label: "Market", icon: Store, tag: "New" },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/channels", label: "Channels", icon: Radio },
  { href: "/communities", label: "Communities", icon: Users },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/ads", label: "Ads", icon: Megaphone },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav({ name, username, business = false }: { name: string; username: string; business?: boolean }) {
  const profileHref = username ? "/" + username : "/home";
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const allItems: NavItem[] = [...items, ...(business ? [{ href: "/studio", label: "Studio", icon: LayoutDashboard }] : []), { href: profileHref, label: "Profile", icon: User }];

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="fixed inset-y-0 left-0 flex w-[260px] flex-col overflow-y-auto border-r border-ink/10 px-4 py-6">
      {/* The wordmark sets on two lines so the display face has room to read as
          a lockup rather than a cramped single line. */}
      <Link href="/home" className="mb-7 flex items-center gap-3 px-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-10 w-10 rounded-xl" />
        <span className="font-display text-[15px] uppercase leading-[1.15] tracking-[0.14em] text-porcelain">
          Platinum
          <br />
          Circles
        </span>
      </Link>
      <nav className="flex flex-1 flex-col gap-0.5">
        {allItems.map(({ href, label, icon: Icon, badge, dot, tag }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link key={label}
              href={href}
              onClick={(e) => {
                // Tapping the item you are already on scrolls to the top rather
                // than re-navigating, which is what every app of this shape
                // does and what people reach for after a long scroll.
                if (!active) return;
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className={
                "flex items-center gap-3.5 rounded-full px-4 py-2.5 text-[15px] transition-colors duration-[140ms] " +
                (active
                  ? "bg-pearl/18 font-semibold text-ink"
                  : "text-ink/70 hover:bg-surface hover:text-ink")
              }
            >
              <span className="relative flex shrink-0 items-center">
                <Icon size={20} strokeWidth={active ? 2.2 : 1.8} className={active ? "text-pearl-muted" : undefined} />
                {dot ? <span className="absolute -right-0.5 -top-0.5 h-[7px] w-[7px] rounded-full bg-danger ring-2 ring-white" aria-hidden /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {tag ? (
                <span className="shrink-0 rounded-full bg-pearl/20 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-pearl-muted">{tag}</span>
              ) : null}
              {badge ? (
                <span className="shrink-0 rounded-full bg-surface-elevated px-1.5 py-[1px] text-[11px] font-semibold tabular-nums text-ink/70">{badge}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 flex items-center gap-3 border-t border-ink/10 px-3 pt-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-sm font-semibold text-white">
          {name ? name.charAt(0).toUpperCase() : "?"}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-ink">{name}</span>
          <span className="truncate text-xs text-ink/50">@{username}</span>
        </span>
        <button onClick={signOut}
          title="Sign out"
          className="rounded-full p-2 text-ink/50 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"
        >
          <LogOut size={18} />
        </button>
      </div>
      <p className="px-3 pt-3 text-[11px] text-ink/30">© {new Date().getFullYear()} Platinum Circles</p>
    </aside>
  );
}