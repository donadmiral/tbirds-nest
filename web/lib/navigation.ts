/** Public destinations are shared by the desktop rail, mobile menu and search. */
export const PRIMARY_DESTINATIONS = [
  { href: '/home', label: 'Home', icon: 'home' },
  { href: '/discover', label: 'Discover', icon: 'compass' },
  { href: '/watch', label: 'Watch', icon: 'play' },
  { href: '/messages', label: 'Messages', icon: 'message' },
  { href: '/channels', label: 'Channels', icon: 'channel' },
  { href: '/communities', label: 'Communities', icon: 'users' },
  { href: '/jobs', label: 'Jobs', icon: 'briefcase' },
  { href: '/market', label: 'Market', icon: 'store' },
  { href: '/notifications', label: 'Notifications', icon: 'bell' },
] as const;

export const MORE_DESTINATIONS = [
  { href: '/saved', label: 'Saved collections', detail: 'Posts and ideas you kept', icon: 'bookmark' },
  { href: '/archive', label: 'Your archive', detail: 'Stories and past moments', icon: 'archive' },
  { href: '/ads', label: 'Advertising', detail: 'Promotions and campaign review', icon: 'megaphone' },
  { href: '/monetization', label: 'Earnings and IntoBank', detail: 'Statements, payouts and connections', icon: 'wallet' },
  { href: '/businesses', label: 'Business accounts', detail: 'Manage or apply for a business', icon: 'business' },
  { href: '/settings', label: 'Settings and privacy', detail: 'Account, appearance and security', icon: 'settings' },
  { href: '/settings/help', label: 'Help and support', detail: 'Get help and track requests', icon: 'help' },
] as const;

export function isDestinationActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

/** A visible, deterministic exit never sends someone to an unrelated website. */
export function parentDestination(pathname: string): { href: string; label: string } | null {
  if (pathname === '/write' || pathname === '/story/new') return { href: '/home', label: 'Back to Home' };
  if (pathname.startsWith('/post/') || pathname.startsWith('/story/') || pathname.startsWith('/album/')) return { href: '/home', label: 'Back to Home' };
  if (pathname.startsWith('/jobs/') && pathname !== '/jobs/messages') return { href: '/jobs', label: 'Back to Jobs' };
  if (pathname.startsWith('/market/') && pathname !== '/market/messages') return { href: '/market', label: 'Back to Market' };
  if (pathname.startsWith('/channels/')) return { href: '/channels', label: 'Back to Channels' };
  if (pathname.startsWith('/communities/')) return { href: '/communities', label: 'Back to Communities' };
  if (pathname.startsWith('/ads/')) return { href: '/ads', label: 'Back to Advertising' };
  if (pathname.startsWith('/businesses/')) return { href: '/businesses', label: 'Back to Businesses' };
  if (pathname.startsWith('/topic/')) return { href: '/discover', label: 'Back to Discover' };
  return null;
}

export type ComposeIntent = 'post' | 'photo' | 'video' | 'poll';
export function composeHref(intent: ComposeIntent): string { return '/home?compose=' + intent; }
