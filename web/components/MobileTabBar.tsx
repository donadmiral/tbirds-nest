"use client";
// The phone app's five tabs, for the browser on a phone. Hidden from md up where the sidebar lives.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Compass, PlusSquare, Bell } from "lucide-react";

export function MobileTabBar({ username, avatarUrl }: { username: string; avatarUrl?: string | null }) {
  const path = usePathname() || "";
  const is = (h: string) => path === h || path.startsWith(h + "/");
  const item = "flex flex-1 flex-col items-center justify-center py-2 text-ink/55";
  const on = " text-ink";
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-ink/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Primary">
      <Link href="/home" className={item + (is("/home") ? on : "")} aria-label="Home"><Home size={24} strokeWidth={is("/home") ? 2.4 : 1.8} /></Link>
      <Link href="/discover" className={item + (is("/discover") || is("/search") ? on : "")} aria-label="Discover"><Compass size={24} strokeWidth={is("/discover") ? 2.4 : 1.8} /></Link>
      <Link href="/write" className={item} aria-label="Post"><PlusSquare size={26} strokeWidth={1.8} /></Link>
      <Link href="/notifications" className={item + (is("/notifications") ? on : "")} aria-label="Notifications"><Bell size={24} strokeWidth={is("/notifications") ? 2.4 : 1.8} /></Link>
      <Link href={username ? "/" + username : "/settings"} className={item} aria-label="Profile">
        {avatarUrl ? <img src={avatarUrl} alt="" className={"h-7 w-7 rounded-full object-cover " + (username && is("/" + username) ? "ring-2 ring-ink" : "")} /> : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-[12px] font-bold text-white">{(username || "?").charAt(0).toUpperCase()}</span>}
      </Link>
    </nav>
  );
}