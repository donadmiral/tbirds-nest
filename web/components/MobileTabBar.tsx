"use client";
// The phone app's five tabs, for the browser on a phone. Hidden from md up where the sidebar lives.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Compass, MessageCircle, Store, Briefcase } from "lucide-react";

export function MobileTabBar({ username, avatarUrl }: { username: string; avatarUrl?: string | null }) {
  const path = usePathname() || "";
  const is = (h: string) => path === h || path.startsWith(h + "/");
  const item = "flex flex-1 flex-col items-center justify-center py-2 text-ink/55";
  const on = " text-ink";
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-ink/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Primary">
      <Link href="/home" className={item + (is("/home") ? on : "")} aria-label="Home"><Home size={24} strokeWidth={is("/home") ? 2.4 : 1.8} /></Link>
      <Link href="/discover" className={item + (is("/discover") || is("/search") ? on : "")} aria-label="Discover"><Compass size={24} strokeWidth={is("/discover") ? 2.4 : 1.8} /></Link>
      <Link href="/messages" className={item + (is("/messages") ? on : "")} aria-label="Messages"><MessageCircle size={24} strokeWidth={is("/messages") ? 2.4 : 1.8} /></Link>
      <Link href="/market" className={item + (is("/market") ? on : "")} aria-label="Market"><Store size={24} strokeWidth={is("/market") ? 2.4 : 1.8} /></Link>
      <Link href="/jobs" className={item + (is("/jobs") ? on : "")} aria-label="Jobs"><Briefcase size={24} strokeWidth={is("/jobs") ? 2.4 : 1.8} /></Link>
    </nav>
  );
}