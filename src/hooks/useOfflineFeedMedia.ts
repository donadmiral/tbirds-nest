import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { offlineFeedMedia } from '../services/offlineFeedMedia';
import { useAuthStore } from '../stores/authStore';
import { contentObject } from '../../shared/contentMedia';
import { SUPABASE_URL } from '../services/supabase';
import { AppState } from 'react-native';

export function useOfflineFeedMedia(postId?: string | null, mediaId?: string | null, source?: string | null, sourceVersion?: string | null, enabled = true) {
  const session = useAuthStore(state => state.session);
  const read = useCallback(() => postId && mediaId && session ? offlineFeedMedia.peek(postId, mediaId) : null,
    [postId, mediaId, session]);
  const cached = useSyncExternalStore(offlineFeedMedia.subscribe, read, () => null);
  const readVersion = useCallback(() => postId && mediaId && session ? offlineFeedMedia.version(postId, mediaId) : null, [postId, mediaId, session]);
  const version = useSyncExternalStore(offlineFeedMedia.subscribe, readVersion, () => null);
  useEffect(() => {
    const open = () => { if (enabled && postId && mediaId && session) void offlineFeedMedia.open(postId, mediaId).catch(() => {}); };
    open();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') open(); });
    return () => subscription.remove();
  }, [postId, mediaId, session, version, source, enabled]);
  // A changed source cannot show the previous original even when card IDs are reused.
  return cached && sourceVersion === cached.sourceVersion && (!source || source === cached.uri || source.startsWith('data:image/') || contentObject(source, SUPABASE_URL)?.key === cached.objectKey) ? cached : null;
}
