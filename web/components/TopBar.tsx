"use client";

/**
 * The top action bar.
 *
 * Four controls sit above every page: compose, assistant, notifications and
 * the account menu. They live here rather than in each route because they are
 * chrome, not content, and because the unread count has to be one query no
 * matter which page is open.
 *
 * The count is read once on mount and then kept live over realtime, so opening
 * Notifications in another tab clears the dot here without a refresh.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, LogOut, Plus, Sparkles, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useUnreadNotifications } from "@/lib/useUnreadNotifications";
import { Wordmark } from "@/components/Wordmark";
import chrome from "./NavigationChrome.module.css";

export function TopBar({ name, username, avatarUrl }: { name: string; username: string; avatarUrl?: string | null }) {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const unread = useUnreadNotifications() ?? 0;
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // A menu that traps nothing and closes on any outside click, which is what
  // people expect from an avatar menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    const onFocus = (e: FocusEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open]);

  const btn = chrome.control;

  return (
    <div className="sticky top-0 z-30 flex items-center justify-between gap-2 bg-white px-3 py-2 md:pointer-events-none md:justify-end md:bg-transparent md:px-6 md:py-0 md:pt-3">
      <div className="md:hidden"><Link href="/home" aria-label="Platinum Circles home" className={chrome.control}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-9 w-9 rounded-xl min-[480px]:hidden" />
        <Wordmark size={18} className="hidden min-[480px]:inline" />
      </Link></div>
      <div className={chrome.surface + " pointer-events-auto flex shrink-0 items-center gap-1 rounded-full border p-1"}>
        <Link href="/write" className={btn} aria-label="Create a post">
          <Plus size={19} />
        </Link>
        <Link href="/discover" className={btn} aria-label="Discover">
          <Sparkles size={18} />
        </Link>
        <Link href="/notifications" className={btn + " relative"} aria-label={unread > 0 ? unread + " unread notifications" : "Notifications"}>
          <Bell size={18} />
          {unread > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-pearl px-1 text-[10.5px] font-bold tabular-nums text-on-pearl">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Link>

        <div ref={menuRef} className="relative">
          <button ref={triggerRef} onClick={() => setOpen((v) => !v)} aria-label="Account menu" aria-expanded={open} aria-controls={open ? "account-navigation" : undefined} className={btn}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-10 w-10 rounded-full border border-ink/10 object-cover" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-porcelain text-[14px] font-semibold text-white">
                {name ? name.charAt(0).toUpperCase() : "?"}
              </span>
            )}
          </button>
          {open ? (
            <div id="account-navigation" className="absolute right-0 top-[calc(100%+12px)] w-56 max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-ink/15 bg-white py-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.10)]">
              <div className="px-4 py-2">
                <p className="truncate text-[14px] font-semibold text-ink">{name}</p>
                <p className={chrome.secondary + " truncate text-[12px]"}>{username ? "@" + username : "Set username"}</p>
              </div>
              <div className="my-1 h-px bg-ink/8" />
              <Link href={username ? "/" + encodeURIComponent(username) : "/settings/username"} onClick={() => setOpen(false)} className={chrome.menuItem + " flex items-center gap-3 px-4 py-2.5 text-[13.5px] text-ink transition-colors duration-[140ms] hover:bg-surface"}>
                <User size={16} className="text-ink/50" /> Your profile
              </Link>
              <button
                onClick={async () => { await supabase.auth.signOut(); router.push("/login"); router.refresh(); }}
                className={chrome.menuItem + " flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13.5px] text-ink transition-colors duration-[140ms] hover:bg-surface"}
              >
                <LogOut size={16} className="text-ink/50" /> Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
