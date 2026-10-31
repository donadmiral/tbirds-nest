import type { getNavigationStore } from './navigationCache';
import { MORE_DESTINATIONS, PRIMARY_DESTINATIONS } from './navigation';

export type NavigationChromeIdentity = {
  ownerId: string; name: string; username: string; business: boolean; avatarUrl: string | null;
};
type Store = ReturnType<typeof getNavigationStore>;
type Session = ReturnType<Store['getSnapshot']>;
type Memory = NavigationChromeIdentity & { scope: string; revision: number };
const KEY = 'shell:verified-navigation';
const NEUTRAL = new Set(['api', 'auth', 'login', 'signup', 'reset-password', 'forgot-password', 'business-login', 'account-deletion', 'privacy', 'terms', 'about', 'music', 'calls', 'write', 'post', 'story', 'studio']);
const STANDARD = new Set([
  ...PRIMARY_DESTINATIONS.map(item => item.href.split('/')[1]),
  ...MORE_DESTINATIONS.map(item => item.href.split('/')[1]),
  'search', 'explore', 'album', 'topic',
]);

/** Only ordinary AppShell destinations and the recorded owner's profile opt in. */
export function supportsNavigationChrome(path: string, identity: NavigationChromeIdentity): boolean {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length || NEUTRAL.has(parts[0])) return false;
  if (STANDARD.has(parts[0])) return true;
  const own = new Set([identity.ownerId, identity.username].filter(Boolean).map(encodeURIComponent));
  return own.has(parts[0]) && (parts.length === 1 || (parts.length === 2 && parts[1] === 'follows'));
}

/** Only canonical first-party public avatars can appear in the transient view. */
export function navigationAvatar(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.origin !== new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin || !parsed.pathname.startsWith('/storage/v1/object/public/avatars/')) return null;
    return url;
  } catch { return null; }
}

function current(store: Store, captured: Session): boolean {
  const live = store.getSnapshot();
  return captured.initialized && !captured.changed && !!captured.scope && !!captured.owner
    && live.initialized && !live.changed && live.owner === captured.owner
    && live.scope === captured.scope && live.revision === captured.revision;
}

/** Called synchronously after the existing server-verified shell has committed. */
export function rememberNavigationChrome(store: Store, captured: Session, identity: NavigationChromeIdentity): boolean {
  if (!current(store, captured) || identity.ownerId !== captured.owner) return false;
  return store.cache.save<Memory>(captured.scope, KEY, {
    ownerId: identity.ownerId, name: identity.name, username: identity.username, business: identity.business,
    avatarUrl: navigationAvatar(identity.avatarUrl), scope: captured.scope!, revision: captured.revision,
  });
}

/** A verified guest result can arrive before the browser's Auth observer catches up. */
export function forgetNavigationChrome(store: Store, captured: Session): void {
  if (current(store, captured)) store.cache.remove(captured.scope, KEY);
}

export function readNavigationChrome(store: Store, captured: Session, path: string): NavigationChromeIdentity | null {
  if (!current(store, captured)) return null;
  const memory = store.cache.read<Memory>(captured.scope, KEY);
  if (!memory || memory.ownerId !== captured.owner || memory.scope !== captured.scope || memory.revision !== captured.revision || !supportsNavigationChrome(path, memory)) return null;
  return { ownerId: memory.ownerId, name: memory.name, username: memory.username, business: memory.business, avatarUrl: navigationAvatar(memory.avatarUrl) };
}
