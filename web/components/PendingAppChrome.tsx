'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { BarChart3, BriefcaseBusiness, Home, LayoutDashboard, MessageCircle, Store, User } from 'lucide-react';
import { getNavigationStore } from '@/lib/navigationCache';
import { readNavigationChrome } from '@/lib/navigationChromeMemory';
import { PRIMARY_DESTINATIONS, isDestinationActive } from '@/lib/navigation';
import { NAV_ICONS } from './NavigationActions';
import { LiveIcon } from './LiveIcon';
import { Wordmark } from './Wordmark';
import chrome from './NavigationChrome.module.css';

/** This fallback is only mounted after AppShell verifies its server-side owner. */
function useVerifiedChrome(ownerId: string) {
  const [store] = useState(getNavigationStore);
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  // The owner, session and revision checks still apply. The verified standard
  // shell can reuse its own navigation while displaying any protected page.
  const remembered = readNavigationChrome(store, session, '/home');
  return remembered?.ownerId === ownerId ? remembered : null;
}

/** Links remain usable without starting counters, search reads or media layers. */
export function PendingAppNavigation({ ownerId }: { ownerId: string }) {
  const identity = useVerifiedChrome(ownerId);
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const own = identity ? '/' + encodeURIComponent(identity.username || identity.ownerId) : '/settings/username';
  useLayoutEffect(() => {
    const restore = () => {
      let value = false;
      try { value = localStorage.getItem('pc:nav-collapsed') === '1'; } catch { /* Neutral geometry remains usable. */ }
      setCollapsed(value);
      document.documentElement.classList.toggle('nav-collapsed', value);
    };
    restore();
    const storage = (event: StorageEvent) => { if (event.key === 'pc:nav-collapsed' || event.key === null) restore(); };
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener('storage', storage); document.documentElement.classList.remove('nav-collapsed'); };
  }, []);
  const tabs = [
    { href: '/home', label: 'Home', icon: Home }, { href: '/market', label: 'Market', icon: Store },
    { href: identity?.business ? '/studio' : '/jobs', label: identity?.business ? 'Studio' : 'Jobs', icon: identity?.business ? LayoutDashboard : BriefcaseBusiness },
    { href: '/messages', label: 'Messages', icon: MessageCircle }, { href: own, label: 'Profile', icon: User },
  ];
  return <>
    <aside data-app-chrome data-navigation-profile="pending" className={chrome.sidebar + (collapsed ? ' ' + chrome.collapsed : '')}>
      <div className={chrome.brandRow}><Link href="/home" prefetch={false} aria-label="Platinum Circles home" className={chrome.brand}>{collapsed ? <Image unoptimized src="/logo.png" width={36} height={36} alt="" /> : <Wordmark size={21} />}</Link></div>
      <nav aria-label="Primary" className={chrome.navigation}>
        {PRIMARY_DESTINATIONS.map(item => { const Icon = NAV_ICONS[item.icon]; return <Link key={item.href} href={item.href} prefetch={false} className={chrome.navItem} aria-label={item.label} aria-current={isDestinationActive(path, item.href) ? 'page' : undefined}><Icon size={22} aria-hidden />{collapsed ? null : <span>{item.label}</span>}</Link>; })}
        <Link href="/live" prefetch={false} className={chrome.navItem} aria-label="Live streams" aria-current={isDestinationActive(path, '/live') ? 'page' : undefined}><LiveIcon size={22} />{collapsed ? null : <span>Live streams</span>}</Link>
        <Link href={own} prefetch={false} className={chrome.navItem} aria-label="Profile" aria-current={isDestinationActive(path, own) ? 'page' : undefined}><User size={22} aria-hidden />{collapsed ? null : <span>Profile</span>}</Link>
        <Link href="/studio" prefetch={false} className={chrome.navItem} aria-label={identity?.business ? 'Business Studio' : 'Studio'}><BarChart3 size={22} aria-hidden />{collapsed ? null : <span>Studio</span>}</Link>
      </nav>
      {identity ? <Link href={own} prefetch={false} className={chrome.sidebarAccount} aria-label="Your profile">
        {identity.avatarUrl ? <Image unoptimized src={identity.avatarUrl} width={36} height={36} alt="" /> : <span className={chrome.avatar}>{identity.name.trim().slice(0, 1).toUpperCase() || '?'}</span>}
        {collapsed ? null : <span className={chrome.accountCopy}><strong>{identity.name}</strong><small>{identity.username ? '@' + identity.username : 'Your profile'}</small></span>}
      </Link> : null}
    </aside>
    <nav data-app-chrome aria-label="Primary" className={chrome.surface + ' fixed inset-x-3 bottom-[max(8px,env(safe-area-inset-bottom))] z-40 flex gap-1 rounded-[32px] border p-1 md:hidden'}>
      {tabs.map(({ href, label, icon: Icon }) => <Link key={href} href={href} prefetch={false} className={chrome.navItem + ' ' + chrome.tab + ' flex flex-1 flex-col items-center justify-center'} aria-label={label} aria-current={isDestinationActive(path, href) ? 'page' : undefined}><Icon size={22} aria-hidden /><span className="text-[10px] font-semibold leading-none">{label}</span></Link>)}
    </nav>
  </>;
}

export function PendingAppTopBar({ ownerId }: { ownerId: string }) {
  const identity = useVerifiedChrome(ownerId);
  return <header data-app-chrome data-navigation-profile="pending" className={chrome.topbar}>
    <div className={chrome.mobileBrand}><Link href="/home" prefetch={false} aria-label="Platinum Circles home"><Wordmark size={19} /></Link></div>
    <span className="text-sm text-muted" role="status">Opening navigation…</span>
    {identity ? <span className="ml-auto text-sm text-muted">{identity.name}</span> : null}
  </header>;
}
