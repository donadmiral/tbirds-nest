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
import { createClient } from "@/lib/supabase/client";

const items = [
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

export function Nav({ name, username, business = false }: { name: string; username: string; business?: boolean }) {
  const profileHref = username ? "/" + username : "/home";
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const allItems = [...items, ...(business ? [{ href: "/studio", label: "Studio", icon: LayoutDashboard }] : []), { href: profileHref, label: "Profile", icon: User }];

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="fixed inset-y-0 left-0 flex w-[260px] flex-col border-r border-ink/10 px-4 py-6">
      <Link href="/home" className="mb-8 flex items-center gap-3 px-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Platinum Circles" className="h-9 w-9 rounded-xl" />
        <span className="font-display text-lg tracking-wide text-porcelain">
          Platinum Circles
        </span>
      </Link>
      <nav className="flex flex-1 flex-col gap-1">
        {allItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link key={label}
              href={href}
              className={
                "flex items-center gap-4 rounded-md px-3 py-2.5 text-[15px] transition-colors " +
                (active
                  ? "bg-surface-elevated text-ink"
                  : "text-ink/70 hover:bg-surface hover:text-ink")
              }
            >
              <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center gap-3 border-t border-ink/10 px-3 pt-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-sm font-semibold text-porcelain">
          {name ? name.charAt(0).toUpperCase() : "?"}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-ink">{name}</span>
          <span className="truncate text-xs text-ink/50">@{username}</span>
        </span>
        <button onClick={signOut}
          title="Sign out"
          className="rounded-md p-2 text-ink/50 transition-colors hover:bg-surface hover:text-ink"
        >
          <LogOut size={18} />
        </button>
      </div>
    </aside>
  );
}