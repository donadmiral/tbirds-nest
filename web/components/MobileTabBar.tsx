"use client";
// The phone app's five tabs, for the browser on a phone. Hidden from md up where the sidebar lives.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Compass, MessageCircle, Store, Briefcase } from "lucide-react";
import chrome from "./NavigationChrome.module.css";

const tabs = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/market", label: "Market", icon: Store },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
];

export function MobileTabBar() {
  const path = usePathname() || "";
  const is = (h: string) => path === h || path.startsWith(h + "/");
  return (
    <nav className={chrome.surface + " fixed inset-x-3 bottom-[max(8px,env(safe-area-inset-bottom))] z-40 flex gap-1 rounded-[32px] border p-1 md:hidden"} aria-label="Primary">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = is(href) || (href === "/discover" && is("/search"));
        return (
          <Link key={href} href={href} className={chrome.navItem + " " + chrome.tab + " flex flex-1 flex-col items-center justify-center"} aria-current={active ? "page" : undefined}>
            <Icon size={22} strokeWidth={active ? 2.4 : 1.8} aria-hidden />
            <span className="text-[10px] font-semibold leading-none">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
