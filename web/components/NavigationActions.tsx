'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Archive, BarChart3, Bell, Bookmark, BriefcaseBusiness, Camera, CircleHelp, Compass, FileText, Home, Image, LayoutDashboard, Megaphone, MessageCircle, MoreHorizontal, Plus, Radio, Settings, Store, User, Users, Video, Wallet, PlaySquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MORE_DESTINATIONS, PRIMARY_DESTINATIONS, composeHref, type ComposeIntent } from '@/lib/navigation';
import { NavigationPopover } from './NavigationPopover';
import chrome from './NavigationChrome.module.css';

export const NAV_ICONS: Record<string, LucideIcon> = {
  home: Home, compass: Compass, play: PlaySquare, message: MessageCircle, channel: Radio,
  users: Users, briefcase: BriefcaseBusiness, store: Store, bell: Bell, bookmark: Bookmark,
  archive: Archive, megaphone: Megaphone, wallet: Wallet, business: BriefcaseBusiness,
  settings: Settings, help: CircleHelp,
};

const CREATE = [
  { label: 'Post', detail: 'Share an update or start a conversation', intent: 'post' as const, icon: MessageCircle },
  { label: 'Photos', detail: 'Add, edit and order your photographs', intent: 'photo' as const, icon: Image },
  { label: 'Video', detail: 'Trim a clip and choose its cover', intent: 'video' as const, icon: Video },
  { label: 'Poll', detail: 'Ask your circles a question', intent: 'poll' as const, icon: BarChart3 },
];

export function CreateMenu({ compact = false, sidebar = false }: { compact?: boolean; sidebar?: boolean }) {
  const path = usePathname();
  const compose = (event: React.MouseEvent, intent: ComposeIntent, close: () => void) => {
    close();
    if (path !== '/home' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.dispatchEvent(new CustomEvent('pc-compose', { detail: { intent } }));
  };
  return <NavigationPopover label="Create" side={sidebar ? 'right' : 'bottom'} className={compact ? chrome.control : chrome.createButton}
    trigger={<><Plus size={21} strokeWidth={1.8} aria-hidden />{compact ? null : <span>Create</span>}</>}>
    {close => <>
      <div className={chrome.menuHeading}><strong>Create something</strong><span>Choose how to share your next moment.</span></div>
      {CREATE.map(({ label, detail, intent, icon: Icon }) => <Link key={intent} href={composeHref(intent)} onClick={event => compose(event, intent, close)} className={chrome.menuLink}>
        <Icon size={20} strokeWidth={1.8} aria-hidden /><span><strong>{label}</strong><small>{detail}</small></span>
      </Link>)}
      <div className={chrome.menuDivider} />
      <Link href="/story/new" onClick={close} className={chrome.menuLink}><Camera size={20} strokeWidth={1.8} aria-hidden /><span><strong>Story</strong><small>Capture, edit and share a story</small></span></Link>
      <Link href="/write" onClick={close} className={chrome.menuLink}><FileText size={20} strokeWidth={1.8} aria-hidden /><span><strong>Article</strong><small>A little more room for your ideas</small></span></Link>
    </>}
  </NavigationPopover>;
}

export function MoreMenu({ compact = false, mobile = false, profileHref }: { compact?: boolean; mobile?: boolean; profileHref?: string }) {
  return <NavigationPopover label={mobile ? 'All destinations' : 'More'} side={mobile ? 'bottom' : 'right'}
    className={compact || mobile ? chrome.control : chrome.navItem}
    trigger={<><MoreHorizontal size={22} strokeWidth={1.8} aria-hidden />{compact || mobile ? null : <span>More</span>}</>}>
    {close => <>
      <div className={chrome.menuHeading}><strong>{mobile ? 'Explore Platinum Circles' : 'More from your circles'}</strong></div>
      {mobile ? <>
        <div className={chrome.mobileDestinations}>
          {PRIMARY_DESTINATIONS.map(item => { const Icon = NAV_ICONS[item.icon]; return <Link key={item.href} href={item.href} onClick={close}><Icon size={21} strokeWidth={1.8} aria-hidden /><span>{item.label}</span></Link>; })}
          {profileHref ? <Link href={profileHref} onClick={close}><User size={21} strokeWidth={1.8} aria-hidden /><span>Profile</span></Link> : null}
          <Link href="/studio" onClick={close}><LayoutDashboard size={21} strokeWidth={1.8} aria-hidden /><span>Studio</span></Link>
        </div><div className={chrome.menuDivider} />
      </> : null}
      {MORE_DESTINATIONS.map(item => { const Icon = NAV_ICONS[item.icon]; return <Link key={item.href} href={item.href} onClick={close} className={chrome.menuLink}>
        <Icon size={20} strokeWidth={1.8} aria-hidden /><span><strong>{item.label}</strong><small>{item.detail}</small></span>
      </Link>; })}
    </>}
  </NavigationPopover>;
}
