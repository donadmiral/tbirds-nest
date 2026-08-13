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
  Bookmark,
  User,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const items = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/search", label: "Search", icon: Search },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/market", label: "Market", icon: Store },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/saved", label: "Saved", icon: Bookmark },
];

export function Nav({ name, username }: { name: string; username: string }) {
  const profileHref = username ? "/" + username : "/home";
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const allItems = [...items, { href: profileHref, label: "Profile", icon: User }];

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="fixed inset-y-0 left-0 flex w-[260px] flex-col border-r border-white/10 px-4 py-6">
      <Link href="/home" className="mb-8 flex items-center gap-3 px-3">
        <span className="h-8 w-8 rounded-full border-2 border-pearl" aria-hidden />
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
                  ? "bg-surface-elevated text-white"
                  : "text-white/70 hover:bg-surface hover:text-white")
              }
            >
              <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center gap-3 border-t border-white/10 px-3 pt-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-sm font-semibold text-porcelain">
          {name ? name.charAt(0).toUpperCase() : "?"}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-white">{name}</span>
          <span className="truncate text-xs text-white/50">@{username}</span>
        </span>
        <button onClick={signOut}
          title="Sign out"
          className="rounded-md p-2 text-white/50 transition-colors hover:bg-surface hover:text-white"
        >
          <LogOut size={18} />
        </button>
      </div>
    </aside>
  );
}