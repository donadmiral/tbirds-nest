"use client";
// The phone app's five tabs, for the browser on a phone. Hidden from md up where the sidebar lives.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Home, MessageCircle, Store, Briefcase, LayoutDashboard } from "lucide-react";
import { profilePath } from "@/lib/profileLookup";
import chrome from "./NavigationChrome.module.css";

export function MobileTabBar({ userId, username, name, avatarUrl, business = false }: {
  userId: string; username?: string | null; name?: string | null; avatarUrl?: string | null; business?: boolean;
}) {
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const avatarKey = `${userId}:${avatarUrl ?? ''}`;
  const profileHref = profilePath(username, userId);
  const tabs = [
    { href: '/home', label: 'Home', icon: Home },
    { href: '/market', label: 'Market', icon: Store },
    { href: business ? '/studio' : '/jobs', label: business ? 'Studio' : 'Jobs', icon: business ? LayoutDashboard : Briefcase },
    { href: '/messages', label: 'Messages', icon: MessageCircle },
  ];
  const path = usePathname() || "";
  const is = (h: string) => path === h || path.startsWith(h + "/");
  return (
    <nav className={chrome.surface + " fixed inset-x-3 bottom-[max(8px,env(safe-area-inset-bottom))] z-40 flex gap-1 rounded-[32px] border p-1 md:hidden"} aria-label="Primary">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = is(href);
        return (
          <Link key={href} href={href} className={chrome.navItem + " " + chrome.tab + " flex flex-1 flex-col items-center justify-center"} aria-current={active ? "page" : undefined}>
            <Icon size={22} strokeWidth={active ? 2.4 : 1.8} aria-hidden />
            <span className="text-[10px] font-semibold leading-none">{label}</span>
          </Link>
        );
      })}
      <Link href={profileHref} aria-label="Your profile" aria-current={is(profileHref) ? 'page' : undefined}
        className={chrome.navItem + ' ' + chrome.tab + ' flex flex-1 flex-col items-center justify-center'}>
        <span className={'flex h-8 w-8 items-center justify-center rounded-full border-2 p-0.5 ' + (is(profileHref) ? 'border-ink' : 'border-transparent')}>
          {avatarUrl && failedAvatar !== avatarKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={avatarKey} src={avatarUrl} alt="" onError={() => setFailedAvatar(avatarKey)} className="h-full w-full rounded-full object-cover" />
          ) : <span className="flex h-full w-full items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">{(name?.trim() || username || '?').slice(0, 1).toUpperCase()}</span>}
        </span>
        <span className="text-[10px] font-semibold leading-none">Profile</span>
      </Link>
    </nav>
  );
}
