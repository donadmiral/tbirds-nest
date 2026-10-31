import { getNavigationStore } from './navigationCache';
import { replaceContentMedia } from '../../shared/contentMedia';

export const profileNavigationKey = (profileId: string, kind: 'posts' | 'books') => `profile:${profileId}:${kind}`;
let observingMutations = false;

/** Retain only the viewer's own content. Visitor visibility remains server-authoritative. */
export function getProfileNavigationStore() {
  const store = getNavigationStore();
  if (typeof window !== 'undefined' && !observingMutations) {
    observingMutations = true;
    const invalidatePosts = () => {
      const session = store.getSnapshot();
      if (session.owner) store.cache.remove(session.scope, profileNavigationKey(session.owner, 'posts'));
    };
    // These events may fire on another route while the profile is unmounted.
    window.addEventListener('pc-refresh-feed', invalidatePosts);
    window.addEventListener('pc-feed-hidden', invalidatePosts);
    window.addEventListener('pc-feed-author-hidden', invalidatePosts);
  }
  return store;
}

/** A warm metadata snapshot must not turn an expired signed URL into a capability. */
export function safeProfileMemoryRows<T extends object>(rows: T[], now = Date.now()): T[] {
  return rows.map(row => {
    const expiry = (row as { _mediaExpiresAt?: unknown })._mediaExpiresAt;
    return typeof expiry === 'number' && (!Number.isFinite(expiry) || expiry <= now)
      ? replaceContentMedia(row, process.env.NEXT_PUBLIC_SUPABASE_URL!, new Map()) as T : row;
  });
}
