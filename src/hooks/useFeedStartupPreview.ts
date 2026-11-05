import { useCallback, useSyncExternalStore } from 'react';
import { useAuthStore } from '../stores/authStore';
import { feedStartupPreviews } from '../services/feedStartupPreviews';

/** Read the one bounded cache entry directly. Expiry and account changes remove
 * it without copying decrypted image data into each mounted screen's state. */
export function useFeedStartupPreview(postId?: string | null, mediaId?: string | null) {
  const owner = useAuthStore(state => state.session?.user.id ?? null);
  const read = useCallback(() => owner && postId && mediaId
    ? feedStartupPreviews.peek(owner)?.find(row => row.postId === postId && row.mediaId === mediaId) ?? null
    : null, [owner, postId, mediaId]);
  return useSyncExternalStore(feedStartupPreviews.subscribe, read, () => null);
}
