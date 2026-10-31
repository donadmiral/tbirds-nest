'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { BriefcaseBusiness, Home, LayoutDashboard, MessageCircle, Store, User } from 'lucide-react';
import { getNavigationStore } from '@/lib/navigationCache';
import { forgetNavigationChrome, readNavigationChrome, rememberNavigationChrome, type NavigationChromeIdentity } from '@/lib/navigationChromeMemory';
import { PRIMARY_DESTINATIONS, isDestinationActive } from '@/lib/navigation';
import { NAV_ICONS } from './NavigationActions';
import { Wordmark } from './Wordmark';
import chrome from './NavigationChrome.module.css';

/** No await: a late server payload cannot publish into a replacement browser session. */
export function RememberNavigationChrome({ identity }: { identity: NavigationChromeIdentity | null }) {
  const [store] = useState(getNavigationStore);
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  useLayoutEffect(() => {
    if (identity) rememberNavigationChrome(store, session, identity);
    else forgetNavigationChrome(store, session);
  }, [store, session, identity]);
  return null;
}

function collapsedPreference() {
  try { return localStorage.getItem('pc:nav-collapsed') === '1'; } catch { return false; }
}

/** Navigation only: no query hooks, inputs, compose actions, or global app layers. */
function PassiveChrome({ identity, path, children }: { identity: NavigationChromeIdentity; path: string; children: React.ReactNode }) {
  const [collapsed] = useState(collapsedPreference);
  const own = '/' + encodeURIComponent(identity.username || identity.ownerId);
  const tabs = [
    { href: '/home', label: 'Home', icon: Home }, { href: '/market', label: 'Market', icon: Store },
    { href: identity.business ? '/studio' : '/jobs', label: identity.business ? 'Studio' : 'Jobs', icon: identity.business ? LayoutDashboard : BriefcaseBusiness },
    { href: '/messages', label: 'Messages', icon: MessageCircle }, { href: own, label: 'Profile', icon: User },
  ];
  return <div className="min-h-screen" data-navigation-loading="verified">
    <a href="#loading-main-content" className={chrome.skipLink}>Skip to content</a>
    <aside data-app-chrome className={chrome.sidebar + (collapsed ? ' ' + chrome.collapsed : '')}>
      <div className={chrome.brandRow}><Link href="/home" prefetch={false} aria-label="Platinum Circles home" className={chrome.brand}>{collapsed ? <Image unoptimized src="/logo.png" width={36} height={36} alt="" /> : <Wordmark size={21} />}</Link></div>
      <nav aria-label="Primary" className={chrome.navigation}>
        {PRIMARY_DESTINATIONS.map(item => { const Icon = NAV_ICONS[item.icon]; return <Link key={item.href} href={item.href} prefetch={false} className={chrome.navItem} aria-label={item.label} aria-current={isDestinationActive(path, item.href) ? 'page' : undefined}><Icon size={22} aria-hidden />{collapsed ? null : <span>{item.label}</span>}</Link>; })}
        <Link href={own} prefetch={false} className={chrome.navItem} aria-label="Profile" aria-current={isDestinationActive(path, own) ? 'page' : undefined}><User size={22} aria-hidden />{collapsed ? null : <span>Profile</span>}</Link>
      </nav>
      <Link href={own} prefetch={false} className={chrome.sidebarAccount} aria-label="Your profile">
        {identity.avatarUrl ? <Image unoptimized src={identity.avatarUrl} width={36} height={36} alt="" /> : <span className={chrome.avatar}>{identity.name.trim().slice(0, 1).toUpperCase() || '?'}</span>}
        {collapsed ? null : <span className={chrome.accountCopy}><strong>{identity.name}</strong><small>{identity.username ? '@' + identity.username : 'Your profile'}</small></span>}
      </Link>
    </aside>
    <div className={'min-w-0 ' + (collapsed ? 'md:ml-[76px]' : 'md:ml-[248px]')}>
      <header data-app-chrome className={chrome.topbar}><span className="text-sm text-muted" role="status">Opening page…</span></header>
      <main id="loading-main-content" tabIndex={-1} className={chrome.wideContent}>{children}</main>
    </div>
    <nav data-app-chrome aria-label="Primary" className={chrome.surface + ' fixed inset-x-3 bottom-[max(8px,env(safe-area-inset-bottom))] z-40 flex gap-1 rounded-[32px] border p-1 md:hidden'}>
      {tabs.map(({ href, label, icon: Icon }) => <Link key={href} href={href} prefetch={false} className={chrome.navItem + ' ' + chrome.tab + ' flex flex-1 flex-col items-center justify-center'} aria-label={label} aria-current={isDestinationActive(path, href) ? 'page' : undefined}><Icon size={22} aria-hidden /><span className="text-[10px] font-semibold leading-none">{label}</span></Link>)}
    </nav>
  </div>;
}

export function NavigationLoading({ children }: { children: React.ReactNode }) {
  const [store] = useState(getNavigationStore);
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const path = usePathname();
  const identity = readNavigationChrome(store, session, path);
  return identity ? <PassiveChrome identity={identity} path={path}>{children}</PassiveChrome>
    : <main className="min-h-screen p-6" aria-busy="true" data-navigation-loading="neutral">{children}</main>;
}
